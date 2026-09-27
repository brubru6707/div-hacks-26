import { isLoggedIn } from '../lib/common.js'

const HEAD = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Barn Owl</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🦉</text></svg>">
<script>try{document.documentElement.dataset.theme=localStorage.getItem('owl-theme')||'day'}catch(e){document.documentElement.dataset.theme='day'}</script>
<style>
/* Same liquid-glass tokens as the team app at / (web/src/index.css): day is light frosted glass on a hazy
   sky, night is the stage preset. --panel/--text/--bad are this page's older names for the same roles. */
:root{--bg:#d6dfe6;--glass:rgba(255,255,255,.56);--glass-strong:rgba(255,255,255,.82);--glass-line:rgba(255,255,255,.78);
--glass-shadow:0 10px 32px rgba(20,40,60,.16),inset 0 1px 0 rgba(255,255,255,.85);--ink:#16202b;--muted:#5f6d7b;--line:rgba(22,32,43,.1);
--field:rgba(255,255,255,.65);--row-hot:rgba(255,255,255,.75);--active:#fff;--active-ink:#111;--accent:#c8731e;--ok:#1f8a58;--ok-bg:rgba(31,138,88,.14);
--warn:#9a5a12;--warn-bg:rgba(200,115,30,.16);--bad:#d33a2c;--bad-bg:rgba(211,58,44,.13);--track:rgba(22,32,43,.14);--r:16px;--r-sm:10px;
--sky:radial-gradient(1100px 620px at 12% -12%,#f1f5f8 0%,transparent 60%),radial-gradient(900px 560px at 105% 8%,#bccfdd 0%,transparent 62%),radial-gradient(800px 600px at 50% 115%,#c7d6c9 0%,transparent 60%),linear-gradient(180deg,#dfe7ed,#cdd8e0);
--panel:var(--glass);--text:var(--ink);color-scheme:light}
:root[data-theme=night]{--bg:#07080d;--glass:rgba(16,19,28,.6);--glass-strong:rgba(16,19,28,.86);--glass-line:rgba(255,255,255,.12);
--glass-shadow:0 10px 32px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.08);--ink:#e6e8ef;--muted:#8f95a6;--line:rgba(255,255,255,.1);
--field:rgba(255,255,255,.06);--row-hot:rgba(255,255,255,.1);--active:#eef1f5;--active-ink:#111;--accent:#eaa25a;--ok:#6fe0a8;--ok-bg:rgba(31,138,88,.25);
--warn:#f0c070;--warn-bg:rgba(200,115,30,.22);--bad:#ff6b5e;--bad-bg:rgba(255,80,60,.18);--track:rgba(255,255,255,.14);
--sky:radial-gradient(1100px 620px at 12% -12%,#1a2233 0%,transparent 60%),radial-gradient(900px 560px at 105% 8%,#15202b 0%,transparent 62%),linear-gradient(180deg,#0b0d14,#07080d);color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:var(--sky);background-color:var(--bg);background-attachment:fixed;color:var(--ink);
font:13px/1.45 -apple-system,BlinkMacSystemFont,Inter,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
button,input{font:inherit;color:inherit}
.glass{background:var(--glass);border:1px solid var(--glass-line);box-shadow:var(--glass-shadow);backdrop-filter:blur(18px) saturate(1.5);-webkit-backdrop-filter:blur(18px) saturate(1.5)}
</style></head><body>`

const LOGIN = (err) => `${HEAD}
<style>
main{min-height:100vh;display:grid;place-items:center;padding:16px}
form{width:100%;max-width:340px;border-radius:var(--r);padding:28px}
h1{margin:0 0 4px;font-size:20px;font-weight:650} p{margin:0 0 18px;color:var(--muted)}
label{display:block;font-size:12px;color:var(--muted);margin:12px 0 6px}
input{width:100%;height:40px;padding:0 14px;background:var(--field);border:1px solid var(--line);border-radius:999px;outline:0}
input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--warn-bg)}
button{width:100%;margin-top:20px;height:40px;border:0;border-radius:999px;background:var(--active);color:var(--active-ink);font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.14)}
button:hover{transform:translateY(-1px)}
.err{color:var(--bad);background:var(--bad-bg);border-radius:var(--r-sm);padding:8px 12px;margin:14px 0 0;font-size:12px;font-weight:600}
</style>
<main><form class="glass" method="post" action="api/login">
<h1>🦉 Barn Owl</h1><p>Sign in to view the node.</p>
<label for="u">Username</label><input id="u" name="user" autocomplete="username" autocapitalize="off" required autofocus>
<label for="p">Password</label><input id="p" name="pass" type="password" autocomplete="current-password" required>
${err ? '<div class="err">Wrong username or password.</div>' : ''}
<button>Sign in</button>
</form></main></body></html>`


const DASH = `${HEAD}
<style>
header{position:sticky;top:12px;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:8px;margin:12px 0 0;padding:0 12px;flex-wrap:wrap}
header h1{margin:0;font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px;height:40px;padding:0 14px 0 12px;border-radius:999px}
.left{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
nav{display:flex;gap:2px;padding:4px;border-radius:999px;flex-wrap:wrap}
nav button{background:none;border:0;border-radius:999px;padding:7px 13px;cursor:pointer;color:var(--muted);font-weight:500;white-space:nowrap;transition:background .15s,color .15s}
nav button:hover{color:var(--ink)}
nav button[aria-selected=true]{background:var(--active);color:var(--active-ink);font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,.14)}
.right{display:flex;align-items:center;gap:6px;height:40px;padding:0 6px 0 8px;border-radius:999px}
#status{font-weight:600;font-size:11px;display:flex;align-items:center;gap:6px;white-space:nowrap;padding:3px 10px;border-radius:999px;color:var(--muted);border:1px solid var(--line)}
#status::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
#status.on{color:var(--ok);background:var(--ok-bg);border-color:transparent}
#status.off{color:var(--bad);background:var(--bad-bg);border-color:transparent}
header a{color:var(--muted);font-size:12px;text-decoration:none;padding:6px 10px;border-radius:999px} header a:hover{color:var(--ink);background:var(--row-hot)}
.theme{display:flex;gap:2px;padding:3px;border-radius:999px;background:var(--field)}
.theme button{width:30px;height:26px;border:0;border-radius:999px;background:none;color:var(--muted);cursor:pointer;display:grid;place-items:center}
.theme button[aria-pressed=true]{background:var(--active);color:var(--active-ink);box-shadow:0 2px 6px rgba(0,0,0,.14)}
main{max-width:1100px;margin:0 auto;padding:16px 12px 40px}
#totals{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 22px;max-width:1076px;margin:10px auto 0;padding:9px 18px;border-radius:999px;font-size:12px;color:var(--muted)}
#totals b{color:var(--ink);font-weight:600}
.vid video{width:100%;background:#000;border-radius:var(--r-sm);display:block;aspect-ratio:4/3}
.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-top:10px}
.pair figure{margin:0}
.pair figcaption{font-size:11px;color:var(--muted);margin-top:6px;display:flex;justify-content:space-between;gap:8px}
.pair .prev{width:100%;aspect-ratio:4/3;background:#000;border-radius:var(--r-sm);display:grid;place-items:center;overflow:hidden;position:relative}
.pair .prev img{width:100%;height:100%;object-fit:contain}
.pair .prev span{color:#aab;font-size:12px;position:absolute}
.dl{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.dl a{color:var(--ink);font-size:12px;font-weight:500;text-decoration:none;background:var(--field);border:1px solid var(--line);border-radius:999px;padding:6px 12px}
.dl a:hover{background:var(--row-hot);color:var(--accent)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
.tile .v{font-size:22px;font-weight:650;margin-top:2px;letter-spacing:-.01em}
.tile .s{font-size:11px;color:var(--muted);margin-top:2px}
.chart{position:relative}
.chart svg{display:block;width:100%;height:160px;overflow:visible}
.chart .grid{stroke:var(--line);stroke-width:1}
.chart .axis{fill:var(--muted);font-size:10px}
.chart .bar{fill:var(--accent)} .chart .bar:hover,.chart .bar.hot{fill:var(--accent);opacity:.65}
.chart .line{fill:none;stroke:var(--accent);stroke-width:2}
.chart .none{fill:var(--muted);font-size:12px}
.tip{position:absolute;pointer-events:none;background:var(--glass-strong);color:var(--ink);border:1px solid var(--glass-line);box-shadow:var(--glass-shadow);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border-radius:var(--r-sm);padding:6px 10px;font-size:11px;white-space:nowrap;transform:translate(-50%,-110%);z-index:3}
table.ev{width:100%;border-collapse:collapse;font-size:12px}
table.ev th{text-align:left;color:var(--muted);font-weight:500;padding:6px 8px;border-bottom:1px solid var(--line)}
table.ev td{padding:6px 8px;border-bottom:1px solid var(--line)}
.powered{font-size:11px;color:var(--muted);text-align:center}
.view{display:grid;gap:14px;transition:filter .6s}
.view[hidden]{display:none}
body.offline #live{filter:grayscale(.7) opacity(.45);pointer-events:none}
.card{background:var(--glass);border:1px solid var(--glass-line);box-shadow:var(--glass-shadow);backdrop-filter:blur(18px) saturate(1.5);-webkit-backdrop-filter:blur(18px) saturate(1.5);border-radius:var(--r);padding:16px}
.cam{padding:0;overflow:hidden;position:relative;background:#05070a;aspect-ratio:4/3;display:grid;place-items:center;width:min(100%,calc(64vh * 4 / 3));justify-self:center;border:1px solid var(--glass-line)}
.cam img{width:100%;height:100%;object-fit:contain;transition:transform .3s}
.cam img:not([src]){visibility:hidden}
.pill:empty{display:none}
.cam .empty{color:#9aa3b2;position:absolute}
.cam .tools{position:absolute;right:10px;bottom:10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.cam .badge{position:absolute;left:10px;top:10px}
.pill{background:rgba(16,19,28,.55);border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-radius:999px;padding:5px 12px;font-size:11px;font-weight:600;color:#eef1f5}
button.pill{cursor:pointer;transition:transform .15s,background .15s} button.pill:hover{background:rgba(16,19,28,.8);transform:translateY(-1px)}
.rec{background:var(--bad);border-color:transparent;color:#fff;font-weight:600}
@keyframes blink{50%{opacity:.35}}
.recdot{color:#fff;background:rgba(211,48,44,.85);border-color:rgba(255,255,255,.35);font-weight:600} .recdot::first-letter{animation:blink 1s infinite}
.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
.camctl{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;justify-content:center}
.camctl .label{margin:0}
.seg{display:inline-flex;background:var(--glass);border:1px solid var(--glass-line);box-shadow:var(--glass-shadow);backdrop-filter:blur(18px) saturate(1.5);-webkit-backdrop-filter:blur(18px) saturate(1.5);border-radius:999px;padding:4px;gap:2px}
.seg button{background:none;border:0;border-radius:999px;padding:6px 14px;cursor:pointer;color:var(--muted);font-weight:500;white-space:nowrap;transition:background .15s,color .15s}
.seg button:hover{color:var(--ink)}
.seg button[aria-pressed=true]{background:var(--active);color:var(--active-ink);font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,.14)}
.seg button:disabled{opacity:.4;cursor:not-allowed}
.label{font-size:11px;font-weight:600;letter-spacing:.02em;color:var(--muted);margin-bottom:8px}
.big{font-size:24px;font-weight:650;letter-spacing:-.01em}
.big.motion{color:var(--accent)} .big.clear{color:var(--ok)}
.sub{color:var(--muted);font-size:12px;margin-top:4px}
.toggle{display:flex;align-items:center;justify-content:space-between;gap:12px}
.switch{width:52px;height:30px;border-radius:999px;border:0;background:var(--track);position:relative;cursor:pointer;flex:none;transition:background .2s}
.switch::after{content:"";position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.25);transition:left .2s var(--ease,ease)}
.switch[aria-checked=true]{background:var(--accent)} .switch[aria-checked=true]::after{left:25px}
.switch:disabled{opacity:.5;cursor:wait}
.bar{height:6px;border-radius:99px;background:var(--track);overflow:hidden;margin-top:8px} .bar i{display:block;height:100%;background:var(--accent)}
.list{display:grid;gap:10px}
.item{display:grid;grid-template-columns:1fr auto;gap:8px 16px;align-items:center}
.item h3{margin:0;font-size:13px;font-weight:600} .meta{color:var(--muted);font-size:12px}
.actions{display:flex;gap:6px;flex-wrap:wrap}
.btn{background:var(--field);border:1px solid var(--line);border-radius:999px;padding:6px 14px;cursor:pointer;font-size:12px;font-weight:500;color:var(--ink);transition:background .15s,transform .15s}
.btn:hover{background:var(--row-hot);transform:translateY(-1px)} .btn.danger{color:var(--bad)} .btn.danger.armed{background:var(--bad);border-color:transparent;color:#fff}
.btn:disabled{opacity:.5;cursor:default;transform:none}
pre{grid-column:1/-1;margin:0;background:var(--field);border:1px solid var(--line);border-radius:var(--r-sm);padding:10px;font-size:11px;overflow:auto;max-height:260px}
.tag{font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:var(--field);border:1px solid var(--line);color:var(--muted);margin-left:6px;vertical-align:2px}
.tag.live{color:var(--bad);background:var(--bad-bg);border-color:transparent}
.player .cam{width:100%}
.controls{display:flex;align-items:center;gap:10px;margin-top:12px}
.controls input{flex:1;accent-color:var(--accent)}
.empty-list{color:var(--muted);text-align:center;padding:28px}
.chainhead{display:flex;flex-wrap:wrap;gap:12px 24px;align-items:center;justify-content:space-between}
.chainhead a,.chain a{color:var(--accent);text-decoration:none} .chainhead a:hover,.chain a:hover{text-decoration:underline}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.wsdot{font-size:12px;font-weight:600;color:var(--muted)} .wsdot.on{color:var(--ok)} .wsdot.on::first-letter{animation:blink 1.4s infinite}
.chain{display:grid;gap:0}
.crow{display:grid;grid-template-columns:auto 1fr auto;gap:4px 12px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}
.crow:first-child{border-top:0}
.crow .when{color:var(--muted);font-size:12px;white-space:nowrap}
.crow .what{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.crow .st{font-size:12px;white-space:nowrap} .st.ok{color:var(--ok)} .st.wait{color:var(--warn)} .st.bad{color:var(--bad)}
.crow .res{grid-column:1/-1;font-size:12px;background:var(--field);border:1px solid var(--line);border-radius:var(--r-sm);padding:10px;display:grid;gap:4px}
.crow .res b.ok{color:var(--ok)} .crow .res b.bad{color:var(--bad)}
.crow.fresh{animation:fresh 2.5s ease-out}
@keyframes fresh{from{background:var(--ok-bg)}to{background:transparent}}
.kind{font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:var(--field);border:1px solid var(--line);color:var(--muted);margin-right:6px}
.drop{display:block;background:var(--field);border:1.5px dashed var(--track);border-radius:var(--r);padding:22px;text-align:center;color:var(--muted);cursor:pointer}
.drop.over{border-color:var(--accent);color:var(--text)}
.caveat{font-size:13px;color:var(--muted)} .caveat p{margin:6px 0 0}
@media (max-width:560px){.crow{grid-template-columns:1fr auto}.crow .when{grid-column:1/-1}}
#toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:var(--glass-strong);border:1px solid var(--glass-line);border-radius:999px;padding:10px 18px;font-size:12px;font-weight:500;box-shadow:var(--glass-shadow);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);max-width:calc(100% - 32px)}
</style>
<header><div class="left"><h1 class="glass">🦉 Barn Owl <span class="muted" style="font-weight:500">admin</span></h1>
<nav class="glass" role="tablist"><button role="tab" id="tab-live" aria-selected="true">Live</button><button role="tab" id="tab-recs" aria-selected="false">Recordings</button><button role="tab" id="tab-vids" aria-selected="false">Videos (15 fps)</button><button role="tab" id="tab-act" aria-selected="false">Activity</button><button role="tab" id="tab-chain" aria-selected="false">Solana</button></nav></div>
<div class="right glass"><span id="status">Connecting…</span><div class="theme" id="theme" role="group" aria-label="Theme"><button data-t="day" title="Day">☀︎</button><button data-t="night" title="Night">☾</button></div><a href="api/login?logout">Sign out</a></div></header>
<div class="glass" id="totals" aria-live="polite">Loading totals…</div>
<main>
<div class="view" id="live">
<section class="card cam"><span class="empty" id="empty">Waiting for camera…</span><img id="img" alt="Live camera view"><img id="stream" alt="Live camera view, 15 fps" hidden>
<span class="pill recdot badge" id="recbadge" hidden></span>
<div class="tools"><span class="pill" id="age"></span><button class="pill" id="recbtn">● Record</button><button class="pill" id="rot" title="Rotate view">↻ Rotate</button></div></section>
<div class="camctl">
<span class="label">View</span><div class="seg" id="fps"><button data-v="1">1 fps</button><button data-v="15">15 fps</button></div>
<span class="label">Zoom</span><div class="seg" id="zoom"><button data-v="1">1×</button><button data-v="1.5">1.5×</button><button data-v="2">2×</button><button data-v="2.5">2.5×</button></div>
</div>
<div class="row">
<section class="card"><div class="label">PIR motion sensor (GPIO23)</div><div class="big" id="pir">—</div><div class="sub" id="last"></div></section>
<section class="card"><div class="toggle"><div><div class="label">IR light (GPIO4)</div><div class="big" id="irtxt">—</div><div class="sub" id="irsub"></div></div>
<button class="switch" id="ir" role="switch" aria-checked="false" aria-label="IR light"></button></div></section>
</div>
</div>
<div class="view" id="recs" hidden>
<section class="card"><div class="label">MongoDB storage (free tier)</div><div id="storage">—</div><div class="bar"><i id="storagebar" style="width:0"></i></div></section>
<section class="card player" id="player" hidden><div class="toggle"><h3 id="ptitle" style="margin:0"></h3><button class="btn" id="pclose">Close</button></div>
<div class="cam" style="margin-top:12px"><img id="pimg" alt="Recorded frame"><span class="empty" id="pempty"></span></div>
<div class="controls"><button class="btn" id="pplay">▶ Play</button><input type="range" id="pseek" min="0" value="0"><span class="meta" id="ppos"></span></div></section>
<div class="list" id="list"><div class="card empty-list">Loading…</div></div>
</div>
<div class="view" id="vids" hidden><div class="list" id="vlist"><div class="card empty-list">Loading…</div></div></div>
<div class="view" id="act" hidden>
<div class="camctl"><span class="label">Range</span><div class="seg" id="range"><button data-v="15">15 min</button><button data-v="60">1 h</button><button data-v="360">6 h</button><button data-v="1440">24 h</button><button data-v="10080">7 d</button></div></div>
<div class="tiles" id="tiles"></div>
<section class="card chart"><div class="label">Motion: share of each <span class="bk">minute</span> the PIR saw movement</div><div id="c-motion"></div></section>
<section class="card chart"><div class="label">Rat detections per <span class="bk">minute</span> (from the model)</div><div id="c-det"></div></section>
<section class="card chart"><div class="label">Pi CPU temperature (°C)</div><div id="c-temp"></div></section>
<section class="card"><div class="label">Recent motion events</div><div id="events"></div></section>
<div class="powered" id="powered"></div>
</div>
<div class="view" id="chain" hidden>
<section class="card"><div class="chainhead"><div><div class="label">Tamper-evident log on Solana <span id="cluster"></span></div><div class="big" id="ccount">—</div><div class="sub" id="csub"></div></div>
<div style="text-align:right"><div class="wsdot" id="wsdot">○ Not connected</div><div class="sub">Anchor key <a class="mono" id="caddr" target="_blank" rel="noopener"></a></div><div class="sub"><span id="cbal"></span> <button class="btn" id="airdrop" hidden>Airdrop 1 SOL</button></div></div></div></section>
<section class="card" id="coff" hidden><div class="label">Solana is not set up</div><div class="sub">Set SOLANA_ANCHOR_KEY on the server (see HANDOFF-solana.md). Nothing is anchored until then.</div></section>
<section class="card"><div class="toggle"><div class="label" style="margin:0">Live chain log: new rows turn ✓ the moment Solana confirms them (your browser watches the chain directly)</div></div><div class="chain" id="clist"><div class="empty-list">Loading…</div></div></section>
<section class="card"><div class="label">Check a downloaded clip</div><label class="drop" id="drop"><input type="file" id="dropfile" accept=".mjpeg,video/*" hidden>Drop an original MJPEG here (Videos tab → ⬇ Original MJPEG), or click to pick one. It's hashed in your browser and checked against the chain.</label><div id="dropres" style="margin-top:10px"></div></section>
<section class="card caveat"><div class="label" style="margin:0">What this proves, and what it doesn't</div>
<p>✓ A detection or recording hasn't been changed or deleted since it was anchored, and it was anchored by this node's key at the time shown on chain.</p>
<p>✗ It doesn't prove a rat was really there. A false alarm gets anchored too, and stays visible; that's the point: no one can quietly delete bad calls or add fake ones later.</p></section>
</div>
</main>
<div id="toast" hidden></div>
<script>
const $ = id => document.getElementById(id)
function setTheme(t) { document.documentElement.dataset.theme = t; for (const b of $('theme').children) b.setAttribute('aria-pressed', b.dataset.t === t); try { localStorage.setItem('owl-theme', t) } catch (e) {} }
setTheme(document.documentElement.dataset.theme || 'day')
for (const b of $('theme').children) b.onclick = () => setTheme(b.dataset.t)
let since = '', timer, pending = null, rot = 0, tab = 'live', rec = null, recBusy = false, lastList = 0, fps = 1, zoom = null
// The 15 fps view is a stream held open by the droplet; Vercel can't do that.
const canStream = !location.hostname.endsWith('vercel.app')
try { rot = +localStorage.getItem('rot') || 0; fps = canStream && localStorage.getItem('fps') === '15' ? 15 : 1 } catch {}
const applyRot = () => { for (const i of [$('img'), $('stream'), $('pimg')]) i.style.transform = 'rotate(' + rot + 'deg)' + (rot % 180 ? ' scale(.75)' : '') }
applyRot()
$('rot').onclick = () => { rot = (rot + 90) % 360; applyRot(); try { localStorage.setItem('rot', rot) } catch {} }

function pressed(seg, v) { for (const b of $(seg).children) b.setAttribute('aria-pressed', +b.dataset.v === v) }
// Show the 15 fps stream only while the Live tab is visible; otherwise close
// it so the Pi stops uploading.
function syncStream() {
  const on = fps === 15 && tab === 'live' && !document.hidden
  const s = $('stream')
  if (on && !s.getAttribute('src')) { s.src = 'api/stream?t=' + Date.now(); $('empty').hidden = false; $('empty').textContent = 'Starting 15 fps…' }
  if (!on && s.getAttribute('src')) { s.removeAttribute('src') }
  s.hidden = !on; $('img').hidden = on
}
$('stream').onload = () => { $('empty').hidden = true }
$('stream').onerror = () => { if (fps === 15) setTimeout(() => { $('stream').removeAttribute('src'); syncStream() }, 2000) }
for (const b of $('fps').children) {
  if (+b.dataset.v === 15 && !canStream) { b.disabled = true; b.title = '15 fps works on barn-owl.tech (Vercel can only relay 1 fps)' }
  b.onclick = () => { fps = +b.dataset.v; pressed('fps', fps); try { localStorage.setItem('fps', fps) } catch {}; syncStream(); poll() }
}
pressed('fps', fps)
for (const b of $('zoom').children) b.onclick = async () => {
  const r = await fetch('api/cam', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ zoom: +b.dataset.v }) })
  const d = await r.json()
  if (!r.ok) return toast(d.error || 'Could not change zoom')
  zoom = d.zoom; pressed('zoom', zoom); toast('Zoom ' + zoom + '× (the camera restarts, ~2 s)')
}

const ago = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : Math.round(s / 3600) + 'h ago' }
const clock = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') }
const mb = b => b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB'
const when = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 4000) }

function setTab(t) {
  tab = t
  for (const k of ['live', 'recs', 'vids', 'act', 'chain']) { $('tab-' + k).setAttribute('aria-selected', t === k); $(k).hidden = t !== k }
  if (t === 'recs') loadList(); else stopPlayer()
  if (t === 'act') loadActivity()
  if (t === 'chain') loadChain()
  syncChainWs()
  if (t === 'vids') loadVideos(); else for (const v of document.querySelectorAll('#vlist video')) v.pause()
  syncStream()
  try { localStorage.setItem('tab', t) } catch {}
  poll()
}
$('tab-live').onclick = () => setTab('live'); $('tab-recs').onclick = () => setTab('recs'); $('tab-vids').onclick = () => setTab('vids'); $('tab-act').onclick = () => setTab('act'); $('tab-chain').onclick = () => setTab('chain')

function render(d) {
  document.body.classList.toggle('offline', !d.online)
  const st = $('status'); st.textContent = d.online ? 'Pi online' : 'Pi offline'; st.className = d.online ? 'on' : 'off'
  const wasRec = rec; rec = d.recording
  if (!recBusy) {
    $('recbtn').textContent = rec ? '■ Stop' : '● Record'; $('recbtn').className = 'pill' + (rec ? ' rec' : '')
  }
  $('recbadge').hidden = !rec
  if (d.zoom !== zoom) { zoom = d.zoom; pressed('zoom', zoom) }
  for (const b of $('zoom').children) { b.disabled = !!rec; b.title = rec ? 'Zoom is locked while recording' : '' }
  if (rec) $('recbadge').textContent = '● REC ' + clock((d.now - rec.startedAt) / 1000)
  if (tab === 'recs' && (!!wasRec !== !!rec || (rec && Date.now() - lastList > 5000))) loadList()
  if (tab === 'vids' && Date.now() - lastList > 8000) loadVideos()
  if (d.frame) { $('img').src = 'data:image/jpeg;base64,' + d.frame; $('empty').hidden = true; since = d.frameTs }
  $('age').textContent = fps === 15 ? '15 fps live' : d.frameTs ? 'frame ' + ago(d.now - d.frameTs) : ''
  const s = d.state
  if (!s) return
  $('pir').textContent = s.pir ? 'Motion' : 'Clear'; $('pir').className = 'big ' + (s.pir ? 'motion' : 'clear')
  $('last').textContent = s.lastMotion ? 'Last motion ' + ago(d.now - s.lastMotion) : 'No motion since the Pi started'
  const ir = pending ?? s.ir
  if (pending !== null && s.ir === pending) pending = null
  $('ir').setAttribute('aria-checked', ir); $('ir').disabled = pending !== null
  $('irtxt').textContent = pending !== null ? (pending ? 'Turning on…' : 'Turning off…') : ir ? 'On' : 'Off'
  $('irsub').textContent = s.ir && s.irLeft != null ? 'Auto-off in ' + Math.ceil(s.irLeft) + 's (overheat guard)' : 'Turns itself off after a while to avoid overheating'
}

async function poll() {
  clearTimeout(timer)
  try {
    const r = await fetch('api/state?live=' + (tab === 'live' ? 1 : 0) + (tab === 'live' && fps === 15 ? '&fast=1' : '') + '&since=' + encodeURIComponent(since), { cache: 'no-store' })
    if (r.status === 401) return location.reload()
    render(await r.json())
  } catch { document.body.classList.add('offline'); $('status').textContent = 'No connection'; $('status').className = 'off' }
  if (!document.hidden) timer = setTimeout(poll, tab === 'live' ? 1000 : 3000)
}

$('ir').onclick = async () => {
  pending = $('ir').getAttribute('aria-checked') !== 'true'
  $('ir').disabled = true
  await fetch('api/ir', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: pending }) })
  setTimeout(() => { if (pending !== null) { pending = null; poll() } }, 20000) // give up waiting if the Pi never applies it
  poll()
}

$('recbtn').onclick = async () => {
  if (recBusy) return
  recBusy = true; $('recbtn').disabled = true
  const action = rec ? 'stop' : 'start'
  $('recbtn').textContent = action === 'start' ? 'Starting…' : 'Saving…'
  try {
    const r = await fetch('api/record', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) })
    const d = await r.json()
    rec = d.recording
    loadTotals(); setTimeout(loadTotals, 4000)
    if (action === 'stop' && d.saved) toast('Saved recording: ' + d.saved.frameCount + ' frames, ' + clock(d.saved.durationSec) + '. See the Recordings tab.')
    if (action === 'start') toast('Recording… press Stop to save it.')
  } catch { toast('Could not ' + action + ' recording') }
  recBusy = false; $('recbtn').disabled = false
  poll()
}

