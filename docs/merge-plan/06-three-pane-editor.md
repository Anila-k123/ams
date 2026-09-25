# Phase 6 — The 3-pane editor

## Goal

Port `/draft/:sessionId` — InstaDraft's standalone, full-screen 3-pane TipTap/ProseMirror drafting editor — into the merged app.

## Background

Unlike the discarded first pass of this plan (which assumed a PrimeReact→AntD rewrite of the editor chrome), the rechecked UI decision keeps PrimeReact. That means **this phase is a near-direct port, not a rewrite** — both the ProseMirror editor core (`frontend/src/editor/`: citation-chip nodes, live `[[Label]]` placeholders, drag-resize state) and its surrounding chrome (PrimeReact `Splitter`, `Toolbar`, `TabView`, `OverlayPanel`) carry over largely unchanged. The main work is re-pointing API calls at the unified client and auth context from Phase 04, not rebuilding UI.

## What happens

1. **Port unchanged**: `frontend/src/editor/` in full — ProseMirror schema, citation-chip node view, placeholder node view (`focusPlaceholder`/`blurPlaceholder`), `patchClause`, `scrollToClause`.

2. **Port the chrome as-is** (PrimeReact stays PrimeReact): `DraftPage.tsx`'s 3-pane `Splitter` layout, `EditorToolbar.tsx`, the right-pane `TabView` (Chat/Review, both mounted), citation `OverlayPanel` popovers, the download menu (Word/.doc via Blob, PDF via `window.print()` — unchanged in this phase; real server-side export lands in Phase 07), the re-draft confirm flow, status polling, `DraftChat.tsx`, and the refine-presets menu. Re-point every API call inside these components at the Phase 04 unified axios client, and read the current user/permissions from the new shared `AuthContext` instead of InstaDraft's retired one.

3. **Close the RBAC gap for this specific surface**: confirm the `DRAFT_EXPORT`/`DRAFT_MANAGE` permission codes from Phase 03 are actually checked on the editor's write actions (`save-blocks`, `edit`, `refine`, `regenerate`) — this is the point where an incorrectly-scoped permission would be most visible (a user editing a draft they shouldn't have access to).

## Files touched

- `Advocate-app-FE-main/src/editor/` (ported, largely unchanged)
- `Advocate-app-FE-main/src/pages/Drafting/DraftPage.tsx` (ported, API/auth re-pointed)
- `Advocate-app-FE-main/src/components/Drafting/{EditorToolbar,DraftChat,...}.tsx` (ported, API/auth re-pointed)

## Risk/effort

Lower than the discarded plan's estimate, precisely because the UI-library decision didn't flip. The remaining risk is entirely in the RBAC check (step 3) and in making sure every API call site was actually re-pointed, not missed.

## Done when

- The full editor works end-to-end: load a session, edit a clause, hover a citation, use the chat-edit loop, use refine, download Word/.doc and PDF, re-draft.
- Behavior matches InstaDraft's original exactly (side-by-side comparison against the standalone InstaDraft app if still runnable) — this phase should produce no visible change to the editor itself, only where it lives and what it authenticates against.
- RBAC: a user without `DRAFT_MANAGE`/`DRAFT_EXPORT` is correctly refused on write/export actions, verified by testing as a role that shouldn't have access.

## Next phase

`07-draft-to-document-integration.md`
