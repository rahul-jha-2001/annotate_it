"""Normalize legacy list-based experiment label schemas.

Revision ID: 8b73f61f6d21
Revises: 50bc27c1a90d
"""

from typing import Sequence, Union

from alembic import op

revision: str = "8b73f61f6d21"
down_revision: Union[str, None] = "50bc27c1a90d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE experiment
        SET label_schema = jsonb_build_object(
            'annotation_type', label_schema->0->>'type',
            'choices', COALESCE(
                (
                    SELECT jsonb_agg(entry->>'name' ORDER BY position)
                    FROM jsonb_array_elements(label_schema) WITH ORDINALITY AS items(entry, position)
                    WHERE entry ? 'name'
                ),
                '[]'::jsonb
            ),
            'multi_select', false
        )
        WHERE jsonb_typeof(label_schema) = 'array'
          AND jsonb_array_length(label_schema) > 0
        """
    )


def downgrade() -> None:
    # The current object format cannot be converted back without losing newer
    # schema fields, so preserve it during downgrade.
    pass
