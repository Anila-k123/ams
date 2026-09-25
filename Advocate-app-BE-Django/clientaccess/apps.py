from django.apps import AppConfig


class ClientaccessConfig(AppConfig):
    """The Client role: a firm's client signs in to AMS and sees only their own matters."""
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'clientaccess'
