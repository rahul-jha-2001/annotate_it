import logging
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import List

import boto3
from botocore.client import Config
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exception_handlers import (
    http_exception_handler,
    request_validation_exception_handler,
)
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from pydantic import ValidationError
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from annotation_types import REGISTRY, get_compatible_modalities, get_type, get_valid_types_for_modality
from auth import get_current_user, get_optional_user, router as auth_router
from config import (
    CORS_ORIGINS, MINIO_ACCESS_KEY, MINIO_BUCKET, MINIO_SECRET_KEY, MINIO_URL,
)
from database import get_db
from modalities import REGISTRY as MODALITY_REGISTRY
from models import Annotation, Annotator, DataUnit, Experiment, ItemAgreement, User
from schemas import (
    AnnotationCreate, AnnotationTypeResponse, AnnotatorStatusUpdate,
    DataUnitBatchCreate, ExperimentCreate, ExperimentListResponse,
    ExperimentResponse, GoldManifestRequest, ModalityResponse, NextItemResponse, PresignRequest,
    PresignResponse, PresignResponseItem, QualificationSubmission, SessionResponse,
)
from schema_compat import normalize_label_schema
from services.allocation import allocate_next_item, has_pending_unseen_items
from services.scoring import recompute_after_annotation
from services.qualifications import validate_qualification_answers, validate_sample_metadata

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
logging.getLogger("uvicorn.access").disabled = True

@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        s3_client.head_bucket(Bucket=BUCKET_NAME)
    except Exception:
        try:
            s3_client.create_bucket(Bucket=BUCKET_NAME)
        except Exception as exc:
            logger.warning("Could not create object-storage bucket: %s", exc)
    yield


app = FastAPI(title="Annotate It API", lifespan=lifespan)


def request_context(request: Request) -> str:
    client = (
        f"{request.client.host}:{request.client.port}"
        if request.client else "unknown"
    )
    query_keys = sorted(set(request.query_params.keys()))
    return (
        f"request_id={request.state.request_id} method={request.method} "
        f"path={request.url.path} query_keys={query_keys} client={client} "
        f"origin={request.headers.get('origin', '-')} "
        f"content_type={request.headers.get('content-type', '-')} "
        f"content_length={request.headers.get('content-length', '-')}"
    )


@app.middleware("http")
async def log_request_lifecycle(request: Request, call_next):
    supplied_request_id = request.headers.get("X-Request-ID", "")
    request.state.request_id = (
        supplied_request_id
        if 1 <= len(supplied_request_id) <= 64
        and all(character.isalnum() or character in "-_" for character in supplied_request_id)
        else uuid.uuid4().hex
    )
    started_at = time.perf_counter()
    logger.info("request.started %s", request_context(request))
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = (time.perf_counter() - started_at) * 1000
        logger.exception(
            "request.crashed %s duration_ms=%.2f",
            request_context(request),
            duration_ms,
        )
        raise

    duration_ms = (time.perf_counter() - started_at) * 1000
    log_level = logging.WARNING if response.status_code >= 400 else logging.INFO
    logger.log(
        log_level,
        "request.completed %s status=%s duration_ms=%.2f",
        request_context(request),
        response.status_code,
        duration_ms,
    )
    response.headers["X-Request-ID"] = request.state.request_id
    return response


@app.exception_handler(StarletteHTTPException)
async def log_http_error(request: Request, exc: StarletteHTTPException):
    logger.warning(
        "request.rejected %s status=%s detail=%r",
        request_context(request),
        exc.status_code,
        exc.detail,
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
        "request.validation_failed %s errors=%s",
        request_context(request),
        safe_errors,
    )
    return await request_validation_exception_handler(request, exc)


app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)

BUCKET_NAME = MINIO_BUCKET
s3_client = boto3.client(
    "s3", endpoint_url=MINIO_URL, aws_access_key_id=MINIO_ACCESS_KEY,
    aws_secret_access_key=MINIO_SECRET_KEY,
    config=Config(signature_version="s3v4"),
)


def generate_share_token() -> str:
    return secrets.token_urlsafe(8)


def get_owned_experiment(
    experiment_id: uuid.UUID,
    db: Session,
    user: User,
) -> Experiment:
    experiment = db.query(Experiment).filter_by(id=experiment_id).first()
    if experiment is None:
        logger.info(
            "authorization.resource_missing local_user_id=%s experiment_id=%s",
            user.id,
            experiment_id,
        )
        raise HTTPException(status_code=404, detail="Experiment not found")
    if not user.is_platform_admin and experiment.owner_id != user.id:
        logger.warning(
            "authorization.experiment_denied local_user_id=%s experiment_id=%s owner_id=%s",
            user.id,
            experiment_id,
            experiment.owner_id,
        )
        raise HTTPException(status_code=404, detail="Experiment not found")
    return experiment


