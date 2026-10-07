import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Spinner } from '../../ui/kit'
import '../../ui/pages/drafting.css'

// Full-screen drafting pages, outside the sidebar shell (App mounts these):
//   /samples/:id/translate                        - document translation
//   (summaries are AMS's own, from the document's Summary action)
//   /draft/:sessionId                              - the three-pane editor (merge phase 06)
const DocumentTranslate = lazy(() => import('./DocumentTranslate'))
const DraftPage = lazy(() => import('./DraftPage'))

const fallback = <div className="row" style={{ justifyContent: 'center', padding: 48 }}><Spinner /></div>

export function SampleTool() {
  return (
    <div className="pp-drafting pp-drafting-standalone">
      <Suspense fallback={fallback}>
        <Routes>
          <Route path="translate" element={<DocumentTranslate />} />
        </Routes>
      </Suspense>
    </div>
  )
}

export function DraftEditor() {
  return (
    <div className="pp-drafting pp-drafting-standalone">
      <Suspense fallback={fallback}>
        <DraftPage />
      </Suspense>
    </div>
  )
}
