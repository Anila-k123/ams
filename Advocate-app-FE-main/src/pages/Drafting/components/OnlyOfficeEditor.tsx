import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { draftingApi, type OnlyOfficeSetup } from '../api/drafting'

// ONLYOFFICE Docs as the draft editor (docs/ONLYOFFICE_PLAN.md). The page gets a signed editor config
// from AMS; ONLYOFFICE loads the Word file and saves it back to AMS by itself (save callback). This
// component mounts the editor, covers it with PactPro's loading screen until the document is ready,
// and links it to the page through the Automation API (connector, Developer Edition): find / fill
// placeholders in the open document, jump to a clause, and report the clause under the cursor.
// Without the connector (Community edition) those calls report "not available" and the page falls
// back to changing the file on the server.

type Connector = {
  executeMethod: (name: string, args: unknown[] | null, cb?: (r: unknown) => void) => void
  attachEvent: (name: string, cb: (data: unknown) => void) => void
  // Runs `func` inside the editor with its document builder API (`Api`); the function is sent as text,
  // so it may not use anything from this file.
  callCommand: (func: () => unknown, cb?: (r: unknown) => void, isNoCalc?: boolean) => void
  disconnect?: () => void
}
type DocEditor = {
  destroyEditor: () => void
  createConnector?: () => Connector
  // The editor's own version history and compare (Docs API, every edition).
  refreshHistory: (data: unknown) => void
  setHistoryData: (data: unknown) => void
  setRequestedDocument: (data: unknown) => void
  setUsers: (data: unknown) => void
}
type DocsAPIType = { DocEditor: new (id: string, config: Record<string, unknown>) => DocEditor }

declare global {
  interface Window { DocsAPI?: DocsAPIType }
}

const CLAUSE_TAG = 'pactpro:block:'
const loading: Record<string, Promise<void>> = {}

/** Load the editor's script once. Called early (as soon as the server URL is known) so the editor
 *  opens faster. */
export function loadOnlyOfficeApi(base: string): Promise<void> {
  const src = `${base}/web-apps/apps/api/documents/api.js`
  if (window.DocsAPI) return Promise.resolve()
  loading[src] ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => { delete loading[src]; reject(new Error('editor script')) }
    document.head.appendChild(s)
  })
  return loading[src]
}

/** What the page can ask the open editor to do. Each returns false when the connector isn't there. */
export type OfficeEditorHandle = {
  live: () => boolean
  findPlaceholder: (label: string) => Promise<boolean>
  fillPlaceholder: (label: string, value: string) => Promise<boolean>
  gotoClause: (blockId: number) => Promise<boolean>
  replaceText: (find: string, replace: string) => Promise<boolean>
  /** Turn track changes on / off; resolves to whether it was on before (null without a connector). */
  setTracking: (on: boolean) => Promise<boolean | null>
  /** Answer the editor's Compare request with the chosen document (signed by PactPro). */
  compareWith: (data: Record<string, unknown>) => void
}

/** Where the editor's History / Restore / @mention requests go: a draft (default) or an AMS document. */
export type EditorBackend = {
  history: () => Promise<unknown>
  historyData: (version: number) => Promise<unknown>
  restore: (version: number) => Promise<{ config: Record<string, unknown> }>
  users?: () => Promise<{ id: string; name: string; email: string }[]>
  notify?: (emails: string[], message: string) => Promise<unknown>
}

export const draftBackend = (sessionId: number): EditorBackend => ({
  history: () => draftingApi.getOfficeHistory(sessionId),
  historyData: v => draftingApi.getOfficeHistoryData(sessionId, v),
  restore: v => draftingApi.restoreOffice(sessionId, v),
  users: () => draftingApi.getOfficeUsers(sessionId),
  notify: (emails, message) => draftingApi.notifyOfficeMention(sessionId, emails, message),
})

type Props = {
  setup: OnlyOfficeSetup
  sessionId?: number                            // a draft (its backend), unless `backend` is given
  backend?: EditorBackend
  canRestore?: boolean                          // the History panel offers Restore (who decides)
  onConfig?: (config: Record<string, unknown>) => void  // a new version is current (restored): reopen it
  onCompareRequest?: () => void                 // Compare > Document from storage: let the user pick
  onModified?: (modified: boolean) => void
  onSaved?: () => void                       // the editor saved (unsaved -> saved)
  onClause?: (blockId: number | null) => void // the clause under the cursor
  onReady?: () => void                       // the document is open in the editor (e.g. to start a compare)
}

let counter = 0

