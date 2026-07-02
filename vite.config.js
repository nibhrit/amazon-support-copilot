import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev-only bridge: serves the Vercel serverless function at /api/claude
// through Vite's dev server, so local dev and production share one handler.
function apiDevPlugin() {
  return {
    name: 'api-dev-server',
    configureServer(server) {
      server.middlewares.use('/api/claude', async (req, res) => {
        const { default: dotenv } = await import('dotenv')
        dotenv.config()
        const { default: handler } = await server.ssrLoadModule('/api/claude.js')

        // Minimal shim for the Vercel req/res helpers the handler uses
        let body = ''
        for await (const chunk of req) body += chunk
        req.body = body ? JSON.parse(body) : {}
        res.status = (code) => { res.statusCode = code; return res }
        res.json = (obj) => {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(obj))
        }
        try {
          await handler(req, res)
        } catch (err) {
          console.error('[api/claude]', err)
          res.status(500).json({ error: err.message })
        }
      })
    },
  }
}

export default defineConfig({
  server: { host: true },
  plugins: [react(), tailwindcss(), apiDevPlugin()],
})
