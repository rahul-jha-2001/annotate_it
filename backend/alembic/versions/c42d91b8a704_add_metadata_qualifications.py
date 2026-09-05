"""Add sample metadata, qualifications, routing, and experiment status.

Revision ID: c42d91b8a704
Revises: 8b73f61f6d21
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "c42d91b8a704"
down_revision: Union[str, None] = "8b73f61f6d21"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "experiment",
        sa.Column("status", sa.String(), nullable=False, server_default="active"),
    )
    op.add_column(
        "experiment",
        sa.Column(
            "metadata_schema", postgresql.JSONB(), nullable=False, server_default="[]"
        ),
    )
    op.add_column(
        "experiment",
        sa.Column(
            "qualification_form", postgresql.JSONB(), nullable=False, server_default="[]"
        ),
    )
    op.add_column(
        "experiment",
        sa.Column(
            "routing_rules", postgresql.JSONB(), nullable=False, server_default="[]"
        ),
    )
    op.add_column(
        "data_unit",
        sa.Column("metadata", postgresql.JSONB(), nullable=False, server_default="{}"),
    )
    op.add_column(
        "annotator", sa.Column("qualification_answers", postgresql.JSONB(), nullable=True)
    )
    op.add_column(
        "annotator", sa.Column("qualified_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("annotator", "qualified_at")
    op.drop_column("annotator", "qualification_answers")
    op.drop_column("data_unit", "metadata")
    op.drop_column("experiment", "routing_rules")
    op.drop_column("experiment", "qualification_form")
    op.drop_column("experiment", "metadata_schema")
    op.drop_column("experiment", "status")
