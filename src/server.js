// The morning report, served on this machine only. Approve (and undo), run the watch again, read the last run.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { redactLine } from './app.js';
import { approve, scanProject } from './scan.js';
import { HOME, load, save } from './state.js';
import { worst } from './policy.js';

const UI = join(import.meta.dirname, 'ui');
const LAST = join(HOME, 'last-run.json');
const FONTS = new Set(['Unbounded.ttf', 'SchibstedGrotesk.ttf', 'IBMPlexMono-Regular.ttf', 'IBMPlexMono-Medium.ttf']);

export const saveRun = (run, options) => writeFileSync(LAST, JSON.stringify({ ...run, options, finished: new Date().toISOString() }));
const lastRun = () => (existsSync(LAST) ? JSON.parse(readFileSync(LAST, 'utf8')) : null);

/** The lines around one finding, from inside the item's own folder only, with secrets cut down. Null if it can't be shown. */
export function codeWindow(dir, file, line, around = 4) {
  if (!dir || typeof file !== 'string' || !file || !(line > 0)) return null;
  try {
    const root = realpathSync(dir), full = realpathSync(resolve(root, file)), rel = relative(root, full);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;  // a symlink or ../ can't walk out of the item
    if (!statSync(full).isFile() || statSync(full).size > 2_000_000) return null;
    const all = readFileSync(full, 'utf8').split(/\r?\n/), start = Math.max(1, line - around);
    return { start, total: all.length, lines: all.slice(start - 1, line + around).map(l => redactLine(l.slice(0, 240))) };
  } catch { return null; }
}

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
      if (url.pathname === '/api/run') { const r = lastRun(); return send(res, 200, r ? { ...relevel(r), home: homedir() } : { empty: true }); }
      if (url.pathname === '/api/code') {
        const item = lastRun()?.items.find(i => i.key === url.searchParams.get('key'));
        const w = codeWindow(item?.dir, url.searchParams.get('file'), Number(url.searchParams.get('line')));
        return w ? send(res, 200, w) : send(res, 404, { error: 'no code' });
      }
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
      // a live picture of the watch: the stage, what is being read right now, how each item was settled, the last few
      const w = watch = { stage: 'finding', done: 0, total: 0, started: Date.now(), now: null, counts: { cached: 0, rules: 0, model: 0, flagged: 0 }, ms: 0, log: [] };
      const name = i => i.kind === 'npm' ? i.key.replace(/^npm:/, '') : i.name;
      scanProject(o.project ?? process.cwd(), {
        ...o,
        onStep: s => { w.stage = 'reading'; w.now = { name: name(s), kind: s.kind, phase: s.phase }; },
        onItem: (item, n, { how = 'rules', ms = 0 } = {}) => {
          w.stage = 'reading'; w.done++; w.total = n ?? w.total; w.counts[how]++; w.ms += ms;
          if (['review', 'hold'].includes(item.level) && !item.approved) w.counts.flagged++;
          w.log.unshift({ n: w.done, name: name(item), kind: item.kind, how, ms, level: item.approved ? 'cleared' : item.level });
          w.log.length = Math.min(w.log.length, 12);
        },
      })
        .then(r => { saveRun(r, o); w.stage = 'done'; w.now = null; w.finished = Date.now(); })
        .catch(e => { w.error = String(e.message).slice(0, 200); w.stage = 'done'; w.finished = Date.now(); });
      return send(res, 202, watch);
    }
    return send(res, 404, { error: 'not found' });
  });
  server.listen(port, '127.0.0.1');
  return server;
}
