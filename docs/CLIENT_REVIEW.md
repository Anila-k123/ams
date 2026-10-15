# Client review: sending a document to the client, getting their changes back

Status: **phase 1 built** (15 Oct 2026; automated tests pass, not yet tried by hand). Phase 2 (WhatsApp, clients' desktop editor over WebDAV) comes with
hosting / HTTPS.

## Why (how it works in practice today)
The firm emails or WhatsApps a Word file "for your review". The client replies however suits them: tracked changes in
Word, a note ("rent should be 45,000"), a phone call, a photo of handwritten corrections. The junior folds the changes
into the firm's own copy, sends the next version, and the client finally says "OK, go ahead". Firms struggle with
feedback scattered across email / WhatsApp / phone, version confusion, untracked edits, informal approvals and chasing.

PactPro keeps that habit but in one place: **the firm keeps the master; the client marks up a copy; the firm decides
what goes in; every round and the approval are on record.**

## Decisions (15 Oct 2026)
| Question | Decision |
|---|---|
| How clients edit | **For now: download, edit in their own Word / LibreOffice, upload back** (decided 15 Oct 2026). The portal editor in review mode is built but **switched off** (`CLIENT_REVIEW_EDITOR=False`). |
| Desktop editors for clients through PactPro (WebDAV) | Later, with HTTPS hosting. |
| Notifications | **Email + in-app** now. **WhatsApp later.** |

## The flow

1. **Send for review (firm).** On a Word document linked to a client (directly or through a case) whose client has a
   portal login: **Send to client for review**:
   - a message;
   - optional questions;
   - an optional reply-by date.

   PactPro makes a **review copy** of that exact version for the client. The firm's internal comments are removed
   and open tracked changes accepted, so firm notes never leak. The client gets an email (firm-branded, link to the
   portal) and sees it under **Waiting for your review**.
2. **Review (client, portal).** Three steps on the review page:
   1. **Download** the copy;
   2. edit it in their own Word / LibreOffice (the page suggests switching on Track Changes);
   3. **upload** it back, with a note, photos or a PDF if they like.

   (With `CLIENT_REVIEW_EDITOR=True` the copy opens in the PactPro editor in review mode instead.)
3. **Reply (client).**
   - **Send back with my changes:** the uploaded file and / or a note (one of them is required). The round is marked
     *Changes sent*, and the firm is notified (bell + email).
   - **Approve this version:** who, which version and when are recorded; the firm is notified.
   - Messages in the review's **thread** (both sides) at any time.
4. **Take in the changes (firm).** On the document, the **Client review** panel shows the thread, the client's
   notes and files. Two ways to bring changes in:
   - **Compare in editor** on the client's uploaded Word file: the firm's document opens in the PactPro editor compared
     with it; the differences appear as tracked changes to accept or reject. (*Open client's changes* does the same
     with the online copy, shown only when the client edited in the portal editor.)
   - For anything else (a note, a photo), the advocate edits the document themselves.
5. **Next round (firm).** **Send revised version** sends the current version as round 2 (a new review copy) with a
   message. The previous rounds stay on record.
6. **Approved.** The document shows **Client approved · v5 · date**; the review closes. The firm can also cancel a
   review (the client then no longer sees it).
7. **Reminders.** With a reply-by date, the scheduler emails the client a reminder on the date and every 3 days after
   while the round is waiting on them.

## Rules
- Who sends, writes to the client, sends the next round or cancels: anyone allowed to edit documents (DOCUMENT_EDIT),
  **and the person an open task is assigned to, for that task's document** (decided 15 Oct 2026). Anyone who can open
  the document can read the review.
- The client sees only review copies sent to them (their client, practice scope), never the master, its history,
  other versions or the firm's comments.
- The client never accepts / rejects anything; the firm decides.
- Word documents can be edited by the client; other types (PDF, Excel, images) are sent to view / download and
  answered with notes and files.
- Every step is recorded (rounds, messages, files, approval) and notifications are sent through the usual services.

## Not in phase 1
- WhatsApp notifications (the channel is disabled; later: click-to-send or the WhatsApp Business API).
- Clients editing in their own Word / LibreOffice through PactPro (WebDAV): needs HTTPS hosting; meanwhile download
  and upload.
- Sending a draft directly: file it to the case first (Save to case), then send that document.
- Approval with a one-time code (e-sign style).
- The portal is reachable only where PactPro is: on the office network until hosting.

## How it is built (phase 1)

**Backend: app `clientreview`**
- **Tables:** `client_review` (one per document per review), `client_review_round` (each version sent, with the client's
  copy file and its editor key), `client_review_message` and `client_review_file` (the thread and its attachments).
- **`reviewcopy.review_copy`:** makes the client's copy. A `.docx` has its comments and comment references removed and
  its tracked changes accepted; other types are sent as they are (view / download only).
- **`service.py`:** the rules (start, next round, cancel, messages, client reply, reminders) and the editor config for
  the client's copy:
  - review mode (`edit: false, review: true`, comments on);
  - user `client-<login id>`;
  - signed links `/api/editor/clientcopy/file|callback/<round>` (salt `clientreview.copy`).
  - Saves (status 2 / 6) overwrite the round's copy while the round is SENT, and are ignored once it is sent back.
  - *Send back* force-saves the open editor first.
- **Firm API** (practice scope via `documents.editor._document`; DOCUMENT_VIEW to read, DOCUMENT_EDIT to act):
  - `GET|POST documents/<id>/client-reviews`;
  - `POST client-reviews/<id>/messages | rounds | cancel`;
  - `GET client-reviews/<id>/rounds/<n>/file`, `GET client-review-files/<id>`.
- **Compare:** `POST documents/<id>/editor/compare` also takes `{reviewRound}` / `{reviewFile}`.
- **Client API** (`/api/client/reviews…`, behind the portal gate; a client sees only their own, non-cancelled reviews):
  - list, detail, `editor`, `file` (download), `files/<id>`;
  - `reply` (multipart: `action` = changes / approve / message, `note`, `files`).
- **Notifications:**
  - types `CLIENT_REVIEW_REQUEST` / `_MESSAGE` / `_REMINDER` (email to the client, through `notify_client`) and
    `CLIENT_REVIEW_REPLIED` / `_APPROVED` (bell + email to the advocates who sent it);
  - the CHECK constraint is widened in `clientreview/0002_notification_types`;
  - the scheduler's scan runs `manage.py remind_client_reviews`.
- **Audit:** client replies and downloads go to the audit log (`CLIENT_REVIEW_CHANGES / _APPROVED / _MESSAGE`).
- **Documents list:** carries `clientReview` (latest: status, waiting on).

**Frontend**
- **Firm:**
  - the document menu's **Send to client for review… / Client review…**, and the Documents list's *Client* column
    (*With client / Client replied / Client approved*);
  - `components/ClientReviewDrawer.tsx`: send form, rounds, thread, files, *Open client's changes*, *Compare in
    editor*, *Send version N*, reply, cancel.
- **Editor page:** `?compareRound=` / `?compareFile=` starts the compare once the document is open
  (`OnlyOfficeEditor` `onReady`).
- **Portal:**
  - **For review** (`client/ClientReviews.tsx`): the list and the review page (the editor in review mode, Download,
    note and files, *Send back with my changes*, *Approve this version*, the conversation).