// ---- Totals bar ----
const dur = s => { s = Math.round(s || 0); return s < 60 ? s + ' s' : s < 3600 ? Math.floor(s / 60) + ' min ' + (s % 60) + ' s' : (s / 3600).toFixed(1) + ' h' }
async function loadTotals() {
  let d
  try { d = await (await fetch('api/recordings?summary=1', { cache: 'no-store' })).json() } catch { return }
  const t = d.totals; if (!t) return
  const n = x => Math.round(x || 0).toLocaleString()
  $('totals').innerHTML = ''
  const part = (label, html) => { const s = document.createElement('span'); s.innerHTML = label + ' ' + html; $('totals').append(s) }
  part('Recordings', '<b>' + n(t.recordings) + '</b> · <b>' + dur(t.seconds) + '</b>')
  part('Pi (15 fps originals)', '<b>' + n(t.piFrames) + '</b> frames · <b>' + dur(t.piSeconds) + '</b> · ' + mb(t.piBytes))
  part('MongoDB (1 fps previews)', '<b>' + n(t.mongoFrames) + '</b> frames · <b>' + dur(t.seconds) + '</b> · ' + mb(t.mongoBytes) + (d.storage ? ' of ' + mb(d.storage.limitBytes) : ''))
}

// ---- Videos tab: the Pi's 15 fps recordings, uploaded to the droplet ----
async function loadVideos() {
  lastList = Date.now()
  const list = $('vlist')
  if (!canStream) {
    list.innerHTML = '<div class="card empty-list">The 15 fps videos are stored on the droplet. Open <a style="color:var(--accent)" href="https://barn-owl.tech">barn-owl.tech</a> to watch them.</div>'
    return
  }
  let d
  try { d = await (await fetch('api/recordings', { cache: 'no-store' })).json() } catch { return }
  const recs = d.recordings.filter(r => r.pi || r.video)
  const ready = recs.filter(r => r.video?.status === 'ready')
  const bar = document.createElement('section'); bar.className = 'card toggle'
  bar.innerHTML = '<div><h3 style="margin:0">All 15 fps videos</h3><div class="meta"></div></div><a class="btn" style="text-decoration:none" href="api/videos-zip">⬇ Download all (.zip)</a>'
  bar.querySelector('.meta').textContent = ready.length + ' videos · originals + MP4s + frame times + manifest.csv · ' + mb(ready.reduce((n, r) => n + (r.video.mjpegBytes || 0) + (r.video.mp4Bytes || 0), 0))
  if (!ready.length) bar.querySelector('a').remove()
  const playing = new Set([...list.querySelectorAll('video')].filter(v => !v.paused).map(v => v.dataset.id))
  if (!recs.length) { list.innerHTML = '<div class="card empty-list">No 15 fps videos yet. Record something on the Live tab; it appears here a few seconds after you press Stop.</div>'; return }
  // Don't rebuild a card whose video is playing.
  const keep = new Map([...list.children].filter(c => playing.has(c.dataset.id)).map(c => [c.dataset.id, c]))
  list.replaceChildren(bar, ...recs.map(r => keep.get(r._id) || videoCard(r)))
}

