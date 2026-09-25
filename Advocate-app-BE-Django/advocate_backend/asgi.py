"""ASGI entrypoint (plain Django; HTTP only).

The Channels router that was here for WebSockets "later" was removed in merge
phase 08: nothing serves WebSockets, and the frontend's real-time client is off
unless VITE_ENABLE_WS=true. Add Channels back together with a real consumer.
"""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'advocate_backend.settings')

application = get_asgi_application()
