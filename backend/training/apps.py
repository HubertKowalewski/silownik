from django.apps import AppConfig


class TrainingConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'training'
    verbose_name = 'Trening'

    def ready(self):
        from . import signals  # noqa: F401
