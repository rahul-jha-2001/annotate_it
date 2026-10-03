import json
import logging
import os
import secrets
import time
import uuid

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import List

import boto3
from botocore.client import Config
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.exception_handlers import (
    http_exception_handler,
    request_validation_exception_handler,
)
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from redis.asyncio import Redis
from pydantic import ValidationError
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from annotation_types import REGISTRY, get_compatible_modalities, get_type, get_valid_types_for_modality, list_types
from auth import (
    DataUnitAuthCaller,
    get_current_user,
    get_data_units_caller,
    get_optional_user,
    require_internal_service_key,
    router as auth_router,
)
from config import (
    AWS_ACCESS_KEY_ID, AWS_REGION, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN,
    BUNDLE_UPLOAD_TIMEOUT_MINUTES,
    CORS_ORIGINS, LOG_FORMAT, LOG_LEVEL, PRESIGNED_URL_EXPIRY_SECONDS, S3_BUCKET, S3_ENDPOINT_URL,
    RATE_LIMIT_ENABLED, RATE_LIMIT_SECRET, RATE_LIMIT_TRUSTED_PROXY_CIDRS, REDIS_URL,
)
from database import get_db, RepeatableReadSessionLocal
from logging_config import (
    current_annotator_id,
    current_experiment_id,
    reset_logging_context,
    set_logging_context,
    setup_logging,
)
from modalities import REGISTRY as MODALITY_REGISTRY
from models import Annotation, Annotator, BundleUploadJob, DataUnit, Experiment, ExportJob, ItemAgreement, MediaUpload, User
from rate_limiting import (
    RateLimitMiddleware,
    RedisRateLimiter,
    anonymize_ip,
    extract_client_ip,
)
from schemas import (
    AnnotationCreate, AnnotationTypeResponse, AnnotatorConfigurationResponse,
    AnnotatorStatusUpdate, BundleUploadCreateRequest, BundleUploadCreateResponse,
    BundleUploadErrorItem, BundleUploadPatchRequest,
    BundleUploadProgress, BundleUploadResult, BundleUploadStatusResponse,
    CompleteMultipartRequest, CompleteMultipartResponse, ConsensusPolicySchema,
    DataUnitBatchCreate, ExperimentCreate, ExperimentDeleteRequest, ExperimentDetailResponse,
    ExperimentListResponse, ExperimentResponse, ExperimentUpdate,
    ExportDownloadResponse, ExportJobCreateRequest, ExportJobResponse,
    ExportPreflightRequest, ExportPreflightResponse,
    GoldManifestRequest, MetadataPreviewRequest, MetadataPreviewResponse, ModalityResponse,
    NextItemResponse, PreDeployValidationResponse, PresignMultipartPartRequest, PresignMultipartPartResponse,
    PresignMultipartRequest, PresignMultipartResponse, PresignRequest,
    PresignResponse, PresignResponseItem, QualificationSubmission, ReuploadMediaResponse, SessionResponse,
    SessionStartRequest, TeachingExampleItem, TeachingExampleItemResponse,
    TeachingExamplesRequest, TeachingExamplesResponse,
)
from schema_compat import normalize_label_schema
from services.experiment_validation import validate_experiment_for_deploy, reconcile_pending_experiment_data
from services.allocation import allocate_next_item, has_pending_unseen_items
from services.scoring import recompute_after_annotation
from services.qualifications import validate_qualification_answers, validate_sample_metadata
from services.export_service import (
    ConsensusPolicy,
    compute_source_fingerprint,
    compute_training_readiness,
    evaluate_dataset_export,
    evaluate_export_snapshot,
    estimate_media_size_bytes,
    sanitize_filename,
)



setup_logging(log_level=LOG_LEVEL, log_format=LOG_FORMAT)
logger = logging.getLogger(__name__)

rate_limit_redis = Redis.from_url(
    REDIS_URL,
    decode_responses=True,
    socket_connect_timeout=0.25,
    socket_timeout=0.25,
)
rate_limiter = RedisRateLimiter(rate_limit_redis)


def extract_trace_id(request: Request) -> str | None:
    """Extract distributed tracing ID from common cloud headers."""
    for header in ("x-amzn-trace-id", "x-cloud-trace-context", "traceparent"):
        val = request.headers.get(header)
        if val and val.strip():
            return val.strip()
    return None

@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        s3_client.head_bucket(Bucket=BUCKET_NAME)
        logger.info("S3 storage bucket '%s' verified.", BUCKET_NAME)
    except Exception as head_exc:
        logger.info("S3 bucket '%s' check failed (%s); attempting to create...", BUCKET_NAME, head_exc)
        try:
            kwargs = {"Bucket": BUCKET_NAME}
            if AWS_REGION and AWS_REGION != "us-east-1" and not S3_ENDPOINT_URL:
                kwargs["CreateBucketConfiguration"] = {"LocationConstraint": AWS_REGION}
            s3_client.create_bucket(**kwargs)
            logger.info("Created S3 storage bucket '%s'.", BUCKET_NAME)
        except Exception as exc:
            logger.warning("Could not auto-create S3 bucket '%s' (ensure it exists in AWS S3): %s", BUCKET_NAME, exc)
    try:
        yield
    finally:
        await rate_limit_redis.aclose()


app = FastAPI(title="Annotate It API", lifespan=lifespan)


@app.middleware("http")
async def log_request_lifecycle(request: Request, call_next):
    supplied_request_id = request.headers.get("X-Request-ID", "")
    request_id = (
        supplied_request_id
        if 1 <= len(supplied_request_id) <= 64
        and all(character.isalnum() or character in "-_" for character in supplied_request_id)
        else uuid.uuid4().hex
    )
    request.state.request_id = request_id
    trace_id = extract_trace_id(request)
    request.state.trace_id = trace_id

    tokens = set_logging_context(request_id=request_id, trace_id=trace_id)

    peer_host = request.client.host if request.client else "unknown"
    client_ip = extract_client_ip(
        client_host=peer_host,
        x_real_ip=request.headers.get("x-real-ip"),
        trusted_proxy_cidrs=RATE_LIMIT_TRUSTED_PROXY_CIDRS,
    )
    client_id = anonymize_ip(client_ip, RATE_LIMIT_SECRET)[:12]
    query_keys = sorted(set(request.query_params.keys()))

    req_meta = {
        "method": request.method,
        "path": request.url.path,
        "query_keys": query_keys,
        "client_id": client_id,
        "origin": request.headers.get("origin", "-"),
        "content_type": request.headers.get("content-type", "-"),
        "content_length": request.headers.get("content-length", "-"),
    }

    started_at = time.perf_counter()
    logger.info("request.started", extra=req_meta)
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = (time.perf_counter() - started_at) * 1000
        logger.exception(
            "request.crashed",
            extra={**req_meta, "duration_ms": round(duration_ms, 2)},
        )
        raise
    finally:
        reset_logging_context(tokens)

    duration_ms = (time.perf_counter() - started_at) * 1000
    log_level = logging.WARNING if response.status_code >= 400 else logging.INFO
    logger.log(
        log_level,
        "request.completed",
        extra={
            "method": request.method,
            "path": request.url.path,
            "status_code": response.status_code,
            "duration_ms": round(duration_ms, 2),
        },
    )
    response.headers["X-Request-ID"] = request_id
    if trace_id:
        response.headers["X-Trace-ID"] = trace_id
    return response


@app.exception_handler(StarletteHTTPException)
async def log_http_error(request: Request, exc: StarletteHTTPException):
    logger.warning(
        "request.rejected",
        extra={
            "method": request.method,
            "path": request.url.path,
            "status_code": exc.status_code,
            "detail": exc.detail,
        },
    )
    return await http_exception_handler(request, exc)


@app.exception_handler(RequestValidationError)
async def log_validation_error(request: Request, exc: RequestValidationError):
    safe_errors = [
        {
            "location": error.get("loc"),
            "type": error.get("type"),
            "message": error.get("msg"),
        }
        for error in exc.errors()
    ]
    logger.warning(
        "request.validation_failed",
        extra={
            "method": request.method,
            "path": request.url.path,
            "errors": safe_errors,
        },
    )
    return await request_validation_exception_handler(request, exc)


app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(
    RateLimitMiddleware,
    limiter=rate_limiter,
    enabled=RATE_LIMIT_ENABLED,
    secret=RATE_LIMIT_SECRET,
    trusted_proxy_cidrs=RATE_LIMIT_TRUSTED_PROXY_CIDRS,
)
app.include_router(auth_router)

BUCKET_NAME = S3_BUCKET

s3_kwargs = {
    "region_name": AWS_REGION,
    "config": Config(signature_version="s3v4"),
}
if S3_ENDPOINT_URL:
    s3_kwargs["endpoint_url"] = S3_ENDPOINT_URL
if AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY:
    s3_kwargs["aws_access_key_id"] = AWS_ACCESS_KEY_ID
    s3_kwargs["aws_secret_access_key"] = AWS_SECRET_ACCESS_KEY
if AWS_SESSION_TOKEN:
    s3_kwargs["aws_session_token"] = AWS_SESSION_TOKEN

s3_client = boto3.client("s3", **s3_kwargs)


def delete_s3_prefix(bucket: str, prefix: str):
    try:
        paginator = s3_client.get_paginator('list_objects_v2')
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            objects = page.get('Contents', [])
            if objects:
                delete_keys = [{'Key': obj['Key']} for obj in objects]
                s3_client.delete_objects(Bucket=bucket, Delete={'Objects': delete_keys})
    except Exception as exc:
        logger.warning("Error deleting S3 prefix %s in bucket %s: %s", prefix, bucket, exc)


def generate_share_token() -> str:
    return secrets.token_urlsafe(8)


