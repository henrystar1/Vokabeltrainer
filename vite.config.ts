import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// VITE_BASE wird beim GitHub-Pages-Build gesetzt (z. B. "/vokabeltrainer/"); lokal gilt "/".
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  return {
    base: env.VITE_BASE || '/',
    plugins: [react()],
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  }
})
