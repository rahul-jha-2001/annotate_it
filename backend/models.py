import uuid
from datetime import datetime
from sqlalchemy import Column, String, Float, Integer, Boolean, ForeignKey, DateTime, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.sql import func

Base = declarative_base()

class Experiment(Base):
    __tablename__ = 'experiment'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    modality = Column(String, nullable=False) # 'audio' | 'image'
    instructions = Column(String)
    label_schema = Column(JSONB, nullable=False)
    overlap_n = Column(Integer, nullable=False, default=1)
    gold_ratio = Column(Float, nullable=False, default=0.1)
    share_token = Column(String, unique=True, nullable=False)
    status = Column(String, nullable=False, default='active')
    metadata_schema = Column(JSONB, nullable=False, default=list)
    qualification_form = Column(JSONB, nullable=False, default=list)
    routing_rules = Column(JSONB, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    data_units = relationship("DataUnit", back_populates="experiment", cascade="all, delete-orphan")
    annotators = relationship("Annotator", back_populates="experiment", cascade="all, delete-orphan")

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
    session_token = Column(String, unique=True, nullable=False)
    status = Column(String, nullable=False, default='active')
    qualification_answers = Column(JSONB)
    qualified_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    experiment = relationship("Experiment", back_populates="annotators")
    annotations = relationship("Annotation", back_populates="annotator", cascade="all, delete-orphan")
    score = relationship("AnnotatorScore", back_populates="annotator", uselist=False, cascade="all, delete-orphan")

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
