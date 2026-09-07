"""Add experiment soft deletion.

Revision ID: 1e6a32d9b0f4
Revises: 9537f4ad2c61
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "1e6a32d9b0f4"
down_revision: Union[str, None] = "9537f4ad2c61"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "experiment",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("experiment", "deleted_at")
