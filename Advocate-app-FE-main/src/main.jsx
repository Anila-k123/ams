globalThis.global = globalThis;

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import axios from 'axios'

const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:8080'
axios.defaults.baseURL = apiBase
window.API_BASE = apiBase
import { ThemeProvider } from './contexts/ThemeContext.jsx'
import { LoadingProvider } from './contexts/LoadingContext.jsx'
import { ToastProvider } from './contexts/ToastContext.jsx'
import GlobalLoader from './components/GlobalLoader.jsx'
import GlobalToast from './components/GlobalToast.jsx'
import './index.css'
import './assets/styles/themes.css'
import './assets/styles/animations.css'
import './assets/styles/Panel.css'
import './assets/styles/NotificationsCenter.css'
import './assets/styles/GlobalLoader.css'
import './assets/styles/DownloadLoader.css'
import DownloadLoader from './components/DownloadLoader.jsx'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
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
  </StrictMode>,
)
