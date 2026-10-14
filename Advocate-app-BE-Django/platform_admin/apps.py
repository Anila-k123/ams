from django.apps import AppConfig


class PlatformAdminConfig(AppConfig):
    """AMS platform operators (the company running AMS): tenant provisioning and
    operations. Separate identities, tokens and audit from firm users."""
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'platform_admin'
