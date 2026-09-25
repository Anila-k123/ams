import { useEffect, useState } from 'react'
import { Message } from 'primereact/message'
import { ProgressSpinner } from 'primereact/progressspinner'
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

  if (!fileUrl) return <Message severity="warn" className="w-full" text="No file available." />
  if (loading) return <div className="flex justify-content-center p-5"><ProgressSpinner style={{ width: 38, height: 38 }} /></div>
  if (error) return <Message severity="error" className="w-full" text={error} />
  if (isPdf && pdfUrl) return <iframe title={name ?? 'document'} src={pdfUrl} style={{ width: '100%', height: '100%', border: 'none' }} />
  if (isDocx) return <div className="pp-docx-preview" style={{ fontSize: '0.85rem' }} dangerouslySetInnerHTML={{ __html: html }} />
  return <Message severity="warn" className="w-full" text="In-app preview isn't supported for this file type." />
}
