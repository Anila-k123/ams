from django.apps import AppConfig
from django.db.models.signals import pre_migrate


def _ensure_drafting_schema(sender, using='default', **kwargs):
    """Drafting's tables live in schema "drf" and use pgvector. Migration 0001 creates
    both, but the test runner (core/test_runner.py) builds the test database from the
    models with migrations switched off, so make sure of them before any migrate."""
    from django.db import connections
    with connections[using].cursor() as cur:
        cur.execute('CREATE SCHEMA IF NOT EXISTS drf')
        cur.execute('CREATE EXTENSION IF NOT EXISTS vector')


class DraftingConfig(AppConfig):
    """Legal drafting (merged from InstaDraft). Its tables live in schema "drf" of the
    one app database, and use pgvector."""
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'drafting'

    def ready(self):
        pre_migrate.connect(_ensure_drafting_schema, sender=self, dispatch_uid='drafting_schema')
