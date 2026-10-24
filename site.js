// slowship.site: the small things every page does. The header turns to glass once you leave a dark hero, the menu
// opens on phones, things rise into place as they scroll in, and commands copy with one press.
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  document.documentElement.classList.remove('no-js');
  const nav = $('.nav');

  // the header: clear over a dark hero, frosted glass everywhere else
  const hero = $('[data-dark-hero]');
  const paint = () => nav?.classList.toggle('solid', !hero || hero.getBoundingClientRect().bottom < 80);
  addEventListener('scroll', paint, { passive: true }); addEventListener('resize', paint); paint();
  $('.menu-b')?.addEventListener('click', () => { const o = nav.classList.toggle('open'); $('.menu-b').setAttribute('aria-expanded', o); });
  $$('.nav .links a').forEach(a => a.addEventListener('click', () => nav.classList.remove('open')));

  // things rise into place once, as they come into view
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
  $$('[data-reveal]').forEach(el => io.observe(el));

  // copy a command; the button says so for a moment
  const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  document.addEventListener('click', async e => {
    const b = e.target.closest('.copy'); if (!b) return;
    const text = b.dataset.copy ?? b.closest('.cmd,pre,.codeblock')?.querySelector('code')?.innerText ?? '';
    try { await navigator.clipboard.writeText(text.trim()); } catch { return; }
    const was = b.innerHTML; b.classList.add('done'); b.innerHTML = `${CHECK}Copied`;
    setTimeout(() => { b.classList.remove('done'); b.innerHTML = was; }, 1600);
  });
})();
