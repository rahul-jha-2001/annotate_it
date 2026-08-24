import uuid
import boto3
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from botocore.client import Config

from database import get_db, engine
from models import Base, Experiment, DataUnit, Annotator, Annotation, AnnotatorScore, ItemAgreement
from schemas import ExperimentCreate, ExperimentResponse, ExperimentListResponse, PresignRequest, PresignResponse, PresignResponseItem, DataUnitBatchCreate, SessionResponse, NextItemResponse, AnnotationCreate, GoldManifestRequest, AnnotationTypeResponse
from typing import List
from pydantic import ValidationError
import string
import random
import logging
from annotation_types import get_type, get_valid_types_for_modality

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize DB models (if not using alembic immediately for local testing)
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Annotate It API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# MinIO Config
MINIO_URL = "http://localhost:9000"
MINIO_ACCESS_KEY = "minioadmin"
MINIO_SECRET_KEY = "minioadmin"
BUCKET_NAME = "annotate-it-data"

s3_client = boto3.client(
    's3',
    endpoint_url=MINIO_URL,
    aws_access_key_id=MINIO_ACCESS_KEY,
    aws_secret_access_key=MINIO_SECRET_KEY,
    config=Config(signature_version='s3v4')
)

# Ensure bucket exists at startup
try:
    s3_client.head_bucket(Bucket=BUCKET_NAME)
except BaseException:
    try:
        s3_client.create_bucket(Bucket=BUCKET_NAME)
    except Exception as e:
        print(f"Warning: Could not create bucket: {e}")

def generate_share_token(length=8):
    characters = string.ascii_letters + string.digits
    return ''.join(random.choice(characters) for _ in range(length))

@app.get("/annotation-types", response_model=List[AnnotationTypeResponse])
def get_annotation_types():
    from annotation_types import REGISTRY
    return [
        AnnotationTypeResponse(
            key=spec.key,
            name=spec.name,
            compatible_modalities=spec.compatible_modalities,
            supports_choices=spec.supports_choices,
            supports_multi_select=spec.supports_multi_select
        ) for spec in REGISTRY.values()
    ]

@app.get("/experiments", response_model=ExperimentListResponse)
def list_experiments(db: Session = Depends(get_db)):
    experiments = db.query(Experiment).order_by(Experiment.created_at.desc()).all()
    return ExperimentListResponse(experiments=experiments)

