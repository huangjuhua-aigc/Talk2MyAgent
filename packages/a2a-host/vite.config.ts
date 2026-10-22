import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    // Dev server proxies the API to a locally running `a2a-host` CLI.
    proxy: {
      '/api': 'http://127.0.0.1:17890',
    },
  },
})