// Only fetch a video's first frame once its card scrolls into view, so a long
// list doesn't open dozens of downloads at once.
const lazy = new IntersectionObserver(entries => {
  for (const e of entries) if (e.isIntersecting) { e.target.preload = 'metadata'; lazy.unobserve(e.target) }
}, { rootMargin: '200px' })

function videoCard(r) {
  const el = document.createElement('section'); el.className = 'card vid'; el.dataset.id = r._id
  const h = document.createElement('h3'); h.style.margin = '0'; h.textContent = when(r.startedAt)
  const v = r.video || {}
  const m = document.createElement('div'); m.className = 'meta'
  const frames = v.frames ?? r.pi?.frames ?? 0, fps = v.fps ?? r.pi?.fps ?? 15
  m.textContent = dur(frames / (fps || 15)) + ' · ' + frames + ' frames at ' + fps + ' fps · ' + (r.zoom || 1) + '× zoom'
  el.append(h, m)
  if (v.status === 'ready') {
    const video = document.createElement('video'); video.controls = true; video.preload = 'none'; video.playsInline = true
    video.dataset.id = r._id; video.src = 'api/video?id=' + r._id + '&kind=mp4'
    lazy.observe(video)
    const turn = 'rotate(' + rot + 'deg)' + (rot % 180 ? ' scale(.75)' : '')
    video.style.transform = turn
    // Side by side: the 15 fps original and the 1 fps preview MongoDB kept for
    // the same moment. Both start when the recording started, so video time t
    // maps to the preview taken at first-preview time + t.
    const pair = document.createElement('div'); pair.className = 'pair'
    const left = document.createElement('figure'), right = document.createElement('figure')
    const lcap = document.createElement('figcaption'), rcap = document.createElement('figcaption')
    const box = document.createElement('div'); box.className = 'prev'
    const pimg = document.createElement('img'); pimg.alt = '1 fps preview frame'; pimg.style.transform = turn; pimg.hidden = true
    const note = document.createElement('span'); note.textContent = r.frameCount ? 'Press play or scrub' : 'No 1 fps previews for this recording'
    box.append(pimg, note)
    left.append(video, lcap); right.append(box, rcap); pair.append(left, right)
    lcap.innerHTML = '<span>15 fps original (Pi)</span><span></span>'
    rcap.innerHTML = '<span>1 fps preview (MongoDB)</span><span></span>'
    let previews = null, shown = -1
    const sync = async () => {
      const t = video.currentTime || 0
      lcap.lastChild.textContent = 'frame ' + Math.min(frames, Math.floor(t * fps) + 1) + ' / ' + frames + ' · ' + t.toFixed(1) + ' s'
      if (!r.frameCount) return
      previews ??= fetch('api/frame?rec=' + r._id, { cache: 'no-store' }).then(x => x.json())
      const list = await previews
      if (!list.length) return
      const target = list[0].ts + t * 1000
      let i = 0; while (i + 1 < list.length && list[i + 1].ts <= target) i++
      if (i !== shown) { shown = i; pimg.src = 'api/frame?id=' + list[i].id; pimg.hidden = false; note.hidden = true }
      rcap.lastChild.textContent = 'frame ' + (i + 1) + ' / ' + list.length + ' · ' + ((list[i].ts - list[0].ts) / 1000).toFixed(1) + ' s'
    }
    video.addEventListener('timeupdate', sync); video.addEventListener('seeked', sync); video.addEventListener('loadedmetadata', sync)
    const dl = document.createElement('div'); dl.className = 'dl'
    for (const [kind, label, size] of [['mp4', 'MP4', v.mp4Bytes], ['mjpeg', 'Original MJPEG (for training)', v.mjpegBytes], ['txt', 'Frame times (.txt)', null]]) {
      const a = document.createElement('a'); a.href = 'api/video?id=' + r._id + '&kind=' + kind + '&download=1'
      a.textContent = '⬇ ' + label + (size ? ' · ' + mb(size) : ''); dl.append(a)
    }
    el.append(pair, dl)
  } else {
    const p = document.createElement('div'); p.className = 'meta'; p.style.marginTop = '10px'
    p.textContent = r.status === 'recording' ? 'Recording… it uploads when you press Stop.'
      : v.status === 'converting' ? 'Uploaded; converting to MP4…'
      : v.status === 'failed' ? 'Conversion failed: ' + (v.error || 'unknown error')
      : 'Waiting for the Pi to upload it (it retries until the Pi is online).'
    el.append(p)
  }
  return el
}

