from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from typing import List, Dict, Any, Literal, Optional
from uuid import UUID

class AnnotationTypeResponse(BaseModel):
    key: str
    name: str
    compatible_modalities: List[str]
    supports_choices: bool
    supports_multi_select: bool
    required_interaction: str
    schema_version: int
    configuration_kind: str

class ModalityResponse(BaseModel):
    key: str
    name: str
    supported_interactions: List[str]
    available: bool

class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    clerk_user_id: str
    email: str
    display_name: str
    avatar_url: Optional[str] = None
    is_platform_admin: bool
    created_at: Any

class MetadataFieldDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(min_length=1, pattern=r"^[a-z][a-z0-9_]*$")
    label: str = Field(min_length=1)
    type: Literal["text", "choice", "number", "boolean"]
    options: List[str] = Field(default_factory=list)

    @field_validator("options")
    @classmethod
    def unique_options(cls, options: List[str]) -> List[str]:
        normalized = [option.strip() for option in options]
        if any(not option for option in normalized) or len(normalized) != len(set(normalized)):
            raise ValueError("metadata options must be non-empty and unique")
        return normalized

    @model_validator(mode="after")
    def choice_fields_require_options(self):
        if self.type == "choice" and not self.options:
            raise ValueError("choice metadata fields require options")
        return self

class QualificationQuestionDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(min_length=1, pattern=r"^[a-z][a-z0-9_]*$")
    label: str = Field(min_length=1)
    type: Literal["single_choice", "multi_choice", "boolean", "number", "text"]
    required: bool = True
    options: List[str] = Field(default_factory=list)
    minimum: Optional[float] = None
    maximum: Optional[float] = None

    @field_validator("options")
    @classmethod
    def unique_options(cls, options: List[str]) -> List[str]:
        normalized = [option.strip() for option in options]
        if any(not option for option in normalized) or len(normalized) != len(set(normalized)):
            raise ValueError("question options must be non-empty and unique")
        return normalized

    @model_validator(mode="after")
    def validate_question_options(self):
        if self.type in {"single_choice", "multi_choice"} and not self.options:
            raise ValueError("choice questions require options")
        if self.minimum is not None and self.maximum is not None and self.minimum > self.maximum:
            raise ValueError("minimum cannot be greater than maximum")
        return self

class RoutingRuleDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    metadata_field: str
    operator: Literal["equals", "in", "gte"]
    question_key: str

class ExperimentCreate(BaseModel):
    name: str
    modality: str
    instructions: Optional[str] = None
    label_schema: Dict[str, Any]
    overlap_n: int = Field(default=1, ge=1, le=100)
    gold_ratio: float = Field(default=0.1, ge=0, le=1)
    access_mode: Literal["sign_in_required", "guest_name", "anonymous"] = "anonymous"
    status: Literal["draft", "active"] = "active"
    metadata_schema: List[MetadataFieldDefinition] = Field(default_factory=list)
    qualification_form: List[QualificationQuestionDefinition] = Field(default_factory=list)
    routing_rules: List[RoutingRuleDefinition] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_experiment_configuration(self):
        metadata_keys = [field.key for field in self.metadata_schema]
        question_keys = [question.key for question in self.qualification_form]
        if len(metadata_keys) != len(set(metadata_keys)):
            raise ValueError("metadata field keys must be unique")
        if len(question_keys) != len(set(question_keys)):
            raise ValueError("qualification question keys must be unique")
        metadata_by_key = {field.key: field for field in self.metadata_schema}
        questions_by_key = {question.key: question for question in self.qualification_form}
        for rule in self.routing_rules:
            if rule.metadata_field not in metadata_keys:
                raise ValueError(f"unknown routing metadata field: {rule.metadata_field}")
            if rule.question_key not in question_keys:
                raise ValueError(f"unknown routing question: {rule.question_key}")
            if rule.metadata_field not in metadata_by_key or rule.question_key not in questions_by_key:
                continue
            metadata_field = metadata_by_key[rule.metadata_field]
            question = questions_by_key[rule.question_key]
            if question.type == "text":
                raise ValueError("text qualification questions cannot be used for routing")
            if rule.operator == "in" and question.type != "multi_choice":
                raise ValueError("the 'in' routing operator requires a multi-choice question")
            if rule.operator == "gte" and (
                metadata_field.type != "number" or question.type != "number"
            ):
                raise ValueError("the 'gte' routing operator requires numeric fields")
            if rule.operator == "equals":
                compatible = (
                    metadata_field.type in {"text", "choice"} and question.type == "single_choice"
                ) or (
                    metadata_field.type == "boolean" and question.type == "boolean"
                ) or (
                    metadata_field.type == "number" and question.type == "number"
                )
                if not compatible:
                    raise ValueError("the 'equals' routing operator requires compatible field types")
        return self

class ExperimentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    share_token: str
    status: str
    access_mode: Literal["sign_in_required", "guest_name", "anonymous"]
    created_at: Any = None

class ExperimentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    instructions: Optional[str] = Field(default=None, max_length=10000)
    access_mode: Optional[Literal["sign_in_required", "guest_name", "anonymous"]] = None
    overlap_n: Optional[int] = Field(default=None, ge=1, le=100)
    gold_ratio: Optional[float] = Field(default=None, ge=0, le=1)

    @model_validator(mode="after")
    def require_a_change(self):
        if not self.model_fields_set:
            raise ValueError("provide at least one setting to update")
        if any(getattr(self, field) is None for field in self.model_fields_set):
            raise ValueError("experiment settings cannot be null")
        return self

