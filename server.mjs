// Minimal zero-dependency static server for the SharedWorker OPFS repro.
//
// It serves the repro files over http://127.0.0.1 (which Chrome treats as a
// potentially trustworthy / secure context, so no TLS is needed) and sets the
// cross-origin isolation headers on every response. Those headers are what make
// the page `crossOriginIsolated`, which is the exact configuration under which
// the SharedWorker OPFS denial reproduces.
//
// Usage: node server.mjs   (optionally PORT=9000 node server.mjs)

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('./', import.meta.url))
const port = Number(process.env.PORT ?? 8787)

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
}

const server = createServer(async (req, res) => {
  const pathname = (req.url ?? '/').split('?')[0]
  const filePath = pathname === '/' ? '/index.html' : pathname
  const safePath = normalize(filePath).replace(/^(\.\.[/\\])+/, '')
  try {
    const data = await readFile(join(root, safePath))
    res.writeHead(200, {
      'content-type': contentTypes[extname(safePath)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
    })
    res.end(data)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`not found: ${safePath}`)
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`SharedWorker OPFS repro: open http://127.0.0.1:${port}/ in Chrome`)
})
