import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    watch: {
      ignored: [
        '**/scripts/**',
        '**/supabase/**',
        '**/*.sql',
        '**/*.csv',
        '**/podio_*',
      ],
    },
  },
})
