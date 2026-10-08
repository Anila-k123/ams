import { useEffect, useState } from 'react'
import { Spinner } from '../../../ui/kit'
import Icon from '../../../ui/Icon'
import * as mammoth from 'mammoth'
import { apiUrl, authHeaders } from '../../../api/client'

/** Inline document renderer (no dialog): PDF via a blob-URL iframe, DOCX via
 *  mammoth → HTML, images as they are. Used to show a reference document inside a panel.
 *  `amsDocId` = a case document, fetched with the login token; `fileName` then gives its type. */
export default function InlineDocViewer({ fileUrl, name, amsDocId, fileName }:
  { fileUrl?: string | null; name?: string; amsDocId?: number; fileName?: string }) {
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
    fetch(fileUrl, amsDocId ? { headers: authHeaders() } : undefined)
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer() })
      .then(async buf => {
        if (cancelled) return
        if (isDocx) {
          const res = await mammoth.convertToHtml({ arrayBuffer: buf })
          if (!cancelled) setHtml(res.value || '<p>(empty document)</p>')
        } else if (isImage) {
          objectUrl = URL.createObjectURL(new Blob([buf]))
          if (!cancelled) setImgUrl(objectUrl)
        } else {
          objectUrl = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }))
          if (!cancelled) setPdfUrl(objectUrl)
        }
      })
      .catch(() => { if (!cancelled) setError('Could not load this document.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [fileUrl, isPdf, isDocx, isImage, amsDocId])

  if (!fileUrl) return <div className="callout warn"><Icon name="warn" size="sm" /><div>No file available.</div></div>
  if (loading) return <div className="row" style={{ justifyContent: 'center', padding: 32 }}><Spinner label="Loading document" /></div>
  if (error) return <div className="callout bad"><Icon name="warn" size="sm" /><div>{error}</div></div>
  if (isPdf && pdfUrl) return <iframe title={name ?? 'document'} src={pdfUrl} style={{ width: '100%', height: '100%', border: 'none' }} />
  if (isImage && imgUrl) return <img src={imgUrl} alt={name ?? 'document'} style={{ maxWidth: '100%' }} />
  if (isDocx) return <div className="pp-docx-preview" style={{ fontSize: '0.85rem' }} dangerouslySetInnerHTML={{ __html: html }} />
  return <div className="callout warn"><Icon name="warn" size="sm" /><div>In-app preview isn't supported for this file type.</div></div>
}