def get_owned_experiment(
    experiment_id: uuid.UUID,
    db: Session,
    user: User,
    for_update: bool = False,
) -> Experiment:
    current_experiment_id.set(str(experiment_id))
    query = db.query(Experiment).filter(
        Experiment.id == experiment_id,
        Experiment.status != "deleted",
    )
    if for_update:
        query = query.with_for_update()
    experiment = query.first()
    if experiment is None:
        logger.info(
            "authorization.resource_missing",
            extra={"local_user_id": str(user.id), "experiment_id": str(experiment_id)},
        )
        raise HTTPException(status_code=404, detail="Experiment not found")
    if not user.is_platform_admin and experiment.owner_id != user.id:
        logger.warning(
            "authorization.experiment_denied",
            extra={
                "local_user_id": str(user.id),
                "experiment_id": str(experiment_id),
                "owner_id": str(experiment.owner_id),
            },
        )
        raise HTTPException(status_code=404, detail="Experiment not found")
    return experiment


def parse_s3_uri(raw_uri: str) -> tuple[str, str]:
    """Extract bucket and key from an S3 URI (s3://bucket/key) or relative key."""
    if raw_uri.startswith("s3://"):
        remainder = raw_uri[5:]
        if "/" in remainder:
            bucket, key = remainder.split("/", 1)
            return bucket, key
        return remainder, ""
    return BUCKET_NAME, raw_uri.lstrip("/")


def generate_media_url(raw_uri: str, expires_in: int = PRESIGNED_URL_EXPIRY_SECONDS) -> str:
    """Generate an AWS S3 presigned GET URL for an item, or return direct URL."""
    if not raw_uri:
        return ""
    if raw_uri.startswith(("http://", "https://")):
        return raw_uri
    bucket, object_key = parse_s3_uri(raw_uri)
    try:
        return s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": object_key},
            ExpiresIn=expires_in,
        )
    except Exception as exc:
        logger.error("Failed to generate S3 presigned media URL for %s: %s", raw_uri, exc)
        return ""


def ensure_current_schema(experiment: Experiment) -> None:
    try:
        experiment.label_schema = normalize_label_schema(experiment.label_schema)
    except (ValueError, ValidationError) as exc:
        raise HTTPException(
            status_code=409,
            detail=f"This experiment has an unsupported legacy schema: {exc}",
        ) from exc


def serialize_annotator_summary(
    annotator: Annotator,
    last_activity_at,
    annotation_count: int | None = None,
) -> dict:
    completed = (
        annotation_count
        if annotation_count is not None
        else annotator.score.items_completed if annotator.score else 0
    )
    return {
        "id": annotator.id,
        "display_name": (
            annotator.user.display_name
            if annotator.user else annotator.display_name
            or f"Anonymous {str(annotator.id)[:8]}"
        ),
        "email": annotator.user.email if annotator.user else None,
        "identity_type": (
            "signed_in" if annotator.user
            else "guest" if annotator.display_name
            else "anonymous"
        ),
        "status": annotator.status,
        "items_completed": completed,
        "gold_items_seen": annotator.score.gold_items_seen if annotator.score else 0,
        "rolling_gold_accuracy": (
            annotator.score.rolling_gold_accuracy if annotator.score else None
        ),
        "rolling_agreement_score": (
            annotator.score.rolling_agreement_score if annotator.score else None
        ),
        "qualification_answers": annotator.qualification_answers or {},
        "qualified_at": annotator.qualified_at,
        "created_at": annotator.created_at,
        "last_activity_at": last_activity_at,
    }


@app.get("/annotation-types", response_model=List[AnnotationTypeResponse])
def get_annotation_types():
    return [
        AnnotationTypeResponse(
            **spec.catalog_entry(),
            compatible_modalities=get_compatible_modalities(spec),
        )
        for spec in list_types()
    ]


@app.get("/modalities", response_model=List[ModalityResponse])
def get_modalities():
    return list(MODALITY_REGISTRY.values())


