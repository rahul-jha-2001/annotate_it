import uuid
from datetime import datetime
from sqlalchemy import Column, String, Float, Integer, BigInteger, Boolean, ForeignKey, DateTime, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.sql import func

Base = declarative_base()

class User(Base):
    __tablename__ = 'app_user'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    clerk_user_id = Column(String, unique=True, nullable=True, index=True)
    email = Column(String, unique=True, nullable=False, index=True)
    display_name = Column(String, nullable=False)
    avatar_url = Column(String)
    status = Column(String, nullable=False, default='active')
    is_platform_admin = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    experiments = relationship("Experiment", back_populates="owner")
    annotator_profiles = relationship("Annotator", back_populates="user")
    export_jobs = relationship("ExportJob", back_populates="requested_by_user")

class Experiment(Base):
    __tablename__ = 'experiment'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id = Column(UUID(as_uuid=True), ForeignKey('app_user.id', ondelete='RESTRICT'), nullable=True, index=True)
    name = Column(String, nullable=False)
    modality = Column(String, nullable=False) # 'audio' | 'image'
    instructions = Column(String)
    label_schema = Column(JSONB, nullable=False)
    overlap_n = Column(Integer, nullable=False, default=1)
    gold_ratio = Column(Float, nullable=False, default=0.1)
    access_mode = Column(String, nullable=False, default='anonymous')
    share_token = Column(String, unique=True, nullable=False)
    status = Column(String, nullable=False, default='active')
    metadata_schema = Column(JSONB, nullable=False, default=list)
    qualification_form = Column(JSONB, nullable=False, default=list)
    routing_rules = Column(JSONB, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    deleted_at = Column(DateTime(timezone=True))

    data_units = relationship("DataUnit", back_populates="experiment", cascade="all, delete-orphan")
    annotators = relationship("Annotator", back_populates="experiment", cascade="all, delete-orphan")
    owner = relationship("User", back_populates="experiments")
    export_jobs = relationship("ExportJob", back_populates="experiment", cascade="all, delete-orphan")

class DataUnit(Base):
    __tablename__ = 'data_unit'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    experiment_id = Column(UUID(as_uuid=True), ForeignKey('experiment.id', ondelete='CASCADE'), nullable=False)
    raw_uri = Column(String, nullable=False)
    is_gold = Column(Boolean, nullable=False, default=False)
    gold_answer = Column(JSONB)
    metadata_json = Column("metadata", JSONB, nullable=False, default=dict)

    experiment = relationship("Experiment", back_populates="data_units")
    annotations = relationship("Annotation", back_populates="data_unit", cascade="all, delete-orphan")
    agreement = relationship("ItemAgreement", back_populates="data_unit", uselist=False, cascade="all, delete-orphan")

class Annotator(Base):
    __tablename__ = 'annotator'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    experiment_id = Column(UUID(as_uuid=True), ForeignKey('experiment.id', ondelete='CASCADE'), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey('app_user.id', ondelete='SET NULL'), nullable=True, index=True)
    display_name = Column(String)
    session_token = Column(String, unique=True, nullable=False)
    status = Column(String, nullable=False, default='active')
    qualification_answers = Column(JSONB)
    qualified_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    experiment = relationship("Experiment", back_populates="annotators")
    annotations = relationship("Annotation", back_populates="annotator", cascade="all, delete-orphan")
    score = relationship("AnnotatorScore", back_populates="annotator", uselist=False, cascade="all, delete-orphan")
    user = relationship("User", back_populates="annotator_profiles")

class Annotation(Base):
    __tablename__ = 'annotation'

    __table_args__ = (
        UniqueConstraint('data_unit_id', 'annotator_id', name='uq_annotation_data_unit_annotator'),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    data_unit_id = Column(UUID(as_uuid=True), ForeignKey('data_unit.id', ondelete='CASCADE'), nullable=False)
    annotator_id = Column(UUID(as_uuid=True), ForeignKey('annotator.id', ondelete='CASCADE'), nullable=False)
    answer = Column(JSONB, nullable=False)
    submitted_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    data_unit = relationship("DataUnit", back_populates="annotations")
    annotator = relationship("Annotator", back_populates="annotations")

class AnnotatorScore(Base):
    __tablename__ = 'annotator_score'

    annotator_id = Column(UUID(as_uuid=True), ForeignKey('annotator.id', ondelete='CASCADE'), primary_key=True)
    rolling_gold_accuracy = Column(Float)
    rolling_agreement_score = Column(Float)
    items_completed = Column(Integer, nullable=False, default=0)
    gold_items_seen = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    annotator = relationship("Annotator", back_populates="score")

class ItemAgreement(Base):
    __tablename__ = 'item_agreement'

    data_unit_id = Column(UUID(as_uuid=True), ForeignKey('data_unit.id', ondelete='CASCADE'), primary_key=True)
    agreement_score = Column(Float)
    n_annotations = Column(Integer, nullable=False)
    computed_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    data_unit = relationship("DataUnit", back_populates="agreement")


class ExportJob(Base):
    __tablename__ = 'export_job'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    experiment_id = Column(UUID(as_uuid=True), ForeignKey('experiment.id', ondelete='CASCADE'), nullable=False, index=True)
    requested_by_user_id = Column(UUID(as_uuid=True), ForeignKey('app_user.id', ondelete='SET NULL'), nullable=True, index=True)
    mode = Column(String, nullable=False)  # 'complete' | 'consensus'
    status = Column(String, nullable=False, default='queued', index=True)  # 'queued' | 'running' | 'ready' | 'failed' | 'expired'
    policy = Column(JSONB, nullable=False, default=dict)
    source_cutoff_at = Column(DateTime(timezone=True), nullable=False)
    source_counts = Column(JSONB, nullable=False, default=dict)
    source_fingerprint = Column(String, nullable=False)
    preflight_summary = Column(JSONB, nullable=False, default=dict)
    warnings = Column(JSONB, nullable=False, default=list)
    object_uri = Column(String)
    size_bytes = Column(BigInteger)
    sha256 = Column(String)
    error_code = Column(String)
    error_message = Column(String)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    started_at = Column(DateTime(timezone=True))
    completed_at = Column(DateTime(timezone=True))
    expires_at = Column(DateTime(timezone=True))
    worker_id = Column(String, nullable=True, index=True)
    lease_expires_at = Column(DateTime(timezone=True), nullable=True, index=True)

    experiment = relationship("Experiment", back_populates="export_jobs")
    requested_by_user = relationship("User", back_populates="export_jobs")


class MediaUpload(Base):
    __tablename__ = 'media_upload'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey('app_user.id', ondelete='CASCADE'), nullable=False, index=True)
    experiment_id = Column(UUID(as_uuid=True), ForeignKey('experiment.id', ondelete='SET NULL'), nullable=True, index=True)
    bucket = Column(String, nullable=False)
    key = Column(String, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    user = relationship("User")
    experiment = relationship("Experiment")