// ---- Activity tab: Tiger Data (TimescaleDB) time series ----
let range = 60
try { range = +localStorage.getItem('range') || 60 } catch {}
for (const b of $('range').children) b.onclick = () => { range = +b.dataset.v; pressed('range', range); try { localStorage.setItem('range', range) } catch {}; loadActivity() }
pressed('range', range)
const hhmm = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const dayhm = t => new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })

async function loadActivity() {
  let d
  try {
    const r = await fetch('api/activity?range=' + range, { cache: 'no-store' })
    d = await r.json()
    if (!r.ok) throw new Error(d.error)
  } catch (e) { $('tiles').innerHTML = ''; $('powered').textContent = 'Activity unavailable: ' + (e.message || 'network error'); return }
  for (const el of document.querySelectorAll('#act .bk')) el.textContent = d.bucket
  const T = d.totals, C = d.compression
  const saved = C.before ? Math.round((1 - C.after / C.before) * 100) : null
  const tiles = [
    ['Readings stored', T.readings.toLocaleString(), 'one per Pi check-in · ' + mb(T.readings_bytes)],
    ['Compression', saved == null ? '—' : saved + '% smaller', saved == null ? 'chunks compress 1 h after they close' : mb(C.before) + ' → ' + mb(C.after) + ' · ' + C.compressed_chunks + '/' + C.chunks + ' chunks'],
    ['Motion events', T.motion_events.toLocaleString(), 'stretches of PIR motion'],
    ['Rat detections', T.detections.toLocaleString(), T.recordings_with_detections + ' of ' + T.recordings + ' recordings'],
    ['Query time', d.queryMs + ' ms', '5 queries, from continuous aggregates'],
  ]
  $('tiles').replaceChildren(...tiles.map(([k, v, sub]) => {
    const el = document.createElement('section'); el.className = 'card tile'
    el.innerHTML = '<div class="label"></div><div class="v"></div><div class="s"></div>'
    el.children[0].textContent = k; el.children[1].textContent = v; el.children[2].textContent = sub; return el
  }))
  const step = d.bucket === 'hour' ? 3600e3 : 60e3
  const end = Math.floor(Date.now() / step) * step, start = end - range * 60e3 + step
  const fmtT = d.bucket === 'hour' ? dayhm : hhmm
  bars($('c-motion'), d.series.map(p => [p.t, p.motion]), start, end, step, { max: 1, ticks: [0, 0.5, 1], fmt: v => Math.round(v * 100) + '%', fmtT, tip: (t, v) => fmtT(t) + ' · motion ' + Math.round(v * 100) + '% of the ' + d.bucket, none: 'No readings in this range' })
  const dmax = Math.max(1, ...d.detections.map(p => p.n))
  bars($('c-det'), d.detections.map(p => [p.t, p.n, p.max]), start, end, step, { max: dmax, ticks: [0, dmax], fmt: v => String(Math.round(v)), fmtT, tip: (t, v, x) => fmtT(t) + ' · ' + v + ' detection' + (v === 1 ? '' : 's') + (x != null ? ' · best ' + Math.round(x * 100) + '%' : ''), none: 'No detections yet. The model posts them to /api/detections.' })
  line($('c-temp'), d.series.filter(p => p.cpu != null).map(p => [p.t, p.cpu]), start, end, { fmtT, none: 'No temperature readings in this range' })
  const ev = d.events
  $('events').innerHTML = ev.length ? '' : '<div class="meta">No motion in this range.</div>'
  if (ev.length) {
    const tb = document.createElement('table'); tb.className = 'ev'
    tb.innerHTML = '<thead><tr><th>Started</th><th>Lasted</th><th>During recording</th></tr></thead><tbody></tbody>'
    for (const e of ev) {
      const tr = document.createElement('tr')
      for (const txt of [fmtT(e.start), e.end ? dur((e.end - e.start) / 1000) : 'ongoing', e.recording ? 'yes' : '—']) { const td = document.createElement('td'); td.textContent = txt; tr.append(td) }
      tb.tBodies[0].append(tr)
    }
    $('events').append(tb)
  }
  $('powered').textContent = 'Time series in Tiger Data (TimescaleDB): readings, motion_events and detections are hypertables; the charts read the activity_1m / activity_1h / detections_1m continuous aggregates; readings compress after an hour. Media and live state stay in MongoDB.'
}

