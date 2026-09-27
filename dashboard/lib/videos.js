// The full-rate (15 fps) recordings, kept on the droplet's disk. Only the
// droplet serves these (server.js); VIDEO_DIR is unset on Vercel.
//
//   Pi      POST /api/video-in?id=<rec>&kind=txt|mjpeg   after a recording closes
//   Browser GET  /api/video?id=<rec>&kind=mp4|mjpeg|txt[&download=1]
//
// When the MJPEG arrives it is converted to an H.264 MP4 so browsers can play
// and scrub it. The MJPEG is kept as the untouched original for training.
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { ObjectId } from 'mongodb'
import { db } from './common.js'
import { anchorRecording } from './solana.js'

export const VIDEO_DIR = process.env.VIDEO_DIR || ''
const TYPES = { mp4: 'video/mp4', mjpeg: 'video/x-motion-jpeg', txt: 'text/plain; charset=utf-8' }
const MAX_UPLOAD = 4 * 1024 ** 3
const pathFor = (id, kind) => `${VIDEO_DIR}/${id}.${kind}`
const validId = id => typeof id === 'string' && /^[0-9a-f]{24}$/.test(id)

async function setVideo(id, video) {
  await (await db()).collection('recordings').updateOne({ _id: new ObjectId(id) }, { $set: { video } })
}

export async function videoIn(req, res, url) {
  const id = url.searchParams.get('id')
  const kind = url.searchParams.get('kind')
  if (!VIDEO_DIR || !validId(id) || !['txt', 'mjpeg'].includes(kind)) return res.status(400).json({ error: 'bad request' })
  if (Number(req.headers['content-length'] || 0) > MAX_UPLOAD) return res.status(413).json({ error: 'too large' })
  const exists = await (await db()).collection('recordings').findOne({ _id: new ObjectId(id) }, { projection: { _id: 1 } })
  if (!exists) return res.status(404).json({ error: 'no such recording (deleted?)' })

  const tmp = pathFor(id, kind) + '.part'
  await pipeline(req, createWriteStream(tmp))
  await fs.rename(tmp, pathFor(id, kind))
  if (kind === 'mjpeg') {
    await setVideo(id, { status: 'converting', mjpegBytes: (await fs.stat(pathFor(id, 'mjpeg'))).size })
    convert(id)
    anchorRecording(id, pathFor(id, 'mjpeg')) // hashes and queues in the background; never throws
  }
  res.json({ ok: true })
}

// Frame times come from the .txt the Pi writes (ms since start, one per
// frame), so the MP4 plays at the rate the camera actually achieved.
async function frameStats(id) {
  try {
    const lines = (await fs.readFile(pathFor(id, 'txt'), 'utf8')).trim().split('\n').map(Number).filter(n => !Number.isNaN(n))
    const span = (lines.at(-1) - lines[0]) / 1000
    return { frames: lines.length, fps: lines.length > 1 && span > 0 ? (lines.length - 1) / span : 15 }
  } catch {
    return { frames: null, fps: 15 }
  }
}

async function convert(id) {
  const { frames, fps } = await frameStats(id)
  const out = pathFor(id, 'mp4')
  const tmp = out + '.part.mp4'
  const ff = spawn('nice', ['-n', '10', 'ffmpeg', '-v', 'error', '-y', '-f', 'mjpeg', '-framerate', fps.toFixed(3),
    '-i', pathFor(id, 'mjpeg'), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', tmp], { stdio: ['ignore', 'ignore', 'pipe'] })
  let err = ''
  ff.stderr.on('data', d => { err += d })
  ff.on('close', async code => {
    try {
      if (code !== 0) throw new Error(err.trim().slice(-300) || `ffmpeg exited ${code}`)
      await fs.rename(tmp, out)
      const [mj, mp] = await Promise.all([fs.stat(pathFor(id, 'mjpeg')), fs.stat(out)])
      await setVideo(id, { status: 'ready', frames, fps: Math.round(fps * 10) / 10, mjpegBytes: mj.size, mp4Bytes: mp.size })
    } catch (e) {
      console.error('convert', id, e.message)
      await fs.rm(tmp, { force: true })
      await setVideo(id, { status: 'failed', error: String(e.message).slice(0, 300) }).catch(() => {})
    }
  })
}

// Serves a file with Range support, which <video> needs to seek.
export async function videoOut(req, res, url) {
  const id = url.searchParams.get('id')
  const kind = url.searchParams.get('kind') || 'mp4'
  if (!VIDEO_DIR || !validId(id) || !TYPES[kind]) return res.status(404).json({ error: 'not found' })
  let size
  try { size = (await fs.stat(pathFor(id, kind))).size } catch { return res.status(404).json({ error: 'not found' }) }

  const headers = { 'Content-Type': TYPES[kind], 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' }
  if (url.searchParams.get('download')) headers['Content-Disposition'] = `attachment; filename="barn-owl_${id}.${kind}"`
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
  let start = 0
  let end = size - 1
  if (m && (m[1] || m[2])) {
    start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
    end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` })
      return res.end()
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': size })
  }
  if (req.method === 'HEAD') return res.end()
  createReadStream(pathFor(id, kind), { start, end }).pipe(res)
}

export async function deleteVideo(id) {
  if (!VIDEO_DIR || !validId(id)) return
  await Promise.all(['mjpeg', 'txt', 'mp4', 'mjpeg.part', 'txt.part', 'mp4.part.mp4'].map(k => fs.rm(pathFor(id, k), { force: true })))
}

// GET /api/videos-zip: every uploaded 15 fps recording in one zip, built on
// the fly (nothing extra kept on disk). Files are renamed by start time (UTC)
// so they sort, and manifest.csv lists each clip. JPEG/H.264 are already
// compressed, so the zip only stores them (-0) instead of recompressing.
export async function zipOut(req, res) {
  if (!VIDEO_DIR) return res.status(404).json({ error: 'not found' })
  const recs = await (await db()).collection('recordings')
    .find({ 'video.status': 'ready' }).sort({ startedAt: 1 }).toArray()
  if (!recs.length) return res.status(404).json({ error: 'no videos yet' })

  const dir = await fs.mkdtemp('/tmp/barn-owl-zip-')
  const rows = [['file', 'recording_id', 'started_utc', 'duration_s', 'frames', 'fps', 'zoom', 'mjpeg_bytes', 'mp4_bytes']]
  for (const r of recs) {
    const id = String(r._id)
    const name = new Date(r.startedAt).toISOString().replace(/\..*/, '').replace(/:/g, '-') + 'Z_' + id
    for (const kind of ['mjpeg', 'txt', 'mp4']) {
      await fs.symlink(pathFor(id, kind), `${dir}/${name}.${kind}`).catch(() => {})
    }
    const v = r.video
    rows.push([name, id, new Date(r.startedAt).toISOString(), r.durationSec ?? '', v.frames ?? '', v.fps ?? '', r.zoom ?? 1, v.mjpegBytes ?? '', v.mp4Bytes ?? ''])
  }
  await fs.writeFile(`${dir}/manifest.csv`, rows.map(row => row.join(',')).join('\n') + '\n')

  const stamp = new Date().toISOString().slice(0, 16).replace(/:/g, '-')
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="barn-owl-videos_${stamp}Z.zip"`,
    'Cache-Control': 'no-store',
  })
  const zip = spawn('zip', ['-0', '-q', '-r', '-', '.'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] })
  zip.stdout.pipe(res)
  const cleanup = () => fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  zip.on('close', cleanup)
  req.on('close', () => { if (zip.exitCode === null) zip.kill() })
}
