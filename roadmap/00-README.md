# InstaDraft ↔ AMS Integration Roadmap

The two apps stay separate, with separate databases. They connect over REST with single sign-on.
A lawyer clicks a button in AMS, lands in InstaDraft already logged in, drafts, and the
finished .docx is saved back into AMS (and linked to the task, if it came from one).

## How to use this folder
Say **"implement roadmap/0X-....md"**. Each file is self-contained: it says which codebase
to work in, what to build, and how to check it is done. Do them in order.

| # | File | Codebase | Depends on |
|---|------|----------|------------|
| 01 | `01-ams-shared-secret-and-service-auth.md` | AMS backend | — |
| 02 | `02-ams-launch-endpoint-and-buttons.md` | AMS backend + frontend | 01 |
| 03 | `03-ams-integration-api.md` | AMS backend | 01, 02 |
| 04 | `04-instadraft-sso-login.md` | InstaDraft | 01, 02 |
| 05 | `05-instadraft-ams-ids-and-prefill.md` | InstaDraft | 03, 04 |
| 06 | `06-instadraft-docx-export.md` | InstaDraft | — |
| 07 | `07-instadraft-send-to-ams.md` | InstaDraft | 03, 05, 06 |
| 08 | `08-end-to-end-testing.md` | Both | all |

Files 01–03 are built in this repo (`C:\Users\Sybrant\ams`). Files 04–07 must be run inside
the InstaDraft repo, so copy this `roadmap/` folder there (or open it from there).

## Decisions already made (do not re-open)
- Codebases stay separate. Databases stay separate. No shared tables.
- Cross-system links are stored as IDs only: `ams_advocate_id`, `ams_case_id`, `ams_client_id`,
  `ams_task_id`. Never match on `case_number` (it is only unique per advocate).
- Two entry points, one SSO mechanism:
  - **Direct button** (AMS sidebar) opens InstaDraft with no case.
  - **Task button** (on a task) opens InstaDraft with `caseId` + `taskId`.
- AMS's main `SECRET_KEY` is **never** shared. A separate secret, `INSTADRAFT_SHARED_SECRET`, is used.

## The shared token contract (both apps must match exactly)
All cross-app tokens are JWT, HS256, signed with `INSTADRAFT_SHARED_SECRET`.

| Token | Issued by | `aud` claim | TTL | Used for |
|-------|-----------|-------------|-----|----------|
| Launch token | AMS | `instadraft-sso` | 2 min | Goes in the URL; InstaDraft exchanges it for its own login |
| Service token | InstaDraft backend | `ams-api` | 5 min | InstaDraft backend → AMS integration API calls |

Claims on both: `advocateId` (int), `email` (str), `aud`, `iat`, `exp`, `jti` (random uuid).
The launch token may also carry `caseId` and `taskId` (int, or absent).

InstaDraft mints a fresh service token for every call, so an AMS token can never expire
halfway through drafting.

## Build order
1. 01 → 02 → 04 gives a working **direct button** (log in once, no case).
2. 03 → 05 adds case context and prefill.
3. 06 → 07 adds real .docx and saving back to AMS / the task.
4. 08 verifies both journeys.
