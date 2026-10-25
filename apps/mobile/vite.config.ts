import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Capacitor serves from the device filesystem — assets MUST be relative.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'www', emptyOutDir: true },
})
