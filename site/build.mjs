// Builds the web demo into site/dist: the real report page and its fonts, one recorded watch (site/record.mjs), the
// small stand-in for the local server (site/demo.js), and a line saying plainly what this is.
//   node site/build.mjs [demo-run.json] [--cname slowship.example.com]
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2), ci = args.indexOf('--cname'), cname = ci >= 0 ? args.splice(ci, 2)[1] : null;
const root = resolve(import.meta.dirname, '..'), ui = join(root, 'src', 'ui'), dist = join(import.meta.dirname, 'dist');
const data = resolve(args[0] ?? join(import.meta.dirname, 'demo-run.json'));

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'fonts'), { recursive: true });
cpSync(join(ui, 'fonts'), join(dist, 'fonts'), { recursive: true });
cpSync(join(import.meta.dirname, 'demo.js'), join(dist, 'demo.js'));
cpSync(data, join(dist, 'demo-run.json'));

const swap = (html, from, to) => { if (!html.includes(from)) throw new Error(`build: can't find ${from.slice(0, 40)}`); return html.replace(from, to); };
let html = readFileSync(join(ui, 'index.html'), 'utf8').replaceAll('url(/fonts/', 'url(fonts/');
html = swap(html, '<title>slowship · morning report</title>', `<title>slowship · a replay of a real watch</title>
<meta name="description" content="slowship reads your npm packages, agent skills, MCP servers and your own build overnight, on your laptop, and asks of each: does this do what it says it does?">
<meta property="og:title" content="slowship: ship safe, slowly"><meta property="og:description" content="A local, overnight check of everything your project brings aboard. Read, never run.">
<script src="demo.js"></script>`);
html = swap(html, '</style>', `.demoline{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;padding:9px 16px;font-size:13.5px;text-align:center;background:var(--ink);color:var(--paper)}
.demoline a{color:inherit;font-weight:650;text-underline-offset:3px}
.demoline .dtag{font-weight:700;padding:3px 8px;border-radius:6px;background:color-mix(in oklab,var(--paper) 18%,transparent)}
</style>`);
html = swap(html, '<header class="bar" id="bar">', `<div class="demoline"><span class="dtag">Demo</span><span>A replay of one real watch, recorded with gemma4 on a laptop: REA’s public npm dependencies plus slowship’s own inert test fixtures. Nothing here touches your computer.</span><a href="https://github.com/nirajkhetre/slowship">Get slowship</a></div>
<header class="bar" id="bar">`);
// a replay is not the real thing: its length is the replay's, and it says so
html = swap(html, 'say(`Done in ${clock(w.finished - w.started)}`)', 'say(`Replayed in ${clock(w.finished - w.started)}`)');
html = swap(html, 'dn.innerHTML = `Done in <b>${clock(w.finished - w.started)}</b>.', 'dn.innerHTML = `Replayed in <b>${clock(w.finished - w.started)}</b> (the real night took ${clock(D_REAL)}).');
html = swap(html, '<script src="demo.js"></script>', `<script src="demo.js"></script>\n<script>const D_REAL = ${JSON.parse(readFileSync(data, 'utf8')).recorded.ms};</script>`);
writeFileSync(join(dist, 'index.html'), html);
if (cname) writeFileSync(join(dist, 'CNAME'), cname + '\n');
console.log(`built ${dist}${cname ? ` for ${cname}` : ''}`);
