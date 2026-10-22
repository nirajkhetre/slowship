// Makes the site's pictures. Terminal pictures are slowship's own output (the same canvas the terminal gets), turned
// into HTML a cell at a time so blocks and box lines join up. Screenshots are of the real report, taken by a headless
// Edge or Chrome over its debugging protocol. Nothing here reads anything new: the report shows the demo's watch.
//   node site/shots.mjs [term|web] [--url http://127.0.0.1:7798]
// The report has to be running with the demo's data (the slowship-ui preview); a throwaway browser profile goes on D:.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = import.meta.dirname, web = join(here, 'web');
const args = process.argv.slice(2), only = args.find(a => a === 'term' || a === 'web'), url = args[args.indexOf('--url') + 1] && args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:7798';

// ---------- terminal pictures ----------
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
// what a block or box character covers of its cell, as backgrounds: [x, y, w, h] in eighths
const EIGHTH = { '▁': 1, '▂': 2, '▃': 3, '▄': 4, '▅': 5, '▆': 6, '▇': 7, '█': 8 };
const QUAD = { '▘': [0], '▝': [1], '▖': [2], '▗': [3], '▀': [0, 1], '▌': [0, 2], '▐': [1, 3], '▛': [0, 1, 2], '▜': [0, 1, 3], '▙': [0, 2, 3], '▟': [1, 2, 3] };
const BOX = { '─': 'h', '│': 'v', '╭': 'rd', '╮': 'ld', '╰': 'ru', '╯': 'lu', '├': 'vr', '┤': 'vl', '┬': 'hd', '┴': 'hu', '┼': 'hv', '▕': 'R', '▏': 'L' };
function cellBg(ch, fg, bg) {
  const c = fg || '#E8ECF8', layers = [], at = (x, y, w, h) => layers.push(`linear-gradient(${c},${c}) ${x} ${y}/${w} ${h} no-repeat`);
  if (EIGHTH[ch]) at('0', '100%', '100%', `${EIGHTH[ch] * 12.5}%`);
  else if (QUAD[ch]) for (const q of QUAD[ch]) at(q % 2 ? '100%' : '0', q > 1 ? '100%' : '0', '50%', '50%');
  else if (BOX[ch]) {
    const k = BOX[ch], t = '1.5px';
    if (k === 'R') at('100%', '0', '25%', '100%'); else if (k === 'L') at('0', '0', '25%', '100%');
    else {
      if (k.includes('h')) at('0', '50%', '100%', t);
      if (k.includes('v')) at('50%', '0', t, '100%');
      if (k.includes('r')) at('100%', '50%', '50%', t);
      if (k.includes('l')) at('0', '50%', '50%', t);
      if (k.includes('d')) at('50%', '100%', t, '50%');
      if (k.includes('u')) at('50%', '0', t, '50%');
    }
  } else return null;
  return layers.join(',') + (bg ? `,${bg}` : '');
}
/** ANSI lines (true colour) as one <pre>, each cell exactly one column wide. */
function toHTML(lines, cols) {
  const rows = lines.map(line => {
    let st = { fg: null, bg: null, b: false, d: false, i: false, u: false }, out = '', run = '', runKey = null;
    const style = s => [s.fg && `color:${s.fg}`, s.bg && `background:${s.bg}`, s.b && 'font-weight:700', s.d && 'opacity:.6', s.i && 'font-style:italic', s.u && 'text-decoration:underline'].filter(Boolean).join(';');
    const flush = () => { if (run) out += `<span${runKey ? ` style="${runKey}"` : ''}>${esc(run)}</span>`; run = ''; };
    for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
      const m = part.match(/^\x1b\[([0-9;]*)m$/);
      if (m) {
        const n = m[1].split(';').map(Number);
        for (let k = 0; k < n.length; k++) {
          const x = n[k];
          if (x === 0) st = { fg: null, bg: null, b: false, d: false, i: false, u: false };
          else if (x === 1) st.b = true; else if (x === 2) st.d = true; else if (x === 3) st.i = true; else if (x === 4) st.u = true;
          else if ((x === 38 || x === 48) && n[k + 1] === 2) { const hex = '#' + n.slice(k + 2, k + 5).map(v => v.toString(16).padStart(2, '0')).join(''); x === 38 ? st.fg = hex : st.bg = hex; k += 4; }
        }
        continue;
      }
      for (const ch of part) {
        const drawn = cellBg(ch, st.fg, st.bg);
        if (drawn || ch.codePointAt(0) > 126) {
          flush();
          const s = style({ ...st, fg: drawn ? null : st.fg, bg: null });
          out += drawn ? `<i style="background:${drawn}${st.d ? ';opacity:.6' : ''}"></i>` : `<i${s || st.bg ? ` style="${[s, st.bg && `background:${st.bg}`].filter(Boolean).join(';')}"` : ''}>${esc(ch)}</i>`;
          continue;
        }
        const key = style(st);
        if (key !== runKey) { flush(); runKey = key; }
        run += ch;
      }
    }
    flush();
    return `<span class="tl">${out}</span>`;
  });
  return `<pre class="tpic" style="--cols:${cols}">${rows.join('\n')}</pre>`;
}