@app.post("/experiments", response_model=ExperimentResponse)
def create_experiment(experiment_in: ExperimentCreate, db: Session = Depends(get_db)):
    logger.info(f"Received request to create experiment: {experiment_in.dict()}")
    # Validate annotation_types in label_schema against modality
    valid_types = get_valid_types_for_modality(experiment_in.modality)
    logger.info(f"Valid types for modality {experiment_in.modality}: {valid_types}")
    ann_type = experiment_in.label_schema.get("annotation_type")
    if not ann_type:
        logger.error("Validation failed: label_schema must contain 'annotation_type'")
        raise HTTPException(status_code=400, detail="label_schema must contain 'annotation_type'")
    if ann_type not in valid_types:
        logger.error(f"Validation failed: Annotation type '{ann_type}' is not compatible with modality '{experiment_in.modality}'")
        raise HTTPException(status_code=400, detail=f"Annotation type '{ann_type}' is not compatible with modality '{experiment_in.modality}'")
    try:
        get_type(ann_type)
    except ValueError as e:
        logger.error(f"Validation failed for annotation type '{ann_type}': {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
            
    db_exp = Experiment(
        name=experiment_in.name,
        modality=experiment_in.modality,
        instructions=experiment_in.instructions,
        label_schema=experiment_in.label_schema,
        overlap_n=experiment_in.overlap_n,
        gold_ratio=experiment_in.gold_ratio,
        share_token=generate_share_token()
    )
    db.add(db_exp)
    db.commit()
    db.refresh(db_exp)
    return db_exp

@app.post("/uploads/presign", response_model=PresignResponse)
def presign_urls(request: PresignRequest):
    urls = []
    for filename in request.filenames:
        # Generate a unique object key to prevent collisions
        object_key = f"uploads/{uuid.uuid4()}/{filename}"
        
        try:
            # Generate the presigned URL for PUT request
            presigned_url = s3_client.generate_presigned_url(
                'put_object',
                Params={
                    'Bucket': BUCKET_NAME,
                    'Key': object_key,
                },
                ExpiresIn=3600
            )
            urls.append(PresignResponseItem(
                filename=filename,
                upload_url=presigned_url,
                s3_uri=f"s3://{BUCKET_NAME}/{object_key}"
            ))
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
            
    return PresignResponse(urls=urls)

@app.post("/experiments/{id}/data-units")
def create_data_units(id: str, payload: DataUnitBatchCreate, db: Session = Depends(get_db)):
    # Verify experiment exists
    exp = db.query(Experiment).filter(Experiment.id == id).first()
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")
        
    created_units = []
    for item in payload.items:
        db_unit = DataUnit(
            experiment_id=exp.id,
            raw_uri=item.raw_uri,
            is_gold=item.is_gold,
            gold_answer=item.gold_answer
        )
        db.add(db_unit)
        created_units.append(db_unit)
        
    db.commit()
    return {"message": f"Successfully created {len(created_units)} data units."}

@app.post("/experiments/{id}/gold-manifest")
def process_gold_manifest(id: str, request: GoldManifestRequest, db: Session = Depends(get_db)):
    experiment = db.query(Experiment).filter(Experiment.id == uuid.UUID(id)).first()
    if not experiment:
        raise HTTPException(status_code=404, detail="Experiment not found")
        
    data_units = db.query(DataUnit).filter(DataUnit.experiment_id == experiment.id).all()
    # Extract filename from raw_uri (e.g., s3://bucket/filename.wav -> filename.wav)
    data_units_by_filename = {
        du.raw_uri.split('/')[-1]: du
        for du in data_units
    }
    
    results = {"applied": [], "errors": []}
    
    # Get the single AnswerModel spec for the experiment
    try:
        spec = get_type(experiment.label_schema["annotation_type"])
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid annotation type in experiment schema")
            
    for entry in request.manifest:
        filename = entry.filename
        du = data_units_by_filename.get(filename)
        
        if du is None:
            results["errors"].append({
                "filename": filename,
                "error": "No uploaded file matches this filename"
            })
            continue
        
        try:
            AnswerModel = spec.get_answer_model(experiment.label_schema)
            validated_answer = AnswerModel(**entry.answer)
        except ValidationError as e:
            # e.errors() provides structured validation errors, we can format them
            err_msg = ", ".join([f"{'.'.join(str(loc) for loc in err['loc'])}: {err['msg']}" for err in e.errors()])
            results["errors"].append({
                "filename": filename,
                "error": err_msg
            })
            continue
        except Exception as e:
            results["errors"].append({
                "filename": filename,
                "error": str(e)
            })
            continue
            
        du.is_gold = True
        du.gold_answer = validated_answer.model_dump()
        results["applied"].append(filename)
        
    db.commit()
    return results

@app.get("/annotate/{share_token}/session", response_model=SessionResponse)
def get_session(share_token: str, session_token: str | None = None, db: Session = Depends(get_db)):
    exp = db.query(Experiment).filter(Experiment.share_token == share_token).first()
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")
        
    if not session_token:
        # Create a new annotator session
        session_token = str(uuid.uuid4())
        db_annotator = Annotator(
            experiment_id=exp.id,
            session_token=session_token,
            status='active'
        )
        db.add(db_annotator)
        db.commit()
    else:
        # Verify existing
        db_annotator = db.query(Annotator).filter(
            Annotator.session_token == session_token,
            Annotator.experiment_id == exp.id
        ).first()
        if not db_annotator:
            raise HTTPException(status_code=401, detail="Invalid session token for this experiment")
            
    return SessionResponse(
        session_token=session_token,
        experiment_id=exp.id,
        instructions=exp.instructions,
        label_schema=exp.label_schema
    )

@app.get("/annotate/{share_token}/next")
def get_next_item(share_token: str, session_token: str, db: Session = Depends(get_db)):
    exp = db.query(Experiment).filter(Experiment.share_token == share_token).first()
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")
        
    annotator = db.query(Annotator).filter(
        Annotator.session_token == session_token,
        Annotator.experiment_id == exp.id
    ).first()
    
    if not annotator or annotator.status != 'active':
        raise HTTPException(status_code=401, detail="Invalid or inactive session")

    # Simple allocator (v1): find a data_unit that this annotator hasn't annotated yet
    # We should respect overlap_n (only pick items with < overlap_n non-gold annotations)
    # But for MVP, just pick any unannotated item
    
    # Get IDs of items already annotated by this user
    annotated_subquery = db.query(Annotation.data_unit_id).filter(Annotation.annotator_id == annotator.id)
    
    next_unit = db.query(DataUnit).filter(
        DataUnit.experiment_id == exp.id,
        ~DataUnit.id.in_(annotated_subquery)
    ).first()
    
    if not next_unit:
        return {"message": "Queue exhausted. Thanks for your help!"}
        
    # Generate Presigned GET
    object_key = next_unit.raw_uri.replace(f"s3://{BUCKET_NAME}/", "")
    presigned_url = s3_client.generate_presigned_url(
        'get_object',
        Params={'Bucket': BUCKET_NAME, 'Key': object_key},
        ExpiresIn=3600
    )
    
    return NextItemResponse(
        data_unit_id=next_unit.id,
        media_url=presigned_url
    )

@app.post("/annotate/{share_token}/items/{data_unit_id}/annotations")
def submit_annotation(share_token: str, data_unit_id: str, payload: AnnotationCreate, session_token: str, db: Session = Depends(get_db)):
    annotator = db.query(Annotator).filter(Annotator.session_token == session_token).first()
    if not annotator:
        raise HTTPException(status_code=401, detail="Invalid session")
        
    exp = db.query(Experiment).filter(Experiment.share_token == share_token).first()
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")
        
    ann_type_str = exp.label_schema.get("annotation_type")
    
    if not ann_type_str:
        raise HTTPException(status_code=400, detail="Experiment schema missing annotation_type")
        
    type_spec = get_type(ann_type_str)
    
    try:
        AnswerModel = type_spec.get_answer_model(exp.label_schema)
        validated_answer = AnswerModel(**payload.answer).dict()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
        
    # Create annotation
    db_ann = Annotation(
        data_unit_id=uuid.UUID(data_unit_id),
        annotator_id=annotator.id,
        answer=validated_answer
    )
    db.add(db_ann)
    db.commit()
    
    # ---------------------------------------------------------
    # STEP 4: Live Quality Scoring Engine
    # ---------------------------------------------------------
    data_unit = db.query(DataUnit).filter(DataUnit.id == db_ann.data_unit_id).first()
    
    # 1. Update Annotator Score items_completed and gold tracking
    ann_score = db.query(AnnotatorScore).filter(AnnotatorScore.annotator_id == annotator.id).first()
    if not ann_score:
        ann_score = AnnotatorScore(annotator_id=annotator.id, items_completed=0, gold_items_seen=0)
        db.add(ann_score)
        
    ann_score.items_completed += 1
    
    if data_unit.is_gold and data_unit.gold_answer:
        ann_score.gold_items_seen += 1
        current_gold_score = type_spec.gold_match(validated_answer, data_unit.gold_answer, exp.label_schema)
        
        if ann_score.rolling_gold_accuracy is None:
            ann_score.rolling_gold_accuracy = current_gold_score
        else:
            old_total = ann_score.rolling_gold_accuracy * (ann_score.gold_items_seen - 1)
            ann_score.rolling_gold_accuracy = (old_total + current_gold_score) / ann_score.gold_items_seen
            
    # 2. Update Item Agreement
    all_anns_for_item = db.query(Annotation).filter(Annotation.data_unit_id == data_unit.id).all()
    answers = [a.answer for a in all_anns_for_item]
    
    item_agr = db.query(ItemAgreement).filter(ItemAgreement.data_unit_id == data_unit.id).first()
    if not item_agr:
        item_agr = ItemAgreement(data_unit_id=data_unit.id, n_annotations=0)
        db.add(item_agr)
        
    item_agr.n_annotations = len(answers)
    if len(answers) >= exp.overlap_n and len(answers) > 1:
        item_agr.agreement_score = type_spec.agreement(answers, exp.label_schema)
        
    db.commit()
    
    # 3. Update all involved annotators' rolling agreement scores
    if len(answers) >= exp.overlap_n and len(answers) > 1:
        involved_annotator_ids = set(a.annotator_id for a in all_anns_for_item)
        for ann_id in involved_annotator_ids:
            score_row = db.query(AnnotatorScore).filter(AnnotatorScore.annotator_id == ann_id).first()
            if not score_row:
                continue
                
            annotated_units = db.query(Annotation.data_unit_id).filter(Annotation.annotator_id == ann_id).all()
            unit_ids = [u[0] for u in annotated_units]
            
            agreements = db.query(ItemAgreement.agreement_score).filter(
                ItemAgreement.data_unit_id.in_(unit_ids),
                ItemAgreement.agreement_score.isnot(None)
            ).all()
            
            valid_scores = [ag[0] for ag in agreements if ag[0] is not None]
            if valid_scores:
                score_row.rolling_agreement_score = sum(valid_scores) / len(valid_scores)
                
    db.commit()
    
    return {"status": "success"}
