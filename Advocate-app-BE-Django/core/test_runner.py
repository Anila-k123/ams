"""Test runner that can build a database for this project's models.

26 of the 37 models are `managed = False` - they map onto tables the old Spring
application owns, so Django never migrates them. That is right in production and
fatal for tests: the test database is built from migrations, so every unmanaged
table would be missing and any test touching a Client or a Case would fail with
"relation does not exist".

The fix is the standard one: flip `managed = True` for the duration of the test
run so Django creates the tables from the model definitions, then put it back.
Nothing outside the test database is affected - production still never migrates
these tables, because this runner is only used by `manage.py test`.

One consequence worth knowing: the tables are built from the MODELS, not from
the real schema. Postgres CHECK constraints that exist in the live database -
notification_history.channel, notification_queue.type - are not reproduced, so a
test cannot catch a violation of them. Those need the real database.
"""

from django.apps import apps
from django.conf import settings
from django.test.runner import DiscoverRunner


class _NoMigrations:
    """Tells Django every app has no migrations, so tables come from models.

    Flipping `managed` alone is not enough. When migrations exist, Django builds
    the test database from the migration files, and those files record
    `managed = False` for the Spring-owned models - so the tables were still
    skipped, and the first migration that ALTERs one failed with
    "relation acts_act does not exist".

    Switching migrations off makes Django create every table directly from the
    current model definitions instead. The trade is that migrations themselves
    are not exercised by the test run; the models are what the code under test
    actually uses, so that is the right side to be correct on.
    """

    def __contains__(self, item):
        return True

    def __getitem__(self, item):
        return None


class ManagedModelTestRunner(DiscoverRunner):
    """Make unmanaged models managed while the test database is built."""

    def setup_test_environment(self, *args, **kwargs):
        self.unmanaged_models = [m for m in apps.get_models()
                                 if not m._meta.managed]
        for m in self.unmanaged_models:
            m._meta.managed = True
        settings.MIGRATION_MODULES = _NoMigrations()
        super().setup_test_environment(*args, **kwargs)

    def teardown_test_environment(self, *args, **kwargs):
        super().teardown_test_environment(*args, **kwargs)
        # Restore, so a runner reused in one process cannot leave models
        # marked managed and tempt a later migration into touching them.
        for m in self.unmanaged_models:
            m._meta.managed = False
