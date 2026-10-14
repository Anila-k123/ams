import { Navigate, Route, Routes } from 'react-router-dom'
import { PlatformAuthProvider, PlatformRoute } from './PlatformAuth'
import PlatformLayout from './PlatformLayout'
import FirmCreate from './pages/FirmCreate'
import FirmDetail from './pages/FirmDetail'
import FirmDirectory from './pages/FirmDirectory'
import PlatformAudit from './pages/PlatformAudit'
import PlatformDashboard from './pages/PlatformDashboard'
import PlatformLogin from './pages/PlatformLogin'

// /platform/* - the operator console. Lives outside the firm ProtectedRoute and
// never reads the firm token; see api.ts.
const guarded = (el: React.ReactNode, permission: string) => (
  <PlatformRoute permission={permission}><PlatformLayout>{el}</PlatformLayout></PlatformRoute>
)

export default function PlatformApp() {
  return (
    <PlatformAuthProvider>
      <Routes>
        <Route path="login" element={<PlatformLogin />} />
        <Route path="dashboard" element={guarded(<PlatformDashboard />, 'firm.read')} />
        <Route path="firms" element={guarded(<FirmDirectory />, 'firm.read')} />
        <Route path="firms/new" element={guarded(<FirmCreate />, 'firm.create')} />
        <Route path="firms/:id" element={guarded(<FirmDetail />, 'firm.read')} />
        <Route path="audit" element={guarded(<PlatformAudit />, 'audit.read')} />
        <Route path="*" element={<Navigate to="/platform/dashboard" replace />} />
      </Routes>
    </PlatformAuthProvider>
  )
}
