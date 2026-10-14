# Financial integrity and background reliability (SaaS Phase 7)

How AMS keeps a firm's billing, reminders, documents and drafts correct when
requests are retried, run at the same time, fail half-way, or cross a firm
boundary. This is the **law firm's billing of its clients**; AMS's own
subscription billing of firms is a separate, future concern (Phase 8) and does
not use these tables or rules.

## Money (`core/money.py`)

- Amounts are parsed and computed as `Decimal`, rounded to paise. The legacy
  columns (`invoices.amount`, `client_payments.amount`) stay double precision;
  only already-rounded values are written.
- `parse_amount`: a number, at most two decimals, above zero, at most Rs. 100
  crore. A bad amount is a 400, never silently 0 (it used to be).
- `check_currency`: a currency sent with an amount must be the firm's
  (`FirmSettings.currency`) and supported (INR only today).
- GST rate must be 0 / 5 / 12 / 18 / 28 %; GST is computed in Decimal
  (`invoices/views._compute_gst`).

## Invoice numbers (`invoices/numbering.py`)

- Per firm: `<prefix><NNNNNN>` (`FirmSettings.invoice_prefix`, default `INV-`),
  or `<prefix><FY>/<NNNN>` when `invoice_fy_reset` restarts numbering each
  Indian financial year (April-March).
- Unique **within the firm** in the database: `invoices_firm_number_uniq
  (firm_id, invoice_number)`, plus `invoices_legacy_number_uniq` for rows with
  no firm. The old server-wide `UNIQUE (invoice_number)` was dropped by
  `invoices/0010` (two firms' `INV-000001` collided); no row was changed.
- Concurrency: the scope's `invoice_sequence` row is locked (`SELECT ... FOR
  UPDATE`) inside the invoice's transaction, so simultaneous invoices in one
  firm get consecutive numbers; firms never touch each other's row.
- History is kept: a scope's first use continues after the firm's highest
  existing number in that format. Nothing is renumbered.
- A hand-typed number is checked within the firm only (a 409 never reveals
  another firm's numbers).

## Invoices (`invoices/views.py`)

- Creation and issue are one transaction: invoice, lines, tax detail, handling
  row, number and case totals - a failure leaves nothing and gives the number
  back. Client email and internal alerts run `on_commit`.
- Status transitions (`core/finance.INVOICE_TRANSITIONS`): UNPAID -> PARTIAL /
  PAID / CANCELLED, PARTIAL -> PAID; nothing leaves PAID or CANCELLED (a wrong
  invoice is cancelled and a new one raised). Mark-paid and cancel lock the row;
  repeating mark-paid is harmless.
- Every issue, mark-paid, cancel and payment writes a business audit row
  (`core.audit.business_event`, module INVOICE / PAYMENT) with the facts
  (number, amount, before -> after) and the firm's `firm_id`.

## Payments (`payments/views.py`)

- `Idempotency-Key` header (the app sends one per payment form, reused on a
  retry): a repeated request returns the first payment (200); the same key with
  a different body is a 409 `IDEMPOTENCY_MISMATCH`. Table `payment_request_key`.
- Same reference + amount + invoice (or case) twice -> 409 `DUPLICATE_REFERENCE`
  (one cheque over two invoices is allowed).
- Against an invoice, the invoice row is locked while the balance is checked:
  simultaneous payments can't together exceed what is due.
- Date must be a real date, not in the future.

## Background jobs and notifications

No Redis/Celery was added: the scheduler (`run_scheduler`) and the database do it.

- **Firm context is explicit.** `scan_due_notifications` resolves each owner's
  firm (`firm_id_of_advocate`); work of a suspended / closed firm raises nothing.
  Recipients are checked per reminder with `core.tenant.can_receive(advocate,
  firm_id)`: not left, ACTIVE membership of that ACTIVE firm. An owner who left
  is still scanned - the work stays with the firm and the team is told - but the
  leaver is not.
- **Once per period.** Before a scheduled reminder is queued, its key
  (event, entity, recipient, day or ISO week) is inserted into
  `notification_key` (unique). Overlapping or retried scans can't queue it twice.
- **Sent once.** The drain claims each row with one `UPDATE ... WHERE status =
  'PENDING'` (-> PROCESSING); only one drain wins a row. A row left PROCESSING
  for 15 minutes (dead drain) is handed back. Before sending, the recipient and
  firm are re-checked; if no longer allowed the row is CANCELLED with the reason.
- **Retries** keep the existing backoff (5, 30, 120 min) then FAILED_PERMANENTLY.
- **Job status**: every scan and drain records a `job_run` row (status, counts,
  short error - exception type and first line, no payloads).
  `manage.py job_status [--job NAME] [--failed]`.

## Documents (`documents/storage.py`)

- Files are written to `<uuid>.part` and renamed when complete; the stored name
  is a uuid plus a sanitised extension (the uploaded name never picks the path).
- If the database row can't be saved, the new file is removed. A version upload
  locks the document, is all-or-nothing, and keeps every earlier file.

## Drafting (`drafting/tasks.py::generate_draft`, `views.py::regenerate`)

- A run is claimed with a conditional UPDATE (PENDING / FAILED -> GENERATING):
  a duplicate or late job (double dispatch, a retry after the draft is READY)
  does nothing instead of wiping the draft.
- The new blocks replace the old ones in one transaction at the end, with the
  READY status and the "AI draft" version: a failed regeneration keeps the
  previous draft. Two Regenerate clicks start one run (409 for the second).

## Exports

Report PDFs, receipts and the notification history / CSV export are limited to
the firm (`owned(...)`, `communication.views._firm_rows`): rows from a member's
time at another firm are not shown or exported.
