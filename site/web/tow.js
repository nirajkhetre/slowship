// slowship.site: sailing to the live demo. Press a link to it and everything in the hero clears away but the ship; the
// skipper hops off the quay onto her bridge, and she sails off to the right. The quay she's moored to comes with her, and
// behind the quay comes the demo, which has been loading quietly since this page settled, so the trip never waits on the
// network and nothing has to draw itself again at the end. Back sails home the same way.
// Only transforms and opacity move, so the browser does it all on the GPU.
(() => {
  const $ = s => document.querySelector(s);
  const stick = $('#stick'), near = $('#scene2'), cap = $('#cap'), quay = $('#quay'), deck = $('#ship .bob');
  if (!stick || !near || !cap || !quay || !deck) return;
  const root = document.documentElement, REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const HOME = location.pathname, DEMO = new URL('demo/', location.href).pathname, TITLE = document.title;
  const wait = ms => new Promise(r => setTimeout(r, ms)), frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  let page = null, state = 'docked', sail = [];

  // ---------- the demo, loaded in the background once this page has settled ----------
  function preload() {
    if (page) return page;
    page = document.createElement('iframe');
    page.className = 'towpage'; page.src = 'demo/?towed'; page.title = 'slowship · the live demo';
    page.tabIndex = -1; page.setAttribute('inert', ''); page.setAttribute('aria-hidden', 'true');
    page.addEventListener('load', () => {
      // inside the towed demo, “← slowship” sails home; any other link leaves for real
      page.contentDocument?.addEventListener('click', e => {
        const a = e.target.closest?.('a[href]');
        if (!a || a.target === '_blank' || a.getAttribute('href').startsWith('#') || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        const u = new URL(a.href);
        if (u.origin === location.origin && u.pathname === HOME) history.back(); else location.href = u.href;
      }, true);
    });
    document.body.append(page);
    return page;
  }
  const idle = f => 'requestIdleCallback' in window ? requestIdleCallback(f, { timeout: 3000 }) : setTimeout(f, 1500);
  if (document.readyState === 'complete') idle(preload); else addEventListener('load', () => idle(preload), { once: true });
  // ready once the report has fetched its watch and drawn itself (it drops its boot class then)
  const ready = () => new Promise(res => {
    const t0 = performance.now();
    const look = () => { const d = page.contentDocument; (d?.readyState === 'complete' && d.body && !d.body.classList.contains('boot')) || performance.now() - t0 > 9000 ? res() : setTimeout(look, 60); };
    look();
  });

  // ---------- the skipper's hop, quay to bridge (in the scene's own units), squashing as it leaves and lands ----------
  const HOP = [
    { transform: 'translate(452px,486px) scale(.7)', offset: 0 },
    { transform: 'translate(448px,497px) scale(.74,.64)', offset: .14 },
    { transform: 'translate(522px,318px) scale(.66,.77)', offset: .5 },
    { transform: 'translate(612px,350px) scale(.7)', offset: .78 },
    { transform: 'translate(623px,400px) scale(.76,.62)', offset: .9 },
    { transform: 'translate(629px,385px) scale(.7)', offset: 1 },
  ];
  const BACK = [...HOP].reverse().map(k => ({ ...k, offset: 1 - k.offset }));
  async function hop(keys, to, parent) {
    const h = cap.animate(keys, { duration: 760, easing: 'cubic-bezier(.33,.65,.35,1)', fill: 'forwards' });
    await h.finished;
    cap.setAttribute('transform', to); h.cancel();
    parent.append(cap);  // aboard, it rides the ship's swell; ashore, it stands on the quay
  }

  // ---------- leaving ----------
  // from lower down the page, it cuts to the top through the night first
  async function dip() {
    const d = document.createElement('div'); d.className = 'towdip'; document.body.append(d);
    await frame(); d.classList.add('on'); await wait(280);
    scrollTo({ top: 0, behavior: 'instant' }); dispatchEvent(new Event('scroll'));
    await frame(); d.classList.remove('on'); await wait(300); d.remove();
  }
  async function leave() {
    if (state !== 'docked') return;
    state = 'leaving';
    preload();
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    root.style.overflow = '';
    if (scrollY > 40) await dip();
    stick.style.setProperty('--mx', 0); stick.style.setProperty('--my', 0);
    root.classList.add('towing');
    page.style.display = 'block';  // laid out now, off to the left, so the slide has nothing left to draw
    await wait(460);
    cap.dataset.mood = 'happy';
    await hop(HOP, 'translate(629 385) scale(.7)', deck);
    await ready();
    const W = innerWidth, o = { duration: 1700, easing: 'cubic-bezier(.62,0,.2,1)', fill: 'forwards' };
    sail = [near.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${W}px)` }], o),
      page.animate([{ transform: 'translateX(-100%)' }, { transform: 'translateX(0)' }], o)];
    await sail[1].finished;
    state = 'towed';
    history.pushState({ towed: true }, '', DEMO);
    document.title = page.contentDocument?.title || TITLE;
    page.removeAttribute('inert'); page.removeAttribute('aria-hidden'); page.contentWindow?.focus();
  }

  // ---------- coming home ----------
  async function home() {
    if (state !== 'towed') return;
    state = 'returning';
    page.setAttribute('inert', ''); page.setAttribute('aria-hidden', 'true'); document.title = TITLE;
    sail.forEach(a => a.reverse());
    await sail[0].finished;
    sail.forEach(a => a.cancel()); sail = [];
    page.style.display = '';  // kept loaded, ready for the next trip
    await hop(BACK, 'translate(452 486) scale(.7)', quay);
    root.classList.remove('towing');
    dispatchEvent(new Event('scroll'));  // the hero picks its own mood and colours back up
    state = 'docked';
  }

  document.addEventListener('click', e => {
    const a = e.target.closest?.('a[href]');
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank') return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || u.pathname !== DEMO || REDUCED) return;
    e.preventDefault(); leave();
  });
  addEventListener('popstate', e => { if (state === 'towed' && !e.state?.towed) home(); else if (state === 'docked' && e.state?.towed) leave(); });
  // coming back to this page from elsewhere with Back: put back as it was
  addEventListener('pageshow', e => { if (e.persisted && state !== 'docked') location.reload(); });
})();
