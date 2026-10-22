// The terminal, drawn properly. A canvas of cells (character, colours, weight) that turns into as little ANSI as it
// can, true colour when the terminal has it and 256 or none when it doesn't, widths that count what you see, keys and
// mouse as names, and frames written as only the lines that changed. No dependencies.

const ESC = '\x1b[';
export const caps = (out = process.stdout) => {
  if (process.env.NO_COLOR || !out.isTTY) return { color: 0, motion: false };
  const env = process.env, truecolor = /truecolor|24bit/i.test(env.COLORTERM || '') || !!env.WT_SESSION || out.hasColors?.(2 ** 24);
  const motion = !env.CI && !env.SLOWSHIP_NO_MOTION && !process.argv.includes('--no-motion');
  return { color: truecolor ? 24 : out.hasColors?.(256) ? 8 : 4, motion };
};

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const to256 = ([r, g, b]) => {
  const grey = Math.abs(r - g) < 10 && Math.abs(g - b) < 10;
  if (grey) return r < 8 ? 16 : r > 238 ? 231 : 232 + Math.round((r - 8) / 247 * 24);
  return 16 + 36 * Math.round(r / 255 * 5) + 6 * Math.round(g / 255 * 5) + Math.round(b / 255 * 5);
};
const to16 = ([r, g, b]) => {
  const bright = Math.max(r, g, b) > 170 ? 60 : 0;
  return (Math.round(b / 255) << 2 | Math.round(g / 255) << 1 | Math.round(r / 255)) + bright;
};
/** The SGR codes for a colour at this depth: fg or bg. */
function colour(h, depth, bg) {
  if (!h || !depth) return '';
  const c = hex(h);
  if (depth === 24) return `${bg ? 48 : 38};2;${c.join(';')}`;
  if (depth === 8) return `${bg ? 48 : 38};5;${to256(c)}`;
  const n = to16(c);
  return String((bg ? 40 : 30) + n);
}

// ---------- widths ----------
const ANSI = /\x1b\[[0-9;?<>]*[ -/]*[@-~]/g;
export const strip = s => String(s).replace(ANSI, '');
const wide = cp => cp >= 0x1100 && (cp <= 0x115f || (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) || (cp >= 0xac00 && cp <= 0xd7a3)
  || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6)
  || (cp >= 0x1f300 && cp <= 0x1f64f) || (cp >= 0x1f900 && cp <= 0x1f9ff) || (cp >= 0x20000 && cp <= 0x3fffd));
const zero = cp => (cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || cp === 0xfe0f || cp === 0xfe0e;
const charWidth = ch => { const cp = ch.codePointAt(0); return cp < 32 ? 0 : zero(cp) ? 0 : wide(cp) ? 2 : 1; };
/** How many columns a string takes on screen. */
export const width = s => { let w = 0; for (const ch of strip(s)) w += charWidth(ch); return w; };

/** Words into lines no wider than w (long words are cut). */
export function wrap(text, w) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let wd = word;
      while (width(wd) > w) { if (line) { out.push(line); line = ''; } out.push(cut(wd, w)); wd = wd.slice([...cut(wd, w)].length); }
      if (!line) line = wd;
      else if (width(line) + 1 + width(wd) <= w) line += ' ' + wd;
      else { out.push(line); line = wd; }
    }
    out.push(line);
  }
  return out;
}
const cut = (s, w) => { let o = '', n = 0; for (const ch of s) { const cw = charWidth(ch); if (n + cw > w) break; o += ch; n += cw; } return o; };
/** Cut to w columns, with an ellipsis when something was cut. */
export const clip = (s, w) => width(s) <= w ? s : w <= 1 ? cut(s, w) : cut(s, w - 1) + '…';

