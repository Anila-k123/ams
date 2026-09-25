"""Send the drafting app to its own database (settings.DATABASES['drafting']) and
keep every other app out of it. Drafting has no foreign keys into AMS's tables:
advocates, cases and documents are referenced by plain ids (AMS convention)."""

DRAFTING_APP = 'drafting'
DRAFTING_DB = 'drafting'


class DraftingRouter:
    def db_for_read(self, model, **hints):
        return DRAFTING_DB if model._meta.app_label == DRAFTING_APP else None

    db_for_write = db_for_read

    def allow_relation(self, obj1, obj2, **hints):
        a, b = obj1._meta.app_label == DRAFTING_APP, obj2._meta.app_label == DRAFTING_APP
        return None if a == b else False   # no relations across the two databases

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        if app_label == DRAFTING_APP:
            return db == DRAFTING_DB
        return db != DRAFTING_DB
