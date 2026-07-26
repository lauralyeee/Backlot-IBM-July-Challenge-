import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Backend API — FastAPI running on port 8000
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      // Legacy dev-proxy paths kept for reference (no longer used by the app
      // — credentials now live server-side only, not in the browser bundle).
      // '/iam': { target: 'https://iam.cloud.ibm.com', changeOrigin: true, rewrite: ... }
      // '/wx':  { target: 'https://eu-de.ml.cloud.ibm.com', changeOrigin: true, rewrite: ... }
    },
  },
})
