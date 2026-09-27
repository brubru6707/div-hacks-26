// Tiger Data (TimescaleDB on Postgres): the time-series side of Barn Owl.
//
// MongoDB keeps the media and live state (preview JPEGs, the node document,
// recording entries). Tiger Data keeps everything that is "a thing at a time":
//
//   readings        hypertable  one row per Pi check-in (every 1-3 s): PIR, IR,
//                               zoom, camera state, CPU temperature, Wi-Fi signal
//   motion_events   hypertable  one row per stretch of PIR motion (start, end)
//   detections      hypertable  one row per model detection (rat + confidence + box)
//   recordings      table       one row per recording, same id as in MongoDB, so
//                               detections and readings join to clips in SQL
//   activity_1m     continuous aggregate of readings per minute (the charts)
//   activity_1h     continuous aggregate on top of activity_1m (hierarchical)
//   detections_1m   continuous aggregate of detections per minute
//
// readings are compressed once an hour-long chunk is an hour old; the
// dashboard shows the before/after size. Everything here is optional: with no
// TIGER_DATABASE_URL set, every function is a no-op and the site works as before.
import { readFileSync } from 'node:fs'
import pg from 'pg'

const URL = process.env.TIGER_DATABASE_URL || ''
// Tiger Cloud signs service certificates with its own root, ca.timescale.com,
// which isn't in Node's trust store. Pin it (it's public) so TLS is verified
// rather than turned off.
const TIGER_CA = readFileSync(new globalThis.URL('./timescale-ca.pem', import.meta.url), 'utf8')
export const tigerEnabled = !!URL
let pool
let ready

function getPool() {
  const local = /sslmode=disable|localhost|127\.0\.0\.1/.test(URL)
  pool ??= new pg.Pool({
    // sslmode in the URL would override the ssl option below, so drop it.
    connectionString: URL.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, ''),
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Tiger Cloud requires TLS; a local test database doesn't offer it.
    ssl: local ? false : { ca: TIGER_CA, rejectUnauthorized: true },
  })
  return pool
}

const SCHEMA = [
  `create extension if not exists timescaledb`,

  `create table if not exists readings (
     ts          timestamptz not null,
     node        text        not null default 'pi',
     pir         boolean     not null,
     ir          boolean     not null,
     zoom        real,
     camera_on   boolean,
     recording   text,
     cpu_temp_c  real,
     wifi_dbm    smallint
   )`,
  `select create_hypertable('readings', by_range('ts', interval '1 hour'), if_not_exists => true)`,
  `create index if not exists readings_node_ts on readings (node, ts desc)`,
  `alter table readings set (timescaledb.compress, timescaledb.compress_segmentby = 'node', timescaledb.compress_orderby = 'ts desc')`,
  `select add_compression_policy('readings', compress_after => interval '1 hour', if_not_exists => true)`,

  `create table if not exists motion_events (
     started_at  timestamptz not null,
     ended_at    timestamptz,
     node        text        not null default 'pi',
     recording   text
   )`,
  `select create_hypertable('motion_events', by_range('started_at', interval '1 day'), if_not_exists => true)`,
  `create index if not exists motion_open on motion_events (node) where ended_at is null`,

  `create table if not exists detections (
     ts          timestamptz not null,
     node        text        not null default 'pi',
     recording   text,
     frame       integer,
     label       text        not null default 'rat',
     confidence  real        not null,
     x real, y real, w real, h real,
     model       text
   )`,
  `select create_hypertable('detections', by_range('ts', interval '1 day'), if_not_exists => true)`,
  `create index if not exists detections_recording on detections (recording, ts)`,
  // SHA-256 of the sighting's picture (the boxed frame, kept in MongoDB sighting_images); part of the Solana anchor.
  `alter table detections add column if not exists image_sha256 text`,

  `create table if not exists recordings (
     id          text primary key,
     started_at  timestamptz not null,
     ended_at    timestamptz,
     duration_s  integer,
     zoom        real,
     pi_frames   integer,
     fps         real,
     status      text
   )`,

  `create materialized view if not exists activity_1m with (timescaledb.continuous) as
     select time_bucket('1 minute', ts) as bucket, node,
            count(*)                        as readings,
            count(*) filter (where pir)     as pir_readings,
            count(*) filter (where ir)      as ir_readings,
            avg(cpu_temp_c)                 as cpu_temp_c,
            avg(wifi_dbm)                   as wifi_dbm
     from readings group by bucket, node
     with no data`,
  `alter materialized view activity_1m set (timescaledb.materialized_only = false)`,
  `select add_continuous_aggregate_policy('activity_1m', start_offset => interval '3 hours', end_offset => interval '1 minute', schedule_interval => interval '1 minute', if_not_exists => true)`,

  `create materialized view if not exists activity_1h with (timescaledb.continuous) as
     select time_bucket('1 hour', bucket) as bucket, node,
            sum(readings) as readings, sum(pir_readings) as pir_readings, sum(ir_readings) as ir_readings,
            avg(cpu_temp_c) as cpu_temp_c
     from activity_1m group by 1, node
     with no data`,
  `alter materialized view activity_1h set (timescaledb.materialized_only = false)`,
  `select add_continuous_aggregate_policy('activity_1h', start_offset => interval '3 days', end_offset => interval '1 hour', schedule_interval => interval '10 minutes', if_not_exists => true)`,

  `create materialized view if not exists detections_1m with (timescaledb.continuous) as
     select time_bucket('1 minute', ts) as bucket, node, label,
            count(*) as detections, max(confidence) as max_confidence, avg(confidence) as avg_confidence
     from detections group by bucket, node, label
     with no data`,
  `alter materialized view detections_1m set (timescaledb.materialized_only = false)`,
  `select add_continuous_aggregate_policy('detections_1m', start_offset => interval '3 hours', end_offset => interval '1 minute', schedule_interval => interval '1 minute', if_not_exists => true)`,
]

