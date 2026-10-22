// Builds the public site into site/dist: the landing page, the docs (one page each, from site/web/docs), and the live
// demo at demo/, which is the real report page answered from one recorded watch (site/record.mjs, site/demo.js).
//   node site/build.mjs [demo-run.json] [--cname slowship.example.com]
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2), ci = args.indexOf('--cname'), cname = ci >= 0 ? args.splice(ci, 2)[1] : null;
const here = import.meta.dirname, root = resolve(here, '..'), ui = join(root, 'src', 'ui'), web = join(here, 'web'), dist = join(here, 'dist');
const data = resolve(args[0] ?? join(here, 'demo-run.json'));
const GH = 'https://github.com/nirajkhetre/slowship';

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'fonts'), { recursive: true });
cpSync(join(ui, 'fonts'), join(dist, 'fonts'), { recursive: true });
for (const f of ['site.css', 'site.js', 'docs.css', 'docs.js', 'play.css', 'play.js']) cpSync(join(web, f), join(dist, f));
if (existsSync(join(web, 'img'))) cpSync(join(web, 'img'), join(dist, 'img'), { recursive: true });
if (existsSync(join(web, 'term', 'frames'))) cpSync(join(web, 'term', 'frames'), join(dist, 'term', 'frames'), { recursive: true });

// ---------- the try-it windows: slowship's own words, made here by slowship's own code from the recorded watch ----------
{
  process.env.SLOWSHIP_HOME = join(dist, '.nohome');  // nothing here reads or writes anyone's memory
  const { summary, discordBody, telegramText, said } = await import('../src/notify.js');
  const { brief } = await import('../src/mcp.js');
  const { cronLine } = await import('../src/schedule.js');
  const rec = JSON.parse(readFileSync(data, 'utf8')).run;
  // the morning ping as it would read after last night (held), after you clear the held ones (a glance), and with all clear
  const as = upTo => ({ ...rec, items: rec.items.map(i => ({ ...i, approved: ['hold', 'review'].slice(0, upTo).includes(i.level) })) });
  const ping = {};
  for (const [k, run] of [['hold', as(0)], ['review', as(1)], ['ok', as(2)]]) {
    const s = summary(run), t = summary(run, { test: true });
    ping[k] = { s, discord: discordBody(s), telegram: telegramText(s), testDiscord: discordBody(t), testTelegram: telegramText(t) };
  }
  // what your agent hears back from check, for each package in the recording, exactly as slowship's MCP server says it
  const agent = rec.items.filter(i => i.kind === 'npm').map(i => {
    const name = i.key.replace(/^npm:/, '').replace(/@[^@]*$/, ''), why = i.findings?.find(f => f.level === 'hold' || f.level === 'review');
    // the recording's folders are stand-ins, so brief() can't find the files to name: put back the file:line it names on a real machine
    let text = brief({ ...rec, items: [{ ...i, approved: false }], unread: [] }, `: what npm install ${name} would bring aboard`);
    for (const e of i.facts ?? []) if (e.file && e.line > 0) text = text.replaceAll(`${i.dir}:${e.line}\n`, `${i.dir}/${e.file}:${e.line}\n`);
    text = text.replaceAll(i.dir, i.dir.replaceAll('\\', '/'));  // recorded on Windows; shown as the stand-in it is
    return { name, version: i.key.split('@').pop(), level: i.level, why: why ? said(why) : '', brief: text };
  }).sort((a, b) => a.name.localeCompare(b.name));
  // the nightly crontab line, at 03:00, for a laptop that keeps its projects in ~/code
  const cron = cronLine('03:00', ['/usr/local/bin/node', '/home/you/slowship/bin/slowship.js', '/home/you/code/your-app'], '/home/you/.slowship').replaceAll('\\', '/');
  writeFileSync(join(dist, 'play.json'), JSON.stringify({ ping, agent, cron, model: rec.model }));
  // who can spend your money: the very rules slowship uses, lifted out of src/agents.js for the page to run on your text
  const src = readFileSync(join(root, 'src', 'agents.js'), 'utf8'), a = src.indexOf('// ---------- who can spend your money'), b = src.indexOf('/** Where an MCP server');
  if (a < 0 || b < a) throw new Error('build: the key rules moved in src/agents.js');
  writeFileSync(join(dist, 'play-keys.js'), `// lifted from slowship's src/agents.js at build time, unchanged\nwindow.SLOWSHIP_KEYS = (() => {\n${src.slice(a, b).replace(/^export /gm, '')}\nreturn { keysNamed, serviceOf, givenKeys };\n})();\n`);
}

