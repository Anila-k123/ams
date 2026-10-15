import { sanitizeHtml } from '../../../utils/sanitizeHtml'
import { useEffect, useState } from 'react'
import { Spinner } from '../../../ui/kit'
import Icon from '../../../ui/Icon'
import * as mammoth from 'mammoth'
import { apiUrl, authHeaders } from '../../../api/client'

/** Inline document renderer (no dialog), used beside the draft for reference documents, citations
 *  and case documents:
 *  - the print view (`previewUrl`: a Word file made into a PDF on the server, drafting/files.py) when
 *    there is one, so a Word reference shows its letterhead and layout;
 *  - else a PDF via a blob-URL iframe, a DOCX via mammoth -> HTML (text only), images as they are.
 *  AMS links (/api/…) are fetched with the login token: drafting uploads are served only behind the
 *  login. `amsDocId` = a case document; `fileName` then gives its type. */
export default function InlineDocViewer({ fileUrl, previewUrl, name, amsDocId, fileName }:
  { fileUrl?: string | null; previewUrl?: string | null; name?: string; amsDocId?: number; fileName?: string }) {
  if (amsDocId) {
    fileUrl = apiUrl(`/api/documents/preview/${amsDocId}`)
  }
  const typeOf = amsDocId ? (fileName || name || '') : (fileUrl || '')
  const isImage = /\.(png|jpe?g|gif|webp)(\?|$)/i.test(typeOf)
  const [imgUrl, setImgUrl] = useState('')
  const [html, setHtml] = useState('')
  const [pdfUrl, setPdfUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const isPdf = !!fileUrl && /\.pdf(\?|$)/i.test(typeOf)
  const isDocx = !!fileUrl && /\.docx?(\?|$)/i.test(typeOf)

  useEffect(() => {
    if (!fileUrl || (!isPdf && !isDocx && !isImage)) return
    let cancelled = false
    let objectUrl = ''
    setLoading(true); setError(''); setHtml(''); setPdfUrl(''); setImgUrl('')
    // Our own API needs the login token; anything else (an external link) is fetched as it is.
    const getBytes = (url: string) => fetch(url, url.includes('/api/') ? { headers: authHeaders() } : undefined)
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer() })
    const showPdf = (buf: ArrayBuffer) => {
      objectUrl = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }))
      if (!cancelled) setPdfUrl(objectUrl)
    }
    const run = async () => {
      if (previewUrl && !isImage) {
        try { showPdf(await getBytes(previewUrl)); return } catch { /* no print view: the file itself below */ }
      }
      const buf = await getBytes(fileUrl)
      if (cancelled) return
      if (isDocx) {
        const res = await mammoth.convertToHtml({ arrayBuffer: buf })
        if (!cancelled) setHtml(res.value || '<p>(empty document)</p>')
      } else if (isImage) {
        objectUrl = URL.createObjectURL(new Blob([buf]))
        if (!cancelled) setImgUrl(objectUrl)
      } else {
        showPdf(buf)
      }
    }
    run()
      .catch(() => { if (!cancelled) setError('Could not load this document.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [fileUrl, previewUrl, isPdf, isDocx, isImage, amsDocId])

  if (!fileUrl) return <div className="callout warn"><Icon name="warn" size="sm" /><div>No file available.</div></div>
  if (loading) return <div className="row" style={{ justifyContent: 'center', padding: 32 }}><Spinner label="Loading document" /></div>
  if (error) return <div className="callout bad"><Icon name="warn" size="sm" /><div>{error}</div></div>
  if (pdfUrl) return <iframe title={name ?? 'document'} src={pdfUrl} style={{ width: '100%', height: '100%', border: 'none' }} />
  if (isImage && imgUrl) return <img src={imgUrl} alt={name ?? 'document'} style={{ maxWidth: '100%' }} />
  if (isDocx) return <div className="pp-docx-preview" style={{ fontSize: '0.85rem' }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
  return <div className="callout warn"><Icon name="warn" size="sm" /><div>In-app preview isn't supported for this file type.</div></div>
}
