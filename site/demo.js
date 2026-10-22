// The web demo's stand-in for `slowship ui`: the same page, answered from one recorded watch instead of a server on
// your laptop. Clearing is remembered in this browser only; "run again" replays the recorded watch's own timeline.
(() => {
  const real = window.fetch.bind(window), data = real('demo-run.json').then(r => r.json());
  const KEY = 'slowship-demo-cleared', RANK = ['info', 'notable', 'review', 'hold'];
  let cleared = new Set();
  try { cleared = new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch {}
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify([...cleared])); } catch {} };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const relevel = run => {
    run = structuredClone(run);
    for (const i of run.items) i.approved = cleared.has(i.key);
    run.level = run.items.filter(i => !i.approved).reduce((w, i) => RANK.indexOf(i.level) > RANK.indexOf(w) ? i.level : w, 'info');
    return run;
  };

  // the replay: the recorded timeline, with long model pauses shortened so it takes about half a minute
  let replay = null;
  function startReplay(d) {
    const tl = d.timeline, at = [];
    let t = 0;
    tl.forEach((e, k) => { t += k ? Math.min(e.t - tl[k - 1].t, 1100) : 0; at.push(t); });
    const scale = t > 30000 ? 30000 / t : 1;
    replay = { tl, at: at.map(x => x * scale + 1200), started: Date.now(), total: tl.filter(e => e.type === 'item').length };
  }
  function snapshot() {
    const { tl, at, started, total } = replay, now = Date.now() - started;
    const w = { stage: now < 1200 ? 'finding' : 'reading', done: 0, total: now < 1200 ? 0 : total, started, now: null, counts: { cached: 0, rules: 0, model: 0, flagged: 0 }, ms: 0, log: [] };
    for (let k = 0; k < tl.length && at[k] <= now; k++) {
      const e = tl[k];
      if (e.type === 'step') { w.now = { name: e.name, kind: e.kind, phase: e.phase }; continue; }
      w.done++; w.counts[e.how]++; w.ms += e.ms || 0; w.now = null;
      if (e.level === 'review' || e.level === 'hold') w.counts.flagged++;
      w.log.unshift({ n: w.done, name: e.name, kind: e.kind, how: e.how, ms: e.ms || 0, level: e.level });
    }
    w.log.length = Math.min(w.log.length, 12);
    if (now > at.at(-1) + 400) { w.stage = 'done'; w.finished = started + at.at(-1) + 400; w.now = null; }
    return w;
  }

  window.fetch = async (url, init = {}) => {
    const u = new URL(url, location.href), i = u.pathname.indexOf('/api/');
    if (i < 0) return real(url, init);
    const path = u.pathname.slice(i), d = await data, body = init.body ? JSON.parse(init.body) : {};
    if (path === '/api/run') return json(relevel(d.run));
    if (path === '/api/code') { const w = d.codes[`${u.searchParams.get('key')}|${u.searchParams.get('file')}|${u.searchParams.get('line')}`]; return w ? json(w) : json({ error: 'no code' }, 404); }
    if (path === '/api/approve' || path === '/api/unapprove') { path === '/api/approve' ? cleared.add(body.key) : cleared.delete(body.key); keep(); return json(relevel(d.run)); }
    if (path === '/api/schedule') return init.method === 'POST' ? json({ error: 'this demo can’t schedule anything. Install slowship to have it watch every night' }, 400) : json({ off: true });
    if (path === '/api/folder' || path === '/api/browse') return json({ error: 'this demo can’t look at folders on your computer. Install slowship to watch your own project' }, 404);
    if (path === '/api/settings') return init.method === 'POST' ? json({ error: 'this demo can’t change settings. Install slowship to make them yours' }, 400) : json({ options: d.run.options, recent: [d.run.options.project], schedule: null });
    if (path === '/api/notify') return json({ discord: { on: false }, telegram: { on: false }, when: 'always', manual: false });
    if (path.startsWith('/api/notify/')) return json({ error: 'this demo can’t connect anything. Install slowship to get the morning ping' }, 400);
    if (path === '/api/watch') return json(replay ? snapshot() : { idle: true });
    if (path === '/api/scan') {
      if (body.project && body.project !== d.run.options.project) return json({ error: 'this demo can only replay its recorded watch. Install slowship to watch your own project' }, 400);
      if (!replay || snapshot().finished) startReplay(d); return json(snapshot(), 202);
    }
    return json({ error: 'not found' }, 404);
  };
})();
