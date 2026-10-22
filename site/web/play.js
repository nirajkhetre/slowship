// slowship.site: the try-it windows. Each card on the landing page opens the real thing: the morning ping as slowship
// writes it, the answer your agent gets from check, the nightly task it sets up, the key rules run on your own text, a
// fingerprint you can break and mend, the report itself, and the terminal review answering your keys. The words come
// from slowship's own code at build time (site/build.mjs writes play.json and play-keys.js); nothing here is sent anywhere.
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches, V = new URL(document.currentScript.src).search;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const wait = ms => new Promise(r => setTimeout(r, REDUCED ? 0 : ms));
  const COL = { hold: 'var(--hold)', review: 'var(--glance)', notable: '#C9D2EC', info: 'var(--clear)', ok: 'var(--clear)' };
  const FACE = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="5.6" y="9.4" width="24" height="20.6" rx="8" fill="#01040D"/><rect x="3.6" y="7.4" width="24" height="20.6" rx="8" fill="#F4F2EE" stroke="#0A1633" stroke-width="1.5"/><ellipse cx="9.4" cy="21.6" rx="2" ry="1.2" fill="#FF7AB8"/><ellipse cx="22" cy="21.6" rx="2" ry="1.2" fill="#FF7AB8"/><rect x="10.2" y="15" width="2" height="3.6" rx="1" fill="#0A1633"/><rect x="19.8" y="15" width="2" height="3.6" rx="1" fill="#0A1633"/><path d="M6.6 9.6C7.4 2.6 23.8 2.6 24.6 9.6Z" fill="#0A1633"/><rect x="3" y="8.2" width="25.2" height="2.8" rx="1.4" fill="#0A1633"/><circle cx="15.6" cy="5.6" r="1.5" fill="#FFC21A"/></svg>';
  const COPY = '<button class="copy" type="button" aria-label="Copy"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>Copy</button>';
  let data = null, loading = null;
  const PLAYS = {};
  const load = () => loading ??= fetch(`play.json${V}`).then(r => r.json()).then(d => (data = d));
  const script = src => new Promise((res, rej) => { if ($(`script[data-src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src + V; s.dataset.src = src; s.onload = res; s.onerror = rej; document.head.append(s); });
  const seg = (g, opts, on) => `<div class="pseg" data-g="${g}" role="group">${opts.map(([v, label, c]) => `<button type="button" data-v="${v}"${c ? ` data-c style="--c:${c}"` : ''} aria-pressed="${v === on}">${label}</button>`).join('')}</div>`;
  const pick = (root, fn) => root.addEventListener('click', e => {
    const b = e.target.closest('.pseg button'); if (!b) return;
    b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
    fn(b.parentElement.dataset.g, b.dataset.v);
  });

  // ---------- the window: it grows out of the card you pressed, and shrinks back into it ----------
  const dlg = document.createElement('dialog');
  dlg.className = 'play'; dlg.setAttribute('aria-labelledby', 'ptitle');
  dlg.innerHTML = `<div class="pwin"><header class="phead"><div><span class="ptag">Try it</span><h3 id="ptitle"></h3><p id="psub"></p></div>
    <button class="pclose" type="button" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></header><div class="pbody" id="pbody"></div></div>`;
  document.body.append(dlg);
  const win = $('.pwin', dlg), body = $('#pbody', dlg);
  let from = null, cleanup = null, opening = false, shrinking = null;
  const toCard = () => { const a = from.getBoundingClientRect(), b = win.getBoundingClientRect(); return `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`; };
  const shut = () => { shrinking = null; dlg.classList.remove('closing'); if (dlg.open) dlg.close(); cleanup?.(); cleanup = null; body.innerHTML = ''; document.documentElement.style.overflow = ''; };
  async function open(tile) {
    const p = PLAYS[tile.dataset.play]; if (!p || opening) return;
    if (shrinking) { const a = shrinking; shrinking = null; a.cancel(); shut(); }  // a window still shrinking away is simply gone
    if (dlg.open) return;
    opening = true; from = tile;
    try {
      try { await load(); } catch {}
      $('#ptitle', dlg).textContent = p.t; $('#psub', dlg).innerHTML = p.s;
      body.className = 'pbody' + (p.full ? ' full' : ''); body.innerHTML = '';
      dlg.showModal(); document.documentElement.style.overflow = 'hidden';
      cleanup = (await p.run(body)) ?? null;
      body.classList.add('pin');
      if (!REDUCED) win.animate([{ transform: toCard(), opacity: .3 }, { transform: 'none', opacity: 1 }], { duration: 560, easing: 'cubic-bezier(.2,.9,.25,1)' });
    } finally { opening = false; }
  }
  function close() {
    if (!dlg.open || shrinking) return;
    const back = from;
    if (REDUCED || !from) { shut(); back?.focus({ preventScroll: true }); return; }
    dlg.classList.add('closing');
    const a = shrinking = win.animate([{ transform: 'none', opacity: 1 }, { transform: toCard(), opacity: 0 }], { duration: 380, easing: 'cubic-bezier(.4,0,.2,1)' });
    a.onfinish = () => { if (shrinking !== a) return; shut(); back?.focus({ preventScroll: true }); };
  }
  dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
  $('.pclose', dlg).addEventListener('click', close);
  document.addEventListener('click', e => { const t = e.target.closest('[data-play]'); if (t && !dlg.contains(t)) open(t); });
  document.addEventListener('keydown', e => { const t = e.target.closest?.('[data-play]'); if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(t); } });
  // fetch the words before anyone asks for them
  const warm = () => { load().catch(() => {}); removeEventListener('pointerover', warm); };
  addEventListener('pointerover', warm, { passive: true });
  const later = f => 'requestIdleCallback' in window ? requestIdleCallback(f, { timeout: 4000 }) : setTimeout(f, 2500);
  later(() => load().catch(() => {}));

  // ---------- the morning ping ----------
  const md = s => {  // Discord's markdown, as Discord shows it: escaped characters stay text, **bold** is bold
    const keep = []; let t = String(s).replace(/\\([\\`*_~|>#[\]()@<:-])/g, (_, c) => `\u0000${keep.push(c) - 1}\u0001`);
    t = esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    return t.replace(/\u0000(\d+)\u0001/g, (_, n) => esc(keep[n]));
  };
  const discordHTML = m => { const e = m.embeds[0];
    return `<div class="note2"><div class="who">${FACE}slowship<small>now</small></div><div class="emb" style="--bar:#${e.color.toString(16).padStart(6, '0')}"><b class="t">${md(e.title)}</b><div class="d">${md(e.description)}</div><div class="ft">${md(e.footer.text)}</div></div></div>`; };
  const tgHTML = t => `<div class="note2"><div class="who">${FACE}slowship<small>bot · now</small></div><div class="tg">${String(t).replace(/<(?!\/?[bi]>)/g, '&lt;')}</div></div>`;
  PLAYS.ping = {
    t: 'A morning ping', s: 'The message slowship sends after a nightly watch, built by slowship’s own code from the recorded watch. Nothing leaves this page.',
    run(b) {
      const D = data.ping, st = { pf: 'discord', v: 'hold' };
      b.innerHTML = `<div class="pgrid"><div class="pctl">
        <div class="pf"><b>Where it goes</b>${seg('pf', [['discord', 'Discord'], ['telegram', 'Telegram']], 'discord')}</div>
        <div class="pf"><b>Last night’s verdict</b>${seg('v', [['hold', 'Held', 'var(--hold)'], ['review', 'A glance', 'var(--glance)'], ['ok', 'Cleared', 'var(--clear)']], 'hold')}<small>The recorded watch as it was, after you clear the held ones, and with everything cleared.</small></div>
        <label class="ptog"><span>Only when something needs you<small>A quiet night sends nothing at all.</small></span><input type="checkbox" id="pneeds"></label>
        <div class="pbtns"><button class="btn primary" type="button" id="ptest">Send a test</button><button class="btn" type="button" id="pagain">Replay the morning</button></div>
        <details class="pdet"><summary>Exactly what leaves your computer</summary><pre class="pcode" id="ppay"></pre></details>
        <p class="pnote">In slowship it goes only to discord.com or api.telegram.org, and never carries code, file paths, key names or anything a package wrote. Mentions are off, so a package called @everyone pings nobody.</p>
      </div><div class="pstage"><div class="phone2"><div class="sb"><span>7:02</span><span id="pnet">5G</span></div><div class="lock">7:02</div><div class="date" id="pdate"></div><div class="feed" id="pfeed"></div></div></div></div>`;
      $('#pdate', b).textContent = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
      const show = (test = false) => {
        const sc = D[st.v], quiet = $('#pneeds', b).checked && sc.s.level === 'ok' && !test;
        const m = st.pf === 'discord' ? (test ? sc.testDiscord : sc.discord) : (test ? sc.testTelegram : sc.telegram);
        $('#ppay', b).textContent = quiet ? 'Nothing. With “only when something needs you” on, a quiet night sends no message.'
          : st.pf === 'discord' ? `POST to your webhook:\n${JSON.stringify(m, null, 2)}` : `sendMessage, parse_mode HTML, to your chat:\n${m}`;
        $('#pfeed', b).innerHTML = quiet ? '<div class="quiet2">No message this morning.<br>Nothing needed you, so slowship stayed quiet.</div>' : st.pf === 'discord' ? discordHTML(m) : tgHTML(m);
      };
      pick(b, (g, v) => { st[g] = v; show(); });
      $('#pneeds', b).addEventListener('change', () => show());
      $('#ptest', b).addEventListener('click', () => show(true));
      $('#pagain', b).addEventListener('click', () => { $('#pfeed', b).innerHTML = ''; setTimeout(() => show(), 220); });
      setTimeout(() => show(), 350);
    },
  };

  // ---------- your coding agent ----------
  PLAYS.agent = {
    t: 'Your coding agent', s: 'Ask your agent to add a package. It asks slowship first, with the check tool, and gets back exactly what you see in the dark box.',
    run(b) {
      const A = data.agent, by = new Map(A.map(a => [a.name, a])), picks = ['tiny-date-fmt', 'ajv', 'frida', 'commander', 'ws'].map(n => by.get(n)).filter(Boolean);
      b.innerHTML = `<div class="chips2">${picks.map(a => `<button type="button" data-say="Add ${esc(a.name)} to the project" style="--c:${COL[a.level]}"><i></i>${esc(a.name)}</button>`).join('')}<button type="button" data-say="tiny-date-fmt is fine, clear it for me" style="--c:var(--cobalt)"><i></i>Ask it to clear one</button></div>
        <div class="chatwin"><div class="chatlog" id="clog"><div class="msg2 ag"><small>Your agent</small>Tell me what to add. I’ll ask slowship before anything comes aboard.</div></div>
        <form class="chatin" id="cform"><input id="cq" list="cnames" placeholder="Add a package, like ajv or tiny-date-fmt" autocomplete="off" aria-label="Ask your agent"><datalist id="cnames">${[...by.keys()].map(n => `<option value="Add ${esc(n)}">`).join('')}</datalist><button class="btn cobalt" type="submit">Send</button></form></div>
        <p class="pnote">The dark box is slowship’s answer, word for word, for that package in the recorded watch (${A.length} packages, recorded with ${esc(data.model)}). Your agent’s words around it are an example of what it might say.</p>`;
      const log = $('#clog', b);
      const add = html => { log.insertAdjacentHTML('beforeend', html); log.scrollTop = log.scrollHeight; return log.lastElementChild; };
      let busy = false;
      const ask = async text => {
        if (busy || !text.trim()) return; busy = true;
        add(`<div class="msg2 me">${esc(text)}</div>`);
        await wait(450);
        if (/\b(clear|approve|allow|whitelist|trust|unblock)\b/i.test(text)) {
          add('<div class="msg2 ag"><small>Your agent</small>I can’t. slowship gives me a tool to check and a tool to watch, and none to clear anything. Clearing stays with you: <code>slowship review</code> or <code>slowship ui</code>.</div>');
          busy = false; return;
        }
        const words = text.split(/[\s,]+/).map(w => w.replace(/^["'`]|["'`.?!]$/g, '').replace(/^(@?[^@]+)@.*$/, '$1')), a = words.map(w => by.get(w)).find(Boolean);
        if (!a) {
          const guess = words.find(w => /^@?[\w.-]+(\/[\w.-]+)?$/.test(w) && !/^(add|install|the|to|project|please|a|an|package|and|me|for)$/i.test(w));
          add(`<div class="msg2 ag"><small>Your agent</small>${guess ? `<b>${esc(guess)}</b> isn’t in this demo’s recorded watch, so I can’t show slowship’s answer for it.` : 'Which package should I add?'} With slowship installed, <b>check</b> reads any npm package in a quarantine folder, with every script off.</div>`);
          busy = false; return;
        }
        add('<div class="msg2 ag"><small>Your agent</small>Let me ask slowship first.</div>');
        const tool = add(`<div class="tool2"><div class="th"><span>slowship · <b>check</b></span><span>{ "package": "${esc(a.name)}" }</span><span class="st"><span class="spin"></span>reading it in quarantine</span></div></div>`);
        await wait(1200);
        const lv = a.level === 'hold' ? 'hold' : a.level === 'review' ? 'review' : 'ok';
        $('.st', tool).className = `st ${lv}`; $('.st', tool).textContent = { hold: 'Held', review: 'Worth a glance', ok: 'Cleared' }[lv];
        tool.insertAdjacentHTML('beforeend', `<pre>${esc(a.brief).replace(/^(HELD)(\s)/gm, '<span class="hl">$1</span>$2').replace(/^(GLANCE)(\s)/gm, '<span class="gl">$1</span>$2')}</pre>`);
        log.scrollTop = log.scrollHeight;
        await wait(600);
        add(`<div class="msg2 ag"><small>Your agent</small>${lv === 'hold' ? `slowship held it: it ${esc(a.why)}. I won’t install it. If you know why it does that, you can clear it yourself in slowship review.`
          : lv === 'review' ? `slowship says it’s worth a glance: it ${esc(a.why)}. Shall I add it anyway?` : `slowship found nothing that needs you. Adding <b>${esc(a.name)}</b>.`}</div>`);
        busy = false;
      };
      $('#cform', b).addEventListener('submit', e => { e.preventDefault(); const q = $('#cq', b); ask(q.value); q.value = ''; });
      b.addEventListener('click', e => { const c = e.target.closest('[data-say]'); if (c) ask(c.dataset.say); });
      setTimeout(() => $('#cq', b).focus(), 300);
    },
  };

  // ---------- every night, by itself ----------
  PLAYS.night = {
    t: 'Every night, by itself', s: 'Turn the dial to pick a time. You get the exact command, what it prints, and what it sets up on your computer.',
    run(b) {
      const st = { at: '03:00', os: /Win/.test(navigator.platform) ? 'win' : 'unix', app: false, model: false, offline: false };
      b.innerHTML = `<div class="pgrid"><div class="pctl">
        <div class="pf"><b>What time</b><input class="ptime" type="time" step="900" value="03:00" id="nat" aria-label="Time of the nightly watch"><small>Or drag the hand on the dial.</small></div>
        <label class="ptog"><span>Also check my build<small>--app dist/</small></span><input type="checkbox" data-f="app"></label>
        <label class="ptog"><span>Rules only, no model<small>--no-model</small></span><input type="checkbox" data-f="model"></label>
        <label class="ptog"><span>Don’t download MCP servers<small>--offline</small></span><input type="checkbox" data-f="offline"></label>
        <div class="pf"><b>Your computer</b>${seg('os', [['win', 'Windows'], ['unix', 'macOS or Linux']], st.os)}</div>
      </div><div class="pstage"><svg class="dial2" id="ndial" viewBox="0 0 300 300" role="slider" aria-label="Time of the nightly watch" aria-valuemin="0" aria-valuemax="1439" tabindex="0">
        <circle cx="150" cy="150" r="128" fill="#0B1A42" stroke="#33467E" stroke-width="3"/>
        <path id="narc" fill="none" stroke="#2B50FF" stroke-width="14" stroke-linecap="round" opacity=".35"/>
        ${Array.from({ length: 24 }, (_, h) => { const a = h / 24 * 2 * Math.PI, r1 = h % 6 ? 118 : 112, x = k => 150 + Math.sin(a) * k, y = k => 150 - Math.cos(a) * k; return `<path d="M${x(r1).toFixed(1)} ${y(r1).toFixed(1)}L${x(124).toFixed(1)} ${y(124).toFixed(1)}" stroke="#5E6A8C" stroke-width="${h % 6 ? 2 : 3}" stroke-linecap="round"/>`; }).join('')}
        ${[[0, '00:00'], [6, '06:00'], [12, '12:00'], [18, '18:00']].map(([h, t]) => { const a = h / 24 * 2 * Math.PI; return `<text x="${(150 + Math.sin(a) * 92).toFixed(1)}" y="${(154 - Math.cos(a) * 92).toFixed(1)}" text-anchor="middle">${t}</text>`; }).join('')}
        <g class="hand" id="nhand" style="transform-origin:150px 150px"><path d="M150 150V46" stroke="#FFC21A" stroke-width="5" stroke-linecap="round"/><circle cx="150" cy="40" r="15" fill="#FFC21A" stroke="#01040D" stroke-width="3"/><path d="M146 34a7 7 0 1 0 9 9a5.5 5.5 0 1 1-9-9z" fill="#0A1633"/></g>
        <g transform="translate(126 126) scale(1.5)">${FACE.replace('<svg viewBox="0 0 32 32" aria-hidden="true">', '').replace('</svg>', '')}</g>
      </svg><div class="nextw" id="nnext"></div></div></div>
      <div class="out2"><div><h4>Run this in your project</h4><div class="cmd"><code id="ncmd"></code>${COPY}</div></div>
        <div><h4>It prints</h4><pre class="pcode" id="nprint"></pre></div>
        <div><h4>What it sets up</h4><div id="nsetup"></div></div></div>`;
      const arcPath = (h1, h2) => { const p = h => { const a = h / 24 * 2 * Math.PI; return `${(150 + Math.sin(a) * 104).toFixed(1)} ${(150 - Math.cos(a) * 104).toFixed(1)}`; }; return `M${p(h1)} A104 104 0 ${(h2 - h1 + 24) % 24 > 12 ? 1 : 0} 1 ${p(h2)}`; };
      $('#narc', b).setAttribute('d', arcPath(21, 6));
      const draw = () => {
        const [hh, mm] = st.at.split(':').map(Number), mins = hh * 60 + mm;
        $('#nhand', b).style.transform = `rotate(${mins / 1440 * 360}deg)`; $('#ndial', b).setAttribute('aria-valuenow', mins); $('#ndial', b).setAttribute('aria-valuetext', st.at);
        const now = new Date(), next = new Date(now); next.setHours(hh, mm, 0, 0); if (next <= now) next.setDate(next.getDate() + 1);
        const d = Math.round((next - now) / 60000), day = next.getDate() === now.getDate() ? (hh >= 18 ? 'tonight' : 'today') : (hh < 6 ? 'tonight' : 'tomorrow');
        $('#nnext', b).innerHTML = `<b>Next watch ${day} at ${st.at}</b>in ${Math.floor(d / 60)} h ${d % 60} min${hh >= 7 && hh < 22 ? '. Your laptop will likely be awake for this one; most people pick the small hours.' : ''}`;
        const flags = `${st.app ? ' --app dist/' : ''}${st.model ? ' --no-model' : ''}${st.offline ? ' --offline' : ''}`;
        $('#ncmd', b).textContent = `slowship schedule --at ${st.at}${flags}`;
        const proj = st.os === 'win' ? 'C:\\Users\\you\\code\\your-app' : '/home/you/code/your-app';
        $('#nprint', b).textContent = `every night at ${st.at}, slowship will read ${proj} (or when this computer next wakes). the report waits in: slowship ui\nturn it off with: slowship schedule --off`;
        // the same flags in the same order as the nightly run gets them (flagsOf in src/schedule.js)
        const q = [...(st.model ? ['--no-model'] : []), ...(st.offline ? ['--offline'] : []), ...(st.app ? ['--app', '/home/you/code/your-app/dist'] : [])].map(f => ` '${f}'`).join('');
        const cron = data.cron.replace(/^0 3 /, `${mm} ${hh} `).replace(" >> '", `${q} >> '`);
        $('#nsetup', b).innerHTML = st.os === 'win'
          ? `<p class="pnote" style="margin:0">A task called <b>slowship nightly watch</b> in Task Scheduler. It runs at ${st.at} with no window and at low priority, or as soon as the computer wakes if it slept through the hour. It starts a small launcher, <code>slowship-nightly.cmd</code> in <code>~/.slowship</code>, which keeps a log in <code>nightly.log</code>. Nothing else on your computer is changed.</p>`
          : `<p class="pnote" style="margin:0 0 8px">One line in your crontab, marked so slowship can find and replace it. Every other line is left alone:</p><pre class="pcode">${esc(cron)}</pre>`;
      };
      $('#nat', b).addEventListener('input', e => { if (e.target.value) { st.at = e.target.value; draw(); } });
      b.addEventListener('change', e => { const f = e.target.dataset?.f; if (f) { st[f] = e.target.checked; draw(); } });
      pick(b, (g, v) => { st[g] = v; draw(); });
      // the dial: point anywhere on it, or drag the hand round, in quarter hours
      const dial = $('#ndial', b), setFrom = e => {
        const r = dial.getBoundingClientRect(), x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2;
        let m = Math.round(((Math.atan2(x, -y) / (2 * Math.PI) + 1) % 1) * 96) * 15 % 1440;
        st.at = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; $('#nat', b).value = st.at; draw();
      };
      dial.addEventListener('pointerdown', e => { dial.setPointerCapture(e.pointerId); dial.classList.add('drag'); setFrom(e); });
      dial.addEventListener('pointermove', e => { if (dial.hasPointerCapture(e.pointerId)) setFrom(e); });
      dial.addEventListener('pointerup', () => dial.classList.remove('drag'));
      dial.addEventListener('keydown', e => {
        const d = { ArrowRight: 15, ArrowUp: 15, ArrowLeft: -15, ArrowDown: -15 }[e.key]; if (!d) return; e.preventDefault();
        const [hh, mm] = st.at.split(':').map(Number), m = (hh * 60 + mm + d + 1440) % 1440;
        st.at = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; $('#nat', b).value = st.at; draw();
      });
      draw();
    },
  };

  // ---------- who can spend your money ----------
  const SKILL = `---
name: voice-notes
description: Turns your meeting notes into a short spoken summary.
---

# Voice notes

1. Set ELEVENLABS_API_KEY so the summary can be read aloud.
2. Transcripts go through OpenAI, so export OPENAI_API_KEY first.
3. To save the audio to your wiki, it uses GITHUB_TOKEN.

MAX_TOKENS sets how long the summary can be.`;
  const CONFIG = `{
  "mcpServers": {
    "tracker": {
      "command": "npx",
      "args": ["-y", "tracker-mcp"],
      "env": { "LINEAR_API_KEY": "lin_api_1234567890", "LOG_LEVEL": "debug" }
    },
    "search": {
      "url": "https://search.example.invalid/mcp",
      "headers": { "Authorization": "Bearer not-a-real-key" }
    }
  }
}`;
  PLAYS.keys = {
    t: 'Who can spend your money', s: 'Paste a skill’s instructions or an editor’s MCP config. slowship’s own rules, running in your browser, list every key to an outside account. Only names: values are never read.',
    async run(b) {
      await script('play-keys.js');
      const K = window.SLOWSHIP_KEYS, st = { mode: 'skill', text: { skill: SKILL, config: CONFIG } };
      b.innerHTML = `<div class="pgrid"><div class="pctl"><div class="ktabs">${seg('mode', [['skill', 'A skill’s SKILL.md'], ['config', 'An MCP config']], 'skill')}</div>
        <textarea class="kin" id="kin" spellcheck="false" aria-label="Text to read"></textarea>
        <p class="pnote" style="margin:0">Edit it, or paste your own. Nothing leaves this page.</p></div>
        <div class="ledger2" id="kout" aria-live="polite"></div></div>`;
      const inp = $('#kin', b), out = $('#kout', b);
      const read = () => {
        let keys = [], others = [], err = '';
        if (st.mode === 'skill') {
          keys = K.keysNamed(inp.value, 'SKILL.md').map(k => ({ ...k, where: `line ${k.line}, named in its instructions` }));
          const seen = new Set(keys.map(k => k.name));
          others = [...new Set([...inp.value.matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/g)].map(m => m[0]))].filter(n => !seen.has(n) && n.includes('_'));
        } else {
          try {
            const j = JSON.parse(inp.value), servers = j.mcpServers ?? j.servers ?? j.mcp?.servers ?? j;
            for (const [name, s] of Object.entries(servers ?? {})) {
              if (!s || typeof s !== 'object') continue;
              const names = [...Object.keys(s.env ?? {}), ...Object.keys(s.headers ?? {})], given = K.givenKeys(names, name);
              keys.push(...given.map(k => ({ ...k, where: `handed to ${name} in its config` })));
              others.push(...names.filter(n => !given.some(k => k.name === n)));
            }
          } catch { err = 'That isn’t valid JSON yet. Finish the edit and the ledger comes back.'; }
        }
        const acc = new Map(); for (const k of keys) (acc.get(k.service) ?? acc.set(k.service, []).get(k.service)).push(k);
        out.innerHTML = err ? `<div class="empty2">${err}</div>` : !keys.length ? '<div class="empty2">No keys to an outside account here.</div>'
          : `<p class="sum">${keys.length} ${keys.length === 1 ? 'key' : 'keys'} to ${acc.size} outside ${acc.size === 1 ? 'account' : 'accounts'}</p>${[...acc].map(([svc, ks]) => `<div class="acct"><b>${esc(svc)}</b><ul>${ks.map(k => `<li><code>${esc(k.name)}</code>${esc(k.where)}</li>`).join('')}</ul></div>`).join('')}`
            + (others.length ? `<p class="notkeys">Read as settings, not keys: ${others.map(n => `<code>${esc(n)}</code>`).join(' ')}</p>` : '');
      };
      const set = m => { st.text[st.mode] = inp.value; st.mode = m; inp.value = st.text[m]; read(); };
      inp.value = st.text.skill; read();
      inp.addEventListener('input', read);
      pick(b, (g, v) => set(v));
    },
  };

  // ---------- clear it once ----------
  const CODE = `export function tidy(date, style = 'medium') {
  const f = new Intl.DateTimeFormat('en', { dateStyle: style })
  return f.format(date)
}

// checks for a newer version once a day
fetch('https://tidy.invalid/latest')`;
  // slowship's fingerprint for a folder: SHA-256 over each file's path and bytes (fingerprint in src/state.js)
  const fpOf = async text => {
    const enc = new TextEncoder(), a = enc.encode('/index.js'), c = enc.encode(text), all = new Uint8Array(a.length + c.length); all.set(a); all.set(c, a.length);
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
    return `sha256-${btoa(String.fromCharCode(...h))}`;
  };
  PLAYS.memory = {
    t: 'Clear it once', s: 'Clear the package, then change its code. The fingerprint is slowship’s own, worked out in your browser.',
    run(b) {
      b.innerHTML = `<div class="memgrid"><div><div class="mcard"><div class="mh"><b>tidy-dates</b><small>1.4.2 · makes network calls</small><span class="state2" id="mstate">Worth a glance</span></div>
          <textarea class="mcode" id="mcode" spellcheck="false" aria-label="The package's code: edit it"></textarea></div>
          <div class="pbtns" style="margin-top:14px"><button class="btn primary" type="button" id="mclear">Clear it</button><button class="btn" type="button" id="mbyte">Change one byte</button><button class="btn" type="button" id="mback">Put it back</button></div></div>
        <div class="fp2"><div class="fpbox"><small>Its fingerprint now</small><code id="mnow">…</code></div>
          <div class="fpeq"><i id="meq">?</i><span id="mwhy">Not cleared yet.</span></div>
          <div class="fpbox"><small>The fingerprint you cleared</small><code id="mwas">nothing cleared yet</code></div>
          <ul class="mlog" id="mlog"></ul></div></div>
        <p class="pnote">slowship hashes every file an item ships, with its path. This one ships a single <code>index.js</code>. Packages from your lockfile use the lockfile’s own integrity hash, which changes the same way.</p>`;
      const code = $('#mcode', b), state = $('#mstate', b), logl = $('#mlog', b);
      let cleared = null, now = null, was = 'glance';
      const log = t => logl.insertAdjacentHTML('afterbegin', `<li>${t}</li>`);
      const paint = () => {
        const ok = cleared && now === cleared, mode = ok ? 'ok' : 'glance';
        state.textContent = ok ? 'Cleared by you' : cleared ? 'Asks again' : 'Worth a glance'; state.classList.toggle('ok', ok);
        if (mode !== was && cleared && !ok) { state.classList.remove('shake'); void state.offsetWidth; state.classList.add('shake'); log('Its code changed, so it asks again.'); }
        if (mode !== was && ok && was === 'glance' && logl.children.length) log('The bytes match what you cleared again. Cleared.');
        was = mode;
        $('#mnow', b).textContent = now; $('#mnow', b).classList.toggle('diff', !!cleared && !ok);
        $('#meq', b).textContent = !cleared ? '?' : ok ? '=' : '≠'; $('#meq', b).className = !cleared ? '' : ok ? 'eq' : 'ne';
        $('#mwhy', b).textContent = !cleared ? 'Not cleared yet.' : ok ? 'Same bytes as when you cleared it: it stays quiet.' : 'Different bytes: slowship can’t know what changed, so it asks.';
      };
      const update = async () => { now = await fpOf(code.value); paint(); };
      code.value = CODE; update();
      code.addEventListener('input', update);
      $('#mclear', b).addEventListener('click', () => { if (cleared === now) return; cleared = now; $('#mwas', b).textContent = cleared; was = 'ok'; log('You cleared it. slowship keeps this fingerprint.'); paint(); });
      $('#mbyte', b).addEventListener('click', () => { code.value = code.value.includes("latest'") ? code.value.replace("latest'", "latesT'") : code.value.replace("latesT'", "latest'"); update(); });
      $('#mback', b).addEventListener('click', () => { code.value = CODE; update(); });
    },
  };

  // ---------- the report, and the terminal ----------
  PLAYS.report = {
    t: 'The morning report', s: 'The real report page, replaying one recorded watch. Click anything. <a href="demo/">Open it full size</a>.', full: true,
    run(b) { b.innerHTML = '<iframe class="frame-iframe" src="demo/" title="The slowship morning report, live demo"></iframe>'; },
  };
  PLAYS.term = {
    t: 'The terminal review', s: 'Real frames of <code>slowship review</code>, drawn by slowship itself. Your arrow keys, <kbd>?</kbd> and <kbd>q</kbd> work here.',
    async run(b) {
      const map = await fetch(`term/frames/frames.json${V}`).then(r => r.json()), cache = new Map();
      const get = f => { if (!cache.has(f)) cache.set(f, fetch(`term/frames/${f}.html${V}`).then(r => r.text())); return cache.get(f); };
      b.innerHTML = `<div class="term"><div class="tbar"><b>slowship review</b></div><div class="tscreen" id="tscr"></div></div>
        <div class="tkeys">${[['ArrowUp', '↑', 'Up'], ['ArrowDown', '↓', 'Down'], ['ArrowLeft', '←', 'Previous tab'], ['ArrowRight', '→', 'Next tab'], ['?', '?', 'Every key'], ['q', 'q', 'Quit']].map(([k, l, a]) => `<button type="button" data-k="${k}" aria-label="${a}">${l}</button>`).join('')}<span>Tabs: Review, Aboard, Keys, Blind spots.</span></div>`;
      const scr = $('#tscr', b); let t = 0, s = 0, help = false, quit = false;
      const draw = async () => {
        if (quit) { scr.innerHTML = `${await get('bye')}<div class="bye">$ <button class="btn sm" type="button" id="tagain">Run slowship review again</button></div>`; return; }
        scr.innerHTML = await get(help ? 'help' : map.tabs[t][Math.min(s, map.tabs[t].length - 1)]);
        [map.tabs[t][s + 1], map.tabs[(t + 1) % 4][0]].filter(Boolean).forEach(get);
      };
      const key = k => {
        if (quit) { if (k === 'Enter') { quit = false; draw(); return true; } return false; }
        if (help) { if (k === '?' || k === 'Escape') help = false; else if (k === 'q') { help = false; quit = true; } else return false; draw(); return true; }
        if (k === 'ArrowDown' || k === 'j') s = Math.min(s + 1, map.tabs[t].length - 1);
        else if (k === 'ArrowUp' || k === 'k') s = Math.max(0, s - 1);
        else if (k === 'ArrowRight' || k === 'Tab') { t = (t + 1) % 4; s = 0; }
        else if (k === 'ArrowLeft') { t = (t + 3) % 4; s = 0; }
        else if (/^[1-4]$/.test(k)) { t = +k - 1; s = 0; }
        else if (k === '?') help = true;
        else if (k === 'q') quit = true;
        else return false;
        draw(); return true;
      };
      const onKey = e => { if (e.target.closest?.('input,textarea')) return; if (key(e.key)) { e.preventDefault(); const btn = $(`[data-k="${e.key}"]`, b); if (btn) { btn.classList.add('hit'); setTimeout(() => btn.classList.remove('hit'), 120); } } };
      document.addEventListener('keydown', onKey, true);
      b.addEventListener('click', e => { const k = e.target.closest('[data-k]')?.dataset.k; if (k) key(k); if (e.target.id === 'tagain') key('Enter'); });
      await draw();
      return () => document.removeEventListener('keydown', onKey, true);
    },
  };
})();