// Creates everything once per process. Safe to run against an existing database.
async function init() {
  if (!tigerEnabled) return false
  ready ??= (async () => {
    const c = await getPool().connect()
    try {
      for (const sql of SCHEMA) await c.query(sql)
      return true
    } finally {
      c.release()
    }
  })().catch(e => { ready = null; throw e })
  return ready
}

export async function query(sql, params) {
  await init()
  return getPool().query(sql, params)
}

// Never let the time-series side break the Pi's sync or a page load.
async function safe(what, fn) {
  if (!tigerEnabled) return
  try { await fn() } catch (e) { console.error('tiger', what, e.message) }
}

// One Pi check-in. `prevPir` is the PIR state from the previous check-in, so
// motion edges become motion_events rows.
export function logReading(r, prevPir) {
  return safe('reading', async () => {
    await query(
      `insert into readings (ts, node, pir, ir, zoom, camera_on, recording, cpu_temp_c, wifi_dbm)
       values (to_timestamp($1 / 1000.0), $2, $3, $4, $5, $6, $7, $8, $9)`,
      [r.ts, r.node || 'pi', !!r.pir, !!r.ir, r.zoom ?? null, !!r.cameraOn, r.recording || null, r.cpuTemp ?? null, r.wifiDbm ?? null],
    )
    if (r.pir && !prevPir) {
      await query(
        `insert into motion_events (started_at, node, recording) values (to_timestamp($1 / 1000.0), $2, $3)`,
        [r.ts, r.node || 'pi', r.recording || null],
      )
    } else if (!r.pir && prevPir) {
      await query(
        `update motion_events set ended_at = to_timestamp($1 / 1000.0) where node = $2 and ended_at is null`,
        [r.ts, r.node || 'pi'],
      )
    }
  })
}

export function upsertRecording(rec) {
  // Without a start time (e.g. the Pi's late "file closed" report) the row
  // must already exist, so only fill in what's known.
  if (rec.startedAt == null) {
    return safe('recording', () => query(
      `update recordings set pi_frames = coalesce($2, pi_frames), fps = coalesce($3, fps) where id = $1`,
      [String(rec.id), rec.piFrames ?? null, rec.fps ?? null],
    ))
  }
  return safe('recording', () => query(
    `insert into recordings (id, started_at, ended_at, duration_s, zoom, pi_frames, fps, status)
     values ($1, to_timestamp($2 / 1000.0), to_timestamp($3 / 1000.0), $4, $5, $6, $7, $8)
     on conflict (id) do update set
       ended_at   = coalesce(excluded.ended_at, recordings.ended_at),
       duration_s = coalesce(excluded.duration_s, recordings.duration_s),
       zoom       = coalesce(excluded.zoom, recordings.zoom),
       pi_frames  = coalesce(excluded.pi_frames, recordings.pi_frames),
       fps        = coalesce(excluded.fps, recordings.fps),
       status     = coalesce(excluded.status, recordings.status)`,
    [String(rec.id), rec.startedAt, rec.endedAt ?? null, rec.durationSec ?? null, rec.zoom ?? null,
      rec.piFrames ?? null, rec.fps ?? null, rec.status ?? null],
  ))
}

