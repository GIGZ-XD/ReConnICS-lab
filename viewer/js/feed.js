// State feed: live WebSocket (default ws://localhost:8765/state, also serves the plant's --replay mode),
// a client-side replay of a recorded JSON/NDJSON file, or the built-in demo simulator.
//   ?mode=auto (default: live, falls back to demo, keeps retrying live) | live | demo | replay
//   ?ws=ws://host:port/state   ?replay=url-or-file.json (array or one message per line)
// Replayable sources (feed.py replay, ?replay= file, demo) report {can, paused, speed, pos, len} through onControl and take control(cmd, x):
// 'pause' | 'play' | 'speed' (0.5|1|2). feed.py keeps the clock itself (sent as a command); the two client-side sources use a ReplayClock.
import { createDemo, DEMO_LEN } from './demo.js';
import { ReplayClock } from './clock.js';

export function startFeed({ mode, wsUrl, replayUrl }, { onMessage, onStatus, onReset, onControl }) {
  let ws, retry, tick, demo, clock, clockLen = 0, wsCan = false, live = false, closed = false, replayShown = false;
  const emit = (src, msg) => onMessage(msg, src);
  const ctl = s => onControl?.(s);
  const clockState = () => ctl({ can: true, paused: clock.paused, speed: clock.speed, pos: Math.min(clock.get(), clockLen), len: clockLen });
  const status = (kind, text, title = '') => onStatus({ kind, text, title });

  function startDemo() {
    if (demo) return;
    clock = new ReplayClock(); clockLen = DEMO_LEN;
    demo = createDemo(m => { emit('demo', m); clockState(); }, () => onReset('demo'), clock);
    demo.start(); status('demo', 'Demo data', 'Built-in simulator, no plant feed found');
  }
  const stopDemo = () => { if (demo) ctl({ can: false }); demo?.stop(); demo = null; clock = null; };

  function connect() {
    if (closed) return;
    let opened = false;
    try { ws = new WebSocket(wsUrl); } catch { return fallback(); }
    const giveUp = setTimeout(() => { if (!opened) ws.close(); }, 2500);
    ws.onopen = () => { opened = live = true; replayShown = false; clearTimeout(giveUp); stopDemo(); onReset('live'); status('live', 'Live', wsUrl); };
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      emit('live', m);
      wsCan = !!m.replay && 'paused' in m;                  // an older feed.py has no clock to control
      ctl(wsCan ? { can: true, paused: m.paused, speed: m.speed, pos: m.pos, len: m.len } : { can: false });
      if (m.replay && !replayShown) { replayShown = true; status('replay', 'Replay', 'plant feed.py replay on ' + wsUrl); }
    };
    ws.onclose = () => { clearTimeout(giveUp); live = false; wsCan = false; ctl({ can: false }); fallback(); };
    ws.onerror = () => {};
  }
  function fallback() {
    if (closed) return;
    if (mode === 'auto') startDemo(); else status('wait', 'No feed', 'No feed at ' + wsUrl + ' - retrying');
    retry = setTimeout(connect, mode === 'auto' ? 6000 : 2000);
  }

  async function replay() {
    status('replay', 'Replay', replayUrl);
    const res = await fetch(replayUrl);
    const text = replayUrl.endsWith('.gz') && !res.headers.get('content-encoding')           // .jsonl.gz as recorded by plant.py --record
      ? await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).text() : await res.text();
    let msgs;
    try { const j = JSON.parse(text); msgs = Array.isArray(j) ? j : j.messages || [j]; }
    catch { msgs = text.split('\n').filter(l => l.trim()).map(l => JSON.parse(l)); }
    if (!msgs.length) return status('wait', 'Replay file is empty');
    onReset('replay');
    clock = new ReplayClock();
    const t0 = msgs[0].t; let i = 0; clockLen = msgs[msgs.length - 1].t - t0 + .2;
    tick = setInterval(() => {                             // honour recorded timestamps on the clock, loop at the end
      const r = clock.get();
      while (i < msgs.length && msgs[i].t - t0 <= r) emit('replay', msgs[i++]);
      if (i >= msgs.length && r >= clockLen) { onReset('replay'); clock.reset(); i = 0; }
      clockState();
    }, 50);
  }

  if (mode === 'demo') startDemo();
  else if (mode === 'replay') replay().catch(e => status('wait', 'Replay failed: ' + e.message));
  else connect();
  return {
    restartDemo: () => demo?.restart(),
    control(cmd, x) {
      if (wsCan) { if (ws?.readyState === 1) ws.send(JSON.stringify(cmd === 'speed' ? { cmd, x } : { cmd })); }
      else if (clock) { clock.set(cmd === 'speed' ? { speed: x } : { paused: cmd === 'pause' }); clockState(); }
    },
    get isDemo() { return !!demo; },
    close() { closed = true; clearTimeout(retry); clearInterval(tick); ws?.close(); stopDemo(); },
  };
}