async function terminal() {
  const home = mkdtempSync(join(tmpdir(), 'slowship-shots-'));  // an empty memory: nothing here is cleared
  process.env.SLOWSHIP_HOME = home;
  const { help, card, review, bye } = await import('../src/tui.js');
  const run = JSON.parse(readFileSync(join(here, 'demo-run.json'), 'utf8')).run;
  const grab = (fn, W) => { let s = ''; fn({ depth: 24, motion: false, W, out: { write: t => { s += t; } } }); return s.replace(/^\n+|\n+$/g, '').split('\n'); };
  mkdirSync(join(web, 'term'), { recursive: true });
  const save = (name, lines, cols) => { writeFileSync(join(web, 'term', `${name}.html`), toHTML(lines, cols)); console.log(`term/${name}.html  ${lines.length} rows`); };
  save('help', grab(io => help(io), 96), 96);
  save('card', grab(io => card(run, 207098, io), 96), 96);
  save('card-mini', grab(io => card(run, 207098, io), 58), 58);
  const frame = async keys => {
    const scr = { size: [118, 34], start(on) { this.on = on; }, draw(l) { this.last = l; }, invalidate() {}, stop() {} };
    const done = review(structuredClone(run), { screen: scr, depth: 24, motion: false });
    for (const k of keys) scr.on(k);
    const lines = scr.last; scr.on({ name: 'escape' }); scr.on({ ch: 'q' }); await done;  // Esc closes an overlay first
    return lines;
  };
  save('review', await frame([]), 118);
  save('review-keys', await frame([{ name: 'right' }, { name: 'right' }]), 118);
  // the try-it terminal on the site: every tab, the first few rows of each, and the keys overlay, as real frames
  mkdirSync(join(web, 'term', 'frames'), { recursive: true });
  const seen = new Map(), map = { tabs: [] };
  for (let t = 0; t < 4; t++) {
    const row = [];
    for (let s = 0; s < 6; s++) {
      const html = toHTML(await frame([...Array(t)].map(() => ({ name: 'right' })).concat([...Array(s)].map(() => ({ name: 'down' })))), 118);
      if (seen.has(html)) break;  // the list ends here: more downs change nothing
      const f = `t${t}s${s}`; seen.set(html, f); row.push(f);
      writeFileSync(join(web, 'term', 'frames', `${f}.html`), html);
    }
    map.tabs.push(row);
  }
  writeFileSync(join(web, 'term', 'frames', 'help.html'), toHTML(await frame([{ ch: '?' }]), 118));
  writeFileSync(join(web, 'term', 'frames', 'bye.html'), toHTML(grab(io => bye(run, io), 118), 118));  // what q leaves in the scrollback
  writeFileSync(join(web, 'term', 'frames', 'frames.json'), JSON.stringify(map));
  console.log(`term/frames  ${map.tabs.map(r => r.length).join('+')} frames and the keys overlay`);
}

