import { node, isLoggedIn } from '../lib/common.js'

// Polled by the dashboard. On the Live tab it marks a viewer as present (which
// wakes the Pi into streaming mode) and returns the frame if it changed. With
// ?live=0 (Recordings tab) it only reports status, so the camera can sleep.
export default async function handler(req, res) {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'login required' })

  const now = Date.now()
  const live = req.query.live !== '0'
  // fast=1: the page is showing the 15 fps stream, so tell the Pi to push it.
  const fast = req.query.fast === '1'
  const n = await node()
  const projection = { state: 1, frameTs: 1, recording: 1, zoom: 1, detect: 1, ...(live && !fast && { frame: 1 }) }
  const mark = { ...(live && { viewer: now }), ...(fast && { fastViewer: now }) }
  const doc = Object.keys(mark).length
    ? await n.findOneAndUpdate({ _id: 'node' }, { $set: mark }, { upsert: true, returnDocument: 'after', projection })
    : await n.findOne({ _id: 'node' }, { projection })

  const state = doc?.state ?? null
  // The Pi syncs every `interval` seconds; allow a couple of missed syncs, and
  // at least 15s so a Wi-Fi hiccup or a cold start doesn't flash "offline".
  const online = !!state && now - state.ts < Math.max(15_000, state.interval * 2500 + 5000)
  const frameTs = doc?.frameTs ?? null
  const fresh = live && !fast && frameTs && String(frameTs) !== String(req.query.since || '')
  const recording = doc?.recording ? { id: String(doc.recording.id), startedAt: doc.recording.startedAt } : null

  res.setHeader('Cache-Control', 'no-store')
  // detect: what the dashboard asked for (the Pi's own report is state.detect)
  const detect = doc?.detect?.on && now < doc.detect.until ? { until: doc.detect.until } : null
  res.json({ now, online, state, frameTs, frame: fresh ? doc.frame : null, recording, zoom: doc?.zoom ?? 1, detect })
}
