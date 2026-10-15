"""View decorators: subscription checks at the API boundary (server-side; the
React app only displays limits, it is never the authority)."""
from functools import wraps

from django.db import transaction

from .service import require


def entitled(key, quantity=lambda request: 1):
    """Run the view method inside one transaction, after reserving `quantity` of
    `key` for the acting user's firm. The reservation's row lock is held until
    the view's own insert commits, so concurrent requests can't overshoot."""
    def deco(fn):
        @wraps(fn)
        def wrapper(self, request, *args, **kwargs):
            with transaction.atomic():
                require(request.user, key, quantity(request))
                return fn(self, request, *args, **kwargs)
        return wrapper
    return deco