// ---------- screenshots of the report ----------
const BROWSERS = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'];
const wait = ms => new Promise(r => setTimeout(r, ms));
async function screenshots() {
  const exe = BROWSERS.find(existsSync); if (!exe) throw new Error('no Edge or Chrome found');
  const profile = existsSync('D:/') ? 'D:/slowship-shots/profile' : mkdtempSync(join(tmpdir(), 'slowship-profile-'));
  mkdirSync(profile, { recursive: true });
  const port = 9333, b = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  try {
    let list; for (let k = 0; k < 50 && !list; k++) { await wait(200); list = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()).catch(() => null); }
    const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = new Map(), events = [];
    ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else events.push(d.method); };
    const send = (method, params = {}) => new Promise((res, rej) => { const k = ++id; pending.set(k, d => d.error ? rej(new Error(`${method}: ${d.error.message}`)) : res(d.result)); ws.send(JSON.stringify({ id: k, method, params })); });
    const js = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.value;
    await send('Page.enable'); await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('slowship-tour-3','1');sessionStorage.setItem('slowship-hello','1')}catch{}" });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1.5, mobile: false });
    mkdirSync(join(web, 'img'), { recursive: true });
    const shot = async (name, { dark = false, prep = '', settle = 2600 } = {}) => {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
      events.length = 0; await send('Page.navigate', { url });
      for (let k = 0; k < 100 && !events.includes('Page.loadEventFired'); k++) await wait(100);
      await wait(1800);
      if (prep) await js(`(async () => { ${prep} })()`);
      await wait(settle);
      const { data } = await send('Page.captureScreenshot', { format: 'webp', quality: 82 });
      writeFileSync(join(web, 'img', `${name}.webp`), Buffer.from(data, 'base64'));
      console.log(`img/${name}.webp  ${Math.round(data.length * .75 / 1024)} KB`);
    };
    const toTabs = "const t = document.querySelector('#tabs'); scrollTo(0, t.getBoundingClientRect().top + scrollY - 64);";
    await shot('report-hero');
    await shot('report-dark', { dark: true });
    await shot('report-review', { prep: toTabs });
    await shot('report-inspector', { prep: `${toTabs} await new Promise(r => setTimeout(r, 900)); const c = document.querySelector('#insp .code, #insp pre, #insp .xray') || document.querySelector('#insp'); scrollTo(0, c.getBoundingClientRect().top + scrollY - 120);` });
    await shot('report-aboard', { prep: `document.querySelector('#t-aboard').click(); await new Promise(r => setTimeout(r, 500)); const p = document.querySelector('#pmap'); scrollTo(0, p.getBoundingClientRect().top + scrollY - 90);` });
    await shot('report-keys', { prep: `document.querySelector('#t-aboard').click(); await new Promise(r => setTimeout(r, 500)); ${toTabs}` });
    await shot('report-blind', { prep: `document.querySelector('#t-blind').click(); await new Promise(r => setTimeout(r, 500)); ${toTabs}` });
    await shot('report-skipper', { prep: "document.querySelector('#skip').click();", settle: 2200 });
    await shot('report-settings', { prep: 'openSettings();', settle: 1800 });
    // the agents are shown by their command names; the picture keeps only codex and the editor card
    await shot('report-agent', { prep: `openSettings(); await new Promise(r => setTimeout(r, 700)); document.querySelector('#sg-agent').scrollIntoView({ block: 'start' });
      let c = [...document.querySelectorAll('#sg-agent *')].find(e => !e.childElementCount && e.textContent.trim() === 'codex');
      while (c?.parentElement && !c.parentElement.textContent.includes('Any editor')) c = c.parentElement;
      [...(c?.parentElement?.children ?? [])].forEach(x => { if (!/codex|Any editor/.test(x.textContent)) x.remove(); });
      document.querySelectorAll('#sg-agent p, #sg-agent span').forEach(e => { if (!e.childElementCount) e.textContent = e.textContent.replace('all 3 agents', 'your agents'); });`, settle: 1800 });
    await shot('report-ping', { prep: "openPing('discord', 1);", settle: 3200 });
    ws.close();
  } finally { b.kill(); }
}

if (only !== 'web') await terminal();
if (only !== 'term') await screenshots();
