"""ASGI entrypoint, routed through Channels so WebSockets can be added later.

Mirrors the pact-pro-draft pattern: HTTP is served now; the 'websocket' branch
is intentionally deferred (Phase 2+). The frontend's STOMP client will simply
fail to connect and the UI degrades gracefully (it polls REST for updates).
"""

import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'advocate_backend.settings')

application = ProtocolTypeRouter({
    'http': get_asgi_application(),
    # 'websocket': ... (deferred)
})