// Bars on a time axis: one per bucket, 4px-rounded tops, 2px gaps, hover tooltip.
function bars(host, pts, start, end, step, o) {
  const W = host.clientWidth || 800, H = 160, L = 36, B = 20, n = Math.round((end - start) / step) + 1
  const bw = (W - L) / n, byT = new Map(pts.map(p => [p[0], p]))
  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="bar chart">'
  for (const v of o.ticks) { const y = (H - B) * (1 - v / o.max); svg += '<line class="grid" x1="' + L + '" x2="' + W + '" y1="' + y + '" y2="' + y + '"/><text class="axis" x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + o.fmt(v) + '</text>' }
  for (let i = 0; i < n; i++) {
    const t = start + i * step, p = byT.get(t); if (!p || !p[1]) continue
    const h = Math.max(2, (H - B) * Math.min(1, p[1] / o.max)), x = L + i * bw + 1, w = Math.max(1, bw - 2), y = H - B - h, r = Math.min(4, w / 2)
    svg += '<path class="bar" data-i="' + i + '" d="M' + x + ',' + (H - B) + 'V' + (y + r) + 'q0,-' + r + ' ' + r + ',-' + r + 'H' + (x + w - r) + 'q' + r + ',0 ' + r + ',' + r + 'V' + (H - B) + 'Z"/>'
  }
  for (const f of [0, 0.5, 1]) { const t = start + f * (end - start); svg += '<text class="axis" x="' + (L + f * (W - L - bw) + bw / 2) + '" y="' + (H - 4) + '" text-anchor="' + (f === 0 ? 'start' : f === 1 ? 'end' : 'middle') + '">' + o.fmtT(t) + '</text>' }
  if (!pts.some(p => p[1])) svg += '<text class="none" x="' + ((W + L) / 2) + '" y="' + ((H - B) / 2) + '" text-anchor="middle">' + o.none + '</text>'
  host.innerHTML = svg + '</svg>'
  const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; host.append(tip)
  host.onmousemove = e => {
    const r = host.getBoundingClientRect(), i = Math.floor(((e.clientX - r.left) * W / r.width - L) / bw), t = start + i * step, p = byT.get(t)
    for (const b of host.querySelectorAll('.bar.hot')) b.classList.remove('hot')
    if (i < 0 || i >= n || !p) { tip.hidden = true; return }
    host.querySelector('.bar[data-i="' + i + '"]')?.classList.add('hot')
    tip.hidden = false; tip.textContent = o.tip(t, p[1], p[2]); tip.style.left = (e.clientX - r.left) + 'px'; tip.style.top = (e.clientY - r.top) + 'px'
  }
  host.onmouseleave = () => { tip.hidden = true; for (const b of host.querySelectorAll('.bar.hot')) b.classList.remove('hot') }
}

// A 2px line on a time axis with a nearest-point tooltip.
function line(host, pts, start, end, o) {
  const W = host.clientWidth || 800, H = 160, L = 36, B = 20
  if (!pts.length) { host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '"><text class="none" x="' + ((W + L) / 2) + '" y="' + ((H - B) / 2) + '" text-anchor="middle">' + o.none + '</text></svg>'; return }
  const vs = pts.map(p => p[1]), lo = Math.floor(Math.min(...vs) - 1), hi = Math.ceil(Math.max(...vs) + 1)
  const X = t => L + (W - L) * (t - start) / (end - start), Y = v => (H - B) * (1 - (v - lo) / (hi - lo))
  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="line chart">'
  for (const v of [lo, hi]) svg += '<line class="grid" x1="' + L + '" x2="' + W + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text class="axis" x="' + (L - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + v + '°</text>'
  svg += '<path class="line" d="' + pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join('') + '"/>'
  for (const f of [0, 0.5, 1]) { const t = start + f * (end - start); svg += '<text class="axis" x="' + X(t) + '" y="' + (H - 4) + '" text-anchor="' + (f === 0 ? 'start' : f === 1 ? 'end' : 'middle') + '">' + o.fmtT(t) + '</text>' }
  host.innerHTML = svg + '<circle class="dot" r="4" fill="var(--accent)" stroke="var(--panel)" stroke-width="2" style="display:none"/></svg>'
  const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; host.append(tip)
  const dot = host.querySelector('.dot')
  host.onmousemove = e => {
    const r = host.getBoundingClientRect(), t = start + ((e.clientX - r.left) * W / r.width - L) / (W - L) * (end - start)
    let best = pts[0]; for (const p of pts) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p
    dot.setAttribute('cx', X(best[0])); dot.setAttribute('cy', Y(best[1])); dot.style.display = ''
    tip.hidden = false; tip.textContent = o.fmtT(best[0]) + ' · ' + best[1] + ' °C'
    tip.style.left = (X(best[0]) * r.width / W) + 'px'; tip.style.top = (Y(best[1]) * r.height / H) + 'px'
  }
  host.onmouseleave = () => { tip.hidden = true; dot.style.display = 'none' }
}

// ---- Recordings tab ----
async function loadList() {
  lastList = Date.now()
  let d
  try { d = await (await fetch('api/recordings', { cache: 'no-store' })).json() } catch { return }
  if (d.storage) {
    const pct = Math.min(100, d.storage.usedBytes / d.storage.limitBytes * 100)
    $('storage').textContent = mb(d.storage.usedBytes) + ' of ' + mb(d.storage.limitBytes) + ' used (' + pct.toFixed(1) + '%)'
    $('storagebar').style.width = Math.max(pct, 0.5) + '%'
  }
  const list = $('list'); list.replaceChildren()
  if (!d.recordings.length) { list.innerHTML = '<div class="card empty-list">No recordings yet. Press ● Record on the Live tab.</div>'; return }
  for (const r of d.recordings) list.append(item(r))
}

function item(r) {
  const el = document.createElement('section'); el.className = 'card item'
  const live = r.status === 'recording'
  const dur = live ? clock((Date.now() - r.startedAt) / 1000) : clock(r.durationSec || 0)
  const info = document.createElement('div')
  const h = document.createElement('h3'); h.textContent = when(r.startedAt)
  if (live) { const t = document.createElement('span'); t.className = 'tag live'; t.textContent = 'recording'; h.append(t) }
  if (r.endReason === 'time limit') { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'stopped at time limit'; h.append(t) }
  const m = document.createElement('div'); m.className = 'meta'; m.textContent = dur + ' · ' + (r.zoom || 1) + '× zoom · ' + r.frameCount + ' preview frames · ' + mb(r.bytes || 0)
  info.append(h, m)
  if (r.pi) {
    const p = document.createElement('div'); p.className = 'meta'
    p.textContent = 'On the Pi: ' + r.pi.frames + ' frames at ' + r.pi.fps + ' fps, ' + mb(r.pi.bytes) + (r.pi.done ? '' : ' (writing…)') + ' · ' + r.pi.file.split('/').pop()
    p.title = r.pi.file; info.append(p)
  }
  const act = document.createElement('div'); act.className = 'actions'
  const play = btn('▶ Play', () => openPlayer(r)); play.disabled = !r.frameCount
  const raw = btn('{ } Entry', () => { pre.hidden = !pre.hidden })
  const del = btn('Delete', async () => {
    if (!del.classList.contains('armed')) { del.classList.add('armed'); del.textContent = 'Confirm delete'; setTimeout(() => { del.classList.remove('armed'); del.textContent = 'Delete' }, 4000); return }
    del.disabled = true
    const res = await fetch('api/recordings?id=' + r._id, { method: 'DELETE' })
    if (res.ok) { if (playing.rec === r._id) closePlayer(); el.remove(); loadList() } else { toast((await res.json()).error || 'Delete failed'); del.disabled = false }
  }); del.classList.add('danger'); del.disabled = live
  act.append(play, raw, del)
  const pre = document.createElement('pre'); pre.hidden = true; pre.textContent = JSON.stringify(r, null, 2)
  el.append(info, act, pre)
  return el
}
function btn(label, fn) { const b = document.createElement('button'); b.className = 'btn'; b.textContent = label; b.onclick = fn; return b }

const playing = { rec: null, frames: [], i: 0, t: null, on: false }
async function openPlayer(r) {
  stopPlayer()
  Object.assign(playing, { rec: r._id, frames: [], i: 0 })
  $('player').hidden = false; $('ptitle').textContent = when(r.startedAt)
  $('pempty').textContent = 'Loading frames…'; $('pimg').removeAttribute('src')
  $('player').scrollIntoView({ behavior: 'smooth', block: 'start' })
  playing.frames = await (await fetch('api/frame?rec=' + r._id, { cache: 'no-store' })).json()
  $('pempty').textContent = playing.frames.length ? '' : 'No frames in this recording'
  $('pseek').max = Math.max(0, playing.frames.length - 1)
  show(0); if (playing.frames.length > 1) startPlayer()
}
function show(i) {
  const f = playing.frames[i]; if (!f) return
  playing.i = i; $('pimg').src = 'api/frame?id=' + f.id; $('pseek').value = i
  $('ppos').textContent = clock((f.ts - playing.frames[0].ts) / 1000) + ' / ' + clock((playing.frames.at(-1).ts - playing.frames[0].ts) / 1000)
  const next = playing.frames[i + 1]; if (next) new Image().src = 'api/frame?id=' + next.id
}
function step() {
  if (playing.i >= playing.frames.length - 1) return stopPlayer()
  const gap = playing.frames[playing.i + 1].ts - playing.frames[playing.i].ts
  playing.t = setTimeout(() => { show(playing.i + 1); step() }, Math.min(Math.max(gap, 100), 2000))
}
function startPlayer() { if (playing.i >= playing.frames.length - 1) show(0); playing.on = true; $('pplay').textContent = '❚❚ Pause'; step() }
function stopPlayer() { clearTimeout(playing.t); playing.on = false; $('pplay').textContent = '▶ Play' }
function closePlayer() { stopPlayer(); playing.rec = null; $('player').hidden = true }
$('pplay').onclick = () => playing.on ? stopPlayer() : startPlayer()
$('pseek').oninput = e => { stopPlayer(); show(+e.target.value) }
$('pclose').onclick = closePlayer

// ---- Solana tab: hashes of detections and recordings, anchored on chain ----
// The list comes from the server; the ✓ comes from the chain: this page
// subscribes to Solana itself and reads transactions straight from its RPC.
const chain = { cfg: null, rows: new Map(), ws: null, wsTry: 0 }
const explorer = (kind, v) => 'https://explorer.solana.com/' + kind + '/' + v + (chain.cfg && chain.cfg.cluster !== 'mainnet-beta' ? '?cluster=' + chain.cfg.cluster : '')
const short = h => h ? h.slice(0, 6) + '…' + h.slice(-6) : ''
const memoHash = m => m.split(' ').pop()

async function loadChain() {
  let d
  try { const r = await fetch('api/solana', { cache: 'no-store' }); if (r.status === 401) return location.reload(); d = await r.json() } catch { return }
  chain.cfg = d
  $('coff').hidden = d.enabled
  $('cluster').textContent = '(' + d.cluster + ')'
  if (!d.enabled) { $('clist').innerHTML = '<div class="empty-list">Not set up yet.</div>'; $('ccount').textContent = '—'; return }
  $('caddr').textContent = short(d.address); $('caddr').href = explorer('address', d.address); $('caddr').title = d.address
  $('cbal').textContent = d.balance == null ? '' : d.balance.toFixed(4) + ' SOL for fees'
  $('airdrop').hidden = d.cluster !== 'devnet'
  const n = (kind, sts) => d.counts.filter(c => (!kind || c.kind === kind) && sts.includes(c.status)).reduce((a, c) => a + c.n, 0)
  const flying = n(null, ['pending', 'sending', 'sent']), failed = n(null, ['failed'])
  $('ccount').textContent = n(null, ['confirmed']).toLocaleString() + ' anchored'
  $('csub').textContent = n('det', ['confirmed']) + ' detections · ' + n('rec', ['confirmed']) + ' recordings' + (flying ? ' · ' + flying + ' in flight' : '') + (failed ? ' · ' + failed + ' failed' : '')
  for (const a of d.anchors) {
    const old = chain.rows.get(a._id)
    if (old && old.status !== 'confirmed' && a.status === 'confirmed' && !old.live) old.fresh = true
    chain.rows.set(a._id, Object.assign(old || {}, a, old && old.live ? { status: 'confirmed' } : {}))
  }
  // Rows the chain showed before the server listed them: drop once listed.
  for (const [id, r] of chain.rows) {
    const real = r.fromChain && [...chain.rows.values()].find(a => !a.fromChain && a.sig === r.sig && a.hash === r.hash)
    if (real) { real.live = true; real.status = 'confirmed'; if (r.el) r.el.remove(); chain.rows.delete(id) }
  }
  renderChain()
  syncChainWs()
}

function renderChain() {
  const list = $('clist')
  const rows = [...chain.rows.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 100)
  if (!rows.length) { list.innerHTML = '<div class="empty-list">Nothing anchored yet. Record a clip on the Live tab: after you press Stop and the Pi uploads it, its hash lands here. Detections from the model are anchored as they arrive.</div>'; return }
  if (list.querySelector('.empty-list')) list.replaceChildren()
  let prev = null
  for (const a of rows) {
    a.el ??= chainRow(a)
    updateRow(a)
    if (prev ? prev.nextSibling !== a.el : list.firstChild !== a.el) prev ? prev.after(a.el) : list.prepend(a.el)
    prev = a.el
  }
  while (prev && prev.nextSibling) prev.nextSibling.remove()
}

function chainRow(a) {
  const el = document.createElement('div'); el.className = 'crow'
  const w = document.createElement('span'); w.className = 'when'
  const what = document.createElement('div'); what.className = 'what'
  const right = document.createElement('div'); right.className = 'actions'; right.style.alignItems = 'center'
  const st = document.createElement('span'); st.className = 'st'
  const link = document.createElement('a'); link.className = 'btn'; link.target = '_blank'; link.rel = 'noopener'; link.style.color = 'var(--text)'; link.textContent = 'Explorer ↗'
  const ver = btn('Verify', () => verifyAnchor(a))
  right.append(st, link, ver); el.append(w, what, right)
  a.parts = { w, what, st, link, ver }
  return el
}

function updateRow(a) {
  const p = a.parts
  p.w.textContent = when(a.createdAt)
  const tag = document.createElement('span'); tag.className = 'kind'; tag.textContent = a.kind === 'rec' ? 'Recording' : 'Detection'
  const h = document.createElement('span'); h.className = 'mono'; h.textContent = short(a.hash); h.title = a.memo
  const extra = document.createElement('span'); extra.className = 'meta'
  extra.textContent = a.kind === 'det' && a.ref ? ' · ' + a.ref.split('/')[2] : a.kind === 'rec' ? ' · 15 fps original' : ''
  p.what.replaceChildren(tag, h, extra)
  const s = a.status
  p.st.className = 'st ' + (s === 'confirmed' ? 'ok' : s === 'failed' ? 'bad' : 'wait')
  p.st.textContent = s === 'confirmed' ? (a.live ? '✓ confirmed live' : '✓ confirmed') : s === 'failed' ? '✗ failed' : s === 'sent' ? '… confirming' : '… sending'
  p.st.title = s === 'failed' ? a.error || '' : a.slot ? 'slot ' + a.slot : ''
  p.link.hidden = !a.sig; if (a.sig) p.link.href = explorer('tx', a.sig)
  p.ver.disabled = s !== 'confirmed' || !!a.fromChain
  if (a.fresh) { a.fresh = false; a.el.classList.remove('fresh'); void a.el.offsetWidth; a.el.classList.add('fresh') }
}

// A transaction that mentions our key just confirmed: mark its memos ✓.
function onChainTx(sig, memos, slot) {
  memos.forEach((memo, i) => {
    const hash = memoHash(memo)
    const hit = [...chain.rows.values()].filter(r => r.hash === hash && (r.sig === sig || r.status !== 'confirmed'))
    if (hit.length) for (const r of hit) Object.assign(r, { status: 'confirmed', sig, slot, live: true, fresh: true })
    else chain.rows.set('chain:' + sig + ':' + i, { _id: 'chain:' + sig + ':' + i, fromChain: true, kind: memo.split(' ')[1], hash, memo, sig, slot, status: 'confirmed', live: true, fresh: true, createdAt: Date.now() })
  })
  renderChain()
}

function setWs(t, on) { $('wsdot').textContent = t; $('wsdot').className = 'wsdot' + (on ? ' on' : '') }
function syncChainWs() {
  const want = tab === 'chain' && !document.hidden && chain.cfg && chain.cfg.enabled
  if (!want) {
    if (chain.ws) { chain.ws.onclose = null; chain.ws.close(); chain.ws = null }
    setWs('○ Paused', false); return
  }
  if (chain.ws) return
  const ws = new WebSocket(chain.cfg.rpc.replace(/^http/, 'ws'))
  chain.ws = ws; setWs('○ Connecting to Solana…', false)
  ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'logsSubscribe', params: [{ mentions: [chain.cfg.address] }, { commitment: 'confirmed' }] }))
  ws.onmessage = e => {
    let m; try { m = JSON.parse(e.data) } catch { return }
    if (m.id === 1) { if (m.result != null) { chain.wsTry = 0; setWs('● Live: watching Solana ' + chain.cfg.cluster, true) } return }
    if (m.method !== 'logsNotification') return
    const v = m.params.result.value
    if (!v.err) onChainTx(v.signature, memosFrom(v.logs), m.params.result.context.slot)
  }
  ws.onclose = () => { chain.ws = null; setWs('○ Reconnecting…', false); setTimeout(syncChainWs, Math.min(30000, 1000 * 2 ** chain.wsTry++)) }
}

