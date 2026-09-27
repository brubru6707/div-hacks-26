// The 15 fps live view. Only the droplet serves this (server.js), because it
// needs connections held open, which Vercel functions can't do.
//
//   Pi      POST /api/stream-in  one long chunked request of back-to-back JPEGs
//   Browser GET  /api/stream     multipart/x-mixed-replace, which <img> plays
//
// Frames live only in memory: nothing is written to MongoDB. The Pi's upload
// is ended once no browser has been watching for IDLE_MS.
const IDLE_MS = 15_000
const BOUNDARY = 'owlframe'
const viewers = new Set()
let latest = null
let lastViewerAt = 0

export const hasViewers = () => viewers.size > 0 || Date.now() - lastViewerAt < IDLE_MS

function send(res, frame) {
  // A viewer on a slow link just skips frames instead of queueing them.
  if (res.writableNeedDrain) return
  res.write(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`)
  res.write(frame)
  res.write('\r\n')
}

export function streamIn(req, res) {
  // The page asks the Pi for 15 fps and opens /api/stream at about the same
  // time; give the viewer IDLE_MS to show up before hanging up on the Pi.
  const connectedAt = Date.now()
  let buf = Buffer.alloc(0)
  req.on('data', chunk => {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      const start = buf.indexOf(Buffer.from([0xff, 0xd8]))
      const end = start < 0 ? -1 : buf.indexOf(Buffer.from([0xff, 0xd9]), start + 2)
      if (end < 0) { buf = start < 0 ? Buffer.alloc(0) : buf.subarray(start); break }
      latest = buf.subarray(start, end + 2)
      buf = buf.subarray(end + 2)
      for (const v of viewers) send(v, latest)
    }
    if (buf.length > 4 * 1024 * 1024) buf = Buffer.alloc(0) // garbage; resync
  })
  const idle = setInterval(() => {
    if (!hasViewers() && Date.now() - connectedAt > IDLE_MS) { clearInterval(idle); res.statusCode = 204; res.end(); req.destroy() }
  }, 2000)
  const done = () => { clearInterval(idle); if (!res.writableEnded) { res.statusCode = 204; res.end() } }
  req.on('end', done)
  req.on('close', done)
}

export function streamOut(req, res) {
  res.writeHead(200, {
    'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
    'Cache-Control': 'no-store',
  })
  viewers.add(res)
  lastViewerAt = Date.now()
  if (latest) send(res, latest)
  req.on('close', () => { viewers.delete(res); lastViewerAt = Date.now() })
}
