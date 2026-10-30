import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { parseAuthConfig } from './src/auth/config.ts'

export default defineConfig(({ mode }) => {
  parseAuthConfig(loadEnv(mode, process.cwd(), 'VITE_'))
  return {
    plugins: [react()],
    server: { host: 'localhost', port: 5173, strictPort: true },
    preview: { host: 'localhost', port: 4173, strictPort: true },
  }
})