// Memo program logs look like: Program log: Memo (len 76): "owl1 det 3fa9…"
function memosFrom(logs) {
  const out = []
  for (const l of logs || []) {
    const i = l.indexOf('Memo (len ')
    const q = i < 0 ? -1 : l.indexOf('"', i)
    if (q >= 0) out.push(l.slice(q + 1, l.lastIndexOf('"')))
  }
  return out
}

// Reads a transaction straight from the Solana RPC, not through our server.
async function chainTx(sig) {
  try {
    const r = await fetch(chain.cfg.rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [sig, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }] }) })
    const d = await r.json(), t = d.result
    if (!t) return { ok: false, error: d.error ? d.error.message : 'not found on chain yet' }
    return { ok: !t.meta.err, error: t.meta.err ? JSON.stringify(t.meta.err) : '', slot: t.slot, blockTime: t.blockTime, signer: t.transaction.message.accountKeys[0], memos: memosFrom(t.meta.logMessages) }
  } catch (e) { return { ok: false, error: e.message } }
}

// One line of a result box: strings are plain text, [text, cls] is bold.
function resLine(box, ...parts) {
  const d = document.createElement('div')
  for (const x of parts) { const s = document.createElement(typeof x === 'string' ? 'span' : 'b'); s.textContent = typeof x === 'string' ? x : x[0]; if (typeof x !== 'string') s.className = x[1]; d.append(s) }
  box.append(d); return d
}
const chainLine = tx => 'On chain (read by your browser from Solana ' + chain.cfg.cluster + '): slot ' + tx.slot.toLocaleString() + (tx.blockTime ? ', ' + when(tx.blockTime * 1000) : '') + ', signed by ' + (tx.signer === chain.cfg.address ? 'this node’s key' : tx.signer)

