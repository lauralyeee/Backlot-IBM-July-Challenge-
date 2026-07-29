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
      // 3D concept model files (.glb), served by FastAPI's StaticFiles
      // mount at /models — same backend, needs its own proxy entry
      // because it's a different path prefix than /api. Without this,
      // Vite's dev server has no route for /models/*.glb and falls back
      // to serving index.html, which model-viewer's GLTFLoader then fails
      // to parse ("Unexpected token '<', \"<!doctype \"...").
      '/models': {
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