class ExperimentDeleteRequest(BaseModel):
    experiment_name: str = Field(min_length=1, max_length=200)
    
class ExperimentListResponse(BaseModel):
    experiments: List[ExperimentResponse]

class PresignRequest(BaseModel):
    filenames: List[str]
    experiment_id: Optional[UUID] = None


class PresignResponseItem(BaseModel):
    filename: str
    upload_url: str
    s3_uri: str
    media_url: Optional[str] = None

class PresignResponse(BaseModel):
    urls: List[PresignResponseItem]

class DataUnitCreate(BaseModel):
    raw_uri: str
    is_gold: bool = False
    gold_answer: Optional[Dict[str, Any]] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("raw_uri")
    @classmethod
    def validate_raw_uri(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("raw_uri cannot be empty")
        if ".." in v or "\x00" in v:
            raise ValueError("raw_uri cannot contain path traversal sequences or null bytes")
        if v.startswith("/") or v.startswith("file://") or v.startswith("\\"):
            raise ValueError("Local filesystem paths and file:// schemes are not permitted for raw_uri")
        if v.startswith("s3://"):
            remainder = v[5:]
            if "/" not in remainder or not remainder.split("/", 1)[1]:
                raise ValueError("s3:// URI must include both bucket and key")
        return v


class DataUnitBatchCreate(BaseModel):
    items: List[DataUnitCreate]

class TeachingExampleItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data_unit_id: UUID
    displayed_answer: Dict[str, Any]
    explanation: Optional[str] = None
    keep_as_gold: Optional[bool] = False


class TeachingExampleItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    data_unit_id: UUID
    media_url: str
    displayed_answer: Dict[str, Any]
    explanation: Optional[str] = None
    filename: Optional[str] = None
    keep_as_gold: Optional[bool] = False


class TeachingExamplesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    teaching_examples: List[TeachingExampleItem] = Field(default_factory=list)


class TeachingExamplesResponse(BaseModel):
    teaching_examples: List[TeachingExampleItemResponse]


class SessionResponse(BaseModel):
    session_token: str
    experiment_id: UUID
    modality: str
    instructions: Optional[str] = None
    label_schema: Dict[str, Any]
    access_mode: Literal["sign_in_required", "guest_name", "anonymous"]
    annotator_display_name: Optional[str] = None
    requires_qualification: bool = False
    qualification_form: List[QualificationQuestionDefinition] = Field(default_factory=list)
    requires_teaching_examples: bool = False
    teaching_examples: List[TeachingExampleItemResponse] = Field(default_factory=list)

class SessionStartRequest(BaseModel):
    session_token: Optional[str] = None
    display_name: Optional[str] = Field(default=None, max_length=120)

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

class AnnotatorStatusUpdate(BaseModel):
    status: Literal["active", "paused"]

class QualificationSubmission(BaseModel):
    answers: Dict[str, Any]

class AnnotatorConfigurationResponse(BaseModel):
    experiment_name: str
    access_mode: Literal["sign_in_required", "guest_name", "anonymous"]


class ConsensusPolicySchema(BaseModel):
    min_annotations_for_consensus: int = Field(default=2, ge=1)
    low_evidence_threshold: int = Field(default=3, ge=1)
    min_gold_items: int = Field(default=5, ge=0)
    min_gold_score: float = Field(default=0.70, ge=0.0, le=1.0)
    min_agreement: float = Field(default=0.60, ge=0.0, le=1.0)
    include_low_evidence: bool = Field(default=False)
    prior_strength: float = Field(default=2.0, ge=0.0)


class ExportPreflightRequest(BaseModel):
    mode: Literal["complete", "consensus"] = "complete"
    policy: Optional[ConsensusPolicySchema] = None


class ExportPreflightResponse(BaseModel):
    mode: Literal["complete", "consensus"]
    policy: ConsensusPolicySchema
    source_fingerprint: str
    source_cutoff_at: str
    counts: Dict[str, int]
    annotator_summary: Dict[str, int]
    estimated_size_bytes: int
    training_ready: bool
    warnings: List[str]


class ExportJobCreateRequest(BaseModel):
    mode: Literal["complete", "consensus"] = "complete"
    policy: Optional[ConsensusPolicySchema] = None
    source_fingerprint: str
    acknowledge_warnings: bool = False


class ExportJobResponse(BaseModel):
    id: UUID
    experiment_id: UUID
    mode: Literal["complete", "consensus"]
    status: str
    policy: Dict[str, Any]
    source_cutoff_at: Any
    source_fingerprint: str
    preflight_summary: Dict[str, Any]
    warnings: List[str]
    size_bytes: Optional[int] = None
    sha256: Optional[str] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    created_at: Any
    started_at: Optional[Any] = None
    completed_at: Optional[Any] = None
    expires_at: Optional[Any] = None


class ExportDownloadResponse(BaseModel):
    job_id: UUID
    download_url: str
    expires_in_seconds: int
    filename: str
    size_bytes: Optional[int] = None
    sha256: Optional[str] = None