async function verifyAnchor(a) {
  let box = a.el.querySelector('.res')
  if (!box) { box = document.createElement('div'); box.className = 'res'; a.el.append(box) }
  box.textContent = 'Checking…'; a.parts.ver.disabled = true
  try {
    const [srv, tx] = await Promise.all([fetch('api/solana?verify=' + a._id, { cache: 'no-store' }).then(r => r.json()), chainTx(a.sig)])
    box.replaceChildren()
    if (!tx.ok) { resLine(box, ['✗ ', 'bad'], 'Could not read the transaction from Solana: ' + tx.error); return }
    resLine(box, chainLine(tx))
    const memo = tx.memos.find(m => m === a.memo)
    if (!memo || tx.signer !== chain.cfg.address) { resLine(box, ['✗ ', 'bad'], 'That transaction does not carry this anchor from this node.'); return }
    const now = srv.now || {}
    if (now.ok === null || now.ok === undefined) resLine(box, now.detail || srv.error || 'Could not recompute the hash here.')
    else if (!now.ok) resLine(box, ['✗ Changed: ', 'bad'], now.detail)
    else if (now.hash === memoHash(memo)) resLine(box, ['✓ Unchanged since it was anchored. ', 'ok'], now.detail + ' hashes to ' + short(now.hash) + ', the same as on chain.')
    else {
      resLine(box, ['✗ Changed after it was anchored. ', 'bad'], now.detail + ' now hashes to ' + short(now.hash) + '; the chain says ' + short(memoHash(memo)) + '.')
      if (now.payload && now.anchored) {
        const was = JSON.parse(now.anchored), is = JSON.parse(now.payload)
        for (const k of Object.keys(was)) if (JSON.stringify(was[k]) !== JSON.stringify(is[k])) resLine(box, '   ' + k + ': was ' + JSON.stringify(was[k]) + ', now ' + JSON.stringify(is[k]))
      }
    }
  } catch (e) { box.textContent = 'Check failed: ' + e.message }
  finally { a.parts.ver.disabled = false }
}