// Detections from the rat model: one object or an array. Inserted in one
// statement with unnest(), so a batch of hundreds is a single round trip.
export async function insertDetections(list) {
  const rows = (Array.isArray(list) ? list : [list]).filter(d => d && Number.isFinite(Number(d.confidence)))
  if (!rows.length) return 0
  const col = f => rows.map(f)
  await query(
    `insert into detections (ts, node, recording, frame, label, confidence, x, y, w, h, model, image_sha256)
     select to_timestamp(t / 1000.0), n, r, f, l, c, x, y, w, h, m, i
     from unnest($1::float8[], $2::text[], $3::text[], $4::int[], $5::text[], $6::real[],
                 $7::real[], $8::real[], $9::real[], $10::real[], $11::text[], $12::text[])
          as u(t, n, r, f, l, c, x, y, w, h, m, i)`,
    [
      col(d => (d.ts ? new Date(d.ts).getTime() : Date.now())),
      col(d => String(d.node || 'pi')),
      col(d => (d.recording ? String(d.recording) : null)),
      col(d => (Number.isInteger(d.frame) ? d.frame : null)),
      col(d => String(d.label || 'rat')),
      col(d => Number(d.confidence)),
      col(d => d.box?.[0] ?? d.x ?? null), col(d => d.box?.[1] ?? d.y ?? null),
      col(d => d.box?.[2] ?? d.w ?? null), col(d => d.box?.[3] ?? d.h ?? null),
      col(d => (d.model ? String(d.model) : null)),
      col(d => (d.image_sha256 ? String(d.image_sha256) : null)),
    ],
  )
  return rows.length
}

// Everything the Activity tab needs, in one round of queries.
export async function activity(rangeMin) {
  const hourly = rangeMin > 360
  const view = hourly ? 'activity_1h' : 'activity_1m'
  const t0 = performance.now()
  const [series, dets, events, totals, compression] = await Promise.all([
    query(
      `select extract(epoch from bucket) * 1000 as t, readings, pir_readings, ir_readings, cpu_temp_c
       from ${view} where bucket > now() - make_interval(mins => $1) order by bucket`, [rangeMin]),
    query(
      `select extract(epoch from time_bucket($2::interval, bucket)) * 1000 as t, sum(detections)::int as detections, max(max_confidence) as max_confidence
       from detections_1m where bucket > now() - make_interval(mins => $1) group by 1 order by 1`,
      [rangeMin, hourly ? '1 hour' : '1 minute']),
    query(
      `select extract(epoch from m.started_at) * 1000 as start, extract(epoch from m.ended_at) * 1000 as "end", m.recording
       from motion_events m where m.started_at > now() - make_interval(mins => $1)
       order by m.started_at desc limit 50`, [rangeMin]),
    query(
      `select (select count(*) from readings) as readings,
              (select count(*) from motion_events) as motion_events,
              (select count(*) from detections) as detections,
              (select count(*) from recordings) as recordings,
              (select count(distinct recording) from detections where recording is not null) as recordings_with_detections,
              hypertable_size('readings') as readings_bytes`),
    query(
      `select coalesce(sum(before_compression_total_bytes), 0) as before,
              coalesce(sum(after_compression_total_bytes), 0) as after,
              count(*) filter (where compression_status = 'Compressed') as compressed_chunks, count(*) as chunks
       from chunk_compression_stats('readings')`),
  ])
  return {
    bucket: hourly ? 'hour' : 'minute',
    queryMs: Math.round((performance.now() - t0) * 10) / 10,
    series: series.rows.map(r => ({ t: +r.t, readings: +r.readings, motion: r.readings ? r.pir_readings / r.readings : 0, ir: r.readings ? r.ir_readings / r.readings : 0, cpu: r.cpu_temp_c == null ? null : +(+r.cpu_temp_c).toFixed(1) })),
    detections: dets.rows.map(r => ({ t: +r.t, n: r.detections, max: r.max_confidence == null ? null : +(+r.max_confidence).toFixed(2) })),
    events: events.rows.map(r => ({ start: +r.start, end: r.end == null ? null : +r.end, recording: r.recording })),
    totals: Object.fromEntries(Object.entries(totals.rows[0]).map(([k, v]) => [k, Number(v)])),
    compression: Object.fromEntries(Object.entries(compression.rows[0]).map(([k, v]) => [k, Number(v)])),
  }
}
