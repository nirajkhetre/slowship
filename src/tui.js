// slowship in the terminal: a harbour you can read. The mark and wordmark, the watch as it happens (a ship crossing the
// containers it reads, over moving water), the verdict, and a full-screen review with tabs, an inspector, clearing
// with undo, search and the mouse. Drawn with term.js; falls back to plain text wherever a terminal can't take it.
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BOLD, Canvas, DIM, ITALIC, Region, Screen, caps, clip, keys as parseKeys, width, wrap } from './term.js';
import { codeWindow } from './server.js';
import { approve } from './scan.js';
import { load, save } from './state.js';
import { worst } from './policy.js';
import { MODEL } from './judge.js';

// ---------- palette: the report's night-watch chart, for a canvas we own; mid-tones for the scrollback, which isn't ours
const N = {
  bg: '#061118', sheet: '#0C1921', shoal: '#14222B', deep: '#1C2E38', rule: '#20323D', ink: '#E4EDF0', ink2: '#A4B4BB', ink3: '#6E808A',
  hold: '#ED76B3', holdBg: '#3F1A2E', glance: '#F6B84D', glanceBg: '#35270F', clear: '#60C99A', clearBg: '#12291F', noted: '#7E929D', quiet: '#2B4250',
  sea: '#1B4556', sea2: '#2F6F86', sea3: '#5FA8C4', foam: '#9FD3E6', lamp: '#F4D58A',
  kw: '#7FB3C8', str: '#A8D5BA', num: '#E0B87A',
};
const M = { hold: '#D6589A', glance: '#E39A2D', clear: '#2FA877', noted: '#7E929D', quiet: '#8FA3AD', sea: '#2F6F86', sea2: '#4F93AE', foam: '#7FC0D6' };

// ---------- the mark: a soft blob with pill eyes, and a wordmark drawn letter by letter in half blocks ----------
const MASCOT = [
  '.....oooooo.....',
  '...oobbbbbboo...',
  '..obbbbbbbbbbo..',
  '.obbffffffffbbo.',
  'obbffeffffeffbbo',
  'obbffeffffeffbbo',
  'obbfrrffffrrfbbo',
  '.obbfffssfffbbo.',
  '..oobbbbbbbboo..',
  '....oooooooo....',
];
const MINI = ['..oooooo..', '.obbbbbbo.', 'obffffffbo', 'obfeffefbo', 'obfeffefbo', '.oooooooo.'];
const blink = g => g.map((r, y) => y === g.findIndex(row => row.includes('e')) ? r.replaceAll('e', 'f') : r);
const MPAL = { o: '#2F6F86', b: '#7FB3C8', f: '#E8F2F4', e: '#0B1820', r: '#ED76B3', s: '#0B1820' };
// x-height in rows 1-4, ascenders in 0, the descender in 5
const GLYPH = {
  s: ['....', '.###', '##..', '..##', '###.', '....'],
  l: ['#.', '#.', '#.', '#.', '.#', '..'],
  o: ['....', '.##.', '#..#', '#..#', '.##.', '....'],
  w: ['.....', '#...#', '#...#', '#.#.#', '.#.#.', '.....'],
  h: ['#...', '#.#.', '##.#', '#..#', '#..#', '....'],
  i: ['#', '.', '#', '#', '#', '.'],
  p: ['....', '###.', '#..#', '###.', '#...', '#...'],
};
const mix = (a, b, t) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
/** The wordmark as pixel rows and a palette shading it left to right. */
function wordmark(from, to) {
  const rows = Array(6).fill('');
  for (const [k, ch] of [...'slowship'].entries()) for (let r = 0; r < 6; r++) rows[r] += (k ? '.' : '') + GLYPH[ch][r];
  const w = rows[0].length, pal = {}, letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const grid = rows.map(r => [...r].map((c, x) => c === '#' ? letters[Math.floor(x / w * 30)] : '.').join(''));
  for (let k = 0; k < 30; k++) pal[letters[k]] = mix(from, to, k / 29);
  return { grid, pal, w };
}
const WM = { night: wordmark('#CFE6EE', '#5FA8C4'), mid: wordmark('#5FA8C4', '#2F6F86') };

