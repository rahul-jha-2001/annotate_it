"""add bundle_upload_job table

Revision ID: a7c8e9f01234
Revises: f1a8c9b2d3e4
Create Date: 2026-10-02 23:17:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'a7c8e9f01234'
down_revision: Union[str, None] = 'f1a8c9b2d3e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'bundle_upload_job',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('experiment_id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=True),
        sa.Column('s3_key', sa.String(), nullable=False),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('files_total', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('files_processed', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('applied', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='[]'),
        sa.Column('errors', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='[]'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['experiment_id'], ['experiment.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['app_user.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_bundle_upload_job_experiment_id'), 'bundle_upload_job', ['experiment_id'], unique=False)
    op.create_index(op.f('ix_bundle_upload_job_user_id'), 'bundle_upload_job', ['user_id'], unique=False)
    op.create_index(op.f('ix_bundle_upload_job_status'), 'bundle_upload_job', ['status'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_bundle_upload_job_status'), table_name='bundle_upload_job')
    op.drop_index(op.f('ix_bundle_upload_job_user_id'), table_name='bundle_upload_job')
    op.drop_index(op.f('ix_bundle_upload_job_experiment_id'), table_name='bundle_upload_job')
    op.drop_table('bundle_upload_job')
