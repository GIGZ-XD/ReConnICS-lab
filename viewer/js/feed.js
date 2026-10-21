// State feed: live WebSocket (default ws://localhost:8765/state, also serves the plant's --replay mode),
// a client-side replay of a recorded JSON/NDJSON file, or the built-in demo simulator.
//   ?mode=auto (default: live, falls back to demo, keeps retrying live) | live | demo | replay
//   ?ws=ws://host:port/state   ?replay=url-or-file.json (array or one message per line)
import { createDemo } from './demo.js';

export function startFeed({ mode, wsUrl, replayUrl }, { onMessage, onStatus, onReset }) {
  let ws, retry, demo, live = false, closed = false, replayShown = false;
  const emit = (src, msg) => onMessage(msg, src);
  const status = (kind, text, title = '') => onStatus({ kind, text, title });

  function startDemo() {
    if (demo) return;
    demo = createDemo(m => emit('demo', m), () => onReset('demo'));
    demo.start(); status('demo', 'Demo data', 'Built-in simulator, no plant feed found');
  }
  const stopDemo = () => { demo?.stop(); demo = null; };

  function connect() {
    if (closed) return;
    let opened = false;
    try { ws = new WebSocket(wsUrl); } catch { return fallback(); }
    const giveUp = setTimeout(() => { if (!opened) ws.close(); }, 2500);
    ws.onopen = () => { opened = live = true; replayShown = false; clearTimeout(giveUp); stopDemo(); onReset('live'); status('live', 'Live', wsUrl); };
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      emit('live', m);
      if (m.replay && !replayShown) { replayShown = true; status('replay', 'Replay', 'plant feed.py replay on ' + wsUrl); }
    };
    ws.onclose = () => { clearTimeout(giveUp); live = false; fallback(); };
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
    const t0 = msgs[0].t;
    (function play(i, started) {                           // honour recorded timestamps, loop at the end
      if (closed) return;
      if (i >= msgs.length) { onReset('replay'); return play(0, performance.now()); }
      const wait = Math.max(0, (msgs[i].t - t0) * 1000 - (performance.now() - started));
      retry = setTimeout(() => { emit('replay', msgs[i]); play(i + 1, started); }, wait);
    })(0, performance.now());
  }

  if (mode === 'demo') startDemo();
  else if (mode === 'replay') replay().catch(e => status('wait', 'Replay failed: ' + e.message));
  else connect();
  return {
    restartDemo: () => demo?.restart(),
    get isDemo() { return !!demo; },
    close() { closed = true; clearTimeout(retry); ws?.close(); stopDemo(); },
  };
}
