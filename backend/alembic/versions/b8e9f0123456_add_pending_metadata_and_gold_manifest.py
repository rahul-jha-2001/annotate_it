"""add pending_metadata and pending_gold_manifest to experiment table

Revision ID: b8e9f0123456
Revises: a7c8e9f01234
Create Date: 2026-10-03 19:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'b8e9f0123456'
down_revision: Union[str, None] = 'a7c8e9f01234'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'experiment',
        sa.Column('pending_metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='[]')
    )
    op.add_column(
        'experiment',
        sa.Column('pending_gold_manifest', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='[]')
    )


def downgrade() -> None:
    op.drop_column('experiment', 'pending_gold_manifest')
    op.drop_column('experiment', 'pending_metadata')
