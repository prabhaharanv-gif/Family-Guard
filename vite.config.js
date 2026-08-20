import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'FamilyGuard',
        short_name: 'FamilyGuard',
        theme_color: '#1A1A2E',
        background_color: '#F0F4FF',
        display: 'standalone',
        icons: [
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }
        ],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
})
