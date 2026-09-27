import { ObjectId } from 'mongodb'
import { db, node, isPi, finishRecording } from '../lib/common.js'
import { logReading, upsertRecording } from '../lib/tiger.js'

// Called by the agent on the Pi every few seconds. Stores its latest state
// (and a camera frame while someone is watching or recording) and hands back
// whether to stream plus any pending IR command, clearing it in the same step.
const VIEWER_WINDOW_MS = 20_000
const IR_CMD_TTL_MS = 60_000
// A forgotten recording would fill the 512 MB free tier in a few hours.
const MAX_RECORDING_MS = 30 * 60_000
// The full-rate (15 fps) recording stays on the Pi's SD card; MongoDB keeps a
// ~1 fps preview of it so it can be browsed on the dashboard.
const PREVIEW_EVERY_MS = 900

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!isPi(req)) return res.status(401).json({ error: 'bad token' })

  const b = req.body || {}
  const now = Date.now()
  const set = {
    state: {
      ts: now,
      pir: !!b.pir,
      lastMotion: b.lastMotionAgo == null ? null : now - Math.round(b.lastMotionAgo * 1000),
      ir: !!b.ir,
      irLeft: b.irLeft ?? null,
      interval: Number(b.interval) || 10,
      host: String(b.host || ''),
    },
  }
  const frame = typeof b.frame === 'string' && b.frame ? b.frame : null
  if (frame) Object.assign(set, { frame, frameTs: now })

  const n = await node()
  const before = await n.findOneAndUpdate(
    { _id: 'node' },
    { $set: set, $unset: { irCmd: '' } },
    { upsert: true, returnDocument: 'before', projection: { viewer: 1, fastViewer: 1, irCmd: 1, recording: 1, zoom: 1, 'state.pir': 1 } },
  )

  let rec = before?.recording ?? null
  if (rec && now - rec.startedAt > MAX_RECORDING_MS) {
    // Only the request that actually removes it closes the entry.
    const taken = await n.findOneAndUpdate({ _id: 'node', 'recording.id': rec.id }, { $unset: { recording: '' } })
    if (taken) await finishRecording(rec, now, 'time limit')
    rec = null
  }
  const d = await db()
  // The Pi's own file for a recording: path, frame count, size. Reported on
  // every sync while recording and once more when it closes the file.
  if (b.rec && ObjectId.isValid(b.rec.id)) {
    const r = b.rec
    await d.collection('recordings').updateOne({ _id: new ObjectId(r.id) }, {
      $set: { pi: { file: String(r.file), frames: Number(r.frames) || 0, bytes: Number(r.bytes) || 0, fps: Number(r.fps) || 0, done: !!r.done } },
    })
    if (r.done) await upsertRecording({ id: r.id, piFrames: Number(r.frames) || 0, fps: Number(r.fps) || null })
  }
  const keepPreview = rec && frame && (await n.updateOne(
    { _id: 'node', 'recording.id': rec.id, $or: [{ 'recording.lastSaved': { $exists: false } }, { 'recording.lastSaved': { $lt: now - PREVIEW_EVERY_MS } }] },
    { $set: { 'recording.lastSaved': now } },
  )).modifiedCount === 1
  if (keepPreview) {
    const jpeg = Buffer.from(frame, 'base64')
    await Promise.all([
      d.collection('frames').insertOne({ rec: rec.id, ts: now, jpeg }),
      d.collection('recordings').updateOne({ _id: rec.id }, { $inc: { frameCount: 1, bytes: jpeg.length }, $set: { lastFrameAt: now } }),
    ])
  }

  const cmd = before?.irCmd && now - before.irCmd.at < IR_CMD_TTL_MS ? before.irCmd.value : null
  const watching = !!before?.viewer && now - before.viewer < VIEWER_WINDOW_MS
  const fast = !!before?.fastViewer && now - before.fastViewer < VIEWER_WINDOW_MS
  // The time series: one row per check-in in Tiger Data.
  await logReading({
    ts: now, pir: set.state.pir, ir: set.state.ir, zoom: Number(b.zoom) || null,
    cameraOn: watching || fast || !!rec, recording: rec ? String(rec.id) : null,
    cpuTemp: Number.isFinite(b.cpuTemp) ? b.cpuTemp : null, wifiDbm: Number.isFinite(b.wifiDbm) ? Math.round(b.wifiDbm) : null,
  }, !!before?.state?.pir)
  res.json({ viewer: watching || fast || !!rec, fast, ir: cmd, record: rec ? String(rec.id) : null, zoom: before?.zoom ?? 1 })
}
