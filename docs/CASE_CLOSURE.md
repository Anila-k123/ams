# Closing and reopening a case

"Closed" means two different things: the court decided the matter, or **we no longer act for the client**
(they changed advocate, the NOC was given, the vakalat withdrawn) while the case lives on in court. PactPro asks
why a case is closed, and that answer decides what it keeps doing for the case.

## Who and where

Anyone in the team who can edit the case (`CASE_EDIT`):

- **Case page → Status** field: choosing **Closed** opens *Close case* (*Why is it closed?* + a note);
  choosing Active / Pending on a closed case asks *Reopen case?*.
- **Cases list → Edit**: choosing Closed shows *Why is it closed?* (required) and a note.
- A case closed before reasons were asked shows **Closed: reason not recorded** in its header; click it to
  set the reason.

The reason, note, date and who closed it are kept on the case profile (`case_profile.closed_reason`,
`closed_note`, `closed_on`, `closed_by_id`; read in `GET /api/workspace/cases/<id>/profile` as
`closedReason`, `closedNote`, `closedOn`) and shown in the case header. The API: `PUT /api/cases/update/<id>`
with `status` and `closedReason` (`court_decided`, `no_longer_acting`, `settled`, `other`) and `closedNote`;
reopening (any status that isn't closed) clears them. The case status values themselves are unchanged
(Active / Pending / Closed), so reports and filters work as before.

## What a closed case still gets

`cases/closure.py` (`mode()`, `stopped_case_ids()`) is the one rule every background feature asks:

| | Open | Closed: decided by the court (or reason not recorded) | Closed: no longer acting / settled / other |
|---|---|---|---|
| Order sync (`docs/ORDER_SYNC.md`) | every round | weekly | **not fetched** |
| New-order alerts and client emails | yes | yes | **none** (a manual Refresh keeps the order but tells nobody) |
| Appeal Alerts and the evening appeal watch (`docs/APPEALS.md`) | when decided | yes | **none**; an active watch is stopped; hidden from the page |
| Auto-link by CNR | yes | no | no |
| Cause-list alerts ("listed today") | yes | no | no |
| Hearing reminders | yes | no | no |
| Client portal | as is | as is | as is (history; nothing new is added) |
| Invoices, payments, dues | yes | yes | **yes** (fees owed stay collectable) |

**Reopen** (e.g. the client returns) brings everything back; with a CNR and no court record, the daily
auto-link picks it up again.

Migration: `workspace/0015_case_closed_reason`.
