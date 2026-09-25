from django.apps import AppConfig
from django.db.backends.signals import connection_created


_checked_databases = set()


def _ensure_drafting_schema(sender, connection, **kwargs):
    """Drafting tables live in schema "drf" and use pgvector. Make sure both exist on
    the drafting database (a fresh or test database has neither). Once per database
    per process, not per connection: the dev server opens a connection per request."""
    if connection.alias != 'drafting':
        return
    name = connection.settings_dict.get('NAME')
    if name in _checked_databases:
        return
    with connection.cursor() as cur:
        cur.execute('CREATE SCHEMA IF NOT EXISTS drf')
        cur.execute('CREATE EXTENSION IF NOT EXISTS vector')
    _checked_databases.add(name)


class DraftingConfig(AppConfig):
    """Legal drafting (merged from InstaDraft). Its models are in the separate
    `drafting` database (settings.DATABASES / drafting.router.DraftingRouter)."""
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'drafting'

    def ready(self):
        connection_created.connect(_ensure_drafting_schema, dispatch_uid='drafting_schema')
