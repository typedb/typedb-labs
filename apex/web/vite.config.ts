import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // Served from the site root locally and in Docker; labs.typedb.com builds with VITE_BASE=/apex/.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    host: '127.0.0.1',
    // In development the API runs separately (npm run dev in api/); the dev server
    // forwards /api to it, so the browser only ever talks to one address.
    proxy: { '/api': process.env.APEX_API ?? 'http://127.0.0.1:8000' },
  },
})
