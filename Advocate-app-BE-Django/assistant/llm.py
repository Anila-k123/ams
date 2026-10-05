"""Lisa's entry points, kept here so existing imports keep working.

The assistant is split by job:
    provider.py  the connection to the model (backends, streaming, retries, metering)
    planner.py   how a chat message is answered (tool calling, or the context brief)
    context.py   the pre-built context brief (local models / fallback)
    tools.py     the data lookups, each scoped to the user's team and role
    privacy.py   masking of names and identifiers before anything leaves the server
    prompts.py   what the model is told
"""

from .context import (  # noqa: F401
    _HISTORY_MAX_CHARS, _HISTORY_MAX_TURNS, _HISTORY_TOTAL_CHARS, build_context,
    clean_focus_ids, clean_history, context_case_ids)
from .planner import stream_answer  # noqa: F401
from .prompts import CONTEXT_PROMPT, SYSTEM_PROMPT, TOOL_PROMPT  # noqa: F401
from .provider import (  # noqa: F401
    AssistantUnavailable, LLM_PROVIDER, active_model_name, complete_text, masking_enabled,
    tool_calling_enabled)
