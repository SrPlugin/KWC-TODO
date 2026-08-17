import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'

export default defineConfig({
  plugins: [
    react(),
    legacy({
      // 'defaults' resolves to today's very recent browsers, not old ones.
      // Explicitly cover old Android WebView browsers (e.g. Chrome 65 /
      // Android 7.1 found on cheap Smart TV boxes) so the legacy chunk is
      // actually transpiled down far enough for them to run.
      targets: ['defaults', 'Chrome >= 49', 'Android >= 5', 'not IE 11'],
      additionalLegacyPolyfills: ['whatwg-fetch'],
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:4000',
        ws: true,
      },
    },
  },
})
