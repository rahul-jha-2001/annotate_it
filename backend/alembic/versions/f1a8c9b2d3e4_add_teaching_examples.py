"""add teaching examples to experiment and annotator

Revision ID: f1a8c9b2d3e4
Revises: e461954fe589
Create Date: 2026-10-02 12:35:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'f1a8c9b2d3e4'
down_revision: Union[str, None] = 'e461954fe589'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'experiment',
        sa.Column('teaching_examples', postgresql.JSONB(), nullable=False, server_default='[]'),
    )
    op.add_column(
        'annotator',
        sa.Column('teaching_examples_shown_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('annotator', 'teaching_examples_shown_at')
    op.drop_column('experiment', 'teaching_examples')