def generate_media_url(raw_uri: str) -> str:
    object_key = raw_uri.replace(f"s3://{BUCKET_NAME}/", "", 1)
    return s3_client.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET_NAME, "Key": object_key},
        ExpiresIn=3600,
    )


def ensure_current_schema(experiment: Experiment) -> None:
    try:
        experiment.label_schema = normalize_label_schema(experiment.label_schema)
    except (ValueError, ValidationError) as exc:
        raise HTTPException(
            status_code=409,
            detail=f"This experiment has an unsupported legacy schema: {exc}",
        ) from exc


@app.get("/annotation-types", response_model=List[AnnotationTypeResponse])
def get_annotation_types():
    return [
        AnnotationTypeResponse(
            key=spec.key, name=spec.name,
            compatible_modalities=get_compatible_modalities(spec),
            supports_choices=spec.supports_choices,
            supports_multi_select=spec.supports_multi_select,
            required_interaction=spec.required_interaction,
        )
        for spec in REGISTRY.values()
    ]


@app.get("/modalities", response_model=List[ModalityResponse])
def get_modalities():
    return list(MODALITY_REGISTRY.values())


@app.get("/experiments", response_model=ExperimentListResponse)
def list_experiments(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(Experiment)
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
        share_token=generate_share_token(),
        status=experiment_in.status,
        metadata_schema=[field.model_dump() for field in experiment_in.metadata_schema],
        qualification_form=[question.model_dump() for question in experiment_in.qualification_form],
        routing_rules=[rule.model_dump() for rule in experiment_in.routing_rules],
    )
    db.add(experiment)
    db.commit()
    db.refresh(experiment)
    return experiment


