import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const showcaseHomepage = {
  name: 'showcase-homepage',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/' || req.url?.startsWith('/?')) {
        req.url = req.url.replace(/^\/(?=\?|$)/, '/visionary-rebels.html')
      }
      next()
    })
  },
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [showcaseHomepage, react()],
    server: {
      proxy: {
        '/api': {
          target: env.VITE_API_TARGET || 'http://visionaryrebels-staging.duckdns.org',
          changeOrigin: true,
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/test/setup.js',
    },
  }
})
