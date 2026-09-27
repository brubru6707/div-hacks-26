import { createHmac, timingSafeEqual } from 'node:crypto'
import { MongoClient } from 'mongodb'
import { upsertRecording } from './tiger.js'

// Collections in the barn_owl database:
//   node        one document, { _id: 'node' }: the Pi's latest state and camera
//               frame, when a viewer last polled, any pending IR command, and
//               the recording in progress (if any).
//   recordings  one entry per record/stop session.
//   frames      the JPEGs of each recording ({ rec, ts, jpeg }). Kept apart from
//               recordings because a document is capped at 16 MB.
let client
let indexed
export async function db() {
  client ??= new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 5 }).connect()
  const d = (await client).db('barn_owl')
  indexed ??= d.collection('frames').createIndex({ rec: 1, ts: 1 }).catch(() => { indexed = null })
  return d
}

export async function node() {
  return (await db()).collection('node')
}

// Closes the recording that `rec` ({ id, startedAt }) points at. Callers have
// already removed it from the node document, so this runs at most once.
export async function finishRecording(rec, now, reason = 'stopped') {
  const d = await db()
  const saved = await d.collection('recordings').findOneAndUpdate(
    { _id: rec.id },
    { $set: { endedAt: now, durationSec: Math.round((now - rec.startedAt) / 1000), status: 'done', endReason: reason } },
    { returnDocument: 'after' },
  )
  if (saved) await upsertRecording({ id: saved._id, startedAt: saved.startedAt, endedAt: now, durationSec: saved.durationSec, zoom: saved.zoom, status: 'done' })
  return saved
}

const COOKIE = 'owl_session'
const YEAR = 60 * 60 * 24 * 365

function sign(value) {
  return createHmac('sha256', process.env.SESSION_SECRET).update(value).digest('base64url')
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

export function checkLogin(user, pass) {
  return safeEqual(user, process.env.DASH_USER) && safeEqual(pass, process.env.DASH_PASS)
}

// The session is "<user>.<hmac>". Signing with SESSION_SECRET means changing
// DASH_USER/DASH_PASS or the secret logs every device out.
export function sessionCookie(user) {
  const value = `${user}.${sign(user + ':' + process.env.DASH_PASS)}`
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${YEAR}`
}

export const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`

export function isLoggedIn(req) {
  // The team app's Grok agent reads with a token, never writes: GET only, and only straight from the
  // droplet itself (anything through Caddy carries X-Forwarded-For, so the token is useless from outside).
  if (req.method === 'GET' && process.env.AGENT_TOKEN && !req.headers['x-forwarded-for']
    && safeEqual(req.headers['x-agent-token'] || '', process.env.AGENT_TOKEN)) return true
  const raw = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))
  if (!raw) return false
  const value = raw.slice(COOKIE.length + 1)
  const dot = value.lastIndexOf('.')
  if (dot < 1) return false
  const user = value.slice(0, dot)
  return safeEqual(user, process.env.DASH_USER) && safeEqual(value.slice(dot + 1), sign(user + ':' + process.env.DASH_PASS))
}

export function isPi(req) {
  const auth = req.headers.authorization || ''
  return !!process.env.PI_TOKEN && safeEqual(auth, `Bearer ${process.env.PI_TOKEN}`)
}

export async function readBody(req) {
  if (req.body !== undefined) return req.body
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks).toString()
}
