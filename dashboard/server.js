// Runs the same api/*.js handlers Vercel runs, as a plain Node server, so the
// droplet (barn-owl.tech) and Vercel (barn-owl.vercel.app) serve identical code
// against the same MongoDB. Only the bits of Vercel's req/res helpers that the
// handlers use are implemented. Listens on loopback; Caddy terminates TLS.
import { createServer } from 'node:http'
import { isLoggedIn, isPi } from './lib/common.js'
import { streamIn, streamOut } from './lib/stream.js'
import { videoIn, videoOut, zipOut } from './lib/videos.js'

const PORT = Number(process.env.PORT || 8771)
const HOST = process.env.HOST || '127.0.0.1'
const MAX_BODY = 2 * 1024 * 1024
const ROUTES = new Set(['page', 'pi', 'state', 'ir', 'login', 'record', 'recordings', 'frame', 'cam', 'activity', 'detections', 'solana', 'detect'])
const handlers = {}

async function parseBody(req) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > MAX_BODY) throw Object.assign(new Error('body too large'), { status: 413 })
    chunks.push(c)
  }
  const raw = Buffer.concat(chunks).toString()
  const type = req.headers['content-type'] || ''
  if (!raw) return undefined
  if (type.includes('application/json')) return JSON.parse(raw)
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw))
  return raw
}

function wrap(res) {
  res.status = code => { res.statusCode = code; return res }
  res.json = obj => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)) }
  res.send = body => res.end(body)
  res.redirect = (code, url) => { res.statusCode = code; res.setHeader('Location', url); res.end() }
  return res
}

const server = createServer(async (req, res) => {
  wrap(res)
  try {
    const url = new URL(req.url, 'http://x')
    // The 15 fps live view: long-lived streams that exist only on this server.
    if (url.pathname === '/api/stream-in' && req.method === 'POST') {
      return isPi(req) ? streamIn(req, res) : res.status(401).json({ error: 'bad token' })
    }
    if (url.pathname === '/api/stream' && req.method === 'GET') {
      return isLoggedIn(req) ? streamOut(req, res) : res.status(401).json({ error: 'login required' })
    }
    // The 15 fps recordings: uploaded by the Pi, stored on this disk.
    if (url.pathname === '/api/video-in' && req.method === 'POST') {
      return isPi(req) ? await videoIn(req, res, url) : res.status(401).json({ error: 'bad token' })
    }
    if (url.pathname === '/api/videos-zip' && req.method === 'GET') {
      return isLoggedIn(req) ? await zipOut(req, res) : res.status(401).json({ error: 'login required' })
    }
    if (url.pathname === '/api/video' && (req.method === 'GET' || req.method === 'HEAD')) {
      return isLoggedIn(req) ? await videoOut(req, res, url) : res.status(401).json({ error: 'login required' })
    }
    const name = url.pathname === '/' ? 'page' : url.pathname.match(/^\/api\/([a-z]+)$/)?.[1]
    if (!ROUTES.has(name)) return res.status(404).json({ error: 'not found' })
    req.query = Object.fromEntries(url.searchParams)
    req.body = await parseBody(req)
    handlers[name] ??= (await import(`./api/${name}.js`)).default
    await handlers[name](req, res)
  } catch (e) {
    console.error(req.method, req.url, e)
    if (!res.headersSent) res.status(e.status || 500).json({ error: e.status ? e.message : 'server error' })
  }
})
// Node ends requests after 5 minutes by default, which would cut the streams.
// Caddy sits in front and handles slow or idle clients.
server.requestTimeout = 0
server.listen(PORT, HOST, () => console.log(`barn-owl listening on ${HOST}:${PORT}`))
