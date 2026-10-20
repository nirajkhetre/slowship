// The morning report, served on this machine only. Approve (and undo), run the watch again, read the last run.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { approve, scanProject } from './scan.js';
import { HOME, load, save } from './state.js';
import { worst } from './policy.js';

const UI = join(import.meta.dirname, 'ui');
const LAST = join(HOME, 'last-run.json');
const FONTS = new Set(['Unbounded.ttf', 'SchibstedGrotesk.ttf', 'IBMPlexMono-Regular.ttf', 'IBMPlexMono-Medium.ttf']);

export const saveRun = (run, options) => writeFileSync(LAST, JSON.stringify({ ...run, options, finished: new Date().toISOString() }));
const lastRun = () => (existsSync(LAST) ? JSON.parse(readFileSync(LAST, 'utf8')) : null);

function relevel(run) {
  const state = load();
  for (const i of run.items) i.approved = state.approved[i.key] === i.fp;
  run.level = worst(run.items.filter(i => !i.approved).map(i => i.level));
  return run;
}

export function serve(port = Number(process.env.SLOWSHIP_PORT || 7798)) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  let watch = null;  // { done, total, started } while a scan runs

  const send = (res, code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:" });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };

  const server = createServer(async (req, res) => {
    // Only this machine's own pages: the Host must be ours (no DNS rebinding) and POSTs must come from our origin as JSON.
    if (!hosts.has(req.headers.host)) return send(res, 403, { error: 'wrong host' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET') {
      if (url.pathname === '/') return send(res, 200, readFileSync(join(UI, 'index.html')), 'text/html; charset=utf-8');
      if (url.pathname.startsWith('/fonts/') && FONTS.has(url.pathname.slice(7)))
        return send(res, 200, readFileSync(join(UI, 'fonts', url.pathname.slice(7))), 'font/ttf');
      if (url.pathname === '/api/run') { const r = lastRun(); return send(res, 200, r ? relevel(r) : { empty: true }); }
      if (url.pathname === '/api/watch') return send(res, 200, watch ?? { idle: true });
      return send(res, 404, { error: 'not found' });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method' });
    if (req.headers.origin && !hosts.has(req.headers.origin.replace(/^https?:\/\//, ''))) return send(res, 403, { error: 'wrong origin' });
    if (!String(req.headers['content-type']).startsWith('application/json')) return send(res, 415, { error: 'json only' });
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 64_000) return send(res, 413, { error: 'too big' }); }
    let body;
    try { body = JSON.parse(raw || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
    const run = lastRun();
    if (url.pathname === '/api/approve' || url.pathname === '/api/unapprove') {
      if (!run || typeof body.key !== 'string') return send(res, 400, { error: 'key' });
      const item = run.items.find(i => i.key === body.key);
      if (!item) return send(res, 404, { error: 'no such item' });
      if (url.pathname === '/api/approve') approve(run, body.key);
      else { const s = load(); if (s.approved[item.key] === item.fp) delete s.approved[item.key]; save(s); }
      return send(res, 200, relevel(run));
    }
    if (url.pathname === '/api/scan') {
      if (watch && !watch.finished) return send(res, 409, { error: 'already watching' });
      const o = run?.options ?? {};
      watch = { done: 0, total: 0, started: Date.now() };
      scanProject(o.project ?? process.cwd(), { ...o, onItem: (_, n) => { watch.done++; watch.total = n ?? watch.total; } })
        .then(r => { saveRun(r, o); watch.finished = Date.now(); })
        .catch(e => { watch.error = String(e.message).slice(0, 200); watch.finished = Date.now(); });
      return send(res, 202, watch);
    }
    return send(res, 404, { error: 'not found' });
  });
  server.listen(port, '127.0.0.1');
  return server;
}
