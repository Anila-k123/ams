from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'core'

    def ready(self):
        # Connect the field-level change capture once, after every app's models
        # are loaded - audit_diff registers per model, so it has to run here
        # rather than at import time.
        #
        # The handlers are inert outside a request: they only collect while
        # AuditLogMiddleware has opened a scope, so management commands and
        # migrations pay nothing for this.
        from core import audit_diff
        audit_diff.register()
        # Firm ownership stamped on save + cross-firm references refused
        # (core/tenant.py). Only when this database has the firm_id columns.
        from core import tenant
        tenant.connect()
