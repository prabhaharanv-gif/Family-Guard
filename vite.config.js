import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt' + selfDestroying stops the SW from silently serving stale
      // cached assets inside the Capacitor WebView. The APK already ships the
      // latest files, so we do NOT want a service worker caching layer on top.
      registerType: 'autoUpdate',
      selfDestroying: true,          // <-- kills any previously-installed SW
      injectRegister: null,          // <-- do NOT auto-register the SW
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
