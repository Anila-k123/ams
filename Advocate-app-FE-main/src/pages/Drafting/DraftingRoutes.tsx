import { lazy, Suspense } from 'react'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { ProgressSpinner } from 'primereact/progressspinner'
import { DRAFTING } from './routes'
import './styles/drafting.css'

// The drafting screens inside the AMS sidebar shell (merge phase 04), mounted by
// Dashboard.jsx at /dashboard/drafting/* behind DRAFT_VIEW. The backend enforces the
// same codes (drafting/views.py).

const Drafts = lazy(() => import('./Drafts'))
const Templates = lazy(() => import('./Templates'))
const Samples = lazy(() => import('./Samples'))
const Playbooks = lazy(() => import('./Playbooks'))
const NewDraft = lazy(() => import('./NewDraft'))

const TABS = [
  { to: DRAFTING.drafts, label: 'Drafts', icon: 'pi pi-file-edit' },
  { to: DRAFTING.templates, label: 'Templates', icon: 'pi pi-clone' },
  { to: DRAFTING.samples, label: 'Documents', icon: 'pi pi-folder-open' },
  { to: DRAFTING.playbooks, label: 'Playbooks', icon: 'pi pi-shield' },
]

export default function DraftingRoutes() {
  return (
    <div className="pp-drafting">
      <nav className="pp-drafting-tabs" aria-label="Drafting">
        {TABS.map(t => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => `pp-drafting-tab${isActive ? ' active' : ''}`}>
            <i className={t.icon} /> <span>{t.label}</span>
          </NavLink>
        ))}
      </nav>
      <Suspense fallback={<div className="flex justify-content-center p-5"><ProgressSpinner style={{ width: 40, height: 40 }} /></div>}>
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