// ---------- the pieces every page shares ----------
const FACE = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="5.6" y="9.4" width="24" height="20.6" rx="8" fill="#01040D"/><rect x="3.6" y="7.4" width="24" height="20.6" rx="8" fill="#F4F2EE" stroke="#0A1633" stroke-width="1.5"/><ellipse cx="9.4" cy="21.6" rx="2" ry="1.2" fill="#FF7AB8"/><ellipse cx="22" cy="21.6" rx="2" ry="1.2" fill="#FF7AB8"/><rect x="10.2" y="15" width="2" height="3.6" rx="1" fill="#0A1633"/><rect x="19.8" y="15" width="2" height="3.6" rx="1" fill="#0A1633"/><path d="M6.6 9.6C7.4 2.6 23.8 2.6 24.6 9.6Z" fill="#0A1633"/><rect x="3" y="8.2" width="25.2" height="2.8" rx="1.4" fill="#0A1633"/><circle cx="15.6" cy="5.6" r="1.5" fill="#FFC21A"/></svg>';
writeFileSync(join(dist, 'favicon.svg'), FACE.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
const header = (base, at) => `<a class="sr" href="#main">Skip to the content</a>
<header class="nav"><div class="in">
  <a class="brand" href="${base || './'}">${FACE}slowship</a>
  <nav class="links" aria-label="Site"><a href="${base}#how">How it works</a><a href="${base}#features">Features</a><a href="${base}#safety">Safety</a><a href="${base}docs/"${at === 'docs' ? ' aria-current="page"' : ''}>Docs</a><a href="${GH}">GitHub</a></nav>
  <a class="btn primary sm" href="${base}demo/">Try the live demo</a>
  <button class="menu-b" type="button" aria-label="Menu" aria-expanded="false"><i></i><i></i><i></i></button>
</div></header>`;
const footer = base => `<footer class="foot"><div class="wrap">
  <div class="cols">
    <div><a class="brand" href="${base || './'}">${FACE}slowship</a><p class="tag">Ship safe, slowly. A local, overnight check of everything your project brings aboard. Read, never run.</p></div>
    <div><h4>Product</h4><ul><li><a href="${base}demo/">Try the live demo</a></li><li><a href="${base}#how">How it works</a></li><li><a href="${base}#features">Features</a></li><li><a href="${base}#measured">Measured results</a></li></ul></div>
    <div><h4>Docs</h4><ul><li><a href="${base}docs/install/">Install</a></li><li><a href="${base}docs/first-watch/">Your first watch</a></li><li><a href="${base}docs/morning-report/">The morning report</a></li><li><a href="${base}docs/commands/">Commands</a></li></ul></div>
    <div><h4>Project</h4><ul><li><a href="${GH}">Source on GitHub</a></li><li><a href="${GH}/blob/main/LICENSE">MIT license</a></li><li><a href="${base}docs/safety/">Safety and privacy</a></li><li><a href="${base}docs/faq/">Questions</a></li></ul></div>
  </div>
  <div class="base"><span>Made for the DEV Hacktoberfest 2026 “Slow and Steady” challenge.</span><span>MIT licensed. No trackers on this site.</span></div>
</div></footer>`;
// terminal pictures, drawn from slowship's own output by site/shots.mjs: <!--term:name--> or <!--term:name|the command-->
const term = (html, base) => html.replace(/<!--term:([\w-]+)(?:\|([^>]*?))?-->/g, (_, name, cmd) => {
  const f = join(web, 'term', `${name}.html`);
  if (!existsSync(f)) throw new Error(`build: no terminal picture ${name}; run node site/shots.mjs`);
  const pre = readFileSync(f, 'utf8');
  return cmd ? `<figure class="termfig"><div class="term"><div class="tbar"><b>${cmd}</b></div>${pre}</div></figure>` : pre;
});
// the shared files carry a stamp of their content, so a browser never keeps an old copy after the site changes
const STAMP = createHash('sha1').update(['site.css', 'site.js', 'docs.css', 'docs.js', 'play.css', 'play.js'].map(f => readFileSync(join(web, f))).join('') + readFileSync(join(dist, 'play.json'))).digest('hex').slice(0, 8);
const page = (html, base, at) => term(html, base).replace('<!--header-->', header(base, at)).replace('<!--footer-->', footer(base)).replaceAll('{{base}}', base)
  .replace(/((?:site|docs|play)\.(?:css|js))"/g, `$1?v=${STAMP}"`).replaceAll('{{stamp}}', STAMP);

// ---------- the landing page ----------
writeFileSync(join(dist, 'index.html'), page(readFileSync(join(web, 'index.html'), 'utf8'), '', 'home'));

// ---------- the docs: one page each, a sidebar, what's on the page, and the next page ----------
const DOCS = [
  ['Getting started', [['', 'What slowship is'], ['install', 'Install'], ['first-watch', 'Your first watch']]],
  ['Using it', [['morning-report', 'The morning report'], ['terminal', 'The terminal review'], ['clearing', 'Clearing things'], ['nightly', 'The nightly watch'], ['morning-ping', 'Morning ping'], ['coding-agent', 'Your coding agent'], ['ci', 'In CI']]],
  ['How it works', [['what-it-reads', 'What it reads'], ['how-it-decides', 'How it decides'], ['blind-spots', 'What it can’t see'], ['safety', 'Safety and privacy']]],
  ['Reference', [['commands', 'Commands and options'], ['measured', 'Measured results'], ['faq', 'Questions']]],
];
const flat = DOCS.flatMap(([g, ps]) => ps.map(([slug, title]) => ({ g, slug, title })));
const slugify = s => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const plain = s => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&[a-z]+;/g, ' ');
const COPY = '<button class="copy" type="button" aria-label="Copy"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>Copy</button>';
const search = [];
flat.forEach((d, k) => {
  const base = d.slug ? '../../' : '../', url = `docs/${d.slug ? d.slug + '/' : ''}`;
  let body = readFileSync(join(web, 'docs', `${d.slug || 'index'}.html`), 'utf8');
  const toc = [];
  body = body.replace(/<h2>([\s\S]*?)<\/h2>/g, (_, t) => { const id = slugify(t); toc.push([id, t]); return `<h2 id="${id}"><a class="anchor" href="#${id}" aria-label="Link to this section">#</a>${t}</h2>`; });
  body = body.replace(/<pre><code>/g, `<div class="codeblock">${COPY}<pre><code>`).replace(/<\/code><\/pre>/g, '</code></pre></div>');
  const lead = plain(body.match(/<p class="lead">([\s\S]*?)<\/p>/)?.[1] ?? '').trim();
  search.push({ t: d.title, g: d.g, u: url, h: toc.map(([id, t]) => [plain(t), id]), x: lead });
  const prev = flat[k - 1], next = flat[k + 1], href = p => `${base}docs/${p.slug ? p.slug + '/' : ''}`;
  const side = DOCS.map(([g, ps]) => `<div class="sg"><h4>${g}</h4><ul>${ps.map(([slug, title]) => `<li><a href="${href({ slug })}"${slug === d.slug ? ' aria-current="page"' : ''}>${title}</a></li>`).join('')}</ul></div>`).join('');
  const html = `<!doctype html>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${plain(d.title)} · slowship docs</title>
<meta name="description" content="${lead.replace(/"/g, '&quot;')}">
<meta name="theme-color" content="#061335">
<link rel="icon" href="${base}favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${base}site.css"><link rel="stylesheet" href="${base}docs.css">
</head>
<body class="docs-page" data-base="${base}">
<!--header-->
<div class="docs wrap">
  <aside class="side" id="side" aria-label="Docs">
    <button class="sbtn" type="button" id="sopen"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg>Search docs<kbd>Ctrl K</kbd></button>
    <button class="sidebtn" type="button" id="sidebtn" aria-expanded="false" aria-controls="sidenav"><span>${d.g}</span><b>${d.title}</b><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg></button>
    <nav class="sidenav" id="sidenav">${side}</nav>
  </aside>
  <main class="doc" id="main">
    <p class="crumb">${d.g}</p>
    ${body.trim()}
    <nav class="pn" aria-label="More docs">${prev ? `<a class="prev" href="${href(prev)}"><small>Previous</small><b>${prev.title}</b></a>` : '<span></span>'}${next ? `<a class="next" href="${href(next)}"><small>Next</small><b>${next.title}</b></a>` : ''}</nav>
    <p class="edit"><a href="${GH}/tree/main/site/web/docs/${d.slug || 'index'}.html">Suggest a change to this page</a></p>
  </main>
  <nav class="toc" aria-label="On this page">${toc.length ? `<h4>On this page</h4><ul>${toc.map(([id, t]) => `<li><a href="#${id}">${t}</a></li>`).join('')}</ul>` : ''}</nav>
</div>
<!--footer-->
<dialog class="search" id="search" aria-label="Search the docs">
  <div class="sbox"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg><input id="sq" placeholder="Search the docs" autocomplete="off" spellcheck="false" aria-label="Search the docs"><kbd>Esc</kbd></div>
  <ul id="sres" role="listbox"></ul>
</dialog>
<script src="${base}site.js"></script><script src="${base}docs.js"></script>
</body>
</html>`;
  mkdirSync(join(dist, url), { recursive: true });
  writeFileSync(join(dist, url, 'index.html'), page(html, base, 'docs'));
});
writeFileSync(join(dist, 'search.json'), JSON.stringify(search));