// ---------- what the report knows about an item, in the same words ----------
const ORDER = { info: 0, notable: 1, review: 2, hold: 3 };
const KIND = { npm: 'Package', skill: 'Skill', mcp: 'MCP server', app: 'Your build' };
const ST = { hold: 'Held', glance: 'Worth a glance', cleared: 'Cleared by you', notable: 'Noted', quiet: 'Fine' };
const stateOf = i => i.approved && ORDER[i.level] >= 2 ? 'cleared' : i.level === 'hold' ? 'hold' : i.level === 'review' ? 'glance' : i.level === 'notable' ? 'notable' : 'quiet';
const PIP = { hold: '◆', glance: '●', cleared: '✓', notable: '○', quiet: '·' };
const COL = { hold: 'hold', glance: 'glance', cleared: 'clear', notable: 'noted', quiet: 'quiet' };
const needs = i => ORDER[i.level] >= 2;
const label = i => i.kind === 'npm' ? i.key.replace(/^npm:/, '') : i.name;
const split = i => { const l = label(i), at = i.kind === 'npm' ? l.lastIndexOf('@') : -1; return at > 0 ? [l.slice(0, at), l.slice(at + 1)] : [l, '']; };
const group = run => { const by = new Map(); for (const i of run.items) by.has(i.fp) ? by.get(i.fp).also.push(i) : by.set(i.fp, { ...i, also: [] }); return [...by.values()]; };
const home = p => { const h = homedir(); return p && p.toLowerCase().startsWith(h.toLowerCase()) ? '~' + p.slice(h.length) : p || ''; };
const pl = (n, one, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const dur = ms => ms < 60_000 ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s` : `${Math.floor(ms / 60_000)} min ${Math.round(ms % 60_000 / 1000)} s`;
const VERDICT = { hold: ['Held', 'in port.'], review: ['Ready after', 'a glance.'], ok: ['Cleared', 'to sail.'] };
const verdictOf = items => { const w = worst(items.filter(i => !i.approved).map(i => i.level)); return w === 'hold' ? 'hold' : w === 'review' ? 'review' : 'ok'; };
const WHY = {
  exfil: 'Reading a credential file and making a request close by is how token stealers work, so this holds whatever the description says.',
  'token-net': 'A token from the environment next to a request is often a tool using its own key, and sometimes a token thief.',
  'hidden-code': 'Decoding data and running it as code in the same function is how hidden payloads start.',
  persistence: 'Writing to a shell profile, a startup folder or SSH keys lets code start again on its own.',
  conceal: 'A skill that tells your agent to keep something from you is held, always.',
  override: 'Telling an agent to ignore its other instructions is the classic prompt-injection move.',
  'electron-open': 'With Node.js on and isolation off, any page this window loads can run code on your users\' computers.',
  'ipc-open': 'This handler trusts every page in the window. Check event.senderFrame before doing anything.',
  secret: 'A real-looking key in a build ships to every user. Revoke it, then move it behind your server.',
  'install-runs': 'Code that runs at install and downloads or starts programs is how install-time worms spread.',
  'fuse-node': 'Fuses ship open. Turn these off with @electron/fuses when you package.',
};

// ---------- banner, help ----------
// io: where and how to draw. Defaults to this terminal; tests and previews pass their own.
const inline = (io = {}) => { const c = caps(); return { depth: c.color, motion: c.motion, W: Math.min(process.stdout.columns || 80, 100), out: process.stdout, ...io }; };
/** The mark and the wordmark, for the top of a run and of the help. */
export function banner(sub = 'Ship safe, slowly.', io) {
  const { depth, W, out } = inline(io), c = new Canvas(W, 6);
  c.pixels(2, 0, MASCOT, MPAL);
  c.pixels(21, 1, WM.mid.grid, WM.mid.pal);
  c.text(21, 5, [[sub, { fg: M.quiet, a: ITALIC }]]);
  out.write('\n' + c.lines(depth).join('\n') + '\n\n');
}

export function help(io) {
  banner('Ship safe, slowly. Does everything aboard do what it says?', io);
  const { depth, W, out } = inline(io), L = [];
  const cmd = (a, b) => L.push([['  ' + a.padEnd(36), { fg: M.sea2, a: BOLD }], [b, { fg: M.quiet }]]);
  const head = t => L.push([], [[t, { a: BOLD }]]);
  head('Watch');
  cmd('slowship [dir]', 'read dir (here by default), then review it');
  cmd('slowship review', 'review the last watch again');
  cmd('slowship ui', 'the morning report, in your browser');
  cmd('slowship schedule [dir] --at 03:00', 'keep watch every night (--off, --status)');
  head('Options');
  for (const [a, b] of [['--app <build/>', 'also check your own build before it ships'], ['--no-model', 'rules only, no local model'],
    ['--packages-only, --agents-only', 'read only one side'], ['--offline', 'don\'t fetch npx MCP packages to read them'],
    ['--json <file>', 'write everything found as JSON'], ['--approve <name|notable|review>', 'mark results as seen'],
    ['--plain', 'plain text: no colour, no screens (also when piped)'], ['--no-motion', 'no animation']]) L.push([['  ' + a.padEnd(36), { fg: M.glance }], [b, { fg: M.quiet }]]);
  head('In the review');
  L.push([['  ', {}], ...[['↑↓', 'move'], ['←→', 'tabs'], ['↵', 'open'], ['c', 'clear'], ['u', 'undo'], ['/', 'search'], ['o', 'browser'], ['?', 'keys'], ['q', 'quit']]
    .flatMap(([k, t]) => [[k, { fg: M.sea2, a: BOLD }], [` ${t}   `, { fg: M.quiet }]])]);
  L.push([], [['  Reads code, never runs it. Exit code 2 when something is held, so it can gate CI.', { fg: M.quiet, a: ITALIC }]]);
  const c = new Canvas(W, L.length);
  L.forEach((p, y) => c.text(0, y, p));
  out.write(c.lines(depth).join('\n') + '\n\n');
}

// ---------- the watch, live: a ship crosses the containers it reads, the water moves, each step lights up ----------
const SPIN = ['◜', '◝', '◞', '◟'];
const STEPS = [['find', 'find'], ['memory', 'fingerprint'], ['read', 'read'], ['judge', 'model'], ['verdict', 'verdict']];
const LV = { hold: M.hold, review: M.glance, notable: M.noted, info: M.quiet };
/** Run the scan with a live view in the scrollback. Returns the run. */
export async function watch(scan, project, options, io) {
  const { depth, motion, W, out } = inline(io), region = io?.region ?? new Region(out), t0 = Date.now();
  const s = { total: 0, levels: [], open: new Map(), cached: 0, judged: 0, ms: 0, now: null, phase: 'find', frame: 0, done: false };
  const show = () => out.write('\x1b[?25h');
  process.once('exit', show);
  const draw = () => {
    const c = new Canvas(W, 8), track = W - 18, done = s.levels.length, n = Math.max(s.total, done, 1);
    const cells = s.total ? Math.min(track, n) : track, per = n / cells;  // the berth is full width until the manifest is known
    const worstSoFar = s.levels.includes('hold') ? M.hold : s.levels.includes('review') ? M.glance : M.clear;
    for (let k = 0; k < cells; k++) {  // a container per item (or per few, on a long manifest), coloured once read
      const slice = s.levels.slice(Math.floor(k * per), Math.floor((k + 1) * per));
      const lv = slice.length && Math.floor((k + 1) * per) <= done ? worst(slice) : null;
      c.text(2 + k, 2, lv ? '▆' : '▁', { fg: lv ? LV[lv] : M.sea, a: lv ? 0 : DIM });
    }
    const x = 2 + Math.min(cells - 1, Math.round(done / n * cells));
    c.text(x, 0, [['▐', { fg: M.quiet }], ['▀', { fg: worstSoFar }]]);  // the mast, flying the worst colour so far
    c.text(x - 1, 1, '▟██▙', { fg: M.sea2 });
    if (x < 2 + cells - 2) c.text(2 + cells, 0, '▕▀', { fg: M.clear });  // the finish flag, until she reaches it
    c.right(W - 14, 2, 12, [[String(done), { a: BOLD }], [` of ${s.total || '…'}`, { fg: M.quiet }]]);
    for (let k = 0; k < cells + 4; k++) {  // the water: a slow swell, shaded deeper away from the quay
      const h = Math.sin((k + s.frame * 0.6) / 3.2) + Math.sin((k - s.frame * 0.35) / 1.7) * 0.5;
      c.text(2 + k, 3, '▁▂▃▄'[Math.max(0, Math.min(3, Math.round(h + 1.4)))], { fg: mix(M.sea, M.foam, (h + 1.5) / 3 * 0.6) });
    }
    const verb = { find: 'Finding everything aboard', memory: 'From memory', read: 'Reading', judge: `${MODEL.split(':')[0]} is comparing`, verdict: 'Writing the verdict' }[s.phase];
    let xx = s.done ? c.text(2, 5, [['✓', { fg: M.clear, a: BOLD }], [`  Read everything aboard in ${dur(Date.now() - t0)}`, { a: BOLD }]])
      : c.text(2, 5, [[motion ? SPIN[s.frame % 4] : '•', { fg: M.sea2, a: BOLD }], [`  ${verb}`, { a: BOLD }]]);
    if (s.now) xx = c.text(xx, 5, [['  ' + clip(s.now, Math.max(8, W - xx - 46)), { fg: M.quiet }]]);
    let px = W - 44;
    for (const [k, name] of STEPS) {
      const on = k === s.phase, past = STEPS.findIndex(p => p[0] === k) < STEPS.findIndex(p => p[0] === s.phase);
      px = c.text(px, 5, [[name, { fg: on ? M.sea2 : past ? M.quiet : M.quiet, a: on ? BOLD : past ? 0 : DIM }]]);
      if (k !== 'verdict') px = c.text(px, 5, [[' › ', { fg: M.quiet, a: DIM }]]);
    }
    const count = lv => [...s.open.values()].filter(l => l === lv).length;  // distinct and not cleared, as the verdict counts
    c.text(2, 6, [['◆ ', { fg: M.hold }], [`${count('hold')} held`, {}], ['   ● ', { fg: M.glance }], [`${count('review')} to glance`, {}],
      ['   ↺ ', { fg: M.quiet }], [`${s.cached} from memory`, { fg: M.quiet }],
      ...(s.judged ? [['   ◐ ', { fg: M.sea2 }], [`${s.judged} judged · ${dur(s.ms)}`, { fg: M.quiet }]] : []),
      [`   ${dur(Date.now() - t0)}`, { fg: M.quiet, a: DIM }]]);
    c.text(2, 7, [['Read, never run. Ctrl+C stops the watch; nothing is half-written.', { fg: M.quiet, a: DIM | ITALIC }]]);
    region.draw(c.lines(depth));
  };
  const timer = motion ? setInterval(() => { s.frame++; draw(); }, 90) : null;
  let last = 0;
  const tick = () => { if (!motion && Date.now() - last > 120) { last = Date.now(); draw(); } };
  draw();
  try {
    const run = await scan(project, {
      ...options,
      onStep: st => { s.phase = st.phase === 'judge' ? 'judge' : 'read'; s.now = st.kind === 'npm' ? st.key?.replace(/^npm:/, '') : st.name; tick(); },
      onItem: (item, total, how) => {
        s.total = total; s.levels.push(item.level); s.now = label(item);
        if (!item.approved) s.open.set(item.fp, item.level);
        if (how.how === 'cached') { s.cached++; s.phase = 'memory'; } else if (how.how === 'model') { s.judged++; s.ms += how.ms; }
        tick();
      },
    });
    s.phase = 'verdict'; s.now = null; s.done = true; draw();
    return run;
  } finally { clearInterval(timer); region.done(); process.off('exit', show); }
}

// ---------- the verdict, as a card in the scrollback, then one key: review here, the browser, or done ----------
export function card(run, ms, io) {
  const { depth, W, out } = inline(io), G = group(run), v = verdictOf(G), [a, b] = VERDICT[v], col = { hold: M.hold, review: M.glance, ok: M.clear }[v];
  const open = G.filter(i => needs(i) && !i.approved), held = open.filter(i => i.level === 'hold').length;
  const c = new Canvas(W, 12), w = W - 2;
  c.box(1, 0, w, 12, M.quiet, null);
  c.pixels(4, 2, MINI, MPAL);
  c.text(17, 2, [[a + ' ', { a: BOLD }], [b, { fg: col, a: BOLD }]]);
  c.text(17 + width(a) + 1, 3, '∿'.repeat(width(b)), { fg: col });
  const sub = v === 'hold' ? `${pl(held, 'thing')} ${held === 1 ? 'does' : 'do'} more than ${held === 1 ? 'it says' : 'they say'}. Look before you ship${open.length > held ? `, then glance at ${open.length - held} more` : ''}.`
    : v === 'review' ? `${pl(open.length, 'thing')} worth a look before you ship. Nothing is held.` : 'Nothing needs you. Everything aboard does what it says, as far as its code shows.';
  c.text(17, 4, [[clip(sub, w - 20), { fg: M.quiet }]]);
  const yard = w - 6, per = G.length / yard;  // the whole manifest, as containers in their colours
  for (let k = 0; k < Math.min(yard, G.length); k++) {
    const slice = G.slice(Math.floor(k * per), Math.max(Math.floor((k + 1) * per), Math.floor(k * per) + 1)).map(stateOf);
    const st = ['hold', 'glance', 'cleared', 'notable', 'quiet'].find(x => slice.includes(x));
    c.text(4 + k, 6, '▆', { fg: { hold: M.hold, glance: M.glance, cleared: M.clear, notable: M.noted, quiet: '#3E5764' }[st] });
  }
  const s = run.stats;
  c.text(4, 7, [[`${G.length} aboard`, { a: BOLD }], [`  ·  ${held} held  ·  ${open.length - held} to glance  ·  ${run.model ? `${s.judged} judged by ${run.model.split(':')[0]}` : 'rules only'}${ms ? `  ·  ${dur(ms)}` : ''}`, { fg: M.quiet }]], {}, w - 6);
  const k = (key, t) => [[` ${key} `, { fg: '#0B1820', bg: M.foam, a: BOLD }], [` ${t}     `, { fg: M.quiet }]];
  c.text(4, 9, [...k('↵', 'review here'), ...k('o', 'morning report in the browser'), ...k('q', 'done')]);
  out.write(c.lines(depth).join('\n') + '\n');
}

/** Wait for one key after the card: 'review', 'browser' or 'done'. */
export function choose() {
  return new Promise(res => {
    const inp = process.stdin;
    if (!inp.isTTY) return res('done');
    inp.setRawMode(true); inp.setEncoding('utf8'); inp.resume();
    const on = chunk => {
      for (const k of parseKeys(chunk)) {
        const r = k.name === 'enter' ? 'review' : k.ch === 'o' ? 'browser' : k.ch === 'q' || k.name === 'escape' || k.name === 'ctrl-c' ? 'done' : null;
        if (r) { inp.off('data', on); inp.setRawMode(false); inp.pause(); return res(r); }
      }
    };
    inp.on('data', on);
  });
}

/** One line to leave on: where things stand, and the way back. */
export function bye(run, io) {
  const { depth, W, out } = inline(io), G = group(run), v = verdictOf(G), [a, b] = VERDICT[v], col = { hold: M.hold, review: M.glance, ok: M.clear }[v];
  const open = G.filter(i => needs(i) && !i.approved), c = new Canvas(W, 1);
  c.text(2, 0, [[{ hold: '◆', review: '●', ok: '✓' }[v] + ' ', { fg: col, a: BOLD }], [`${a} ${b}`, { a: BOLD }],
    [`  ${open.filter(i => i.level === 'hold').length} held, ${open.filter(i => i.level === 'review').length} to glance  ·  `, { fg: M.quiet }],
    ['back: ', { fg: M.quiet }], ['slowship review', { fg: M.sea2, a: BOLD }], [' or ', { fg: M.quiet }], ['slowship ui', { fg: M.sea2, a: BOLD }]]);
  out.write(c.lines(depth).join('\n') + '\n\n');
}

export function openBrowser() {
  const bin = join(import.meta.dirname, '..', 'bin', 'slowship.js');
  spawn(process.execPath, [bin, 'ui'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

// ---------- the review, full screen ----------
const TABS = [['review', 'Review'], ['aboard', 'Aboard'], ['keys', 'Keys'], ['blind', 'Blind spots']];
const KINDS = [['all', 'All'], ['npm', 'Packages'], ['skill', 'Skills'], ['mcp', 'MCP'], ['app', 'Build']];
const RX = /(\/\/.*|#.*$)|(`[^`]*`?|"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?)|\b(const|let|var|function|return|if|else|for|while|await|async|new|import|from|export|require|class|try|catch|throw|true|false|null|undefined|def|self|None)\b|\b(\d[\d_.]*)\b/g;
function code(line, base) {  // a small, honest highlighter
  const out = []; let at = 0;
  for (const m of line.matchAll(RX)) {
    if (m.index > at) out.push([line.slice(at, m.index), base]);
    out.push([m[0], { ...base, fg: m[1] ? N.ink3 : m[2] ? N.str : m[3] ? N.kw : N.num, a: m[1] ? ITALIC : 0 }]);
    at = m.index + m[0].length;
  }
  out.push([line.slice(at), base]);
  return out;
}

/** The full-screen review. Resolves with 'quit' or 'rerun'. */
export function review(run, { model = run.model, screen, depth = caps().color, motion = caps().motion } = {}) {
  const scr = screen ?? new Screen();
  let G = group(run);
  const S = { tab: 'review', sel: {}, top: {}, scroll: 0, focus: 'list', q: '', searching: false, kind: 'all', toast: null, help: false, blink: false, undo: [], anim: null, cele: null, narrow: false, cacheGen: 0 };
  const keysOf = i => [i.key, ...i.also.map(a => a.key)];
  const relevel = () => {
    const st = load();
    for (const i of run.items) i.approved = st.approved[i.key] === i.fp;
    run.level = worst(run.items.filter(i => !i.approved).map(i => i.level));
    G = group(run); S.cacheGen++;
  };

  // what each tab lists
  const order = i => ({ hold: 0, glance: 1, cleared: 2, notable: 3, quiet: 4 })[stateOf(i)];
  const match = i => (!S.q || `${i.key} ${i.name}`.toLowerCase().includes(S.q.toLowerCase())) && (S.kind === 'all' || i.kind === S.kind);
  const ledger = () => {
    const rows = new Map();
    for (const i of G) for (const k of [...(i.keys || []).map(k => ({ how: 'code', ...k })), ...(i.given || []).map(k => ({ ...k, how: 'config' }))]) {
      const r = rows.get(k.service) ?? rows.set(k.service, { service: k.service, keys: new Set(), who: new Map() }).get(k.service);
      r.keys.add(k.name); if (!r.who.has(label(i))) r.who.set(label(i), { i, how: k.how, file: k.file, line: k.line, key: k.name });
    }
    return [...rows.values()].sort((a, b) => b.who.size - a.who.size || a.service.localeCompare(b.service));
  };
  const blindNotes = () => {
    let files = 0, read = 0, tests = 0, broken = 0, big = 0, lines = 0;
    for (const i of G) { const c = i.coverage || {}; files += c.files || 0; read += c.read || 0; tests += c.tests || 0; broken += (c.errors || []).filter(x => x.includes('unparseable')).length; big += (c.skipped || []).filter(x => !x.includes('dependencies')).length; lines += c.lineLevel?.length || 0; }
    const bins = G.flatMap(i => i.map?.binaries || []), blank = bins.filter(b => !b.lang).length, notes = [];
    for (const u of run.unread || []) notes.push([u.key.replace(/^mcp:/, 'MCP server '), u.why]);
    if (bins.length) notes.push([`${pl(bins.length, 'compiled file')} read as far as the build record`, `REA read what Go, Rust and .NET files were built from, without running them.${blank ? ` ${blank} left no build record at all.` : ''}`]);
    if (tests) notes.push([`${tests.toLocaleString()} test and example files left out`, 'On purpose: they ship inside packages but don\'t run when you use them.']);
    if (broken) notes.push([`${pl(broken, 'file')} that wouldn't parse`, 'Skipped rather than guessed at.']);
    if (big) notes.push([`${pl(big, 'file')} too large`, 'Over the size limit, so not parsed. Big bundles are usually generated code.']);
    if (lines) notes.push([`${pl(lines, 'script')} read line by line`, 'Python and shell get line rules, not a full parser. Quiet there means "nothing obvious".']);
    notes.push(['TypeScript, and code inside markdown', 'TypeScript isn\'t parsed yet; a markdown code block is read as instructions.']);
    notes.push(['Anything that only exists while a program runs', 'slowship reads code; it never runs it. Code fetched at runtime can\'t be seen.']);
    return { notes, read, code: files - tests };
  };
  const list = () => S.tab === 'review' ? G.filter(i => needs(i) && match(i)).sort((a, b) => order(a) - order(b) || label(a).localeCompare(label(b)))
    : S.tab === 'aboard' ? G.filter(match).sort((a, b) => order(a) - order(b) || label(a).localeCompare(label(b)))
    : S.tab === 'keys' ? ledger() : blindNotes().notes;
  const cur = () => list()[S.sel[S.tab] ?? 0];

  // the inspector's lines: [segments, line background]
  function detail(it, w) {
    const L = [], push = (segs, bg) => L.push([segs, bg]), gap = () => push([]);
    const para = (t, st, ind = 0) => wrap(t, Math.max(10, w - ind)).forEach(l => push([[' '.repeat(ind) + l, st]]));
    if (S.tab === 'keys') {
      push([[it.service, { fg: N.ink, a: BOLD }]]);
      push([[`${pl(it.who.size, 'tool')} your agent runs ${it.who.size === 1 ? 'holds' : 'hold'} a key to it. Each can run up a bill or act as you.`, { fg: N.ink2 }]]);
      gap();
      for (const k of it.keys) push([['  ' + k, { fg: N.lamp, a: BOLD }]]);
      gap();
      for (const [name, h] of it.who) {
        push([[`${PIP[stateOf(h.i)]} `, { fg: N[COL[stateOf(h.i)]] }], [name, { fg: N.ink, a: BOLD }], [`  ${KIND[h.i.kind]}`, { fg: N.ink3 }]]);
        push([[`  ${h.how === 'config' ? 'handed it in an MCP config' : h.how === 'docs' ? 'its instructions name it' : 'reads it in its code'}${h.file ? `, ${h.file}${h.line ? ':' + h.line : ''}` : ''}`, { fg: N.ink3 }]]);
      }
      gap(); para('Names only: slowship never reads a key\'s value.', { fg: N.ink3, a: ITALIC });
      return L;
    }
    if (S.tab === 'blind') { push([[it[0], { fg: N.ink, a: BOLD }]]); gap(); para(it[1], { fg: N.ink2 }); return L; }
    const st = stateOf(it), [name, ver] = split(it);
    const chip = (t, fg, bg) => [[` ${t} `, { fg, bg, a: BOLD }], [' ', {}]];
    push([...chip(`${PIP[st]} ${ST[st]}`, N[COL[st]], { hold: N.holdBg, glance: N.glanceBg, cleared: N.clearBg }[st] ?? N.deep), ...chip(KIND[it.kind], N.ink2, N.deep), ...(it.also.length ? chip(`in ${it.also.length + 1} places`, N.ink2, N.deep) : [])]);
    gap();
    push([[name, { fg: N.ink, a: BOLD }], ...(ver ? [[`  ${ver}`, { fg: N.ink3 }]] : [])]);
    para(home(it.dir || it.key.replace(/^app:/, '')), { fg: N.ink3 });
    gap();
    const mc = it.findings.map(f => f.matches_claim).filter(x => x && x !== 'unknown'), rel = mc.includes('no') ? 'no' : mc.length && mc.every(x => x === 'yes') ? 'yes' : '';
    push([['What it says it does', { fg: N.ink2, a: BOLD }], ...(rel ? [[rel === 'no' ? '   ≠ not what its code does' : '   = matches its code', { fg: rel === 'no' ? N.hold : N.clear, a: BOLD }]] : [])]);
    const claim = it.kind === 'app' ? 'Your own code. Here slowship looks for what you didn\'t mean to ship: keys, debug switches, source maps, open doors in Electron.'
      : (it.claim || 'No description, so there was nothing to compare its code against.').split('\n')[0];
    para(claim, { fg: N.ink, a: ITALIC }, 2);
    gap();
    const fs = [...it.findings.filter(f => ORDER[f.level] >= 2), ...it.findings.filter(f => ORDER[f.level] < 2)].slice(0, 6);
    if (!fs.length) push([['✓ ', { fg: N.clear }], [it.coverage?.compiled ? 'Nothing in its build record to look at.' : 'Read every file it ships: nothing to look at.', { fg: N.ink2 }]]);
    for (const f of fs) {
      const fst = f.level === 'hold' ? 'hold' : f.level === 'review' ? 'glance' : 'notable', fc = N[COL[fst]];
      wrap(f.says.charAt(0).toUpperCase() + f.says.slice(1), w - 2).forEach((l, k) => push([[k ? '  ' : `${PIP[fst]} `, { fg: fc }], [l, { fg: N.ink, a: BOLD }]]));
      push([['  ', {}], ...chip({ hold: 'Held', glance: 'Worth a glance', notable: 'Noted' }[fst], fc, { hold: N.holdBg, glance: N.glanceBg }[fst] ?? N.deep),
        ...(f.matches_claim === 'no' ? chip('Not what it says it does', N.bg, N.ink) : [])]);
      const seen = new Set();
      for (const id of f.evidence) {
        const e = it.facts.find(x => x.id === id), at = e && `${e.file}:${e.line}|${e.line ? '' : e.detail}`;
        if (!e || seen.has(at) || seen.size >= 2) continue;
        seen.add(at);
        const win = e.line ? codeWindow(it.dir, e.file, e.line, 2) : null;
        if (win?.lines?.length) {
          push([['  ┌ ', { fg: N.rule }], [e.file, { fg: N.ink2 }], [` · line ${e.line}`, { fg: N.ink3 }]]);
          win.lines.forEach((l, k) => {
            const n = win.start + k, hot = n === e.line, bg = hot ? (fst === 'hold' ? N.holdBg : N.glanceBg) : undefined;
            push([['  │', { fg: N.rule, bg }], [hot ? '▶' : ' ', { fg: fc, bg, a: BOLD }], [String(n).padStart(5) + '  ', { fg: hot ? fc : N.ink3, bg }], ...code(clip(l.replace(/\t/g, '  '), w - 12), { fg: N.ink2, bg })], bg);
          });
          push([['  └', { fg: N.rule }]]);
        } else push([['  ▣ ', { fg: N.ink3 }], [e.file === '(REA)' ? 'REA · the app\'s structure' : e.file, { fg: N.ink2 }], [`  ${e.detail}${e.code && !e.line ? ` · ${e.code}` : ''}`, { fg: N.ink3 }]]);
      }
      const said = f.evidence.map(id => it.facts.find(x => x.id === id)).find(e => e?.why);
      if (said) {
        push([['  ◐ ', { fg: N.sea3 }], [`${(model || 'gemma4').split(':')[0]} on this laptop`, { fg: N.ink2, a: BOLD }], [`  ${{ expected: 'as described', unexpected: 'not in the description', unclear: 'not sure' }[said.label] ?? ''}`, { fg: said.label === 'unexpected' ? N.hold : N.ink3 }]]);
        para(said.why, { fg: N.ink2, a: ITALIC }, 4);
      }
      if (WHY[f.kind] && ORDER[f.level] >= 2) para(WHY[f.kind], { fg: N.ink3 }, 2);
      gap();
    }
    const ks = [...(it.keys || []).map(k => ({ how: 'code', ...k })), ...(it.given || []).map(k => ({ ...k, how: 'config' }))];
    if (ks.length) {
      push([['$ ', { fg: N.lamp, a: BOLD }], ['Can spend your money on', { fg: N.ink2, a: BOLD }]]);
      for (const k of ks) push([['  ' + k.service.padEnd(16), { fg: N.ink, a: BOLD }], [k.name, { fg: N.lamp }], [`  ${k.how === 'config' ? 'MCP config' : k.how === 'docs' ? 'named in instructions' : 'read in code'}`, { fg: N.ink3 }]]);
      gap();
    }
    if (it.map?.ipc?.length) {
      push([['⇄ ', { fg: N.sea3, a: BOLD }], ['How pages reach your main process', { fg: N.ink2, a: BOLD }]]);
      const fw = Math.max(...it.map.ipc.map(h => width(h.via[0] || h.from[0] || 'nothing calls it')));
      for (const h of [...it.map.ipc].sort((a, b) => a.checked - b.checked || (b.does?.length ?? 0) - (a.does?.length ?? 0))) {
        const c = h.checked ? N.clear : h.does?.length ? N.hold : N.glance, from = (h.via[0] || h.from[0] || 'nothing calls it').padEnd(fw);
        push([['  ' + from + ' ', { fg: N.ink }], ...(h.checked ? [['━━━▐▌   ', { fg: c }]] : [['━━━╸ ╺━━', { fg: c }]]), [` "${h.channel}"`, { fg: N.ink, a: BOLD }], [` ${h.file || ''}${h.line ? ':' + h.line : ''}`, { fg: N.ink3 }],
          [h.checked ? '  checks the sender' : h.does?.length ? `  no sender check · ${h.does.join(', ')}` : '  no sender check', { fg: c }]]);
      }
      gap();
    }
    for (const b of it.map?.binaries || []) {
      push([['▣ ', { fg: N.sea3, a: BOLD }], [b.file, { fg: N.ink, a: BOLD }], [`  ${b.fuses ? 'Electron' : { go: 'Go', rust: 'Rust', dotnet: '.NET' }[b.lang] || 'no build record'}${b.tool ? ' · ' + b.tool : ''}`, { fg: N.ink3 }]]);
      if (b.main) push([['  ' + b.main + (b.deps?.length ? `  and ${b.deps.length} ${b.lang === 'rust' ? 'crates' : b.lang === 'dotnet' ? 'assemblies' : 'modules'}` : ''), { fg: N.ink2 }]]);
      if (b.fuses) push([['  ', {}], ...Object.entries(b.fuses).filter(([k]) => /RunAsNode|NodeOptions|Inspect|Asar/.test(k)).flatMap(([k, on]) => {
        const bad = /RunAsNode|NodeOptions|Inspect/.test(k) ? on : !on;
        return [[` ${k.replace(/^Enable/, '').replace('EnvironmentVariable', '').replace('Arguments', '')} ${on ? 'on' : 'off'} `, { fg: bad ? N.glance : N.ink2, bg: bad ? N.glanceBg : N.deep }], [' ', {}]];
      })]);
      const odd = (b.deps || []).filter(d => d.swap || (d.source && !['crates.io', 'local'].includes(d.source)));
      for (const d of [...odd, ...(b.deps || []).filter(d => !odd.includes(d))].slice(0, 8)) {
        const name = clip(d.name, w - 18), dots = Math.max(2, w - 6 - width(name) - width(d.version || ''));
        push([['  ' + name + ' ', { fg: odd.includes(d) ? N.glance : N.ink2, a: odd.includes(d) ? BOLD : 0 }], ['·'.repeat(dots), { fg: N.rule }], [' ' + (d.version || ''), { fg: N.ink3 }]]);
        if (d.swap) push([['    swapped for ' + d.swap, { fg: N.glance }]]);
      }
      if ((b.deps?.length || 0) > 8) push([[`  and ${b.deps.length - 8} more`, { fg: N.ink3 }]]);
      if (b.note && !b.fuses) para(b.note, { fg: N.ink3 }, 2);
      gap();
    }
    const c = it.coverage || {};
    para(c.compiled ? 'Compiled: REA read its build record; the code itself can\'t be read. Nothing run.'
      : `Read ${c.read ?? 0} of ${c.files ?? 0} file${c.files === 1 ? '' : 's'}${c.lineLevel?.length ? `, ${c.lineLevel.length} line by line` : ''}. Read, never run.`, { fg: N.ink3, a: ITALIC });
    return L;
  }

  // ---------- drawing ----------
  function frame() {
    const [W, H] = scr.size, c = new Canvas(W, H, N.bg);
    if (W < 60 || H < 16) {
      c.text(Math.max(0, (W - 34) >> 1), H >> 1, 'Make the terminal a little bigger.', { fg: N.ink2, bg: N.bg });
      return c;
    }
    S.narrow = W < 110;
    // the header: the mark, where we are, the verdict
    c.fill(0, 0, W, 3, N.sheet);
    c.pixels(2, 0, S.blink ? blink(MINI) : MINI, MPAL);
    const room = W - 52, proj = home(run.options?.project || run.project || ''), when = run.finished ? new Date(run.finished).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : 'just now';
    c.text(14, 0, [['slowship', { fg: N.ink, bg: N.sheet, a: BOLD }], ['  ' + clip(proj, Math.max(4, room - 10)), { fg: N.ink2, bg: N.sheet }]], {}, room);
    c.text(14, 1, [...(room > 52 ? [['Ship safe, slowly.   ', { fg: N.ink3, bg: N.sheet, a: ITALIC }]] : []), [`${G.length} aboard · ${when}`, { fg: N.ink3, bg: N.sheet }]], {}, room);
    const v = verdictOf(G), [va, vb] = VERDICT[v], vc = { hold: N.hold, review: N.glance, ok: N.clear }[v], vbg = { hold: N.holdBg, review: N.glanceBg, ok: N.clearBg }[v];
    c.right(W - 36, 0, 34, [[` ${{ hold: '◆', review: '●', ok: '✓' }[v]} ${va} ${vb} `, { fg: vc, bg: vbg, a: BOLD }]]);
    const open = G.filter(i => needs(i) && !i.approved);
    c.right(W - 36, 1, 34, [[`${open.filter(i => i.level === 'hold').length} held · ${open.filter(i => i.level === 'review').length} to glance`, { fg: N.ink3, bg: N.sheet }]]);
    // the tabs
    let x = 2;
    const counts = { review: G.filter(needs).length, aboard: G.length, keys: ledger().length, blind: (() => { const b = blindNotes(); return b.code ? `${(100 * b.read / b.code).toFixed(b.read === b.code ? 0 : 1)}%` : '—'; })() };
    S.tabX = [];
    for (const [k, name] of TABS) {
      const on = S.tab === k, t = ` ${name} `, n = ` ${counts[k]} `;
      S.tabX.push([x, x + width(t + n), k]);
      x = c.text(x, 3, [[t, { fg: on ? N.bg : N.ink2, bg: on ? N.ink : N.bg, a: BOLD }], [n, { fg: on ? N.bg : N.ink3, bg: on ? N.foam : N.shoal, a: on ? BOLD : 0 }]]) + 2;
    }
    if (S.tab === 'aboard') { let kx = W - 2 - KINDS.reduce((n, [, l]) => n + width(l) + 3, 0); for (const [k, l] of KINDS) kx = c.text(kx, 3, [[` ${l} `, { fg: S.kind === k ? N.ink : N.ink3, bg: S.kind === k ? N.deep : N.bg, a: S.kind === k ? BOLD : 0 }], [' ', { bg: N.bg }]]); }
    c.text(0, 4, '─'.repeat(W), { fg: N.rule, bg: N.bg });
    // the body: the list, and the inspector beside it (or instead of it, when narrow)
    const top = 5, bh = H - top - 1, lw = S.narrow ? W : Math.min(52, Math.floor(W * 0.4)), items = list();
    const sel = Math.min(S.sel[S.tab] ?? 0, Math.max(0, items.length - 1)); S.sel[S.tab] = sel;
    const showList = !S.narrow || S.focus === 'list', showInsp = !S.narrow || S.focus === 'insp';
    if (showList) drawList(c, 0, top, lw, bh, items, sel);
    if (showInsp) {
      const ix = S.narrow ? 0 : lw + 1, iw = W - ix;
      if (!S.narrow) for (let y = top; y < top + bh; y++) c.text(lw, y, '│', { fg: N.rule, bg: N.bg });
      drawInspector(c, ix + 2, top, iw - 4, bh, items[sel]);
    }
    if (S.cele) drawCelebration(c, W, H);
    drawFooter(c, W, H);
    if (S.help) drawHelp(c, W, H);
    return c;
  }
  function drawList(c, x, y, w, h, items, sel) {
    S.listBox = [x, y, w, h];
    if (!items.length) {
      const msg = S.q ? `Nothing matches "${S.q}".` : S.tab === 'review' ? 'Nothing needs you before you ship.' : S.tab === 'keys' ? 'None of your agent\'s tools hold a key to an outside account.' : 'Nothing here.';
      if (S.tab === 'review' && !S.q) { c.pixels(x + 4, y + 2, MASCOT, MPAL); c.text(x + 4, y + 8, [['Cleared to sail.', { fg: N.clear, bg: N.bg, a: BOLD }]]); c.text(x + 4, y + 9, [[clip(msg, w - 6), { fg: N.ink2, bg: N.bg }]]); }
      else c.text(x + 2, y + 1, [[clip(msg, w - 4), { fg: N.ink2, bg: N.bg }]]);
      return;
    }
    const rowH = S.tab === 'blind' ? 2 : 3, fit = Math.max(1, Math.floor(h / rowH));
    let t = S.top[S.tab] ?? 0;
    if (sel < t) t = sel; if (sel >= t + fit) t = sel - fit + 1;
    S.top[S.tab] = t;
    S.rows = [];
    for (let k = t; k < Math.min(items.length, t + fit); k++) {
      const ry = y + (k - t) * rowH, on = k === sel, it = items[k], bg = on ? N.deep : N.bg;
      S.rows.push([ry, rowH, k]);
      let slide = 0, ghost = false;
      if (S.anim && it.fp && S.anim.fp === it.fp) { const p = Math.min(1, (Date.now() - S.anim.t0) / 420); slide = Math.round((1 - (1 - p) ** 3) * w); ghost = true; }
      c.fill(x, ry, w, rowH - 1, ghost ? N.clearBg : bg);
      if (S.tab === 'keys') {
        c.text(x, ry, '▌', { fg: on ? N.lamp : N.bg, bg });
        c.text(x + 2, ry, [[it.service, { fg: N.ink, bg, a: BOLD }]], {}, w - 14);
        c.right(x, ry, w - 2, [[pl(it.who.size, 'tool'), { fg: N.ink3, bg }]]);
        c.text(x + 2, ry + 1, [[clip([...it.keys].join('  '), w - 4), { fg: N.lamp, bg }]]);
        continue;
      }
      if (S.tab === 'blind') { c.text(x, ry, '▌', { fg: on ? N.sea3 : N.bg, bg }); c.text(x + 2, ry, [[clip(it[0], w - 4), { fg: N.ink, bg, a: on ? BOLD : 0 }]]); continue; }
      const st = stateOf(it), fc = N[COL[st]], [name, ver] = split(it);
      if (ghost) { c.text(x + 2 + slide, ry, [[`✓ Cleared  ${name}`, { fg: N.clear, bg: N.clearBg, a: BOLD }]], {}, w - 2 - slide); continue; }
      c.text(x, ry, '▌', { fg: on ? fc : st === 'quiet' ? N.bg : N.quiet, bg });
      c.text(x, ry + 1, '▌', { fg: on ? fc : st === 'quiet' ? N.bg : N.quiet, bg });
      const nx = c.text(x + 2, ry, [[PIP[st] + ' ', { fg: fc, bg, a: BOLD }], [name, { fg: st === 'cleared' ? N.ink2 : N.ink, bg, a: BOLD }]], {}, w - 16);
      if (ver) c.text(nx + 1, ry, [[ver, { fg: N.ink3, bg }]], {}, Math.max(0, x + w - 13 - nx));
      c.right(x, ry, w - 2, [[KIND[it.kind], { fg: N.ink3, bg }]]);
      const top = it.findings.find(f => ORDER[f.level] >= 2) ?? it.findings[0];
      c.text(x + 4, ry + 1, [[clip(top ? top.says.charAt(0).toUpperCase() + top.says.slice(1) : 'Nothing to look at', w - 6), { fg: st === 'cleared' ? N.ink3 : N.ink2, bg }]]);
    }
    if (items.length > fit) {  // a rail instead of a scrollbar: where you are in the list
      const rh = Math.max(1, Math.round(h * fit / items.length)), ry = y + Math.round((h - rh) * t / Math.max(1, items.length - fit));
      for (let k = 0; k < h; k++) c.text(x + w - 1, y + k, k >= ry - y && k < ry - y + rh ? '┃' : '│', { fg: k >= ry - y && k < ry - y + rh ? N.ink3 : N.shoal, bg: N.bg });
    }
  }
  function drawInspector(c, x, y, w, h, it) {
    S.inspBox = [x, y, w, h];
    if (!it) return;
    const id = `${S.tab}|${it.fp ?? it.service ?? it[0]}|${w}|${it.approved}|${S.cacheGen}`;
    if (S.cacheId !== id) { S.cacheId = id; S.cache = detail(it, w); }  // code windows come off disk: once per item, not per frame
    const L = S.cache, max = Math.max(0, L.length - h);
    S.scroll = Math.max(0, Math.min(S.scroll, max));
    L.slice(S.scroll, S.scroll + h).forEach(([segs, bg], k) => {
      if (bg) c.fill(x - 1, y + k, w + 2, 1, bg);
      c.text(x, y + k, segs.map(([t, s]) => [t, { bg: bg ?? N.bg, ...s }]), {}, w);
    });
    if (max) c.right(x, y + h - 1, w, [[` ${Math.round(100 * S.scroll / max)}% · PgUp PgDn `, { fg: N.ink3, bg: N.shoal }]]);
  }
  function drawFooter(c, W, H) {
    c.fill(0, H - 1, W, 1, N.sheet);
    if (S.searching) { c.text(2, H - 1, [[' / ', { fg: N.bg, bg: N.foam, a: BOLD }], [' ' + S.q, { fg: N.ink, bg: N.sheet }], ['▌', { fg: N.foam, bg: N.sheet }], ['   ↵ keep  esc clear', { fg: N.ink3, bg: N.sheet }]]); return; }
    if (S.toast && Date.now() < S.toast.until) { c.text(2, H - 1, [[S.toast.t, { fg: S.toast.fg || N.clear, bg: N.sheet, a: BOLD }]]); return; }
    const k = (key, t) => [[` ${key} `, { fg: N.bg, bg: N.ink2, a: BOLD }], [` ${t}  `, { fg: N.ink3, bg: N.sheet }]];
    const hints = [k('↑↓', 'move'), k('←→', 'tabs'), ...(S.narrow ? [k('↵', S.focus === 'list' ? 'open' : 'back')] : [k('PgDn', 'read')]),
      ...(S.tab === 'review' || S.tab === 'aboard' ? [k('c', 'clear'), k('u', 'undo'), k('/', 'search')] : []), ...(S.tab === 'aboard' ? [k('f', 'kind')] : []),
      k('o', 'browser'), k('r', 'rewatch'), k('?', 'keys'), k('q', 'quit')];
    let x = 1;
    for (const h of hints) { if (x + width(h.map(p => p[0]).join('')) > W - 1) break; x = c.text(x, H - 1, h); }
  }
  function drawHelp(c, W, H) {
    const rows = [['↑ ↓  j k', 'move through the list'], ['← →  tab  1-4', 'switch tabs'], ['↵', 'open (on a narrow terminal), back with esc'], ['PgUp PgDn', 'read the inspector'],
      ['c', 'clear it: it won\'t ask again until its code changes'], ['u', 'undo the last clear'], ['/', 'search by name'], ['f', 'filter Aboard by kind'],
      ['o', 'open the morning report in the browser'], ['r', 'run the watch again'], ['mouse', 'click to pick, wheel to scroll'], ['q', 'quit (esc only steps back)']];
    const w = Math.min(W - 4, 78), h = rows.length + 6, x = (W - w) >> 1, y = Math.max(1, (H - h) >> 1);
    c.box(x, y, w, h, N.sea3, N.sheet, [[' Keys ', { fg: N.ink, bg: N.sheet, a: BOLD }]]);
    rows.forEach(([k, t], i) => c.text(x + 3, y + 2 + i, [[k.padEnd(16), { fg: N.foam, bg: N.sheet, a: BOLD }], [clip(t, w - 22), { fg: N.ink2, bg: N.sheet }]]));
    c.text(x + 3, y + h - 2, [['Reads code, never runs it. Any key closes this.', { fg: N.ink3, bg: N.sheet, a: ITALIC }]], {}, w - 6);
  }
  function drawCelebration(c, W, H) {  // the last one cleared: she sails
    const p = (Date.now() - S.cele) / 2600;
    if (p >= 1) { S.cele = null; return; }
    const y = H - 5, x = Math.round(-6 + p * (W + 12));
    for (let k = 0; k < W; k++) c.text(k, y + 2, '▁▂▃▂'[(k + Math.floor(p * 40)) % 4], { fg: N.sea2, bg: N.bg });
    c.text(x + 1, y, [['▐', { fg: N.ink3, bg: N.bg }], ['▀', { fg: N.clear, bg: N.bg }]]);
    c.text(x, y + 1, '▟██▙', { fg: N.sea3, bg: N.bg });
  }

  // ---------- doing ----------
  const draw = () => scr.draw(frame().lines(depth));
  const toast = (t, fg) => { S.toast = { t, fg, until: Date.now() + 3500 }; };
  const move = d => { const n = list().length; S.sel[S.tab] = Math.max(0, Math.min(n - 1, (S.sel[S.tab] ?? 0) + d)); S.scroll = 0; };
  const tab = d => { const k = TABS.findIndex(t => t[0] === S.tab); S.tab = TABS[(k + d + TABS.length) % TABS.length][0]; S.scroll = 0; S.focus = 'list'; };
  function clearIt() {
    const it = cur();
    if (!it?.fp || !needs(it) || it.approved || S.anim) return;
    S.anim = { fp: it.fp, t0: Date.now() };
    setTimeout(() => {
      for (const k of keysOf(it)) approve(run, k);
      S.undo.push(it); relevel(); S.anim = null;
      const left = G.filter(i => needs(i) && !i.approved).length;
      toast(`✓ Cleared ${label(it)}. It won't ask again until its code changes.  u undoes it`);
      if (!left && motion) S.cele = Date.now();
      draw();
    }, motion ? 430 : 0);
  }
  function undo() {
    const it = S.undo.pop();
    if (!it) return toast('Nothing to undo.', N.ink3);
    const st = load();
    for (const k of keysOf(it)) if (st.approved[k] === it.fp) delete st.approved[k];
    save(st); relevel();
    toast(`↺ ${label(it)} is back on the list.`, N.glance);
  }

  return new Promise(resolve => {
    let timer;
    const quit = how => { clearInterval(timer); process.stdout.off('resize', onResize); scr.stop(); resolve(how); };
    const onResize = () => { scr.invalidate(); draw(); };
    scr.start(k => {
      if (S.help) { S.help = false; return draw(); }
      if (S.searching) {
        if (k.name === 'enter') S.searching = false;
        else if (k.name === 'escape') { S.searching = false; S.q = ''; }
        else if (k.name === 'backspace') S.q = S.q.slice(0, -1);
        else if (k.name === 'ctrl-c') return quit('quit');
        else if (k.ch && k.ch >= ' ') S.q += k.ch;
        S.sel[S.tab] = 0; return draw();
      }
      if (k.mouse) {
        const [lx, ly, lw, lh] = S.listBox || [], [ix, iy, iw] = S.inspBox || [];
        if (k.mouse === 'click' && k.y === 3) { const t = S.tabX?.find(([a, b]) => k.x >= a && k.x < b); if (t) { S.tab = t[2]; S.scroll = 0; } }
        else if (k.mouse === 'click' && lw && k.x >= lx && k.x < lx + lw && k.y >= ly && k.y < ly + lh && (!S.narrow || S.focus === 'list')) {
          const r = S.rows?.find(([ry, rh]) => k.y >= ry && k.y < ry + rh); if (r) { S.sel[S.tab] = r[2]; S.scroll = 0; if (S.narrow) S.focus = 'insp'; }
        } else if (k.mouse === 'wheelup' || k.mouse === 'wheeldown') {
          const d = k.mouse === 'wheelup' ? -1 : 1;
          if (iw && k.x >= ix - 1 && (!S.narrow || S.focus === 'insp')) S.scroll = Math.max(0, S.scroll + d * 3); else move(d);
        }
        return draw();
      }
      const ch = k.ch, n = k.name;
      if (n === 'ctrl-c' || ch === 'q') return quit('quit');
      if (n === 'escape' && S.q) { S.q = ''; }  // esc steps back, never out: q quits
      else if (n === 'escape' && S.narrow && S.focus === 'insp') S.focus = 'list';
      else if (n === 'escape') toast('q quits. Esc only steps back.', N.ink3);
      else if (S.narrow && n === 'left' && S.focus === 'insp') S.focus = 'list';
      else if (n === 'up' || ch === 'k') move(-1);
      else if (n === 'down' || ch === 'j') move(1);
      else if (n === 'home' || ch === 'g') { S.sel[S.tab] = 0; S.scroll = 0; }
      else if (n === 'end' || ch === 'G') { S.sel[S.tab] = list().length - 1; S.scroll = 0; }
      else if (n === 'right' || n === 'tab') tab(1);
      else if (n === 'left' || n === 'shift-tab') tab(-1);
      else if (ch >= '1' && ch <= '4') { S.tab = TABS[+ch - 1][0]; S.scroll = 0; }
      else if (n === 'pagedown' || ch === ' ') S.scroll += Math.max(3, (scr.size[1] - 8) >> 1);
      else if (n === 'pageup') S.scroll = Math.max(0, S.scroll - Math.max(3, (scr.size[1] - 8) >> 1));
      else if (n === 'enter') { if (S.narrow) S.focus = S.focus === 'list' ? 'insp' : 'list'; }
      else if (ch === 'c' && (S.tab === 'review' || S.tab === 'aboard')) clearIt();
      else if (ch === 'u') undo();
      else if (ch === '/') { S.searching = true; S.q = ''; }
      else if (ch === 'f' && S.tab === 'aboard') { const k = KINDS.findIndex(x => x[0] === S.kind); S.kind = KINDS[(k + 1) % KINDS.length][0]; S.sel.aboard = 0; }
      else if (ch === 'o') { openBrowser(); toast('Opening the morning report in your browser…', N.sea3); }
      else if (ch === 'r') return quit('rerun');
      else if (ch === '?') S.help = true;
      draw();
    });
    process.stdout.on('resize', onResize);
    // a slow heartbeat: the mark blinks now and then, a clear slides away, the last one sails
    let nextBlink = Date.now() + 3000;
    timer = setInterval(() => {
      const now = Date.now();
      if (motion && now > nextBlink) { S.blink = true; setTimeout(() => { S.blink = false; draw(); }, 140); nextBlink = now + 3500 + Math.random() * 3000; }
      if (S.anim || S.cele || S.blink || (S.toast && now < S.toast.until + 100)) draw();
    }, motion ? 40 : 500);
    draw();
  });
}
