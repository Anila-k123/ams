globalThis.global = globalThis;

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import axios from 'axios'
import { PrimeReactProvider } from 'primereact/api'
import 'primereact/resources/primereact.min.css'
import 'primeicons/primeicons.css'
import 'primeflex/primeflex.css'
import { API_BASE } from './api/client'
import { AuthProvider } from './context/AuthContext'

// Bare axios calls that are not moved to src/api/client.ts yet still hit AMS.
axios.defaults.baseURL = API_BASE
import { ThemeProvider } from './contexts/ThemeContext'
import { LoadingProvider } from './contexts/LoadingContext'
import { ToastProvider } from './contexts/ToastContext'
import GlobalLoader from './components/GlobalLoader'
import GlobalToast from './components/GlobalToast'
import './index.css'
import './assets/styles/themes.css'
import './assets/styles/animations.css'
import './assets/styles/Panel.css'
import './assets/styles/NotificationsCenter.css'
import './assets/styles/GlobalLoader.css'
import './assets/styles/DownloadLoader.css'
import './assets/styles/prime-bridge.css'
import DownloadLoader from './components/DownloadLoader'
import App from './App'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PrimeReactProvider value={{
      ripple: false,
      // Above AMS's own overlays (sidebar, loaders use up to 9999). Dropdown and
      // autocomplete panels must sit above dialogs, so they get a higher base.
      zIndex: { modal: 10000, overlay: 10100, menu: 10100, tooltip: 10200, toast: 10300 },
    }}>
    <AuthProvider>
    <ThemeProvider>
      <LoadingProvider>
        <ToastProvider>
          <GlobalLoader />
          <DownloadLoader />
          <GlobalToast />
          <App />
        </ToastProvider>
      </LoadingProvider>
    </ThemeProvider>
    </AuthProvider>
    </PrimeReactProvider>
  </StrictMode>,
)
