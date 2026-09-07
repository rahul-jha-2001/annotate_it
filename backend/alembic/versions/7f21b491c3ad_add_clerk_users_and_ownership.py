"""Add Clerk-backed users and resource ownership.

Revision ID: 7f21b491c3ad
Revises: c42d91b8a704
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "7f21b491c3ad"
down_revision: Union[str, None] = "c42d91b8a704"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "app_user",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("clerk_user_id", sa.String(), nullable=True),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=False),
        sa.Column("avatar_url", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="active"),
        sa.Column("is_platform_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_app_user_clerk_user_id", "app_user", ["clerk_user_id"], unique=True)
    op.create_index("ix_app_user_email", "app_user", ["email"], unique=True)

    op.add_column("experiment", sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_experiment_owner",
        "experiment",
        "app_user",
        ["owner_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_experiment_owner_id", "experiment", ["owner_id"])

    op.add_column("annotator", sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_annotator_user",
        "annotator",
        "app_user",
        ["user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_annotator_user_id", "annotator", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_annotator_user_id", table_name="annotator")
    op.drop_constraint("fk_annotator_user", "annotator", type_="foreignkey")
    op.drop_column("annotator", "user_id")
    op.drop_index("ix_experiment_owner_id", table_name="experiment")
    op.drop_constraint("fk_experiment_owner", "experiment", type_="foreignkey")
    op.drop_column("experiment", "owner_id")
    op.drop_index("ix_app_user_email", table_name="app_user")
    op.drop_index("ix_app_user_clerk_user_id", table_name="app_user")
    op.drop_table("app_user")