// ---------- the canvas ----------
export const BOLD = 1, DIM = 2, ITALIC = 4, UNDER = 8;
export class Canvas {
  constructor(w, h, bg = null) {
    this.w = w; this.h = h; this.bg = bg;
    this.rows = Array.from({ length: h }, () => Array.from({ length: w }, () => ({ ch: ' ', fg: null, bg, a: 0 })));
  }
  /** Text at (x, y): a string, or [[text, style], …]. Clipped at x + max. Returns where it ended. Style: { fg, bg, a }. */
  text(x, y, parts, st = {}, max = this.w - x) {
    if (y < 0 || y >= this.h) return x;
    const end = Math.min(this.w, x + Math.max(0, max));
    for (const [t, s = st] of typeof parts === 'string' ? [[parts, st]] : parts) {
      for (const ch of String(t)) {
        const cw = charWidth(ch);
        if (!cw) continue;
        if (x + cw > end) return x;
        if (x >= 0) {
          const c = this.rows[y][x];
          c.ch = ch; c.fg = s.fg ?? null; c.a = s.a ?? 0; if (s.bg !== undefined) c.bg = s.bg;
          if (cw === 2 && x + 1 < this.w) Object.assign(this.rows[y][x + 1], { ch: '', fg: c.fg, bg: c.bg, a: c.a });
        }
        x += cw;
      }
    }
    return x;
  }
  /** Right-aligned text ending at column x + w. */
  right(x, y, w, parts, st) { const t = typeof parts === 'string' ? parts : parts.map(p => p[0]).join(''); return this.text(x + Math.max(0, w - width(t)), y, parts, st, w); }
  fill(x, y, w, h, bg, ch = ' ', fg = null) {
    for (let r = Math.max(0, y); r < Math.min(this.h, y + h); r++)
      for (let c = Math.max(0, x); c < Math.min(this.w, x + w); c++) Object.assign(this.rows[r][c], { ch, fg, bg, a: 0 });
  }
  /** A rounded box: ╭─╮ │ │ ╰─╯, with an optional title in the top edge. */
  box(x, y, w, h, fg, bg, title) {
    if (w < 2 || h < 2) return;
    this.fill(x, y, w, h, bg);
    const st = { fg, bg };
    this.text(x, y, '╭' + '─'.repeat(w - 2) + '╮', st); this.text(x, y + h - 1, '╰' + '─'.repeat(w - 2) + '╯', st);
    for (let r = y + 1; r < y + h - 1; r++) { this.text(x, r, '│', st); this.text(x + w - 1, r, '│', st); }
    if (title) this.text(x + 2, y, typeof title === 'string' ? [[` ${title} `, { fg, bg, a: BOLD }]] : title, st, w - 4);
  }
  /** Pixel art with half blocks: two pixels per cell, top and bottom. grid: rows of palette letters ('.' is empty). */
  pixels(x, y, grid, palette) {
    for (let r = 0; r < grid.length; r += 2) for (let c = 0; c < grid[r].length; c++) {
      const top = palette[grid[r][c]] ?? null, bot = palette[grid[r + 1]?.[c]] ?? null, yy = y + r / 2, xx = x + c;
      if (yy < 0 || yy >= this.h || xx < 0 || xx >= this.w || (!top && !bot)) continue;
      const cell = this.rows[yy][xx];
      if (top && bot && top === bot) Object.assign(cell, { ch: '█', fg: top, a: 0 });
      else if (top && bot) Object.assign(cell, { ch: '▀', fg: top, bg: bot, a: 0 });
      else Object.assign(cell, { ch: top ? '▀' : '▄', fg: top || bot, a: 0 });
    }
  }
  /** Each row as ANSI, with codes only where the style changes. */
  lines(depth) {
    return this.rows.map(row => {
      let s = '', cur = null;
      for (const c of row) {
        if (c.ch === '') continue;  // the second half of a wide character
        const key = depth ? `${c.fg}|${c.bg}|${c.a}` : '';
        if (key !== cur) {
          const codes = ['0'];
          if (c.a & BOLD) codes.push('1'); if (c.a & DIM) codes.push('2'); if (c.a & ITALIC) codes.push('3'); if (c.a & UNDER) codes.push('4');
          const f = colour(c.fg, depth, false), b = colour(c.bg, depth, true);
          if (f) codes.push(f); if (b) codes.push(b);
          if (depth) s += `${ESC}${codes.join(';')}m`;
          cur = key;
        }
        s += c.ch;
      }
      return depth ? s + `${ESC}0m` : s.replace(/\s+$/, '');
    });
  }
}

