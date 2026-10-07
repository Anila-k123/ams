import { useEffect, useState } from 'react'
import { Spinner } from '../../../ui/kit'
import Icon from '../../../ui/Icon'
import * as mammoth from 'mammoth'

/** Inline document renderer (no dialog): PDF via a blob-URL iframe, DOCX via
 *  mammoth → HTML. Used to show a reference document inside a panel. */
export default function InlineDocViewer({ fileUrl, name }: { fileUrl?: string | null; name?: string }) {
  const [html, setHtml] = useState('')
  const [pdfUrl, setPdfUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const isPdf = !!fileUrl && /\.pdf(\?|$)/i.test(fileUrl)
  const isDocx = !!fileUrl && /\.docx?(\?|$)/i.test(fileUrl)

  useEffect(() => {
    if (!fileUrl || (!isPdf && !isDocx)) return
    let cancelled = false
    let objectUrl = ''
    setLoading(true); setError(''); setHtml(''); setPdfUrl('')
    fetch(fileUrl)
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer() })
      .then(async buf => {
        if (cancelled) return
        if (isDocx) {
          const res = await mammoth.convertToHtml({ arrayBuffer: buf })
          if (!cancelled) setHtml(res.value || '<p>(empty document)</p>')
        } else {
          objectUrl = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }))
          if (!cancelled) setPdfUrl(objectUrl)
        }
      })
      .catch(() => { if (!cancelled) setError('Could not load this document.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [fileUrl, isPdf, isDocx])

  if (!fileUrl) return <div className="callout warn"><Icon name="warn" size="sm" /><div>No file available.</div></div>
  if (loading) return <div className="row" style={{ justifyContent: 'center', padding: 32 }}><Spinner label="Loading document" /></div>
  if (error) return <div className="callout bad"><Icon name="warn" size="sm" /><div>{error}</div></div>
  if (isPdf && pdfUrl) return <iframe title={name ?? 'document'} src={pdfUrl} style={{ width: '100%', height: '100%', border: 'none' }} />
  if (isDocx) return <div className="pp-docx-preview" style={{ fontSize: '0.85rem' }} dangerouslySetInnerHTML={{ __html: html }} />
  return <div className="callout warn"><Icon name="warn" size="sm" /><div>In-app preview isn't supported for this file type.</div></div>
}
