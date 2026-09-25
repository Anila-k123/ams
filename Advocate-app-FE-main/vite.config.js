import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // host:true => bind 0.0.0.0 so other devices on the LAN can open the dev server.
  server: {
    host: true,
    port: 5173,
  },
  // Pre-bundle PrimeReact's per-component modules, so the dev server doesn't
  // re-optimise and reload the page the first time each screen is opened.
  optimizeDeps: {
    include: ['primereact/accordion','primereact/api','primereact/autocomplete','primereact/avatar','primereact/badge','primereact/button','primereact/calendar','primereact/card','primereact/checkbox','primereact/column','primereact/confirmdialog','primereact/datatable','primereact/dialog','primereact/dropdown','primereact/fileupload','primereact/iconfield','primereact/inputicon','primereact/inputnumber','primereact/inputswitch','primereact/inputtext','primereact/inputtextarea','primereact/menu','primereact/message','primereact/multiselect','primereact/overlaypanel','primereact/paginator','primereact/password','primereact/progressbar','primereact/progressspinner','primereact/radiobutton','primereact/selectbutton','primereact/sidebar','primereact/skeleton','primereact/tabmenu','primereact/tabview','primereact/tag','primereact/toast','primereact/steps', 'mammoth', '@tiptap/react', '@tiptap/pm/state', '@tiptap/pm/view', '@tiptap/pm/model', '@tiptap/starter-kit', '@tiptap/extension-text-align', '@tiptap/extension-underline', 'diff'],
  },
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