// ---------- the live demo: the real report page, answered from one recorded watch ----------
mkdirSync(join(dist, 'demo'), { recursive: true });
cpSync(join(here, 'demo.js'), join(dist, 'demo', 'demo.js'));
cpSync(data, join(dist, 'demo', 'demo-run.json'));
const swap = (html, from, to) => { if (!html.includes(from)) throw new Error(`build: can't find ${from.slice(0, 40)}`); return html.replace(from, to); };
let html = readFileSync(join(ui, 'index.html'), 'utf8').replaceAll('url(/fonts/', 'url(../fonts/');
html = swap(html, '<title>slowship · morning report</title>', `<title>slowship · the live demo</title>
<meta name="description" content="A replay of one real slowship watch: the morning report, answered from a recording. Nothing here touches your computer.">
<link rel="icon" href="../favicon.svg" type="image/svg+xml">
<script src="demo.js"></script>`);
html = swap(html, '</style>', `.demoline{display:flex;align-items:center;justify-content:center;gap:10px 16px;flex-wrap:wrap;padding:9px 16px;font-size:13.5px;text-align:center;background:#040B22;color:#C9D2EC}
.demoline a{color:#F6F4EF;font-weight:700;text-underline-offset:3px}
.demoline .dback{text-decoration:none;display:inline-flex;align-items:center;gap:6px}
.demoline .dtag{font-weight:700;padding:3px 8px;border-radius:6px;background:#FFC21A;color:#0A1633}
.framed .demoline{display:none}
</style>
<script>if (window.top !== window.self) document.documentElement.classList.add('framed');  /* inside the site's try-it window */</script>`);
html = swap(html, '<header class="bar" id="bar">', `<div class="demoline"><a class="dback" href="../">← slowship</a><span class="dtag">Live demo</span><span>A replay of one real watch, recorded with gemma4 on a laptop: REA’s public npm dependencies plus slowship’s own inert test fixtures. Nothing here touches your computer.</span><a href="../docs/install/">Install it</a></div>
<header class="bar" id="bar">`);
// a replay is not the real thing: its length is the replay's, and it says so
html = swap(html, 'say(`Done in ${clock(w.finished - w.started)}`)', 'say(`Replayed in ${clock(w.finished - w.started)}`)');
html = swap(html, 'dn.innerHTML = `Done in <b>${clock(w.finished - w.started)}</b>.', 'dn.innerHTML = `Replayed in <b>${clock(w.finished - w.started)}</b> (the real night took ${clock(D_REAL)}).');
html = swap(html, '<script src="demo.js"></script>', `<script src="demo.js"></script>\n<script>const D_REAL = ${JSON.parse(readFileSync(data, 'utf8')).recorded.ms};</script>`);
writeFileSync(join(dist, 'demo', 'index.html'), html);

if (cname) writeFileSync(join(dist, 'CNAME'), cname + '\n');
console.log(`built ${dist}: the landing page, ${flat.length} docs pages and the demo${cname ? ` for ${cname}` : ''}`);
