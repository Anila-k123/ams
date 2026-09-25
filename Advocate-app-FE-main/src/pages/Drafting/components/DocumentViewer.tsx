import { authHeaders } from '../../../api/client'
import { useEffect, useState } from 'react'
import { Dialog } from 'primereact/dialog'
import { ProgressSpinner } from 'primereact/progressspinner'
import { Message } from 'primereact/message'
import * as mammoth from 'mammoth'

/** Props for the in-app document preview dialog. */
interface Props {
  visible: boolean // whether the dialog is open
  onHide: () => void // called when the user dismisses the dialog
  fileUrl?: string | null // URL of the document to render (PDF or DOCX)
  name?: string // display name used as the dialog header / iframe title
}

/**
 * Renders an uploaded document inside the app (no download, no new tab).
 * The file is fetched as bytes (with the AMS token; drafting/files.py) and rendered locally:
 *  - PDF  -> blob URL in an <iframe> (blob URLs bypass the server's
 *            X-Frame-Options: DENY, which would block a direct iframe src)
 *  - DOCX -> converted to HTML with mammoth.js
 */
export default function DocumentViewer({ visible, onHide, fileUrl, name }: Props) {
  const [html, setHtml] = useState('')
  const [pdfUrl, setPdfUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Detect file type from the URL extension (tolerating a trailing query string).
  const isPdf = !!fileUrl && /\.pdf(\?|$)/i.test(fileUrl)
  const isDocx = !!fileUrl && /\.docx?(\?|$)/i.test(fileUrl)

  // Fetch and render the document whenever the dialog opens or the target file
  // changes. Re-runs on visible/fileUrl/isPdf/isDocx so a new file reloads.
  useEffect(() => {
    if (!visible || !fileUrl || (!isPdf && !isDocx)) return
    // `cancelled` guards against setting state after unmount or a superseded run;
    // `objectUrl` is tracked so cleanup can revoke the blob URL it created.
    let cancelled = false
    let objectUrl = ''
    setLoading(true); setError(''); setHtml(''); setPdfUrl('')

    fetch(fileUrl, { headers: authHeaders() })
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer() })
      .then(async buf => {
        if (cancelled) return
        if (isDocx) {
          // DOCX: convert the bytes to HTML for inline rendering.
          const res = await mammoth.convertToHtml({ arrayBuffer: buf })
          if (!cancelled) setHtml(res.value || '<p>(empty document)</p>')
        } else {
          // PDF: wrap the bytes in a same-origin blob URL for the <iframe>.
          objectUrl = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }))
          if (!cancelled) setPdfUrl(objectUrl)
        }
      })
      .catch(() => { if (!cancelled) setError('Could not load this document.') })
      .finally(() => { if (!cancelled) setLoading(false) })

    // Cleanup: mark this run stale and free the blob URL to avoid a memory leak.
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [visible, fileUrl, isPdf, isDocx])

  return (
    <Dialog
      header={name ?? 'Document'}
      visible={visible}
      onHide={onHide}
      maximizable
      style={{ width: '80vw', maxWidth: 920 }}
      contentStyle={{ paddingTop: '1rem' }}
    >
      {!fileUrl && <Message severity="warn" className="w-full" text="No file available for this item." />}

      {fileUrl && (isPdf || isDocx) && (
        <div style={{ minHeight: '40vh' }}>
          {loading && (
            <div className="flex flex-column align-items-center justify-content-center p-6 gap-3">
              <ProgressSpinner style={{ width: 44, height: 44 }} />
              <span className="text-color-secondary">Loading document…</span>
            </div>
          )}
          {error && <Message severity="error" className="w-full" text={error} />}
          {!loading && !error && isPdf && pdfUrl && (
            <iframe
              title={name ?? 'document'}
              src={pdfUrl}
              style={{ width: '100%', height: '72vh', border: 'none', borderRadius: 8 }}
            />
          )}
          {!loading && !error && isDocx && (
            <div className="pp-docx-preview" dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>
      )}

      {fileUrl && !isPdf && !isDocx && (
        <Message severity="warn" className="w-full" text="In-app preview isn't supported for this file type." />
      )}
    </Dialog>
  )
}
