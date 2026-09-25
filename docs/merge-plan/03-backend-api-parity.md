# Phase 3 — Backend API parity

## Goal

Port every drafting ViewSet/serializer/action into AMS, wire `Project`'s link to a real `Case`, and register drafting's RBAC permission codes in AMS's custom, table-driven permission system.

## Background

Builds on Phase 02 (auth foundation must be done first). AMS's RBAC is not a Django/DRF library — it's custom, table-driven: `core.models.Role`/`Permission`/`AdvocateRole`/`RolePermission` (all `managed=False`, `core/models.py:194-236`), resolved via `Advocate.permission_codes()`/`role_names()` (`core/models.py:79-93`) and enforced per-view with `core.permissions.RequirePermission('CODE')`. This is a different mechanism from the discarded first pass's assumption (AMS's *other*, wrong-repo copy used a `VIEW_PERMS` dict) — use the real one.

## What happens

1. **Port ViewSets/serializers unchanged in behavior**: `ClientViewSet`, `ProjectViewSet`, `MemberViewSet`, `TemplateViewSet`, `SampleViewSet`, `DraftSessionViewSet` (+ all its actions: `status`, `save-blocks`, `edit`, `refine`, `consistency-check`, `edit/<id>/accept|reject`, `regenerate`, `update-legal-codes`, `analyse-risks`, `risks`, `risk-report`, `risks/<id>/status`), `PlaybookViewSet`, `PlaybookClauseViewSet`.

2. **Mount `drafting/urls.py`** in AMS's root `advocate_backend/urls.py` (which mounts every app flat under `api/` with no extra prefix, per the confirmed convention — e.g. `path('api/', include('cases.urls'))`) — add `path('api/', include('drafting.urls'))` alongside the rest, giving e.g. `api/draft-sessions/`, `api/templates/`, etc.

3. **`drafting.Project` domain change**: add `case_id = models.BigIntegerField(null=True, blank=True)` (plain integer, per Phase 02's convention — **not** a real FK to `core.models.Case`). Drop the discarded plan's `ams_case_id` mirror-column framing entirely — there's no separate "AMS" system to mirror an ID from anymore, `case_id` *is* the real case id in the same database. Look up the `Case` row at read/write time via `Case.objects.filter(id=project.case_id, advocate_id=request.user.id)` (scoping to the caller's own cases/practice, matching how `integrations/views.py`'s `InstaDraftCaseContextView` already scopes — reuse that scoping helper if `core/practice.py` exposes one, rather than reimplementing).

4. **Register drafting permission codes**: insert new rows into `core.models.Permission` (e.g. `DRAFT_VIEW`, `DRAFT_CREATE`, `DRAFT_MANAGE`, `DRAFT_EXPORT`) via a one-off data script or management command — **not a schema migration**, since `Permission` is `managed=False` and the table already exists; this is a plain `Permission.objects.get_or_create(...)` insert. Wire them into `RequirePermission(...)` on each drafting viewset (read = `DRAFT_VIEW`, create/update = `DRAFT_CREATE`/`DRAFT_MANAGE`, the export action = `DRAFT_EXPORT`). Then grant them to whichever `Role`s should have drafting access — **confirm with the manager/lead which roles** (this mirrors the open RBAC question from the discarded plan, now grounded in AMS's real permission model instead of a hypothetical one) before granting broadly.

5. **Celery stays in eager mode** (`CELERY_TASK_ALWAYS_EAGER = True` from Phase 01) — real async is Phase 05's job.

## Files touched

- `Advocate-app-BE-Django/drafting/{views,serializers,urls}.py`
- `Advocate-app-BE-Django/drafting/models.py` (`Project.case_id`)
- `Advocate-app-BE-Django/drafting/migrations/000N_project_case_id.py`
- `Advocate-app-BE-Django/advocate_backend/urls.py`
- A data script/management command seeding `Permission`/`RolePermission` rows for drafting

## Risk/effort

Medium, mostly mechanical port. The RBAC registration is the one genuinely new decision (which roles get drafting access) — don't default it silently; get an explicit answer before this phase is considered done, same as flagged in Phase 02.

## Done when

- All drafting endpoints respond correctly against the merged backend, authenticated via a real AMS JWT (smoke-test with a demo-seeded session).
- `Project.objects.filter(case_id=some_real_case.id)` round-trips correctly; no DB-level FK exists from `drafting.project` into `cases`.
- A user with the granted `Role` can reach drafting endpoints; a user without it gets a real 403 from `RequirePermission`, not a silent pass-through (this is the opposite failure mode from the discarded plan's fail-open concern — verify explicitly that AMS's `RequirePermission` denies by default for an unlisted role, since that changes what "done" means here).
- Existing InstaDraft backend test suites (`drafting/export/tests.py` and equivalents) pass against the merged settings and auth.

## Next phase

`04-frontend-unification.md`
