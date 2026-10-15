import { sanitizeHtml } from '../../../utils/sanitizeHtml'
import { authHeaders } from '../../../api/client'
import { useEffect, useState } from 'react'
import { Modal } from '../../../ui/overlays'
import { Spinner } from '../../../ui/kit'
import Icon from '../../../ui/Icon'
import * as mammoth from 'mammoth'

/** Props for the in-app document preview dialog. */
interface Props {
  visible: boolean // whether the dialog is open
  onHide: () => void // called when the user dismisses the dialog
  fileUrl?: string | null // URL of the document to render (PDF or DOCX)
  // The file as it prints (drafting/files.py preview: a Word file made into a PDF on the server).
  // Shown first, so a template's letterhead, logo, fonts and layout are seen as they are.
  previewUrl?: string | null
  name?: string // display name used as the dialog header / iframe title
}

/**
 * Renders an uploaded document inside the app (no download, no new tab).
 * The file is fetched as bytes (with the AMS token; drafting/files.py) and rendered locally:
 *  - the print view (previewUrl) when there is one: a PDF in an <iframe>, exactly as it prints;
 *  - else a PDF -> blob URL in an <iframe> (blob URLs bypass the server's
 *            X-Frame-Options: DENY, which would block a direct iframe src);
 *  - else a DOCX -> converted to HTML with mammoth.js (text only: no header, logo or layout).
 * "Download original" saves the uploaded file itself.
 */
export default function DocumentViewer({ visible, onHide, fileUrl, previewUrl, name }: Props) {
  const [html, setHtml] = useState('')
  const [pdfUrl, setPdfUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [textOnly, setTextOnly] = useState(false) // the print view wasn't available: text view shown

  // Detect file type from the URL extension (tolerating a trailing query string).
  const isPdf = !!fileUrl && /\.pdf(\?|$)/i.test(fileUrl)
  const isDocx = !!fileUrl && /\.docx?(\?|$)/i.test(fileUrl)

  // Fetch and render the document whenever the dialog opens or the target file changes.
  useEffect(() => {
    if (!visible || !fileUrl || (!isPdf && !isDocx)) return
    // `cancelled` guards against setting state after unmount or a superseded run;
    // `objectUrl` is tracked so cleanup can revoke the blob URL it created.
    let cancelled = false
    let objectUrl = ''
    setLoading(true); setError(''); setHtml(''); setPdfUrl(''); setTextOnly(false)

    const getBytes = (url: string) => fetch(url, { headers: authHeaders() })
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer() })
    const showPdf = (buf: ArrayBuffer) => {
      objectUrl = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }))
      if (!cancelled) setPdfUrl(objectUrl)
    }
    const showText = async () => {
      const res = await mammoth.convertToHtml({ arrayBuffer: await getBytes(fileUrl) })
      if (!cancelled) { setHtml(res.value || '<p>(empty document)</p>'); setTextOnly(true) }
    }

    const run = async () => {
      if (previewUrl) {
        try { showPdf(await getBytes(previewUrl)); return } catch { /* no print view: fall back below */ }
      }
      if (isPdf) showPdf(await getBytes(fileUrl))
      else await showText()
    }
    run()
      .catch(() => { if (!cancelled) setError('Could not load this document.') })
      .finally(() => { if (!cancelled) setLoading(false) })

    // Cleanup: mark this run stale and free the blob URL to avoid a memory leak.
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [visible, fileUrl, previewUrl, isPdf, isDocx])

  // Save the uploaded file itself (the Word file, to open in Word).
  const downloadOriginal = async () => {
    if (!fileUrl) return
    try {
      const r = await fetch(fileUrl, { headers: authHeaders() })
      if (!r.ok) throw new Error(String(r.status))
      const url = URL.createObjectURL(await r.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = decodeURIComponent(new URL(fileUrl, window.location.href).searchParams.get('name') || name || 'document')
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      setError('Could not download the file.')
    }
  }

  return (
    <Modal title={name ?? 'Document'} open={visible} onClose={onHide} size="xwide"
      footer={fileUrl ? <>
        {textOnly && <span className="faint small grow">Text view: the print view (letterhead, layout) isn't available on this server.</span>}
        <button type="button" className="btn" onClick={downloadOriginal}><Icon name="download" size="sm" />Download original</button>
      </> : undefined}>
      {!fileUrl && <div className="callout warn"><Icon name="warn" size="sm" /><div>No file available for this item.</div></div>}

      {fileUrl && (isPdf || isDocx) && (
        <div style={{ minHeight: '40vh' }}>
          {loading && (
            <div className="row" style={{ justifyContent: 'center', padding: 48 }}>
              <Spinner label="Loading document" />
            </div>
          )}
          {error && <div className="callout bad"><Icon name="warn" size="sm" /><div>{error}</div></div>}
          {!loading && !error && pdfUrl && (
            <iframe
              title={name ?? 'document'}
              src={pdfUrl}
              style={{ width: '100%', height: '72vh', border: 'none', borderRadius: 'var(--r-md)' }}
            />
          )}
          {!loading && !error && !pdfUrl && html && (
            <div className="paper-sheet pp-docx-preview" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
          )}
        </div>
      )}

      {fileUrl && !isPdf && !isDocx && (
        <div className="callout warn"><Icon name="warn" size="sm" /><div>In-app preview isn't supported for this file type.</div></div>
      )}
    </Modal>
  )
}
