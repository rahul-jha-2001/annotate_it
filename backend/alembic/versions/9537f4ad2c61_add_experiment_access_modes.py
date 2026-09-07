"""Add experiment access modes and guest annotator names.

Revision ID: 9537f4ad2c61
Revises: 7f21b491c3ad
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "9537f4ad2c61"
down_revision: Union[str, None] = "7f21b491c3ad"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "experiment",
        sa.Column("access_mode", sa.String(), nullable=False, server_default="anonymous"),
    )
    op.add_column("annotator", sa.Column("display_name", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("annotator", "display_name")
    op.drop_column("experiment", "access_mode")
