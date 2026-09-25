import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { ProgressSpinner } from 'primereact/progressspinner'
import './styles/drafting.css'

// Full-screen drafting pages, outside the sidebar shell (App.jsx mounts these):
//   /samples/:id/translate                        - document translation
//   (summaries are AMS's own, from the document's Summary action)
//   /draft/:sessionId                              - the three-pane editor (merge phase 06)
const DocumentTranslate = lazy(() => import('./DocumentTranslate'))
const DraftPage = lazy(() => import('./DraftPage'))

export function SampleTool() {
  return (
    <div className="pp-drafting pp-drafting-standalone">
      <Suspense fallback={<div className="flex justify-content-center p-6"><ProgressSpinner /></div>}>
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
      <Suspense fallback={<div className="flex justify-content-center p-6"><ProgressSpinner /></div>}>
        <DraftPage />
      </Suspense>
    </div>
  )
}
