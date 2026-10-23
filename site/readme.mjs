// Makes the README's pictures in docs/readme: the designed ones (site/readme/*.html, in light and dark), screenshots of
// the real report (the live demo replaying site/demo-run.json), slowship's own terminal output, and the films. A headless
// Edge or Chrome photographs them over its debugging protocol; ffmpeg turns frames into animated WebP and MP4.
//   node site/readme.mjs [pictures] [shots] [terminal] [films]     no argument: all four. Run `node site/build.mjs` first.
// Films are big, so they go outside the repository (SLOWSHIP_FILMS, default D:/slowship-films) to be uploaded by hand.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';

const here = import.meta.dirname, root = resolve(here, '..'), out = join(root, 'docs', 'readme');
const films = process.env.SLOWSHIP_FILMS || (existsSync('D:/') ? 'D:/slowship-films' : join(tmpdir(), 'slowship-films'));
const want = process.argv.slice(2), does = k => !want.length || want.includes(k);
mkdirSync(out, { recursive: true }); mkdirSync(films, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
const size = f => `${Math.round(readFileSync(f).length / 1024)} KB`;

// the repository over http, so fonts and the demo load as they would on the web
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!path.startsWith(root)) { res.writeHead(403).end(); return; }
  const file = existsSync(join(path, 'index.html')) ? join(path, 'index.html') : path;
  let body; try { body = readFileSync(file); } catch { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

// the browser, driven over its debugging protocol
const BROWSERS = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'];
const exe = BROWSERS.find(existsSync); if (!exe) throw new Error('no Edge or Chrome found');
const profile = existsSync('D:/') ? 'D:/slowship-shots/profile-readme' : mkdtempSync(join(tmpdir(), 'slowship-profile-'));
mkdirSync(profile, { recursive: true });
const port = 9334, browser = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });
let list; for (let k = 0; k < 60 && !list; k++) { await wait(200); list = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()).catch(() => null); }
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(), events = [], listeners = [];
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else { events.push(d.method); for (const l of listeners) l(d); } };
const send = (method, params = {}) => new Promise((res, rej) => { const k = ++id; pending.set(k, d => d.error ? rej(new Error(`${method}: ${d.error.message}`)) : res(d.result)); ws.send(JSON.stringify({ id: k, method, params })); });
const js = async expr => (await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true })).result?.value;
await send('Page.enable'); await send('Runtime.enable');
// the skipper comes from the report itself; the demo's first-visit tour and hello stay away
const index = readFileSync(join(root, 'src', 'ui', 'index.html'), 'utf8');
const skipper = index.slice(index.indexOf('const SKIPPER = `') + 17, index.indexOf('`;', index.indexOf('const SKIPPER = `')));
await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.SKIPPER = ${JSON.stringify(skipper)}; try { localStorage.setItem('slowship-tour-3', '1'); sessionStorage.setItem('slowship-hello', '1'); } catch {}` });

const open = async (url, { width = 1440, height = 900, scale = 2, dark = false } = {}) => {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });  // round corners stay see-through
  events.length = 0; await send('Page.navigate', { url });
  for (let k = 0; k < 100 && !events.includes('Page.loadEventFired'); k++) await wait(100);
  await js('await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));');
};
// the element and the room around it, so the plate's hard shadow (8px below) is in the picture
const box = async (sel, pad = 10) => js(`const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.max(0, r.x - ${pad}), y: Math.max(0, r.y + scrollY - ${pad}), width: r.width + ${pad * 2}, height: r.height + ${pad * 2} };`);
const shoot = async (file, { clip, format = 'webp', quality = 90 } = {}) => {
  const { data } = await send('Page.captureScreenshot', { format, ...(format === 'png' ? {} : { quality }), ...(clip ? { clip: { ...clip, scale: 1 } } : {}), captureBeyondViewport: !!clip });
  writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
};
const ffmpeg = args => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
// a paused page, stepped through time: every CSS animation is set to the same moment, so loops line up exactly
const frames = async (dir, { clip, seconds, fps }) => {
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  await js('document.getAnimations().forEach(a => a.pause());');
  for (let f = 0; f < seconds * fps; f++) {
    await js(`document.getAnimations().forEach(a => { a.currentTime = ${(f / fps) * 1000}; }); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));`);
    await shoot(join(dir, `f${String(f).padStart(4, '0')}.png`), { clip, format: 'png' });
  }
};

try {
  if (does('pictures')) {
    for (const name of ['verdicts', 'aboard', 'decides', 'pills']) for (const dark of [false, true]) {
      await open(`${base}/site/readme/${name}.html`, { width: 1260, scale: 2, dark });
      const f = await shoot(join(out, `${name}${dark ? '-dark' : ''}.webp`), { clip: await box('#shot'), quality: 88 });
      console.log(`${f.slice(root.length + 1)}  ${size(f)}`);
    }
    // the hero moves: 4 s at 15 frames a second, one seamless loop, as an animated WebP (and a still for anywhere else)
    await open(`${base}/site/readme/hero.html`, { width: 1260, scale: 1.25 });
    const clip = await box('#shot'), tmp = join(tmpdir(), 'slowship-hero');
    await frames(tmp, { clip, seconds: 4, fps: 15 });
    ffmpeg(['-framerate', '15', '-i', join(tmp, 'f%04d.png'), '-c:v', 'libwebp_anim', '-q:v', '68', '-loop', '0', '-preset', 'picture', join(out, 'hero.webp')]);
    ffmpeg(['-i', join(tmp, 'f0000.png'), '-c:v', 'libwebp', '-q:v', '88', join(out, 'hero-still.webp')]);
    console.log(`docs/readme/hero.webp  ${size(join(out, 'hero.webp'))} (animated)`);
  }

  if (does('shots')) {
    // the real report, replaying the recorded watch; the demo's own "live demo" strip is left out of the pictures
    const demo = `${base}/site/dist/demo/?towed`, prep = "document.querySelector('.demoline')?.remove(); await new Promise(r => setTimeout(r, 2600)); document.getAnimations().forEach(a => { try { if (a.timeline instanceof DocumentTimeline && a.effect.getComputedTiming().iterations !== Infinity) a.finish(); } catch {} });";
    const toTabs = "scrollTo(0, document.querySelector('#tabs').getBoundingClientRect().top + scrollY - 70);";
    const shots = [
      ['report-verdict', ''], ['report-verdict-dark', '', true],
      ['report-review', `${toTabs} const it = G.find(i => i.kind === 'autorun'); openItem(it); await new Promise(r => setTimeout(r, 1400)); ${toTabs}`],
      ['report-code', `${toTabs} const it = G.find(i => i.kind === 'autorun'); openItem(it); await new Promise(r => setTimeout(r, 1400)); const c = [...document.querySelectorAll('.dt .code, .dt pre')][0] || document.querySelector('.dt .says'); scrollTo(0, c.getBoundingClientRect().top + scrollY - 260);`, false, 720],
      ['report-storms', `setTab('storm'); await new Promise(r => setTimeout(r, 1200)); scrollTo(0, document.querySelector('#p-storm').getBoundingClientRect().top + scrollY - 70);`],
      ['report-storms-dark', `setTab('storm'); await new Promise(r => setTimeout(r, 1200)); scrollTo(0, document.querySelector('#p-storm').getBoundingClientRect().top + scrollY - 70);`, true],
      ['report-aboard', `setTab('aboard'); await new Promise(r => setTimeout(r, 1200)); ${toTabs}`],
    ];
    for (const [name, script, dark, crop] of shots) {
      await open(demo, { width: 1440, height: crop || 900, scale: 1.5, dark });  // a shorter window crops below what matters
      // the demo opens in Day whatever the system says, and remembers a choice: every shot sets its own
      await js(`try { setTheme('${dark ? 'dark' : 'light'}'); } catch { applyTheme('${dark ? 'dark' : 'light'}'); } await new Promise(r => setTimeout(r, 600));`);
      await js(`${prep} ${script} await new Promise(r => setTimeout(r, 2600)); document.getAnimations().forEach(a => { try { if (a.timeline instanceof DocumentTimeline && a.effect.getComputedTiming().iterations !== Infinity) a.finish(); } catch {} }); await new Promise(r => setTimeout(r, 400));`);
      mkdirSync(join(root, 'site', 'dist', 'readme-raw'), { recursive: true });  // site/dist is ignored: the raw shot waits there
      await shoot(join(root, 'site', 'dist', 'readme-raw', `${name}.webp`), { quality: 92 });
      // then onto a plate in the README's own style, in the same theme
      await open(`${base}/site/readme/frame.html?src=${encodeURIComponent(`/site/dist/readme-raw/${name}.webp`)}&w=1080`, { width: 1160, height: 900, scale: 2, dark });
      await js("for (let k = 0; k < 50 && !document.body.dataset.ready; k++) await new Promise(r => setTimeout(r, 100));");
      const f = await shoot(join(out, `${name}.webp`), { clip: await box('#shot'), quality: 84 });
      console.log(`${f.slice(root.length + 1)}  ${size(f)}`);
    }
  }
  // slowship's own terminal output (site/shots.mjs term makes it from the same recording), in the site's terminal window
  const term = async (f, cmd, scale = 2) => {
    await open(`${base}/site/readme/term.html?f=${encodeURIComponent(f)}&cmd=${encodeURIComponent(cmd)}`, { width: 1220, height: 900, scale });
    await js("for (let k = 0; k < 50 && !document.body.dataset.ready; k++) await new Promise(r => setTimeout(r, 100)); await document.fonts.ready;");
    return box('#shot');
  };
  // the review walked through: down the list, across the tabs, the keys, and what q leaves behind
  const WALK = [['t0s0', 1.4], ['t0s1', .7], ['t0s2', .7], ['t0s3', .9], ['t1s0', 1.4], ['t1s1', .7], ['t1s2', .9], ['t2s0', 1.6], ['t3s0', 1.4], ['t3s1', .7], ['t3s2', .9], ['help', 2.2], ['bye', 2.4]];
  const walk = async (dir, scale) => {
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
    let list = '';
    for (const [f, d] of WALK) {
      const clip = await term(`web/term/frames/${f}`, 'slowship review', scale);
      await shoot(join(dir, `${f}.png`), { clip, format: 'png' });
      list += `file '${join(dir, `${f}.png`).replaceAll('\\', '/')}'\nduration ${d}\n`;
    }
    writeFileSync(join(dir, 'list.txt'), list + `file '${join(dir, 'bye.png').replaceAll('\\', '/')}'\n`);  // the last frame is listed twice so its duration counts
    return join(dir, 'list.txt');
  };
  if (does('terminal')) {
    for (const [f, cmd, name] of [['web/term/card', 'slowship', 'terminal-card'], ['web/term/review', 'slowship review', 'terminal-review']]) {
      const f2 = await shoot(join(out, `${name}.webp`), { clip: await term(f, cmd), quality: 88 });
      console.log(`${f2.slice(root.length + 1)}  ${size(f2)}`);
    }
    const list = await walk(join(tmpdir(), 'slowship-walk'), 1.25);
    ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=10', '-c:v', 'libwebp_anim', '-q:v', '74', '-loop', '0', join(out, 'terminal.webp')]);
    console.log(`docs/readme/terminal.webp  ${size(join(out, 'terminal.webp'))} (animated)`);
  }

  if (does('films')) {
    // MP4s to upload by hand: the hero (three loops), the terminal walk, and a tour of the report
    await open(`${base}/site/readme/hero.html`, { width: 1260, scale: 1.6 });
    const hero = join(tmpdir(), 'slowship-hero-film');
    await frames(hero, { clip: await box('#shot'), seconds: 4, fps: 30 });
    ffmpeg(['-framerate', '30', '-i', join(hero, 'f%04d.png'), '-vf', 'loop=loop=2:size=120:start=0,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', join(films, 'slowship-hero.mp4')]);
    const list = await walk(join(tmpdir(), 'slowship-walk-film'), 2);
    ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', join(films, 'slowship-terminal.mp4')]);
    // the tour: the real report, filmed as it draws, scrolls, clears one thing and moves between tabs
    const tour = join(tmpdir(), 'slowship-tour'); rmSync(tour, { recursive: true, force: true }); mkdirSync(tour, { recursive: true });
    await open(`${base}/site/dist/demo/?towed`, { width: 1440, height: 900, scale: 1.3334 });
    await js("try { setTheme('light'); } catch {} document.querySelector('.demoline')?.remove(); scrollTo(0, 0);");
    const shots = [];
    listeners.push(d => { if (d.method !== 'Page.screencastFrame') return; const f = join(tour, `s${String(shots.length).padStart(5, '0')}.jpg`); writeFileSync(f, Buffer.from(d.params.data, 'base64')); shots.push([f, d.params.metadata.timestamp]); send('Page.screencastFrameAck', { sessionId: d.params.sessionId }); });
    await js("location.reload();"); await wait(300);
    await send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1200, everyNthFrame: 1 });
    const glide = y => js(`const from = scrollY, to = ${y}, t0 = performance.now(); await new Promise(r => { const step = t => { const k = Math.min(1, (t - t0) / 1400); scrollTo(0, from + (to - from) * (k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)); k < 1 ? requestAnimationFrame(step) : r(); }; requestAnimationFrame(step); });`);
    await wait(4200);
    await js("document.querySelector('.demoline')?.remove();");
    await glide(await js("return document.querySelector('#tabs').getBoundingClientRect().top + scrollY - 70;")); await wait(2200);
    await js("document.querySelector('[data-act=clear]')?.click();"); await wait(5200);
    await js("setTab('storm');"); await wait(2600);
    await glide(await js("return document.querySelector('#p-storm .stormrows')?.getBoundingClientRect().top + scrollY - 160;")); await wait(2400);
    await js("setTab('aboard');"); await wait(1200);
    await glide(await js("return document.querySelector('#tabs').getBoundingClientRect().top + scrollY - 70;")); await wait(2600);
    await send('Page.stopScreencast');
    let tl = ''; shots.forEach(([f, t], k) => { tl += `file '${f.replaceAll('\\', '/')}'\nduration ${((shots[k + 1]?.[1] ?? t + 1.5) - t).toFixed(3)}\n`; });
    writeFileSync(join(tour, 'list.txt'), tl + `file '${shots.at(-1)[0].replaceAll('\\', '/')}'\n`);
    ffmpeg(['-f', 'concat', '-safe', '0', '-i', join(tour, 'list.txt'), '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', join(films, 'slowship-tour.mp4')]);
    for (const n of ['slowship-hero', 'slowship-terminal', 'slowship-tour']) console.log(`${join(films, `${n}.mp4`)}  ${size(join(films, `${n}.mp4`))}`);
  }
} finally { ws.close(); browser.kill(); server.close(); }
