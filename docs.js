// slowship docs: what's on this page lights up as you read, the page list folds away on phones, and Ctrl K searches
// every page and section by title.
(() => {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)], base = document.body.dataset.base;

  // on this page: the section you're reading is lit
  const links = $$('.toc a'), heads = links.map(a => document.getElementById(a.hash.slice(1))).filter(Boolean);
  const spy = () => {
    let cur = heads[0];
    for (const h of heads) if (h.getBoundingClientRect().top < 140) cur = h;
    links.forEach(a => a.classList.toggle('on', a.hash === '#' + cur?.id));
  };
  if (heads.length) { addEventListener('scroll', spy, { passive: true }); spy(); }

  // the page list, folded on phones
  const sb = $('#sidebtn'), sn = $('#sidenav');
  sb?.addEventListener('click', () => { const o = sn.classList.toggle('open'); sb.setAttribute('aria-expanded', o); });

  // search: titles and section headings of every page
  const dlg = $('#search'), q = $('#sq'), res = $('#sres');
  let index = null, hits = [], at = 0;
  const load = async () => index ??= await fetch(base + 'search.json').then(r => r.json()).catch(() => []);
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function find(term) {
    const t = term.trim().toLowerCase(), out = [];
    for (const p of index) {
      const score = !t ? 1 : p.t.toLowerCase().includes(t) ? 3 : p.x.toLowerCase().includes(t) ? 2 : 0;
      if (score) out.push({ s: score, u: p.u, b: p.t, g: p.g, x: p.x });
      if (t) for (const [h, id] of p.h) if (h.toLowerCase().includes(t)) out.push({ s: 2.5, u: `${p.u}#${id}`, b: h, g: p.t, x: '' });
    }
    return out.sort((a, b) => b.s - a.s).slice(0, 12);
  }
  function draw() {
    hits = find(q.value); at = Math.min(at, Math.max(0, hits.length - 1));
    res.innerHTML = hits.length ? hits.map((h, k) => `<li><a href="${base}${h.u}" class="${k === at ? 'on' : ''}"><small>${esc(h.g)}</small><b>${esc(h.b)}</b>${h.x ? `<span>${esc(h.x.slice(0, 110))}${h.x.length > 110 ? '…' : ''}</span>` : ''}</a></li>`).join('')
      : '<li class="empty">Nothing by that name. Try “install”, “nightly” or “clear”.</li>';
  }
  async function open() { await load(); q.value = ''; at = 0; draw(); dlg.showModal(); q.focus(); }
  $('#sopen')?.addEventListener('click', open);
  addEventListener('keydown', e => {
    if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName))) { e.preventDefault(); dlg.open ? dlg.close() : open(); }
  });
  q?.addEventListener('input', () => { at = 0; draw(); });
  q?.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); at = (at + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % Math.max(1, hits.length); draw(); res.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'Enter' && hits[at]) location.href = base + hits[at].u;
  });
  dlg?.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  if (/Mac|iPhone|iPad/.test(navigator.platform)) $$('.sbtn kbd').forEach(k => { k.textContent = '⌘K'; });
})();