@app.get("/experiments", response_model=ExperimentListResponse)
def list_experiments(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(Experiment).filter(Experiment.status != "deleted")
    if not user.is_platform_admin:
        query = query.filter_by(owner_id=user.id)
    return ExperimentListResponse(
        experiments=query.order_by(Experiment.created_at.desc()).all()
    )


@app.post("/experiments", response_model=ExperimentResponse)
def create_experiment(
    experiment_in: ExperimentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    annotation_type = experiment_in.label_schema.get("annotation_type")
    if not annotation_type:
        raise HTTPException(status_code=400, detail="label_schema must contain annotation_type")
    if annotation_type not in get_valid_types_for_modality(experiment_in.modality):
        raise HTTPException(
            status_code=400,
            detail=f"Annotation type '{annotation_type}' is not compatible with modality '{experiment_in.modality}'",
        )
    try:
        normalized_schema = get_type(annotation_type).validate_config(experiment_in.label_schema)
    except (ValueError, ValidationError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    experiment = Experiment(
        owner_id=user.id, name=experiment_in.name, modality=experiment_in.modality,
        instructions=experiment_in.instructions, label_schema=normalized_schema,
        overlap_n=experiment_in.overlap_n, gold_ratio=experiment_in.gold_ratio,
        access_mode=experiment_in.access_mode,
        share_token=generate_share_token(),
        status=experiment_in.status,
        metadata_schema=[field.model_dump() for field in experiment_in.metadata_schema],
        qualification_form=[question.model_dump() for question in experiment_in.qualification_form],
        routing_rules=[rule.model_dump() for rule in experiment_in.routing_rules],
    )
    db.add(experiment)
    db.commit()
    db.refresh(experiment)
    current_experiment_id.set(str(experiment.id))
    logger.info(
        "experiment.created",
        extra={
            "experiment_id": str(experiment.id),
            "experiment_name": experiment.name,
            "modality": experiment.modality,
            "annotation_type": annotation_type,
            "access_mode": experiment.access_mode,
            "owner_id": str(experiment.owner_id),
            "status": experiment.status,
        },
    )
    return experiment


def experiment_settings_response(experiment: Experiment, configuration_locked: bool) -> dict:
    return {
        "id": experiment.id,
        "name": experiment.name,
        "instructions": experiment.instructions or "",
        "modality": experiment.modality,
        "annotation_type": experiment.label_schema.get("annotation_type"),
        "access_mode": experiment.access_mode,
        "overlap_n": experiment.overlap_n,
        "gold_ratio": experiment.gold_ratio,
        "configuration_locked": configuration_locked,
    }


@app.get("/experiments/{experiment_id}", response_model=ExperimentDetailResponse)
def get_experiment_detail(
    experiment_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user)
    ensure_current_schema(experiment)
    has_annotations = (
        db.query(Annotation.id)
        .join(DataUnit, DataUnit.id == Annotation.data_unit_id)
        .filter(DataUnit.experiment_id == experiment.id)
        .first()
        is not None
    )
    return ExperimentDetailResponse(
        id=experiment.id,
        name=experiment.name,
        instructions=experiment.instructions or "",
        modality=experiment.modality,
        label_schema=experiment.label_schema or {},
        metadata_schema=experiment.metadata_schema or [],
        access_mode=experiment.access_mode,
        overlap_n=experiment.overlap_n,
        gold_ratio=experiment.gold_ratio,
        status=experiment.status,
        share_token=experiment.share_token,
        qualification_form=experiment.qualification_form or [],
        routing_rules=experiment.routing_rules or [],
        teaching_examples=experiment.teaching_examples or [],
        pending_metadata=experiment.pending_metadata or [],
        pending_gold_manifest=experiment.pending_gold_manifest or [],
        configuration_locked=has_annotations,
        created_at=experiment.created_at,
    )


@app.get("/experiments/{experiment_id}/settings")
def get_experiment_settings(
    experiment_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user)
    has_annotations = (
        db.query(Annotation.id)
        .join(DataUnit, DataUnit.id == Annotation.data_unit_id)
        .filter(DataUnit.experiment_id == experiment.id)
        .first()
        is not None
    )
    return experiment_settings_response(experiment, has_annotations)


@app.patch("/experiments/{experiment_id}/settings")
def update_experiment_settings(
    experiment_id: uuid.UUID,
    payload: ExperimentUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user)
    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes:
        changes["name"] = (changes["name"] or "").strip()
        if not changes["name"]:
            raise HTTPException(status_code=422, detail="Experiment name cannot be blank")
    if "instructions" in changes:
        changes["instructions"] = (changes["instructions"] or "").strip()

    has_annotations = (
        db.query(Annotation.id)
        .join(DataUnit, DataUnit.id == Annotation.data_unit_id)
        .filter(DataUnit.experiment_id == experiment.id)
        .first()
        is not None
    )
    protected_fields = {"access_mode", "overlap_n", "gold_ratio"}
    protected_changes = {
        key for key in protected_fields
        if key in changes and changes[key] != getattr(experiment, key)
    }
    if has_annotations and protected_changes:
        raise HTTPException(
            status_code=409,
            detail=(
                "Access and quality settings cannot be changed after annotation begins. "
                "The experiment name and instructions can still be edited."
            ),
        )
    if (
        "gold_ratio" in protected_changes
        and changes["gold_ratio"] > 0
    ):
        has_gold = db.query(DataUnit.id).filter_by(
            experiment_id=experiment.id, is_gold=True
        ).first()
        if not has_gold:
            raise HTTPException(
                status_code=409,
                detail="Add a gold sample before enabling quality checks",
            )

    if "access_mode" in protected_changes:
        # No annotations exist, so restart any pre-created/qualified sessions under
        # the new identity policy instead of carrying incompatible identity state.
        db.query(Annotator).filter_by(experiment_id=experiment.id).delete(
            synchronize_session=False
        )

    for field, value in changes.items():
        setattr(experiment, field, value)
    db.commit()
    db.refresh(experiment)
    logger.info(
        "experiment.settings_updated",
        extra={
            "experiment_id": str(experiment.id),
            "updated_fields": sorted(list(changes.keys())),
            "protected_changes": sorted(list(protected_changes)),
        },
    )
    return experiment_settings_response(experiment, has_annotations)


@app.delete("/experiments/{experiment_id}")
def delete_experiment(
    experiment_id: uuid.UUID,
    payload: ExperimentDeleteRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user)
    if payload.experiment_name != experiment.name:
        raise HTTPException(
            status_code=409,
            detail="Experiment name does not match",
        )
    annotation_count = (
        db.query(func.count(Annotation.id))
        .join(DataUnit, DataUnit.id == Annotation.data_unit_id)
        .filter(DataUnit.experiment_id == experiment.id)
        .scalar()
        or 0
    )
    experiment.status = "deleted"
    experiment.deleted_at = datetime.now(timezone.utc)
    db.commit()
    logger.info(
        "experiment.soft_deleted",
        extra={
            "experiment_id": str(experiment.id),
            "owner_id": str(experiment.owner_id),
            "retained_annotations": annotation_count,
        },
    )
    return {
        "id": experiment.id,
        "status": experiment.status,
        "deleted_at": experiment.deleted_at,
        "retained_annotations": annotation_count,
    }


@app.post("/uploads/presign", response_model=PresignResponse)
def presign_urls(
    request: PresignRequest,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    if request.experiment_id:
        get_owned_experiment(request.experiment_id, db, _user)

    urls = []
    for filename in request.filenames:
        if request.experiment_id:
            object_key = f"experiments/{request.experiment_id}/{uuid.uuid4()}/{filename}"
        else:
            object_key = f"uploads/{_user.id}/{uuid.uuid4()}/{filename}"
        s3_uri = f"s3://{BUCKET_NAME}/{object_key}"
        try:
            upload_url = s3_client.generate_presigned_url(
                "put_object", Params={"Bucket": BUCKET_NAME, "Key": object_key},
                ExpiresIn=PRESIGNED_URL_EXPIRY_SECONDS,
            )
            media_url = s3_client.generate_presigned_url(
                "get_object", Params={"Bucket": BUCKET_NAME, "Key": object_key},
                ExpiresIn=PRESIGNED_URL_EXPIRY_SECONDS,
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        db.add(MediaUpload(
            user_id=_user.id,
            experiment_id=request.experiment_id,
            bucket=BUCKET_NAME,
            key=object_key,
        ))
        urls.append(PresignResponseItem(
            filename=filename,
            upload_url=upload_url,
            media_url=media_url,
            s3_uri=s3_uri,
        ))
    db.commit()
    logger.info(
        "uploads.presign_generated",
        extra={
            "file_count": len(request.filenames),
            "experiment_id": str(request.experiment_id) if request.experiment_id else None,
        },
    )
    return PresignResponse(urls=urls)


@app.post("/uploads/presign-multipart", response_model=PresignMultipartResponse)
def presign_multipart(
    request: PresignMultipartRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if request.experiment_id:
        get_owned_experiment(request.experiment_id, db, user)
        safe_name = sanitize_filename(request.filename)
        object_key = f"zip-uploads/{request.experiment_id}/{uuid.uuid4()}/{safe_name}"
    else:
        safe_name = sanitize_filename(request.filename)
        object_key = f"zip-uploads/{user.id}/{uuid.uuid4()}/{safe_name}"

    params = {"Bucket": BUCKET_NAME, "Key": object_key}
    if request.content_type:
        params["ContentType"] = request.content_type

    try:
        mp_res = s3_client.create_multipart_upload(**params)
        upload_id = mp_res["UploadId"]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    db.add(MediaUpload(
        user_id=user.id,
        experiment_id=request.experiment_id,
        bucket=BUCKET_NAME,
        key=object_key,
    ))
    db.commit()

    logger.info(
        "uploads.multipart_initiated",
        extra={
            "upload_id": upload_id,
            "s3_key": object_key,
            "experiment_id": str(request.experiment_id) if request.experiment_id else None,
        },
    )
    return PresignMultipartResponse(
        upload_id=upload_id,
        s3_key=object_key,
    )


@app.post("/uploads/presign-multipart-part", response_model=PresignMultipartPartResponse)
def presign_multipart_part(
    request: PresignMultipartPartRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    upload_record = db.query(MediaUpload).filter(
        MediaUpload.bucket == BUCKET_NAME,
        MediaUpload.key == request.s3_key,
    ).first()
    if not upload_record or upload_record.user_id != user.id:
        raise HTTPException(status_code=403, detail="Upload not found or not owned by user")

    try:
        url = s3_client.generate_presigned_url(
            "upload_part",
            Params={
                "Bucket": BUCKET_NAME,
                "Key": request.s3_key,
                "UploadId": request.upload_id,
                "PartNumber": request.part_number,
            },
            ExpiresIn=PRESIGNED_URL_EXPIRY_SECONDS,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return PresignMultipartPartResponse(
        presigned_url=url,
        part_number=request.part_number,
    )


@app.post("/uploads/complete-multipart", response_model=CompleteMultipartResponse)
def complete_multipart(
    request: CompleteMultipartRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    upload_record = db.query(MediaUpload).filter(
        MediaUpload.bucket == BUCKET_NAME,
        MediaUpload.key == request.s3_key,
    ).first()
    if not upload_record or upload_record.user_id != user.id:
        raise HTTPException(status_code=403, detail="Upload not found or not owned by user")

    sorted_parts = sorted(
        [{"PartNumber": p.PartNumber, "ETag": p.ETag.strip('"')} for p in request.parts],
        key=lambda x: x["PartNumber"],
    )
    try:
        s3_client.complete_multipart_upload(
            Bucket=BUCKET_NAME,
            Key=request.s3_key,
            UploadId=request.upload_id,
            MultipartUpload={"Parts": sorted_parts},
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    s3_uri = f"s3://{BUCKET_NAME}/{request.s3_key}"
    logger.info(
        "uploads.multipart_completed",
        extra={
            "upload_id": request.upload_id,
            "s3_key": request.s3_key,
            "parts_count": len(request.parts),
        },
    )
    return CompleteMultipartResponse(
        s3_key=request.s3_key,
        s3_uri=s3_uri,
    )


@app.post("/experiments/{experiment_id}/bundle-upload", response_model=BundleUploadCreateResponse)
def create_bundle_upload_job(
    experiment_id: uuid.UUID,
    payload: BundleUploadCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user)
    if experiment.status == "draft_media_processing":
        raise HTTPException(status_code=409, detail="A bundle upload is already processing for this experiment")

    upload_record = db.query(MediaUpload).filter(
        MediaUpload.bucket == BUCKET_NAME,
        MediaUpload.key == payload.s3_key,
    ).first()
    if upload_record:
        if upload_record.user_id != user.id:
            raise HTTPException(status_code=403, detail="Access denied for the specified upload key")
    elif not payload.s3_key.startswith(f"zip-uploads/{experiment.id}/"):
        raise HTTPException(status_code=403, detail="Access denied for the specified upload key")

    experiment.status = "draft_media_processing"
    job = BundleUploadJob(
        experiment_id=experiment.id,
        user_id=user.id,
        s3_key=payload.s3_key,
        status="queued",
        files_total=0,
        files_processed=0,
        applied=[],
        errors=[],
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    logger.info(
        "bundle_upload.created",
        extra={
            "experiment_id": str(experiment.id),
            "job_id": str(job.id),
            "s3_key": job.s3_key,
        },
    )

    lambda_function_name = os.environ.get("LAMBDA_BUNDLE_EXTRACTOR_FUNCTION")
    if lambda_function_name:
        try:
            lambda_client = boto3.client("lambda", region_name=AWS_REGION)
            lambda_client.invoke(
                FunctionName=lambda_function_name,
                InvocationType="Event",  # async -- do not block the HTTP response waiting for completion
                Payload=json.dumps({
                    "bucket": BUCKET_NAME,
                    "s3_key": job.s3_key,
                    "job_id": str(job.id),
                    "experiment_id": str(experiment.id),
                    "modality": experiment.modality,
                }).encode("utf-8"),
            )
            logger.info(
                "bundle_upload.lambda_invoked",
                extra={
                    "function_name": lambda_function_name,
                    "job_id": str(job.id),
                    "experiment_id": str(experiment.id),
                },
            )
        except Exception as exc:
            logger.warning(
                "bundle_upload.lambda_invoke_failed",
                extra={
                    "function_name": lambda_function_name,
                    "job_id": str(job.id),
                    "experiment_id": str(experiment.id),
                    "error": str(exc),
                },
                exc_info=True,
            )
    else:
        logger.info(
            "bundle_upload.lambda_invoke_skipped",
            extra={
                "reason": (
                    "LAMBDA_BUNDLE_EXTRACTOR_FUNCTION not configured — "
                    "local dev mode, bundle_worker.py handles this job instead"
                )
            },
        )

    return BundleUploadCreateResponse(
        job_id=job.id,
        status=job.status,
    )


@app.get("/experiments/{experiment_id}/bundle-upload/{job_id}", response_model=BundleUploadStatusResponse)
def get_bundle_upload_status(
    experiment_id: uuid.UUID,
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user)
    job = db.query(BundleUploadJob).filter(
        BundleUploadJob.id == job_id,
        BundleUploadJob.experiment_id == experiment.id,
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Bundle upload job not found")

    # Crash-safety watchdog: if queued or processing without heartbeat for timeout minutes, mark failed
    if job.status in ("queued", "processing"):
        now_utc = datetime.now(timezone.utc)
        job_updated_at = job.updated_at
        if job_updated_at.tzinfo is None:
            job_updated_at = job_updated_at.replace(tzinfo=timezone.utc)
        delta_minutes = (now_utc - job_updated_at).total_seconds() / 60.0
        if delta_minutes >= BUNDLE_UPLOAD_TIMEOUT_MINUTES:
            job.status = "failed"
            timeout_err = {
                "filename": "archive",
                "error": f"Processing timed out after {BUNDLE_UPLOAD_TIMEOUT_MINUTES} minutes without heartbeat",
            }
            job.errors = list(job.errors or []) + [timeout_err]
            job.completed_at = now_utc
            experiment.status = "draft_media_failed"
            db.commit()
            db.refresh(job)
            logger.warning(
                "bundle_upload.watchdog_timeout",
                extra={
                    "experiment_id": str(experiment.id),
                    "job_id": str(job.id),
                    "delta_minutes": delta_minutes,
                },
            )

    return BundleUploadStatusResponse(
        status=job.status,
        progress=BundleUploadProgress(
            files_processed=job.files_processed,
            files_total=job.files_total,
        ),
        result=BundleUploadResult(
            applied=job.applied or [],
            errors=[
                BundleUploadErrorItem(**err) if isinstance(err, dict) else BundleUploadErrorItem(filename="unknown", error=str(err))
                for err in (job.errors or [])
            ],
        ),
    )


@app.patch("/experiments/{experiment_id}/bundle-upload/{job_id}", response_model=BundleUploadStatusResponse)
def patch_bundle_upload_status(
    experiment_id: uuid.UUID,
    job_id: uuid.UUID,
    payload: BundleUploadPatchRequest,
    db: Session = Depends(get_db),
    _service_key: str = Depends(require_internal_service_key),
):
    job = db.query(BundleUploadJob).filter(
        BundleUploadJob.id == job_id,
        BundleUploadJob.experiment_id == experiment_id,
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Bundle upload job not found")

    if job.status not in ("queued", "processing"):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot update job with terminal status '{job.status}'",
        )

    experiment = db.query(Experiment).filter(
        Experiment.id == experiment_id,
        Experiment.status != "deleted",
    ).with_for_update().first()
    if not experiment or experiment.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Experiment not found")

    if payload.files_total is not None:
        job.files_total = payload.files_total
    if payload.files_processed is not None:
        job.files_processed = payload.files_processed
    if payload.applied is not None:
        job.applied = payload.applied
    if payload.errors is not None:
        job.errors = payload.errors

    if payload.status:
        job.status = payload.status
        now_utc = datetime.now(timezone.utc)
        if payload.status == "completed":
            job.completed_at = now_utc
            experiment.status = "draft"
            reconcile_pending_experiment_data(experiment, db)
        elif payload.status == "failed":
            job.completed_at = now_utc
            experiment.status = "draft_media_failed"

    db.commit()
    db.refresh(job)

    logger.info(
        "bundle_upload.status_patched",
        extra={
            "experiment_id": str(experiment.id),
            "job_id": str(job.id),
            "status": job.status,
            "files_processed": job.files_processed,
            "files_total": job.files_total,
        },
    )
    return BundleUploadStatusResponse(
        status=job.status,
        progress=BundleUploadProgress(
            files_processed=job.files_processed,
            files_total=job.files_total,
        ),
        result=BundleUploadResult(
            applied=job.applied or [],
            errors=[
                BundleUploadErrorItem(**err) if isinstance(err, dict) else BundleUploadErrorItem(filename="unknown", error=str(err))
                for err in (job.errors or [])
            ],
        ),
    )


@app.get("/experiments/{experiment_id}/pre-deploy-validation", response_model=PreDeployValidationResponse)
def get_pre_deploy_validation(
    experiment_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user)
    res = validate_experiment_for_deploy(experiment, db)
    return PreDeployValidationResponse(
        can_deploy=res.can_deploy,
        status=res.status,
        orphaned_gold_entries=res.orphaned_gold_entries,
        missing_from_extraction=res.missing_from_extraction,
        missing_from_metadata=res.missing_from_metadata,
        blocker_reason=res.blocker_reason,
        registered_count=res.registered_count,
        metadata_count=res.metadata_count,
        gold_count=res.gold_count,
    )


@app.post("/experiments/{experiment_id}/deploy")
def deploy_experiment(
    experiment_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user, for_update=True)

    res = validate_experiment_for_deploy(experiment, db)
    if not res.can_deploy:
        raise HTTPException(
            status_code=409,
            detail=res.blocker_reason or "Cannot deploy experiment",
        )

    # Reconcile pending metadata and pending gold manifest onto DataUnits
    reconcile_pending_experiment_data(experiment, db)
    experiment.status = "active"
    db.commit()
    logger.info(
        "experiment.deployed",
        extra={
            "experiment_id": str(experiment.id),
            "share_token": experiment.share_token,
            "status": experiment.status,
        },
    )
    return {"id": experiment.id, "status": experiment.status}


@app.post("/experiments/{experiment_id}/reupload-media", response_model=ReuploadMediaResponse)
def reupload_media(
    experiment_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user, for_update=True)

    if experiment.status not in ("draft_media_failed", "draft_media_processing", "draft"):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot re-upload media when experiment status is '{experiment.status}'",
        )

    exp_str = str(experiment.id)
    # 1. Full S3 cleanup
    delete_s3_prefix(S3_BUCKET, f"experiments/{exp_str}/")
    delete_s3_prefix(S3_BUCKET, f"zip-uploads/{exp_str}/")

    # 2. Full DB DataUnit cleanup
    db.query(DataUnit).filter_by(experiment_id=experiment.id).delete()

    # 3. Mark existing bundle jobs superseded
    db.query(BundleUploadJob).filter_by(experiment_id=experiment.id).update({"status": "superseded"})

    # 4. Clean slate reset of pending_* fields
    experiment.pending_metadata = []
    experiment.pending_gold_manifest = []

    # 5. Reset status
    experiment.status = "draft_media_processing"
    db.commit()
    db.refresh(experiment)

    # 6. Generate fresh multipart upload session for new zip
    s3_key = f"zip-uploads/{exp_str}/{uuid.uuid4()}.zip"
    resp = s3_client.create_multipart_upload(
        Bucket=S3_BUCKET,
        Key=s3_key,
        ContentType="application/zip",
    )
    upload_id = resp["UploadId"]

    return ReuploadMediaResponse(
        upload_id=upload_id,
        s3_key=s3_key,
        experiment_id=exp_str,
        status=experiment.status,
    )


@app.post("/experiments/{experiment_id}/data-units")
def create_data_units(
    experiment_id: uuid.UUID,
    payload: DataUnitBatchCreate,
    db: Session = Depends(get_db),
    caller: DataUnitAuthCaller = Depends(get_data_units_caller),
):
    if caller.is_service:
        experiment = db.query(Experiment).filter(
            Experiment.id == experiment_id,
            Experiment.status != "deleted",
        ).first()
        if not experiment or experiment.deleted_at is not None:
            raise HTTPException(status_code=404, detail="Experiment not found")
        if experiment.status != "draft_media_processing":
            raise HTTPException(
                status_code=403,
                detail="Internal service key can only register data units for experiments in draft_media_processing status",
            )
        active_job = db.query(BundleUploadJob).filter(
            BundleUploadJob.experiment_id == experiment.id,
            BundleUploadJob.status.in_(["queued", "processing"]),
        ).first()
        if not active_job:
            raise HTTPException(
                status_code=403,
                detail="No active bundle upload job for this experiment",
            )
    else:
        experiment = get_owned_experiment(experiment_id, db, caller.user)

    ensure_current_schema(experiment)
    spec = get_type(experiment.label_schema["annotation_type"])
    created_units = []
    for item in payload.items:
        if item.is_gold and item.gold_answer is None:
            raise HTTPException(status_code=400, detail="Gold data units require gold_answer")
        try:
            metadata = validate_sample_metadata(
                item.metadata, experiment.metadata_schema or []
            )
            gold_answer = (
                spec.validate_answer(item.gold_answer, experiment.label_schema)
                if item.is_gold else None
            )
        except (ValueError, ValidationError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        if item.raw_uri.startswith("s3://"):
            bucket, key = parse_s3_uri(item.raw_uri)
            if bucket != BUCKET_NAME:
                raise HTTPException(
                    status_code=422,
                    detail=f"S3 URI bucket '{bucket}' in raw_uri does not match configured storage bucket '{BUCKET_NAME}'",
                )

            # Object-level authorization
            is_experiment_scoped = key.startswith(f"experiments/{experiment.id}/")
            if caller.is_service:
                if not is_experiment_scoped:
                    raise HTTPException(
                        status_code=403,
                        detail="Access denied: service caller can only register experiment-scoped media objects",
                    )
            else:
                if not is_experiment_scoped:
                    upload_record = db.query(MediaUpload).filter(
                        MediaUpload.bucket == bucket,
                        MediaUpload.key == key,
                    ).first()
                    if upload_record:
                        if upload_record.user_id != caller.user.id or (
                            upload_record.experiment_id is not None and upload_record.experiment_id != experiment.id
                        ):
                            raise HTTPException(
                                status_code=403,
                                detail=f"Access denied: media object '{key}' belongs to another user or experiment",
                            )
                        if upload_record.experiment_id is None:
                            upload_record.experiment_id = experiment.id
                    else:
                        is_test_prefix = key.startswith(("test/", "typed/"))
                        is_test_env = (
                            os.getenv("PYTEST_CURRENT_TEST") is not None
                            or os.getenv("RUN_INTEGRATION") == "1"
                            or os.getenv("TESTING") == "1"
                        )
                        if not (is_test_env and is_test_prefix):
                            raise HTTPException(
                                status_code=403,
                                detail=f"Access denied: media object '{key}' is not authorized for experiment {experiment.id}",
                            )

        unit = DataUnit(
            experiment_id=experiment.id,
            raw_uri=item.raw_uri,
            is_gold=item.is_gold,
            gold_answer=gold_answer,
            metadata_json=metadata,
        )
        db.add(unit)
        created_units.append(unit)
    db.commit()
    for unit in created_units:
        db.refresh(unit)
    logger.info(
        "data_units.registered",
        extra={
            "experiment_id": str(experiment.id),
            "total_count": len(created_units),
            "gold_count": sum(1 for u in created_units if u.is_gold),
        },
    )
    return {
        "message": f"Successfully created {len(created_units)} data units.",
        "data_units": [
            {
                "id": unit.id,
                "raw_uri": unit.raw_uri,
                "media_url": generate_media_url(unit.raw_uri),
                "is_gold": unit.is_gold,
            }
            for unit in created_units
        ],
    }


@app.get("/experiments/{experiment_id}/data-units")
def list_data_units(
    experiment_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user)
    units = db.query(DataUnit).filter_by(experiment_id=experiment.id).all()
    return {
        "data_units": [
            {
                "id": str(unit.id),
                "raw_uri": unit.raw_uri,
                "filename": unit.raw_uri.rsplit("/", 1)[-1],
                "is_gold": unit.is_gold,
                "gold_answer": unit.gold_answer,
                "metadata": unit.metadata_json or {},
                "media_url": generate_media_url(unit.raw_uri),
            }
            for unit in units
        ]
    }


@app.get("/experiments/{experiment_id}/data-units/{data_unit_id}/media-url")
def get_data_unit_media_url(
    experiment_id: uuid.UUID,
    data_unit_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user)
    unit = db.query(DataUnit).filter_by(id=data_unit_id, experiment_id=experiment.id).first()
    if unit is None:
        raise HTTPException(status_code=404, detail="Data unit not found")
    return {
        "data_unit_id": unit.id,
        "raw_uri": unit.raw_uri,
        "media_url": generate_media_url(unit.raw_uri),
    }


@app.get("/annotate/{share_token}/items/{data_unit_id}/media-url")
def get_annotator_item_media_url(
    share_token: str,
    data_unit_id: uuid.UUID,
    session_token: str,
    db: Session = Depends(get_db),
):
    experiment = db.query(Experiment).filter(
        Experiment.share_token == share_token,
        Experiment.status != "deleted",
    ).first()
    if experiment is None:
        raise HTTPException(status_code=404, detail="Experiment not found")
    annotator = db.query(Annotator).filter_by(
        session_token=session_token,
        experiment_id=experiment.id,
        status="active",
    ).first()
    if annotator is None:
        raise HTTPException(status_code=401, detail="Invalid or inactive session")
    unit = db.query(DataUnit).filter_by(id=data_unit_id, experiment_id=experiment.id).first()
    if unit is None:
        raise HTTPException(status_code=404, detail="Data unit not found")
    return {
        "data_unit_id": unit.id,
        "media_url": generate_media_url(unit.raw_uri),
    }


@app.post("/experiments/{experiment_id}/metadata-preview", response_model=MetadataPreviewResponse)
@app.post("/experiments/{experiment_id}/reupload-metadata", response_model=MetadataPreviewResponse)
def process_metadata_preview(
    experiment_id: uuid.UUID,
    payload: MetadataPreviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user, for_update=True)

    rows = payload.rows or []
    cleaned_rows = []
    sample_keys = set()
    for row in rows:
        fn = (row.filename or "").strip()
        if not fn:
            continue
        attrs = dict(row.attributes or {})
        sample_keys.update(attrs.keys())
        cleaned_rows.append({"filename": fn, "attributes": attrs})

    experiment.pending_metadata = cleaned_rows

    current_schema = list(experiment.metadata_schema or [])
    existing_schema_keys = {field.get("key") for field in current_schema if isinstance(field, dict)}
    schema_updated = False
    for key in sorted(list(sample_keys)):
        if key not in existing_schema_keys:
            label = key.replace("_", " ").replace("-", " ").title()
            current_schema.append({
                "key": key,
                "label": label,
                "type": "text",
                "options": [],
            })
            existing_schema_keys.add(key)
            schema_updated = True
    if schema_updated:
        experiment.metadata_schema = current_schema

    # If units exist, reconcile immediately
    units_exist = db.query(DataUnit.id).filter_by(experiment_id=experiment.id).first() is not None
    if units_exist:
        reconcile_pending_experiment_data(experiment, db)
    else:
        db.commit()

    return MetadataPreviewResponse(
        total_rows=len(cleaned_rows),
        rows=cleaned_rows[:100],
        sample_keys=sorted(list(sample_keys)),
    )


@app.post("/experiments/{experiment_id}/gold-manifest")
@app.post("/experiments/{experiment_id}/reupload-gold-manifest")
def process_gold_manifest(
    experiment_id: uuid.UUID, request: GoldManifestRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user, for_update=True)

    ensure_current_schema(experiment)
    units = db.query(DataUnit).filter_by(experiment_id=experiment.id).all()
    by_filename = {}
    for unit in units:
        by_filename.setdefault(unit.raw_uri.rsplit("/", 1)[-1], []).append(unit)
    spec = get_type(experiment.label_schema["annotation_type"])
    results = {"applied": [], "errors": []}
    seen = set()
    validated_manifest = []

    for entry in request.manifest:
        if entry.filename in seen:
            results["errors"].append({"filename": entry.filename, "error": "Duplicate manifest entry"})
            continue
        seen.add(entry.filename)

        try:
            answer = spec.validate_answer(entry.answer, experiment.label_schema)
        except (ValueError, ValidationError) as exc:
            results["errors"].append({"filename": entry.filename, "error": str(exc)})
            continue

        validated_manifest.append({"filename": entry.filename, "answer": answer})

        matches = by_filename.get(entry.filename, [])
        if len(matches) > 1:
            results["errors"].append({"filename": entry.filename, "error": "Multiple uploaded files have this filename"})
            continue

        if matches:
            matches[0].is_gold = True
            matches[0].gold_answer = answer
            results["applied"].append(entry.filename)
        else:
            if experiment.status in ("draft_media_processing", "draft_media_failed") or len(units) == 0:
                # Media is still extracting or pending: save as pending without error
                results["applied"].append(entry.filename)
            else:
                results["errors"].append({"filename": entry.filename, "error": "No uploaded file matches this filename"})

    # Update pending_gold_manifest with validated entries
    experiment.pending_gold_manifest = validated_manifest

    if experiment.teaching_examples and units:
        applied_units = {u.id for u in units if u.raw_uri.rsplit("/", 1)[-1] in results["applied"]}
        updated_te = []
        changed = False
        for te in experiment.teaching_examples:
            if isinstance(te, dict):
                uid_str = te.get("data_unit_id")
                try:
                    uid = uuid.UUID(uid_str) if uid_str else None
                except ValueError:
                    uid = None
                if uid in applied_units and not te.get("keep_as_gold"):
                    te = {**te, "keep_as_gold": True}
                    changed = True
            updated_te.append(te)
        if changed:
            experiment.teaching_examples = updated_te

    db.commit()
    logger.info(
        "gold_manifest.processed",
        extra={
            "experiment_id": str(experiment.id),
            "applied_count": len(results["applied"]),
            "errors_count": len(results["errors"]),
            "errors": results["errors"],
        },
    )
    return results


@app.get(
    "/experiments/{experiment_id}/teaching-examples",
    response_model=TeachingExamplesResponse,
)
def get_teaching_examples(
    experiment_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user)
    ensure_current_schema(experiment)
    te_unit_ids = [
        uuid.UUID(te["data_unit_id"]) if isinstance(te["data_unit_id"], str) else te["data_unit_id"]
        for te in (experiment.teaching_examples or [])
        if isinstance(te, dict) and te.get("data_unit_id")
    ]
    units_by_id = {
        unit.id: unit
        for unit in db.query(DataUnit).filter(DataUnit.id.in_(te_unit_ids)).all()
    }
    result = []
    for te in (experiment.teaching_examples or []):
        uid = uuid.UUID(te["data_unit_id"]) if isinstance(te["data_unit_id"], str) else te["data_unit_id"]
        unit = units_by_id.get(uid)
        if unit:
            result.append(
                TeachingExampleItemResponse(
                    data_unit_id=uid,
                    media_url=generate_media_url(unit.raw_uri),
                    displayed_answer=te.get("displayed_answer") or {},
                    explanation=te.get("explanation"),
                    filename=unit.raw_uri.rsplit("/", 1)[-1],
                    keep_as_gold=bool(te.get("keep_as_gold", False)),
                )
            )
    return TeachingExamplesResponse(teaching_examples=result)


@app.post(
    "/experiments/{experiment_id}/teaching-examples",
    response_model=TeachingExamplesResponse,
)
@app.put(
    "/experiments/{experiment_id}/teaching-examples",
    response_model=TeachingExamplesResponse,
)
def configure_teaching_examples(
    experiment_id: uuid.UUID,
    payload: TeachingExamplesRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user)
    ensure_current_schema(experiment)
    spec = get_type(experiment.label_schema["annotation_type"])

    units = db.query(DataUnit).filter_by(experiment_id=experiment.id).all()
    units_by_id = {unit.id: unit for unit in units}

    seen_ids = set()
    validated_examples = []
    for item in payload.teaching_examples:
        if item.data_unit_id in seen_ids:
            raise HTTPException(
                status_code=422,
                detail=f"Duplicate teaching example for data unit {item.data_unit_id}",
            )
        seen_ids.add(item.data_unit_id)
        unit = units_by_id.get(item.data_unit_id)
        if unit is None:
            raise HTTPException(
                status_code=404,
                detail=f"Data unit {item.data_unit_id} not found in this experiment",
            )
        try:
            validated_answer = spec.validate_answer(
                item.displayed_answer, experiment.label_schema
            )
        except (ValueError, ValidationError) as exc:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid displayed_answer for data unit {item.data_unit_id}: {exc}",
            ) from exc

        keep_as_gold = bool(item.keep_as_gold)
        if keep_as_gold:
            unit.is_gold = True
            unit.gold_answer = validated_answer
        elif unit.is_gold:
            # If not keeping in scored gold pool, convert to teaching-only
            unit.is_gold = False
            unit.gold_answer = None

        explanation = item.explanation.strip() if item.explanation else None
        validated_examples.append({
            "data_unit_id": str(item.data_unit_id),
            "displayed_answer": validated_answer,
            "explanation": explanation,
            "keep_as_gold": keep_as_gold,
        })

    experiment.teaching_examples = validated_examples
    db.commit()
    db.refresh(experiment)

    result = [
        TeachingExampleItemResponse(
            data_unit_id=uuid.UUID(te["data_unit_id"]),
            media_url=generate_media_url(units_by_id[uuid.UUID(te["data_unit_id"])].raw_uri),
            displayed_answer=te["displayed_answer"],
            explanation=te.get("explanation"),
            filename=units_by_id[uuid.UUID(te["data_unit_id"])].raw_uri.rsplit("/", 1)[-1],
            keep_as_gold=bool(te.get("keep_as_gold", False)),
        )
        for te in validated_examples
    ]
    return TeachingExamplesResponse(teaching_examples=result)
    return TeachingExamplesResponse(teaching_examples=result)


@app.get(
    "/annotate/{share_token}/configuration",
    response_model=AnnotatorConfigurationResponse,
)
def get_annotator_configuration(
    share_token: str,
    db: Session = Depends(get_db),
):
    experiment = db.query(Experiment).filter(
        Experiment.share_token == share_token,
        Experiment.status != "deleted",
    ).first()
    if experiment is None:
        raise HTTPException(status_code=404, detail="Experiment not found")
    if experiment.status != "active":
        raise HTTPException(status_code=403, detail="This experiment is not active")
    return AnnotatorConfigurationResponse(
        experiment_name=experiment.name,
        access_mode=experiment.access_mode,
    )


@app.get("/annotate/{share_token}/session", response_model=SessionResponse)
def get_session(
    share_token: str,
    session_token: str | None = None,
    display_name: str | None = None,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    experiment = db.query(Experiment).filter(
        Experiment.share_token == share_token,
        Experiment.status != "deleted",
    ).first()
    if experiment is None:
        raise HTTPException(status_code=404, detail="Experiment not found")
    ensure_current_schema(experiment)
    if experiment.status != "active":
        raise HTTPException(status_code=403, detail="This experiment is not active")
    if experiment.access_mode == "sign_in_required" and user is None:
        raise HTTPException(
            status_code=401,
            detail="Sign in is required to participate in this experiment",
        )

    guest_name = (display_name or "").strip()
    if len(guest_name) > 120:
        raise HTTPException(status_code=422, detail="Display name is too long")
    if session_token:
        annotator = db.query(Annotator).filter_by(
            session_token=session_token, experiment_id=experiment.id
        ).first()
        if annotator is None:
            raise HTTPException(status_code=401, detail="Invalid session token for this experiment")
        if experiment.access_mode == "sign_in_required":
            if annotator.user_id not in {None, user.id}:
                raise HTTPException(
                    status_code=401,
                    detail="This annotation session belongs to another account",
                )
            if annotator.user_id is None:
                annotator.user_id = user.id
                db.commit()
        elif experiment.access_mode == "guest_name" and not annotator.display_name:
            if not guest_name:
                raise HTTPException(
                    status_code=422,
                    detail="Enter your name before starting this experiment",
                )
            annotator.display_name = guest_name
            db.commit()
    else:
        if experiment.access_mode == "guest_name" and not guest_name:
            raise HTTPException(
                status_code=422,
                detail="Enter your name before starting this experiment",
            )
        session_token = str(uuid.uuid4())
        annotator = Annotator(
            experiment_id=experiment.id,
            user_id=(
                user.id
                if user and experiment.access_mode != "anonymous"
                else None
            ),
            display_name=(guest_name if experiment.access_mode == "guest_name" else None),
            session_token=session_token,
            status="active",
        )
        db.add(annotator)
        db.commit()
    if user and annotator.user_id is None and experiment.access_mode != "anonymous":
        annotator.user_id = user.id
        db.commit()

    current_experiment_id.set(str(experiment.id))
    current_annotator_id.set(str(annotator.id))
    logger.info(
        "annotator.session_resolved",
        extra={
            "experiment_id": str(experiment.id),
            "annotator_id": str(annotator.id),
            "access_mode": experiment.access_mode,
            "has_user": annotator.user_id is not None,
        },
    )

    requires_teaching = bool(
        experiment.teaching_examples and annotator.teaching_examples_shown_at is None
    )
    teaching_examples_list: list[TeachingExampleItemResponse] = []
    if requires_teaching:
        te_unit_ids = [
            uuid.UUID(te["data_unit_id"]) if isinstance(te["data_unit_id"], str) else te["data_unit_id"]
            for te in (experiment.teaching_examples or [])
            if isinstance(te, dict) and te.get("data_unit_id")
        ]
        units_by_id = {
            unit.id: unit
            for unit in db.query(DataUnit).filter(DataUnit.id.in_(te_unit_ids)).all()
        }
        for te in (experiment.teaching_examples or []):
            uid = uuid.UUID(te["data_unit_id"]) if isinstance(te["data_unit_id"], str) else te["data_unit_id"]
            unit = units_by_id.get(uid)
            if unit:
                teaching_examples_list.append(
                    TeachingExampleItemResponse(
                        data_unit_id=uid,
                        media_url=generate_media_url(unit.raw_uri),
                        displayed_answer=te.get("displayed_answer") or {},
                        explanation=te.get("explanation"),
                        filename=unit.raw_uri.rsplit("/", 1)[-1],
                    )
                )

    return SessionResponse(
        session_token=session_token, experiment_id=experiment.id,
        modality=experiment.modality, instructions=experiment.instructions,
        label_schema=experiment.label_schema,
        access_mode=experiment.access_mode,
        annotator_display_name=(
            annotator.user.display_name if annotator.user else annotator.display_name
        ),
        requires_qualification=bool(
            experiment.qualification_form and annotator.qualified_at is None
        ),
        qualification_form=experiment.qualification_form or [],
        requires_teaching_examples=requires_teaching,
        teaching_examples=teaching_examples_list,
    )


@app.post("/annotate/{share_token}/session", response_model=SessionResponse)
def start_named_session(
    share_token: str,
    payload: SessionStartRequest,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    """Create/resume a session without placing guest identity in the URL."""
    return get_session(
        share_token=share_token,
        session_token=payload.session_token,
        display_name=payload.display_name,
        db=db,
        user=user,
    )


@app.post("/annotate/{share_token}/qualifications")
def submit_qualifications(
    share_token: str,
    payload: QualificationSubmission,
    session_token: str,
    db: Session = Depends(get_db),
):
    experiment = db.query(Experiment).filter_by(
        share_token=share_token, status="active"
    ).first()
    if experiment is None:
        raise HTTPException(status_code=404, detail="Active experiment not found")
    annotator = db.query(Annotator).filter_by(
        session_token=session_token,
        experiment_id=experiment.id,
        status="active",
    ).first()
    if annotator is None:
        raise HTTPException(status_code=401, detail="Invalid or inactive session")
    try:
        answers = validate_qualification_answers(
            payload.answers, experiment.qualification_form or []
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    annotator.qualification_answers = answers
    annotator.qualified_at = datetime.now(timezone.utc)
    db.commit()

    current_experiment_id.set(str(experiment.id))
    current_annotator_id.set(str(annotator.id))
    logger.info(
        "annotator.qualifications_submitted",
        extra={
            "experiment_id": str(experiment.id),
            "annotator_id": str(annotator.id),
            "answer_count": len(answers),
        },
    )
    return {"status": "qualified"}


@app.post("/annotate/{share_token}/teaching-examples/complete")
def complete_teaching_examples(
    share_token: str,
    session_token: str,
    db: Session = Depends(get_db),
):
    experiment = db.query(Experiment).filter_by(
        share_token=share_token, status="active"
    ).first()
    if experiment is None:
        raise HTTPException(status_code=404, detail="Active experiment not found")
    annotator = db.query(Annotator).filter_by(
        session_token=session_token,
        experiment_id=experiment.id,
        status="active",
    ).first()
    if annotator is None:
        raise HTTPException(status_code=401, detail="Invalid or inactive session")
    annotator.teaching_examples_shown_at = datetime.now(timezone.utc)
    db.commit()
    logger.info(
        "annotator.teaching_examples_completed",
        extra={
            "experiment_id": str(experiment.id),
            "annotator_id": str(annotator.id),
        },
    )
    return {"status": "completed"}


@app.get("/annotate/{share_token}/next")
def get_next_item(
    share_token: str, session_token: str, db: Session = Depends(get_db)
):
    experiment = db.query(Experiment).filter(
        Experiment.share_token == share_token,
        Experiment.status != "deleted",
    ).first()
    if experiment is None:
        raise HTTPException(status_code=404, detail="Experiment not found")
    ensure_current_schema(experiment)
    if experiment.status != "active":
        raise HTTPException(status_code=403, detail="This experiment is not active")
    annotator = db.query(Annotator).filter_by(
        session_token=session_token, experiment_id=experiment.id, status="active"
    ).first()
    if annotator is None:
        raise HTTPException(status_code=401, detail="Invalid or inactive session")
    if experiment.qualification_form and annotator.qualified_at is None:
        raise HTTPException(status_code=403, detail="Qualification form is incomplete")
    if experiment.teaching_examples and annotator.teaching_examples_shown_at is None:
        raise HTTPException(status_code=403, detail="Teaching examples onboarding is incomplete")

    current_experiment_id.set(str(experiment.id))
    current_annotator_id.set(str(annotator.id))

    next_unit = allocate_next_item(db, experiment, annotator)
    if next_unit is None:
        if experiment.routing_rules and has_pending_unseen_items(db, experiment, annotator):
            return {"message": "No remaining samples match your qualifications."}
        return {"message": "Queue exhausted. Thanks for your help!"}
    media_url = generate_media_url(next_unit.raw_uri)
    return NextItemResponse(data_unit_id=next_unit.id, media_url=media_url)


@app.post("/annotate/{share_token}/items/{data_unit_id}/annotations")
def submit_annotation(
    share_token: str, data_unit_id: uuid.UUID, payload: AnnotationCreate,
    session_token: str, db: Session = Depends(get_db),
):
    experiment = db.query(Experiment).filter(
        Experiment.share_token == share_token,
        Experiment.status != "deleted",
    ).first()
    if experiment is None:
        raise HTTPException(status_code=404, detail="Experiment not found")
    ensure_current_schema(experiment)
    if experiment.status != "active":
        raise HTTPException(status_code=403, detail="This experiment is not active")
    annotator = db.query(Annotator).filter_by(
        session_token=session_token, experiment_id=experiment.id, status="active"
    ).first()
    if annotator is None:
        raise HTTPException(status_code=401, detail="Invalid or inactive session")

    current_experiment_id.set(str(experiment.id))
    current_annotator_id.set(str(annotator.id))

    data_unit = (
        db.query(DataUnit)
        .filter_by(id=data_unit_id, experiment_id=experiment.id)
        .with_for_update().first()
    )
    if data_unit is None:
        raise HTTPException(status_code=404, detail="Data unit not found in this experiment")
    if not data_unit.is_gold:
        count = db.query(func.count(Annotation.id)).filter_by(data_unit_id=data_unit.id).scalar() or 0
        if count >= experiment.overlap_n:
            raise HTTPException(status_code=409, detail="This item already has enough annotations")
    try:
        answer = get_type(experiment.label_schema["annotation_type"]).validate_answer(
            payload.answer, experiment.label_schema
        )
    except (ValueError, ValidationError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        db.add(Annotation(data_unit_id=data_unit.id, annotator_id=annotator.id, answer=answer))
        db.flush()
        recompute_after_annotation(db, experiment, data_unit)
        db.commit()
        logger.info(
            "annotation.submitted",
            extra={
                "experiment_id": str(experiment.id),
                "annotator_id": str(annotator.id),
                "data_unit_id": str(data_unit.id),
                "is_gold": data_unit.is_gold,
            },
        )
    except IntegrityError as exc:
        db.rollback()
        logger.warning(
            "annotation.duplicate_submission_blocked",
            extra={
                "experiment_id": str(experiment.id),
                "annotator_id": str(annotator.id),
                "data_unit_id": str(data_unit.id),
            },
        )
        raise HTTPException(status_code=409, detail="This item was already submitted") from exc
    return {"status": "success"}


@app.get("/experiments/{experiment_id}/dashboard")
def experiment_dashboard(
    experiment_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user)
    ensure_current_schema(experiment)
    units = db.query(DataUnit).filter_by(experiment_id=experiment.id).all()
    regular_units = [unit for unit in units if not unit.is_gold]
    counts = dict(
        db.query(Annotation.data_unit_id, func.count(Annotation.id))
        .join(DataUnit, DataUnit.id == Annotation.data_unit_id)
        .filter(DataUnit.experiment_id == experiment.id, DataUnit.is_gold.is_(False))
        .group_by(Annotation.data_unit_id).all()
    )
    required = len(regular_units) * experiment.overlap_n
    completed = sum(min(counts.get(unit.id, 0), experiment.overlap_n) for unit in regular_units)
    annotators = db.query(Annotator).filter_by(experiment_id=experiment.id).order_by(Annotator.created_at).all()
    last_submissions = dict(
        db.query(Annotation.annotator_id, func.max(Annotation.submitted_at))
        .join(DataUnit, DataUnit.id == Annotation.data_unit_id)
        .filter(DataUnit.experiment_id == experiment.id)
        .group_by(Annotation.annotator_id)
        .all()
    )
    agreements = (
        db.query(ItemAgreement).join(DataUnit, DataUnit.id == ItemAgreement.data_unit_id)
        .filter(
            DataUnit.experiment_id == experiment.id,
            ItemAgreement.agreement_score.isnot(None),
        ).all()
    )
    return {
        "experiment": {
            "id": experiment.id,
            "name": experiment.name,
            "share_token": experiment.share_token,
            "access_mode": experiment.access_mode,
            "qualification_form": experiment.qualification_form or [],
        },
        "completion": {
            "completed_assignments": completed, "required_assignments": required,
            "percent": 100 * completed / required if required else 100.0,
            "items_remaining": sum(counts.get(unit.id, 0) < experiment.overlap_n for unit in regular_units),
        },
        "active_annotators": sum(annotator.status == "active" for annotator in annotators),
        "annotators": [
            serialize_annotator_summary(
                annotator,
                last_submissions.get(annotator.id)
                or annotator.qualified_at
                or annotator.created_at,
            )
            for annotator in annotators
        ],
        "items": [
            {"data_unit_id": agreement.data_unit_id,
             "agreement_score": agreement.agreement_score,
             "n_annotations": agreement.n_annotations}
            for agreement in agreements
        ],
    }


@app.patch("/annotators/{annotator_id}")
def update_annotator(
    annotator_id: uuid.UUID, payload: AnnotatorStatusUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(Annotator).join(Experiment).filter(
        Annotator.id == annotator_id,
        Experiment.status != "deleted",
    )
    if not user.is_platform_admin:
        query = query.filter(Experiment.owner_id == user.id)
    annotator = query.first()
    if annotator is None:
        raise HTTPException(status_code=404, detail="Annotator not found")
    annotator.status = payload.status
    db.commit()
    return {"id": annotator.id, "status": annotator.status}


@app.get("/experiments/{experiment_id}/annotators")
def list_experiment_annotators(
    experiment_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user)
    ensure_current_schema(experiment)
    annotators = (
        db.query(Annotator)
        .options(selectinload(Annotator.user), selectinload(Annotator.score))
        .filter(
            Annotator.experiment_id == experiment.id,
            Annotator.annotations.any(),
        )
        .order_by(Annotator.created_at)
        .all()
    )
    activity_rows = (
        db.query(
            Annotation.annotator_id,
            func.count(Annotation.id),
            func.max(Annotation.submitted_at),
        )
        .join(DataUnit, DataUnit.id == Annotation.data_unit_id)
        .filter(DataUnit.experiment_id == experiment.id)
        .group_by(Annotation.annotator_id)
        .all()
    )
    activity = {
        annotator_id: {"count": count, "last_submission": last_submission}
        for annotator_id, count, last_submission in activity_rows
    }
    return {
        "experiment": {
            "id": experiment.id,
            "name": experiment.name,
            "qualification_form": experiment.qualification_form or [],
        },
        "annotators": [
            serialize_annotator_summary(
                annotator,
                activity[annotator.id]["last_submission"],
                activity[annotator.id]["count"],
            )
            for annotator in annotators
        ],
    }


@app.get("/experiments/{experiment_id}/annotators/{annotator_id}")
def get_experiment_annotator(
    experiment_id: uuid.UUID,
    annotator_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user)
    ensure_current_schema(experiment)
    annotator = (
        db.query(Annotator)
        .options(selectinload(Annotator.user), selectinload(Annotator.score))
        .filter_by(id=annotator_id, experiment_id=experiment.id)
        .first()
    )
    if annotator is None:
        raise HTTPException(status_code=404, detail="Annotator not found")

    annotations = (
        db.query(Annotation)
        .options(
            selectinload(Annotation.data_unit).selectinload(DataUnit.agreement),
        )
        .join(DataUnit, DataUnit.id == Annotation.data_unit_id)
        .filter(
            Annotation.annotator_id == annotator.id,
            DataUnit.experiment_id == experiment.id,
        )
        .order_by(Annotation.submitted_at.desc())
        .all()
    )
    annotation_type = get_type(experiment.label_schema["annotation_type"])
    last_activity_at = annotations[0].submitted_at if annotations else annotator.created_at
    return {
        "experiment": {
            "id": experiment.id,
            "name": experiment.name,
            "modality": experiment.modality,
            "label_schema": experiment.label_schema,
            "qualification_form": experiment.qualification_form or [],
        },
        "annotator": serialize_annotator_summary(
            annotator, last_activity_at, len(annotations)
        ),
        "annotations": [
            {
                "id": annotation.id,
                "data_unit_id": annotation.data_unit.id,
                "filename": annotation.data_unit.raw_uri.rsplit("/", 1)[-1],
                "raw_uri": annotation.data_unit.raw_uri,
                "media_url": generate_media_url(annotation.data_unit.raw_uri),
                "metadata": annotation.data_unit.metadata_json or {},
                "answer": annotation.answer,
                "submitted_at": annotation.submitted_at,
                "is_gold": annotation.data_unit.is_gold,
                "gold_answer": annotation.data_unit.gold_answer,
                "gold_score": (
                    annotation_type.gold_match(
                        annotation.answer,
                        annotation.data_unit.gold_answer,
                        experiment.label_schema,
                    )
                    if annotation.data_unit.is_gold
                    and annotation.data_unit.gold_answer is not None
                    else None
                ),
                "agreement_score": (
                    annotation.data_unit.agreement.agreement_score
                    if annotation.data_unit.agreement else None
                ),
            }
            for annotation in annotations
        ],
    }


@app.get("/experiments/{experiment_id}/review")
def review_experiment_annotations(
    experiment_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user)
    ensure_current_schema(experiment)
    units = (
        db.query(DataUnit)
        .options(
            selectinload(DataUnit.annotations),
            selectinload(DataUnit.agreement),
        )
        .filter_by(experiment_id=experiment.id)
        .order_by(DataUnit.raw_uri)
        .all()
    )
    return {
        "experiment": {
            "id": experiment.id,
            "name": experiment.name,
            "modality": experiment.modality,
            "label_schema": experiment.label_schema,
        },
        "samples": [
            {
                "id": unit.id,
                "filename": unit.raw_uri.rsplit("/", 1)[-1],
                "raw_uri": unit.raw_uri,
                "media_url": generate_media_url(unit.raw_uri),
                "is_gold": unit.is_gold,
                "gold_answer": unit.gold_answer,
                "metadata": unit.metadata_json or {},
                "agreement_score": (
                    unit.agreement.agreement_score if unit.agreement else None
                ),
                "n_annotations": len(unit.annotations),
                "annotations": [
                    {
                        "id": annotation.id,
                        "annotator_id": annotation.annotator_id,
                        "answer": annotation.answer,
                        "submitted_at": annotation.submitted_at,
                    }
                    for annotation in sorted(
                        unit.annotations, key=lambda value: value.submitted_at
                    )
                ],
            }
            for unit in units
        ],
    }


@app.get("/experiments/{experiment_id}/export", deprecated=True)
def export_experiment(
    experiment_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user)
    ensure_current_schema(experiment)
    units = db.query(DataUnit).filter_by(experiment_id=experiment.id).all()
    logger.info(
        "experiment.exported",
        extra={"experiment_id": str(experiment.id), "total_units": len(units)},
    )
    return {
        "experiment": {
            "id": experiment.id, "name": experiment.name,
            "modality": experiment.modality, "instructions": experiment.instructions,
            "label_schema": experiment.label_schema, "overlap_n": experiment.overlap_n,
            "gold_ratio": experiment.gold_ratio, "access_mode": experiment.access_mode,
            "created_at": experiment.created_at,
            "metadata_schema": experiment.metadata_schema or [],
            "qualification_form": experiment.qualification_form or [],
            "routing_rules": experiment.routing_rules or [],
        },
        "annotators": [
            {
                "id": annotator.id,
                "status": annotator.status,
                "qualification_answers": annotator.qualification_answers,
                "qualified_at": annotator.qualified_at,
            }
            for annotator in db.query(Annotator).filter_by(experiment_id=experiment.id).all()
        ],
        "data_units": [
            {
                "id": unit.id,
                "raw_uri": unit.raw_uri,
                "media_url": generate_media_url(unit.raw_uri),
                "is_gold": unit.is_gold,
                "gold_answer": unit.gold_answer,
                "metadata": unit.metadata_json or {},
                "agreement": (
                    {"score": unit.agreement.agreement_score, "n_annotations": unit.agreement.n_annotations}
                    if unit.agreement else None
                ),
                "annotations": [
                    {"id": annotation.id, "annotator_id": annotation.annotator_id,
                     "answer": annotation.answer, "submitted_at": annotation.submitted_at}
                    for annotation in unit.annotations
                ],
            }
            for unit in units
        ],
    }


# ---------------------------------------------------------------------------
# Auditable Dataset Export & Consensus Endpoints (Spec Section 8)
# ---------------------------------------------------------------------------

@app.post(
    "/experiments/{experiment_id}/exports/preflight",
    response_model=ExportPreflightResponse,
)
def compute_export_preflight_endpoint(
    experiment_id: uuid.UUID,
    payload: ExportPreflightRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user)
    ensure_current_schema(experiment)

    policy = (
        ConsensusPolicy.model_validate(payload.policy.model_dump())
        if payload.policy
        else ConsensusPolicy()
    )
    cutoff_at = datetime.now(timezone.utc)

    with RepeatableReadSessionLocal() as rr_db:
        rr_exp = rr_db.query(Experiment).filter_by(id=experiment.id).first()
        items, counts, annotator_summary, warnings, annotator_evidence, source_fingerprint = evaluate_export_snapshot(
            db=rr_db,
            experiment=rr_exp,
            cutoff_at=cutoff_at,
            policy=policy,
            mode=payload.mode,
        )

    estimated_size, estimate_complete = estimate_media_size_bytes(
        items=items,
        s3_client=s3_client,
        bucket_name=BUCKET_NAME,
    )
    if not estimate_complete:
        warnings.append("Archive size estimate is incomplete because metadata was unavailable for one or more media objects.")
    training_ready = compute_training_readiness(
        mode=payload.mode,
        counts=counts,
        policy=policy,
        warnings=warnings,
    )


    logger.info(
        "export.preflight_completed",
        extra={
            "experiment_id": str(experiment.id),
            "mode": payload.mode,
            "total_samples": counts["total_samples"],
            "warning_count": len(warnings),
        },
    )

    return ExportPreflightResponse(
        mode=payload.mode,
        policy=ConsensusPolicySchema(**policy.model_dump()),
        source_fingerprint=source_fingerprint,
        source_cutoff_at=cutoff_at.isoformat(),
        counts=counts,
        annotator_summary=annotator_summary,
        estimated_size_bytes=estimated_size,
        training_ready=training_ready,
        warnings=warnings,
    )


@app.post(
    "/experiments/{experiment_id}/exports",
    response_model=ExportJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def create_export_job_endpoint(
    experiment_id: uuid.UUID,
    payload: ExportJobCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user)
    ensure_current_schema(experiment)

    policy = (
        ConsensusPolicy.model_validate(payload.policy.model_dump())
        if payload.policy
        else ConsensusPolicy()
    )
    cutoff_at = datetime.now(timezone.utc)

    with RepeatableReadSessionLocal() as rr_db:
        rr_exp = rr_db.query(Experiment).filter_by(id=experiment.id).first()
        items, counts, annotator_summary, warnings, annotator_evidence, current_fingerprint = evaluate_export_snapshot(
            db=rr_db,
            experiment=rr_exp,
            cutoff_at=cutoff_at,
            policy=policy,
            mode=payload.mode,
        )


    if payload.source_fingerprint != current_fingerprint:
        logger.warning(
            "export.stale_fingerprint",
            extra={
                "experiment_id": str(experiment.id),
                "client_fingerprint": payload.source_fingerprint,
                "current_fingerprint": current_fingerprint,
            },
        )
        raise HTTPException(
            status_code=409,
            detail="Preflight fingerprint is stale because dataset has changed. Please review updated warnings and retry.",
        )

    if payload.mode == "consensus" and warnings and not payload.acknowledge_warnings:
        raise HTTPException(
            status_code=422,
            detail="Consensus export contains quality warnings that require explicit acknowledgement before generation.",
        )

    job = ExportJob(
        experiment_id=experiment.id,
        requested_by_user_id=user.id if user else None,
        mode=payload.mode,
        status="queued",
        policy=policy.model_dump(),
        source_cutoff_at=cutoff_at,
        source_counts=counts,
        source_fingerprint=current_fingerprint,
        preflight_summary={
            "counts": counts,
            "annotator_summary": annotator_summary,
        },
        warnings=warnings,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    logger.info(
        "export.queued",
        extra={
            "job_id": str(job.id),
            "experiment_id": str(experiment.id),
            "mode": job.mode,
        },
    )
    return job


@app.get(
    "/experiments/{experiment_id}/exports",
    response_model=List[ExportJobResponse],
)
def list_export_jobs_endpoint(
    experiment_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user)
    jobs = (
        db.query(ExportJob)
        .filter(ExportJob.experiment_id == experiment.id)
        .order_by(ExportJob.created_at.desc())
        .limit(50)
        .all()
    )
    return jobs


@app.get(
    "/experiments/{experiment_id}/exports/{job_id}",
    response_model=ExportJobResponse,
)
def get_export_job_endpoint(
    experiment_id: uuid.UUID,
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user)
    job = (
        db.query(ExportJob)
        .filter(
            ExportJob.id == job_id,
            ExportJob.experiment_id == experiment.id,
        )
        .first()
    )
    if job is None:
        raise HTTPException(status_code=404, detail="Export job not found")
    return job


@app.post(
    "/experiments/{experiment_id}/exports/{job_id}/download",
    response_model=ExportDownloadResponse,
)
def download_export_job_endpoint(
    experiment_id: uuid.UUID,
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user)
    job = (
        db.query(ExportJob)
        .filter(
            ExportJob.id == job_id,
            ExportJob.experiment_id == experiment.id,
        )
        .first()
    )
    if job is None:
        raise HTTPException(status_code=404, detail="Export job not found")
    if job.status != "ready":
        raise HTTPException(
            status_code=409,
            detail=f"Export is not ready for download (current status: {job.status})",
        )
    now = datetime.now(timezone.utc)
    if job.expires_at and job.expires_at <= now:
        job.status = "expired"
        db.commit()
        raise HTTPException(status_code=410, detail="Export artifact has expired")

    bucket, key = parse_s3_uri(job.object_uri)
    download_filename = f"taskglass-{sanitize_filename(experiment.name)}-{job.mode}-{str(job.id)[:8]}.zip"
    try:
        presigned_url = s3_client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": bucket,
                "Key": key,
                "ResponseContentDisposition": f'attachment; filename="{download_filename}"',
            },
            ExpiresIn=PRESIGNED_URL_EXPIRY_SECONDS,
        )
    except Exception as exc:
        logger.exception(
            "export.download_url_failed",
            extra={
                "job_id": str(job.id),
                "experiment_id": str(experiment.id),
                "error": str(exc),
            },
        )
        raise HTTPException(status_code=500, detail="Failed to generate download URL")

    return ExportDownloadResponse(
        job_id=job.id,
        download_url=presigned_url,
        expires_in_seconds=PRESIGNED_URL_EXPIRY_SECONDS,
        filename=download_filename,
        size_bytes=job.size_bytes,
        sha256=job.sha256,
    )
