# Lisa — the AI assistant

How Lisa answers, what data she can reach, and how that data is protected.
Backend code: `Advocate-app-BE-Django/assistant/`. Frontend: `src/contexts/AssistantContext.tsx`.

## How a message reaches Lisa

| From | Goes to | AI? |
|---|---|---|
| **Anything typed** | `POST /api/assistant/chat` - the AI answers and can open pages and forms itself (`action` events) | Yes |
| **Quick buttons** (Open Cases, Open Clients, Today's Hearings, Dashboard Summary) | `POST /api/assistant/query` with `{"command": "open_cases"}` - a fixed command name (`views.AssistantQueryView.COMMANDS`) | No |
| Typed text **while the AI is unavailable** (not configured / unreachable: the chat stream ends with `error` + `code: "unavailable"`) | `POST /api/assistant/query` with `{"query": text}` - the old phrase matcher, shown as "(Basic mode)" | No |

**No typed message is matched by phrase first.** Earlier, a phrase matcher ran before the AI and caught anything it recognised: "summarize the case of client Kannan" matched "case of client X" and got a search result instead of a summary. Fixing that wording by wording never ends, so the matcher is now only the basic-mode fallback, and understanding the request is the AI's job. A new wording never needs a rule. A new *capability* is a new tool in `tools._CATALOGUE`.

The chat stream's events: `text` (answer pieces), `action` (`{action: OPEN_PAGE|OPEN_MODAL|SEARCH, route, modalToOpen?, searchQuery?}`, handled by `AssistantContext.handleAction` exactly like a quick command), then `done` with `caseIds`, or `error`.

## Modules

| File | Job |
|---|---|
| `planner.py` | Answers a chat message: tool mode or context mode, masking, audit |
| `tools.py` | Every data lookup, scoped to the user's team and checked against their role (`_CATALOGUE`, `tools_for`, `run_tool`) |
| `context.py` | The pre-built context brief (context mode) |
| `search.py` | Finding the case(s) a question is about: one ranked query |
| `privacy.py` | `Masker` and `StreamUnmasker` |
| `prompts.py` | `TOOL_PROMPT`, `CONTEXT_PROMPT` |
| `provider.py` | Model backends (local / gemini / openai), streaming, retries, token metering, `complete_text` (used by document summaries) |
| `llm.py` | Re-exports the above for existing imports |

## How a chat message is answered

```
question ─► who is asking (tools.acting_as(request.user)): team scope + role permissions
        ─► Masker.for_user: names/identifiers -> [CLIENT_1], [PHONE_1] ...
        ─► TOOL MODE (openai / gemini)                 CONTEXT MODE (local model, or fallback)
             model gets: TODAY, ME, NOT PERMITTED,          a permission-filtered brief of the
             EARLIER CASES + only the tools this            user's data is built up front and
             role may use; it calls them (up to 5           put into the prompt as JSON
             rounds), each result masked
        ─► answer streams back ─► StreamUnmasker puts real names back ─► browser
        ─► token metering (llm_usage, feature "chat") + audit row (ASSISTANT_LLM_CALL)
```

**Tool mode** is used when `ASSISTANT_TOOL_CALLING=auto` (default) and the provider is external, or when it's `on`. If the first tool-mode request fails before anything was shown, the same question is answered in context mode.

### Tools

| Tool | Needs |
|---|---|
| `find_case`, `list_cases`, `caseload_breakdown`, `get_case_summary`, `get_court_record`, `get_parties`, `get_notes`, `get_tasks`, `list_cases_for_client` | `CASE_VIEW` |
| `get_hearings`, `hearings_between(from_date, to_date)` | `EVENT_VIEW` |
| `list_documents` (names only, not contents) | `DOCUMENT_VIEW` |
| `find_client`, `clients_by_case_count` | `CLIENT_VIEW` |
| `get_case_financials`, `client_financials`, `pending_invoices` | `INVOICE_VIEW` (payments inside them also need `PAYMENT_VIEW`) |
| `expense_summary` | `EXPENSE_VIEW` |
| `income_summary` | `PAYMENT_VIEW` |
| `my_tasks`, `overdue_tasks` | signed in (task visibility as on the Tasks page) |
| `dashboard_summary` | signed in; only the counts the role may see |
| **Actions:** `open_page(page)` | the page's own permission (Cases `CASE_VIEW`, Invoices `INVOICE_VIEW`, Tasks `TASK_VIEW`, Reports `REPORT_VIEW`, Drafting `DRAFT_VIEW`, ...; Dashboard, Settings, Display Board, Cause List: signed in) |
| `open_form(form)`: new client / case / hearing / invoice / expense, document upload | the matching `*_CREATE` / `DOCUMENT_UPLOAD` |
| `search_in_page(page, text)`: cases, clients, documents | that page's view permission |
| `open_case(case_id)` | `CASE_VIEW`, and the case must be in scope |

Action tools take only fixed choices (enums of `tools.PAGES` / `FORMS` / `SEARCHABLE`), so the model can't send the browser to an arbitrary route. They return `_action`, which the planner sends as an `action` event and removes from what the model sees.

A tool the role can't use is not offered to the model, and `run_tool` refuses it anyway ("Not permitted"). The model is told what's withheld, so it answers "your role doesn't have access" rather than "there is none". Quick commands apply the same permissions.

## Case search (`search.py`)

`find_case` (a tool, and how context mode picks its cases) runs **one ranked query** over the user's scope instead of one `ILIKE` per word:

| Signal | Matches | Score |
|---|---|---|
| Number | a case number in the text (`900/2025`, `O.S. No. 900/2025`) against the case number or the registration number kept in the description, on number boundaries (`900/2025` is not `1900/2025`) | +10 |
| Words | PostgreSQL full-text search, English stems ("payments" finds "payment"), any of the words, over title, client name, case type, description | + rank |
| Party | a word in a party's or counsel's name on the case | +2 |
| Spelling | `pg_trgm` word similarity ≥ 0.5 to the title or client name ("Seetharman" finds "Seetharaman") | + similarity |

- Words that name the kind of question, English stop words, days, months and generic legal words ("suit", "date", "order") are ignored, so "anything I should worry about before Friday?" matches no case.
- A bare year ("2025 cases") names no case. A 16-character CNR is matched exactly.
- **If the text names a case number, only cases with that number are returned**; words never substitute another case.
- Results carry `matchedOn` (`number`, `words`, `party`, `similar spelling`) and `total` (all matches, not just those returned).
- About 4 statements per search regardless of question length (savepoint, count, rows). `pg_trgm` is optional: without it the spelling signal is skipped. The test database gets it from `assistant/apps.py`.

## Access rules

- **Scope:** the user's team; the whole firm for Super Admin and Accountant (`core.practice.practice_ids`). Resolved on every request from the signed-in user — a team change applies at once.
- **Role:** each kind of data needs the same permission as its page (table above).
- **"Me":** "I/my" mean the asking user; `my_tasks` is their own open tasks. It takes an optional `from_date`/`to_date` ("due today" = both today), and every task row carries `due` in words ("today", "tomorrow", "in 3 days", "overdue by 2 days"), computed on the server. Lisa repeats that wording and never works out dates from a raw deadline: given only `2026-10-07`, she once called a task due in 2 days "due today". When a date range has no tasks, the result carries `nextDue` (the next three) and Lisa names them. A tool result may also carry `_link` (`{route, label}`): the planner sends it as a `link` event and the reply shows it as a button (e.g. **Open Tasks**) that opens the page only when clicked. `_action` (open_page and friends) navigates straight away.

## Privacy masking

Before anything is sent to the model, `privacy.Masker` replaces:

| Token | What | Source |
|---|---|---|
| `[CLIENT_n]` | client names | clients in scope |
| `[PARTY_n]` | case parties, both sides' counsel | `case_party` in scope |
| `[PERSON_n]` | firm staff | advocates in scope |
| `[ADDRESS_n]` | client addresses | client and client-profile records |
| `[PHONE_n]` `[EMAIL_n]` `[PAN_n]` `[GSTIN_n]` `[AADHAAR_n]` `[IFSC_n]` | identifiers | patterns (same shapes as `core/validators.py`) |

- The same value gets the same token across the question, history, starter facts and tool results. A person mentioned by surname alone is masked too; an organisation's single words ("Income", "Technologies") are not.
- Not masked: case numbers, courts, judges, dates, amounts, statutes.
- The model may use tokens in tool arguments (`find_client("[CLIENT_1]")`); they are unmasked before the lookup.
- The reply is unmasked as it streams; a token split across pieces is held back until complete.
- Always on for openai / gemini; for the local model `ASSISTANT_MASK_LOCAL` (default `True`).
- **Limit:** a name that appears only in free text (a note, a court filing) and in no record isn't caught.

## Audit and metering

- One `audit_log` row per chat: `action_type=ASSISTANT_LLM_CALL`, provider, model, mode, and how many values of each kind were masked — never the values.
- Every model round is metered in `llm_usage` (feature `chat`); `manage.py llm_usage` reports it.

## Configuration (`.env`)

| Variable | Default | |
|---|---|---|
| `LLM_PROVIDER` | `local` | `local` / `gemini` / `openai` |
| `ASSISTANT_TOOL_CALLING` | `auto` | `auto` (on for external providers) / `on` / `off` |
| `ASSISTANT_MASK_LOCAL` | `True` | mask for the local model too |
| `LLM_*`, `GEMINI_*`, `OPENAI_*` | | see `provider.py` |

## Tests

`manage.py test assistant` covers: access by role (no money for an intern, in both modes), scope after a team change, masking (outgoing request has no real values; split tokens; organisations), the tool loop (date-range hearings, masked tool arguments, round cap, fallback to context mode, follow-ups), and case search (number boundaries, registration numbers, stems, typos, counsel names, noise questions, named numbers, scope, query count).
