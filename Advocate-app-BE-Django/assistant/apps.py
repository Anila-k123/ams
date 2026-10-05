from django.apps import AppConfig
from django.db.models.signals import pre_migrate


def _ensure_trigram(sender, using='default', **kwargs):
    """Lisa's case search uses pg_trgm for typo tolerance (assistant/search.py).
    Production already has it; the test database is built from models with
    migrations off (core/test_runner.py), so make sure of it before any migrate.
    Without it the search still works, minus typo matching."""
    from django.db import connections
    try:
        with connections[using].cursor() as cur:
            cur.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm')
    except Exception:                                        # noqa: BLE001
        pass


class AssistantConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'assistant'

    def ready(self):
        pre_migrate.connect(_ensure_trigram, sender=self, dispatch_uid='assistant_trigram')