@app.post("/uploads/presign", response_model=PresignResponse)
def presign_urls(
    request: PresignRequest,
    _user: User = Depends(get_current_user),
):
    urls = []
    for filename in request.filenames:
        object_key = f"uploads/{uuid.uuid4()}/{filename}"
        try:
            upload_url = s3_client.generate_presigned_url(
                "put_object", Params={"Bucket": BUCKET_NAME, "Key": object_key},
                ExpiresIn=3600,
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        urls.append(PresignResponseItem(
            filename=filename, upload_url=upload_url,
            s3_uri=f"s3://{BUCKET_NAME}/{object_key}",
        ))
    return PresignResponse(urls=urls)


@app.post("/experiments/{experiment_id}/deploy")
def deploy_experiment(
    experiment_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user)
    if not db.query(DataUnit).filter_by(experiment_id=experiment.id).first():
        raise HTTPException(status_code=409, detail="Upload at least one sample before deployment")
    experiment.status = "active"
    db.commit()
    return {"id": experiment.id, "status": experiment.status}


@app.post("/experiments/{experiment_id}/data-units")
def create_data_units(
    experiment_id: uuid.UUID, payload: DataUnitBatchCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user)
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
        unit = DataUnit(
            experiment_id=experiment.id, raw_uri=item.raw_uri,
            is_gold=item.is_gold, gold_answer=gold_answer, metadata_json=metadata,
        )
        db.add(unit)
        created_units.append(unit)
    db.commit()
    return {"message": f"Successfully created {len(created_units)} data units."}


@app.post("/experiments/{experiment_id}/gold-manifest")
def process_gold_manifest(
    experiment_id: uuid.UUID, request: GoldManifestRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user)
    ensure_current_schema(experiment)
    units = db.query(DataUnit).filter_by(experiment_id=experiment.id).all()
    by_filename = {}
    for unit in units:
        by_filename.setdefault(unit.raw_uri.rsplit("/", 1)[-1], []).append(unit)
    spec = get_type(experiment.label_schema["annotation_type"])
    results = {"applied": [], "errors": []}
    seen = set()
    for entry in request.manifest:
        if entry.filename in seen:
            results["errors"].append({"filename": entry.filename, "error": "Duplicate manifest entry"})
            continue
        seen.add(entry.filename)
        matches = by_filename.get(entry.filename, [])
        if not matches:
            results["errors"].append({"filename": entry.filename, "error": "No uploaded file matches this filename"})
            continue
        if len(matches) > 1:
            results["errors"].append({"filename": entry.filename, "error": "Multiple uploaded files have this filename"})
            continue
        try:
            answer = spec.validate_answer(entry.answer, experiment.label_schema)
        except (ValueError, ValidationError) as exc:
            results["errors"].append({"filename": entry.filename, "error": str(exc)})
            continue
        matches[0].is_gold = True
        matches[0].gold_answer = answer
        results["applied"].append(entry.filename)
    db.commit()
    return results


@app.get("/annotate/{share_token}/session", response_model=SessionResponse)
def get_session(
    share_token: str, session_token: str | None = None,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    experiment = db.query(Experiment).filter_by(share_token=share_token).first()
    if experiment is None:
        raise HTTPException(status_code=404, detail="Experiment not found")
    ensure_current_schema(experiment)
    if experiment.status != "active":
        raise HTTPException(status_code=403, detail="This experiment is not active")
    if session_token:
        annotator = db.query(Annotator).filter_by(
            session_token=session_token, experiment_id=experiment.id
        ).first()
        if annotator is None:
            raise HTTPException(status_code=401, detail="Invalid session token for this experiment")
    else:
        session_token = str(uuid.uuid4())
        annotator = Annotator(
            experiment_id=experiment.id, user_id=user.id if user else None,
            session_token=session_token, status="active"
        )
        db.add(annotator)
        db.commit()
    if user and annotator.user_id is None:
        annotator.user_id = user.id
        db.commit()
    return SessionResponse(
        session_token=session_token, experiment_id=experiment.id,
        modality=experiment.modality, instructions=experiment.instructions,
        label_schema=experiment.label_schema,
        requires_qualification=bool(
            experiment.qualification_form and annotator.qualified_at is None
        ),
        qualification_form=experiment.qualification_form or [],
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
    return {"status": "qualified"}


@app.get("/annotate/{share_token}/next")
def get_next_item(
    share_token: str, session_token: str, db: Session = Depends(get_db)
):
    experiment = db.query(Experiment).filter_by(share_token=share_token).first()
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
    experiment = db.query(Experiment).filter_by(share_token=share_token).first()
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
    except IntegrityError as exc:
        db.rollback()
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
            "qualification_form": experiment.qualification_form or [],
        },
        "completion": {
            "completed_assignments": completed, "required_assignments": required,
            "percent": 100 * completed / required if required else 100.0,
            "items_remaining": sum(counts.get(unit.id, 0) < experiment.overlap_n for unit in regular_units),
        },
        "active_annotators": sum(annotator.status == "active" for annotator in annotators),
        "annotators": [
            {
                "id": annotator.id, "status": annotator.status,
                "created_at": annotator.created_at,
                "items_completed": annotator.score.items_completed if annotator.score else 0,
                "gold_items_seen": annotator.score.gold_items_seen if annotator.score else 0,
                "rolling_gold_accuracy": annotator.score.rolling_gold_accuracy if annotator.score else None,
                "rolling_agreement_score": annotator.score.rolling_agreement_score if annotator.score else None,
                "qualification_answers": annotator.qualification_answers or {},
                "qualified_at": annotator.qualified_at,
                "last_activity_at": (
                    last_submissions.get(annotator.id)
                    or annotator.qualified_at
                    or annotator.created_at
                ),
            }
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
    query = db.query(Annotator).join(Experiment).filter(Annotator.id == annotator_id)
    if not user.is_platform_admin:
        query = query.filter(Experiment.owner_id == user.id)
    annotator = query.first()
    if annotator is None:
        raise HTTPException(status_code=404, detail="Annotator not found")
    annotator.status = payload.status
    db.commit()
    return {"id": annotator.id, "status": annotator.status}


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


@app.get("/experiments/{experiment_id}/export")
def export_experiment(
    experiment_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    experiment = get_owned_experiment(experiment_id, db, user)
    ensure_current_schema(experiment)
    units = db.query(DataUnit).filter_by(experiment_id=experiment.id).all()
    return {
        "experiment": {
            "id": experiment.id, "name": experiment.name,
            "modality": experiment.modality, "instructions": experiment.instructions,
            "label_schema": experiment.label_schema, "overlap_n": experiment.overlap_n,
            "gold_ratio": experiment.gold_ratio, "created_at": experiment.created_at,
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
                "id": unit.id, "raw_uri": unit.raw_uri, "is_gold": unit.is_gold,
                "gold_answer": unit.gold_answer, "metadata": unit.metadata_json or {},
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