// Drop-a-file check: the hash is computed here, in the browser.
async function checkFile(file) {
  const out = $('dropres'); out.replaceChildren()
  if (!chain.cfg || !chain.cfg.enabled) return resLine(out, 'Solana is not set up.')
  resLine(out, 'Hashing ' + file.name + ' (' + mb(file.size) + ') in your browser…')
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('')
  const d = await (await fetch('api/solana?hash=' + hash, { cache: 'no-store' })).json()
  out.replaceChildren(); resLine(out, 'SHA-256 ' + short(hash))
  const a = (d.anchors || []).find(x => x.status === 'confirmed') || (d.anchors || [])[0]
  if (!a) return resLine(out, ['✗ Not anchored. ', 'bad'], 'No anchor has this hash: either this file was never anchored, or it was changed afterwards (one changed byte changes the whole hash).')
  if (!a.sig) return resLine(out, ['… ', 'st wait'], 'Known, but not on chain yet (' + a.status + '). Try again in a few seconds.')
  const tx = await chainTx(a.sig)
  if (tx.ok && tx.signer === chain.cfg.address && tx.memos.some(m => memoHash(m) === hash)) {
    resLine(out, ['✓ Authentic. ', 'ok'], 'Byte-for-byte the ' + (a.kind === 'rec' ? 'recording' : 'item') + ' anchored ' + (tx.blockTime ? when(tx.blockTime * 1000) : '') + '.')
    resLine(out, chainLine(tx))
    const l = document.createElement('a'); l.href = explorer('tx', a.sig); l.target = '_blank'; l.rel = 'noopener'; l.textContent = 'See it on Solana Explorer ↗'; l.style.color = 'var(--accent)'; out.append(l)
  } else resLine(out, ['✗ ', 'bad'], 'The chain does not confirm this hash: ' + (tx.error || 'memo or signer mismatch'))
}
$('dropfile').onchange = e => { if (e.target.files[0]) checkFile(e.target.files[0]); e.target.value = '' }
$('drop').ondragover = e => { e.preventDefault(); $('drop').classList.add('over') }
$('drop').ondragleave = () => $('drop').classList.remove('over')
$('drop').ondrop = e => { e.preventDefault(); $('drop').classList.remove('over'); if (e.dataTransfer.files[0]) checkFile(e.dataTransfer.files[0]) }
$('airdrop').onclick = async () => {
  $('airdrop').disabled = true
  try {
    const r = await fetch('api/solana', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'airdrop' }) })
    const d = await r.json()
    toast(r.ok ? 'Airdrop requested. The balance updates within ~30 s.' : d.error)
  } catch { toast('Airdrop failed') }
  $('airdrop').disabled = false
}
setInterval(() => { if (tab === 'chain' && !document.hidden) loadChain() }, 4000)
document.addEventListener('visibilitychange', syncChainWs)

document.addEventListener('visibilitychange', () => { syncStream(); if (!document.hidden) poll() })
let saved = 'live'; try { saved = localStorage.getItem('tab') || 'live' } catch {}
setTab(['recs', 'vids', 'act', 'chain'].includes(saved) ? saved : 'live')
setInterval(() => { if (tab === 'act' && !document.hidden) loadActivity() }, 10000)
loadTotals(); setInterval(() => { if (!document.hidden) loadTotals() }, 10000)
</script></body></html>`

export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.send(isLoggedIn(req) ? DASH : LOGIN(req.query.err !== undefined))
}