// ---------- keys and mouse ----------
const SEQ = {
  '\x1b[A': 'up', '\x1b[B': 'down', '\x1b[C': 'right', '\x1b[D': 'left', '\x1bOA': 'up', '\x1bOB': 'down', '\x1bOC': 'right', '\x1bOD': 'left',
  '\x1b[5~': 'pageup', '\x1b[6~': 'pagedown', '\x1b[H': 'home', '\x1b[F': 'end', '\x1b[1~': 'home', '\x1b[4~': 'end', '\x1bOH': 'home', '\x1bOF': 'end',
  '\x1b[Z': 'shift-tab', '\r': 'enter', '\n': 'enter', '\t': 'tab', '\x7f': 'backspace', '\b': 'backspace', '\x03': 'ctrl-c', '\x1b': 'escape',
};
const TOKEN = /\x1b\[<\d+;\d+;\d+[mM]|\x1b\[[0-9;]*[A-Za-z~]|\x1bO[A-Z]|\x1b|[\s\S]/gu;
/** A chunk of terminal input as keys: { name } for special keys, { ch } for characters, { mouse } for the mouse. */
export function keys(chunk) {
  const out = [];
  for (const [t] of String(chunk).matchAll(TOKEN)) {
    const m = t.match(/^\x1b\[<(\d+);(\d+);(\d+)([mM])$/);
    if (m) {
      const b = +m[1], x = +m[2] - 1, y = +m[3] - 1;
      out.push({ mouse: b === 64 ? 'wheelup' : b === 65 ? 'wheeldown' : b === 0 && m[4] === 'M' ? 'click' : 'other', x, y });
    } else if (SEQ[t]) out.push({ name: SEQ[t] });
    else if (t.startsWith('\x1b')) out.push({ name: 'unknown' });
    else out.push({ ch: t });
  }
  return out;
}

// ---------- the screen ----------
/** Full-screen mode: the alternate buffer, no cursor, raw keys, mouse; and always put back the way it was. */
export class Screen {
  constructor(out = process.stdout, inp = process.stdin) { this.out = out; this.inp = inp; this.prev = []; this.on = false; }
  get size() { return [this.out.columns || 80, this.out.rows || 24]; }
  start(onKey, { mouse = true } = {}) {
    this.on = true; this.prev = [];
    this.out.write(`${ESC}?1049h${ESC}?25l${ESC}2J` + (mouse ? `${ESC}?1000h${ESC}?1006h` : ''));
    if (this.inp.isTTY) this.inp.setRawMode(true);
    this.inp.setEncoding('utf8'); this.inp.resume();
    this.listener = chunk => { for (const k of keys(chunk)) onKey(k); };
    this.inp.on('data', this.listener);
    this.restore = () => this.stop();
    process.on('exit', this.restore);
  }
  /** Draw only the lines that changed since the last frame. */
  draw(lines) {
    let s = '';
    lines.forEach((l, y) => { if (this.prev[y] !== l) s += `${ESC}${y + 1};1H${l}`; });
    if (s) this.out.write(s);
    this.prev = lines;
  }
  invalidate() { this.prev = []; this.out.write(`${ESC}2J`); }
  stop() {
    if (!this.on) return;
    this.on = false;
    this.out.write(`${ESC}?1000l${ESC}?1006l${ESC}0m${ESC}?25h${ESC}?1049l`);
    if (this.inp.isTTY) this.inp.setRawMode(false);
    this.inp.off('data', this.listener); this.inp.pause();
    process.off('exit', this.restore);
  }
}

/** A block of lines in the normal scrollback that can be redrawn in place (the live watch). */
export class Region {
  constructor(out = process.stdout) { this.out = out; this.n = 0; }
  draw(lines) {
    let s = this.n ? `${ESC}${this.n}F` : '';
    for (const l of lines) s += `${ESC}2K${l}\n`;
    for (let i = lines.length; i < this.n; i++) s += `${ESC}2K\n`;
    if (lines.length < this.n) s += `${ESC}${this.n - lines.length}F`;
    this.out.write(`${ESC}?25l` + s);
    this.n = lines.length;
  }
  done() { this.out.write(`${ESC}?25h`); this.n = 0; }
}