const OnlyOfficeEditor = forwardRef<OfficeEditorHandle, Props>(function OnlyOfficeEditor(
  { setup, sessionId, backend, canRestore, onConfig, onCompareRequest, onModified, onSaved, onClause, onReady }, ref) {
  const api = useRef<EditorBackend | null>(null)
  api.current = backend ?? (sessionId != null ? draftBackend(sessionId) : null)
  const [id] = useState(() => `oo-editor-${++counter}`)
  // ONLYOFFICE replaces the element it is given with its own frame. So React only owns this empty host,
  // and each editor gets a fresh inner element made here: re-creating the editor (closing the History
  // panel, a new version) never asks React to remove a node ONLYOFFICE already took away.
  const hostRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const connector = useRef<Connector | null>(null)
  // The latest callbacks without re-creating the editor when the parent re-renders.
  const cbs = useRef({ onModified, onSaved, onClause, onConfig, onCompareRequest, onReady })
  useEffect(() => { cbs.current = { onModified, onSaved, onClause, onConfig, onCompareRequest, onReady } },
    [onModified, onSaved, onClause, onConfig, onCompareRequest, onReady])
  const editorRef = useRef<DocEditor | null>(null)
  // Closing the History panel reopens the current document (a new editor for the same key).
  const [reopen, setReopen] = useState(0)
  const key = (setup.config.document as { key?: string } | undefined)?.key

  const call = (name: string, args: unknown[] | null) => new Promise<unknown>((resolve, reject) => {
    const c = connector.current
    if (!c) { reject(new Error('no connector')); return }
    try { c.executeMethod(name, args, resolve) } catch (e) { reject(e) }
  })

  useImperativeHandle(ref, () => ({
    live: () => !!connector.current,
    findPlaceholder: async label => {
      if (!connector.current) return false
      try { await call('SearchNext', [{ searchString: `[[${label}]]`, matchCase: true }, true]); return true }
      catch { return false }
    },
    fillPlaceholder: async (label, value) => {
      if (!connector.current) return false
      try {
        await call('SearchAndReplace', [{ searchString: `[[${label}]]`, replaceString: value, matchCase: true }])
        return true
      } catch { return false }
    },
    replaceText: async (find, replace) => {
      if (!connector.current) return false
      try { await call('SearchAndReplace', [{ searchString: find, replaceString: replace, matchCase: true }]); return true }
      catch { return false }
    },
    setTracking: async on => {
      const c = connector.current
      if (!c) return null
      const run = (func: () => unknown) => new Promise<unknown>(resolve => c.callCommand(func, resolve))
      try {
        const was = await run(() => (globalThis as any).Api.GetDocument().IsTrackRevisions())
        if (on) await run(() => { (globalThis as any).Api.GetDocument().SetTrackRevisions(true) })
        else await run(() => { (globalThis as any).Api.GetDocument().SetTrackRevisions(false) })
        return !!was
      } catch { return null }
    },
    compareWith: data => { editorRef.current?.setRequestedDocument(data) },
    gotoClause: async blockId => {
      if (!connector.current) return false
      try {
        const all = await call('GetAllContentControls', null) as { Tag?: string; InternalId?: string }[] | undefined
        const cc = (all || []).find(c => c.Tag === `${CLAUSE_TAG}${blockId}`)
        if (!cc?.InternalId) return false
        await call('MoveCursorToContentControl', [cc.InternalId, true])
        return true
      } catch { return false }
    },
  }))

  useEffect(() => {
    let editor: DocEditor | null = null
    let cancelled = false
    const host = hostRef.current
    let modified = false
    setError('')
    setReady(false)
    loadOnlyOfficeApi(setup.url).then(() => {
      if (cancelled || !window.DocsAPI) return
      // History, restore and compare: the editor asks, PactPro answers from its stored versions.
      const history = {
        onRequestHistory: () => {
          api.current?.history().then(h => editor?.refreshHistory(h))
            .catch(() => editor?.refreshHistory({ error: 'The version history could not be loaded.' }))
        },
        onRequestHistoryData: (e: { data: number }) => {
          api.current?.historyData(e.data).then(d => editor?.setHistoryData(d))
            .catch(() => editor?.setHistoryData({ error: 'This version could not be loaded.', version: e.data }))
        },
        onRequestHistoryClose: () => setReopen(n => n + 1),
        onRequestSelectDocument: (e: { data?: { c?: string } }) => {
          if (e.data?.c === 'compare') cbs.current.onCompareRequest?.()
        },
        // "@" in a comment: the people who can open this draft; mentioning one notifies them in PactPro.
        onRequestUsers: (e: { data?: { c?: string } }) => {
          const c = e.data?.c || 'mention'
          if (!api.current?.users) { editor?.setUsers({ c, users: [] }); return }
          api.current.users().then(users => editor?.setUsers({ c, users }))
            .catch(() => editor?.setUsers({ c, users: [] }))
        },
        onRequestSendNotify: (e: { data?: { emails?: string[]; message?: string } }) => {
          void api.current?.notify?.(e.data?.emails || [], e.data?.message || '')
        },
        // Only offered (Restore button) to whoever decides on the draft.
        ...(canRestore ? {
          onRequestRestore: (e: { data: { version: number } }) => {
            api.current?.restore(e.data.version).then(r => cbs.current.onConfig?.(r.config))
              .catch(() => editor?.refreshHistory({ error: 'The version could not be restored.' }))
          },
        } : {}),
      }
      if (!host) return
      host.replaceChildren()
      const mount = document.createElement('div')
      mount.id = `${id}-${Date.now()}`
      host.appendChild(mount)
      editor = new window.DocsAPI.DocEditor(mount.id, {
        ...setup.config,
        width: '100%',
        height: '100%',
        events: {
          ...history,
          onDocumentReady: () => {
            setReady(true)
            cbs.current.onReady?.()
            try {
              const c = editor?.createConnector?.() ?? null
              connector.current = c
              const clauseOf = (data: unknown) => {
                const tag = (data as { Tag?: string } | null)?.Tag || ''
                return tag.startsWith(CLAUSE_TAG) ? Number(tag.slice(CLAUSE_TAG.length)) || null : null
              }
              c?.attachEvent('onFocusContentControl', d => cbs.current.onClause?.(clauseOf(d)))
              c?.attachEvent('onBlurContentControl', () => cbs.current.onClause?.(null))
            } catch {
              connector.current = null                // Community edition: no Automation API
            }
          },
          onDocumentStateChange: (e: { data: boolean }) => {
            cbs.current.onModified?.(!!e.data)
            if (modified && !e.data) cbs.current.onSaved?.()
            modified = !!e.data
          },
          onError: (e: { data?: { errorDescription?: string } }) => {
            setReady(true)
            setError(e.data?.errorDescription || 'The editor reported an error.')
          },
        },
      })
      editorRef.current = editor
    }).catch(() => {
      if (!cancelled) { setReady(true); setError(`The document editor could not be reached at ${setup.url}.`) }
    })
    return () => {
      cancelled = true
      try { connector.current?.disconnect?.() } catch { /* gone */ }
      connector.current = null
      editorRef.current = null
      try { editor?.destroyEditor() } catch { /* already gone */ }
      host?.replaceChildren()
    }
    // A new document key (a saved or restored version) means a new editor; the rest of the config
    // is signed together with the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-create only for a new document or server
  }, [key, setup.url, id, reopen])

  return (
    <div className="dr-oo">
      {error && <p className="dr-oo-error" role="alert">{error}</p>}
      {!ready && (
        <div className="dr-oo-loading" role="status" aria-live="polite">
          <div className="dr-oo-sheet" aria-hidden="true">
            <span className="dr-oo-line w60" /><span className="dr-oo-line w40" />
            <span className="dr-oo-line" /><span className="dr-oo-line" /><span className="dr-oo-line w80" />
            <span className="dr-oo-line" /><span className="dr-oo-line w70" />
          </div>
          <p className="faint small">Opening the document…</p>
        </div>
      )}
      <div ref={hostRef} className="dr-oo-host" />
    </div>
  )
})

export default OnlyOfficeEditor

/**
 * Turns the page's Save button to "Saved" when a save made in the editor itself (its Save icon, Ctrl+S,
 * File > Save, or closing) has been stored: the editor doesn't tell the page, so while there are unsaved
 * edits the page polls the stored version and clears `dirty` once a newer one lands.
 */
export function useStoredVersionWatch(fetchVersion: () => Promise<number>, dirty: boolean, onStored: () => void) {
  const fetchRef = useRef(fetchVersion)
  const storedRef = useRef(onStored)
  useEffect(() => { fetchRef.current = fetchVersion; storedRef.current = onStored }, [fetchVersion, onStored])

  useEffect(() => {
    if (!dirty) return
    // Edits only start from "Saved", when no save is on its way: the version stored right now is the base.
    let base: number | null = null
    let gone = false
    fetchRef.current().then(v => { if (!gone) base = v }).catch(() => { /* set on the next tick */ })
    const timer = window.setInterval(() => {
      fetchRef.current().then(v => {
        if (gone) return
        if (base == null) base = v
        else if (v > base) storedRef.current()
      }).catch(() => { /* try again on the next tick */ })
    }, 2500)
    return () => { gone = true; window.clearInterval(timer) }
  }, [dirty])
}
