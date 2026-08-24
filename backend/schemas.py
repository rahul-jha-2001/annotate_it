from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from uuid import UUID

class AnnotationTypeResponse(BaseModel):
    key: str
    name: str
    compatible_modalities: List[str]
    supports_choices: bool
    supports_multi_select: bool

class ExperimentCreate(BaseModel):
    name: str
    modality: str
    instructions: Optional[str] = None
    label_schema: Dict[str, Any]
    overlap_n: int = 1
    gold_ratio: float = 0.1

class ExperimentResponse(BaseModel):
    id: UUID
    name: str
    share_token: str
    created_at: Any = None
    
    class Config:
        from_attributes = True

class ExperimentListResponse(BaseModel):
    experiments: List[ExperimentResponse]

class PresignRequest(BaseModel):
    filenames: List[str]

class PresignResponseItem(BaseModel):
    filename: str
    upload_url: str
    s3_uri: str

class PresignResponse(BaseModel):
    urls: List[PresignResponseItem]

class DataUnitCreate(BaseModel):
    raw_uri: str
    is_gold: bool = False
    gold_answer: Optional[Dict[str, Any]] = None

class DataUnitBatchCreate(BaseModel):
    items: List[DataUnitCreate]

class SessionResponse(BaseModel):
    session_token: str
    experiment_id: UUID
    instructions: Optional[str] = None
    label_schema: Dict[str, Any]

class NextItemResponse(BaseModel):
    data_unit_id: UUID
    media_url: str  # Presigned GET url

class AnnotationCreate(BaseModel):
    answer: Dict[str, Any]

class GoldManifestEntry(BaseModel):
    filename: str
    answer: Dict[str, Any]

class GoldManifestRequest(BaseModel):
    manifest: List[GoldManifestEntry]
