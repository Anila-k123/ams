import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-recharts': ['recharts'],
          'vendor-calendar': ['react-big-calendar', 'moment'],
          'vendor-select': ['react-select'],
          'vendor-jspdf': ['jspdf'],
          'vendor-icons': ['react-icons'],
          'vendor-stomp': ['@stomp/stompjs'],
          'vendor-http': ['axios'],
        },
      },
    },
  },
})
