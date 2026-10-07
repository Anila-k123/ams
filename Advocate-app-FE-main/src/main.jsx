globalThis.global = globalThis;

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import axios from 'axios'
import { API_BASE } from './api/client'
import { AuthProvider } from './context/AuthContext'

// Bare axios calls that are not moved to src/api/client.ts yet still hit AMS.
axios.defaults.baseURL = API_BASE
import { ThemeProvider } from './contexts/ThemeContext'
import { LoadingProvider } from './contexts/LoadingContext'
import { ToastProvider } from './contexts/ToastContext'
import GlobalLoader from './components/GlobalLoader'
import GlobalToast from './components/GlobalToast'
import './ui/redtape.css'
import './assets/styles/animations.css'
import './assets/styles/GlobalLoader.css'
import './assets/styles/DownloadLoader.css'
import DownloadLoader from './components/DownloadLoader'
import { ConfirmHost } from './ui/overlays'
import App from './App'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
    <ThemeProvider>
      <LoadingProvider>
        <ToastProvider>
          <GlobalLoader />
          <DownloadLoader />
          <GlobalToast />
          <ConfirmHost />
          <App />
        </ToastProvider>
      </LoadingProvider>
    </ThemeProvider>
    </AuthProvider>
  </StrictMode>,
)
