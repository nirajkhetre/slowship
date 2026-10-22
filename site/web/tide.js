// slowship.site: setting sail for the live demo. Press a link to it and the tide comes in over the page while the demo's
// files load (the boat's place is how much has arrived); the demo page opens under the same sea, the boat keeps going while
// the report fetches its watch and draws itself, and only then does the tide go out.
(() => {
  const root = document.documentElement, tide = document.getElementById('tide');
  if (!tide || matchMedia('(prefers-reduced-motion: reduce)').matches) { root.classList.remove('sailing'); return; }
  const pct = tide.querySelector('.tpct'), wait = ms => new Promise(r => setTimeout(r, ms)), KEY = 'slowship-sail';
  let shown = 0;
  const set = p => { shown = Math.min(1, Math.max(shown, p)); tide.style.setProperty('--tp', shown.toFixed(3)); pct.textContent = `${Math.round(shown * 100)}%`; };

  // ---------- arriving: the demo opens under the sea, which goes out once the report has drawn itself ----------
  if (root.classList.contains('sailing')) {
    let start = 0;
    try { start = JSON.parse(sessionStorage.getItem(KEY))?.p ?? 0; } catch {}
    set(start); tide.classList.add('full');
    let raf = 0;
    const creep = () => { set(shown + (.94 - shown) * .015); raf = requestAnimationFrame(creep); };  // on toward the lighthouse, slower as it nears
    creep();
    const drawn = new Promise(r => {
      const ok = () => document.body && !document.body.classList.contains('boot');
      if (ok()) return r();
      new MutationObserver((_, o) => { if (ok()) { o.disconnect(); r(); } }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    });
    const loaded = new Promise(r => document.readyState === 'complete' ? r() : addEventListener('load', r, { once: true }));
    Promise.race([Promise.all([drawn, loaded, document.fonts?.ready]), wait(15000)]).then(async () => {
      cancelAnimationFrame(raf); set(1);
      await wait(550);
      tide.classList.add('drain');
      await wait(1300);
      root.classList.remove('sailing'); tide.classList.remove('full', 'drain');
      try { sessionStorage.removeItem(KEY); } catch {}
    });
    return;
  }

  // ---------- leaving: the tide rises while the demo's own files come down ----------
  async function sail(href, e) {
    tide.style.setProperty('--x', `${e.clientX}px`); tide.style.setProperty('--y', `${e.clientY}px`);
    document.querySelectorAll('dialog[open]').forEach(d => d.close());  // a modal window would sit above the sea
    set(0); root.classList.add('sailing'); tide.classList.add('rise');
    setTimeout(() => tide.classList.add('covered'), 900);
    const files = ['', 'demo.js', 'demo-run.json'].map(f => new URL(f, href).href), got = new Map(), size = new Map();
    const track = () => { let a = 0, b = 0; for (const f of files) { a += got.get(f) || 0; b += size.get(f) || 0; } if (b) set(a / b * .6); };
    const fetchOne = async f => {
      try {
        const r = await fetch(f, { cache: 'force-cache' }), n = +r.headers.get('content-length') || 0, rd = r.body?.getReader();
        size.set(f, n);
        if (!rd) { await r.arrayBuffer(); got.set(f, n); return track(); }
        let have = 0;
        for (;;) { const { done, value } = await rd.read(); if (done) break; have += value.length; got.set(f, have); if (!n) size.set(f, have); track(); }
      } catch {}
    };
    await Promise.all([Promise.all(files.map(fetchOne)), wait(1150)]);  // the tide takes its time even on a fast line
    set(.6);
    try { sessionStorage.setItem(KEY, JSON.stringify({ t: Date.now(), p: shown })); } catch {}
    location.href = href;
  }
  document.addEventListener('click', e => {
    const a = e.target.closest?.('a[href]');
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank') return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || !/\/demo\/?$/.test(u.pathname)) return;
    e.preventDefault(); sail(u.href, e);
  });
  // coming back with the back button: the page is put back as it was, without the sea
  addEventListener('pageshow', e => { if (e.persisted) { root.classList.remove('sailing'); tide.classList.remove('rise', 'covered', 'full', 'drain'); shown = 0; } });
})();
