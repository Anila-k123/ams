import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Spinner } from '../../ui/kit'
import { DRAFTING } from './routes'
import '../../ui/pages/drafting.css'

// The drafting screens inside the AMS sidebar shell (merge phase 04), mounted by
// Dashboard at /dashboard/drafting/* behind DRAFT_VIEW. The backend enforces the
// same codes (drafting/views.py). The sidebar's Drafting group links each page,
// so there is no tab strip here.

const Drafts = lazy(() => import('./Drafts'))
const Templates = lazy(() => import('./Templates'))
const Samples = lazy(() => import('./Samples'))
const Playbooks = lazy(() => import('./Playbooks'))
const NewDraft = lazy(() => import('./NewDraft'))

export default function DraftingRoutes() {
  return (
    <div className="pp-drafting">
      <Suspense fallback={<div className="row" style={{ justifyContent: 'center', padding: 40 }}><Spinner /></div>}>
        <Routes>
          {/* Opens on Drafts (the Overview page was removed; old links land here too). */}
          <Route index element={<Navigate to={DRAFTING.drafts} replace />} />
          <Route path="drafts" element={<Drafts />} />
          <Route path="templates" element={<Templates />} />
          <Route path="samples" element={<Samples />} />
          <Route path="playbooks" element={<Playbooks />} />
          {/* No drafting Administration: drafting clients/projects/members are AMS's clients,
              cases and users, derived from the AMS case (drafting/ams_cases.py). */}
          {/* New-draft wizard (merge phase 05). ?caseId=&taskId= links an AMS case/task. */}
          <Route path="new" element={<NewDraft />} />
          <Route path="*" element={<Navigate to={DRAFTING.drafts} replace />} />
        </Routes>
      </Suspense>
    </div>
  )
}
