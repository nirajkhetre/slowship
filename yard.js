// slowship.site: two scenes on the landing page. At customs, a container rolls in with its paperwork and you move an
// x-ray over it to find what it doesn't declare. In the yard, the four kinds of cargo sit in a real 3D stack: pick one
// and it slides out of the stack and opens its doors. Both play by themselves until you take over.
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- customs ----------
  const gate = $('#gate');
  if (gate) {
    const box = $('#xbox'), lens = $('#lens'), xin = $('#xin'), finds = $$('#finds li'), count = $('#xcount'), path = $('#xpath');
    const obj = k => $(`.obj[data-f="${k}"]`, box), KEYS = ['date', 'key', 'net'];
    const found = new Set();
    let held = false, auto = 0, user = false, raf = 0, tx = 0, ty = 0, tr = 0, cx = 0, cy = 0, cr = 0;
    const R = () => Math.round(Math.min(96, Math.max(54, box.clientWidth * .14)));
    const centre = (el, rel) => { const a = el.getBoundingClientRect(), b = rel.getBoundingClientRect(); return [a.left + a.width / 2 - b.left, a.top + a.height / 2 - b.top]; };
    function place(x, y, r) {
      box.style.setProperty('--lx', `${x}px`); box.style.setProperty('--ly', `${y}px`); box.style.setProperty('--r', `${Math.max(0, r)}px`);
      lens.classList.toggle('on', r > 6);
      if (r > 20) for (const k of KEYS) { if (found.has(k)) continue; const [ox, oy] = centre(obj(k), box); if (Math.hypot(ox - x, oy - y) < r * .72) find(k); }
    }
    // the lens trails the pointer a little, like something with weight
    const step = () => {
      cx += (tx - cx) * .24; cy += (ty - cy) * .24; cr += (tr - cr) * .2; place(cx, cy, cr);
      raf = Math.abs(tx - cx) + Math.abs(ty - cy) + Math.abs(tr - cr) > .4 ? requestAnimationFrame(step) : 0;
    };
    const follow = () => { if (!raf) raf = requestAnimationFrame(step); };
    function find(k) {
      found.add(k); obj(k).classList.add('on'); finds.find(li => li.dataset.f === k).classList.add('on');
      count.textContent = `${found.size} of 3`; count.classList.toggle('all', found.size === 3);
      if (!held && found.has('key') && found.has('net')) hold();
    }
    function hold() {
      held = true;
      const [x1, y1] = centre(obj('key'), xin), [x2, y2] = centre(obj('net'), xin);
      path.setAttribute('d', `M${x1} ${y1} C${x1 - 34} ${y1} ${x2 - 34} ${y2} ${x2} ${y2}`); path.classList.add('on');
      $('#xwhy').classList.add('on');
      setTimeout(() => { gate.classList.add('held'); $('#stamp2').classList.add('on'); $('#bol').classList.add('shake'); }, REDUCED ? 0 : 650);
    }
    const stop = () => { cancelAnimationFrame(auto); auto = 0; gate.classList.remove('scanning'); };
    // slowship's own sweep: in from the left, over each thing it carries, and out
    function scan() {
      stop(); gate.classList.add('scanning');
      const b = box.getBoundingClientRect(), r = R(), pts = [[-r, b.height * .48]];
      for (const k of KEYS) { const [x, y] = centre(obj(k), box); pts.push([x + r * .35, y]); }
      pts.push([b.width * .72, b.height * .5], [b.width + r, b.height * .5]);
      let i = 0, t0 = performance.now(); tr = r;
      const tick = now => {
        let k = (now - t0) / 1050;
        if (k >= 1) { i++; t0 = now; k = 0; if (i >= pts.length - 1) { stop(); tr = 0; follow(); return; } }
        const [x1, y1] = pts[i], [x2, y2] = pts[i + 1], e = k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        cx = tx = x1 + (x2 - x1) * e; cy = ty = y1 + (y2 - y1) * e + Math.sin(now / 170) * 3; cr += (tr - cr) * .18;
        place(cx, cy, cr); auto = requestAnimationFrame(tick);
      };
      auto = requestAnimationFrame(tick);
    }
    const local = e => { const b = box.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
    box.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse' && !e.buttons) return;
      user = true; stop(); [tx, ty] = local(e); tr = R(); box.classList.add('looking'); follow();
    });
    box.addEventListener('pointerdown', e => { user = true; stop(); box.setPointerCapture(e.pointerId); [tx, ty] = local(e); [cx, cy] = [tx, ty]; tr = R(); follow(); });
    box.addEventListener('pointerleave', () => { tr = 0; box.classList.remove('looking'); follow(); });
    box.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') { tr = 0; follow(); } });
    function reset() {
      stop(); found.clear(); held = false;
      gate.classList.remove('held'); $$('.obj.on', box).forEach(o => o.classList.remove('on')); finds.forEach(li => li.classList.remove('on'));
      count.textContent = '0 of 3'; count.classList.remove('all'); path.classList.remove('on');
      for (const s of ['#xwhy', '#stamp2']) $(s).classList.remove('on'); $('#bol').classList.remove('shake');
      tr = cr = 0; place(0, 0, 0);
    }
    const roll = () => { gate.classList.remove('in'); void box.offsetWidth; gate.classList.add('in', 'rolling'); setTimeout(() => gate.classList.remove('rolling'), REDUCED ? 0 : 1500); };
    new IntersectionObserver((es, o) => {
      if (!es[0].isIntersecting) return; o.disconnect();
      if (REDUCED) { gate.classList.add('in'); KEYS.forEach(find); return; }
      roll(); setTimeout(() => { if (!user) scan(); }, 1900);
    }, { threshold: .45 }).observe($('.bay', gate));
    $('#xauto').addEventListener('click', () => { user = true; if (held) { reset(); roll(); setTimeout(scan, REDUCED ? 0 : 1600); } else scan(); });
    $('#xagain').addEventListener('click', () => { user = true; reset(); roll(); });
  }

  // ---------- the yard ----------
  const yard = $('#yard');
  if (yard) {
    const ART = {
      npm: '<g stroke="#0A1633" stroke-width="2.5" stroke-linejoin="round"><rect x="10" y="30" width="30" height="24" rx="3" fill="#F4F2EE"/><rect x="40" y="30" width="30" height="24" rx="3" fill="#C9D2EC"/><rect x="70" y="36" width="22" height="18" rx="3" fill="#F4F2EE"/><rect x="22" y="8" width="32" height="22" rx="3" fill="#9CB0FF"/><rect x="54" y="12" width="24" height="18" rx="3" fill="#F4F2EE"/></g><g stroke="#FFC21A" stroke-width="3"><path d="M25 30v24M55 30v24M38 8v22M66 12v18"/></g>',
      skill: '<g stroke="#0A1633" stroke-width="2.5" stroke-linejoin="round"><path d="M14 10h30l8 8v36H14z" fill="#F4F2EE"/><path d="M44 10v8h8" fill="none"/><path d="M50 16h30l8 8v32H50z" fill="#FFF3C2"/></g><g stroke="#0A1633" stroke-width="2.5" stroke-linecap="round"><path d="M21 28h22M21 36h22M21 44h14M57 34h24M57 42h24M57 50h14"/></g>',
      mcp: '<g fill="none" stroke-width="3.5" stroke-linecap="round"><path d="M8 44c18 0 18-26 38-26s22 30 46 24" stroke="#14D18F"/></g><g stroke="#0A1633" stroke-width="2.5" stroke-linejoin="round"><rect x="34" y="8" width="22" height="20" rx="4" fill="#F4F2EE"/><path d="M40 8V2M50 8V2" stroke-linecap="round"/><rect x="62" y="34" width="22" height="20" rx="4" fill="#B8F5DD"/><path d="M68 54v6M78 54v6" stroke-linecap="round"/></g>',
      app: '<g stroke="#0A1633" stroke-width="2.5" stroke-linejoin="round"><path d="M50 4c12 8 15 22 11 38H39C35 26 38 12 50 4z" fill="#F4F2EE"/><circle cx="50" cy="22" r="5" fill="#FF7AB8"/><path d="M39 36l-9 10 11 1M61 36l9 10-11 1" fill="#FF7AB8"/></g><g stroke="#FFC21A" stroke-width="3" stroke-linecap="round"><path d="M45 48l-2 8M50 48v10M55 48l2 8"/></g>',
    };
    const K = [
      { k: 'npm', name: 'Packages', n: '174', c: '#5574FF', c2: '#3E5FE6', c3: '#8EA2FF', d: 'Every npm package you’ll actually ship, down to the dependency of a dependency.',
        looks: ['<code>package-lock.json</code>', 'the code in <code>node_modules</code>'], watch: ['network calls', 'install scripts', 'secrets it reads', 'code built at runtime', 'hidden characters'],
        m: 'packages in one real project, all read in one night. None held.' },
      { k: 'skill', name: 'Agent skills', n: '77', c: '#FFC21A', c2: '#E3A600', c3: '#FFD866', d: 'The instructions and scripts your coding agents load, plugins included.',
        looks: ['<code>~/.agents/skills</code>', '<code>~/.codex/skills</code>', 'plugin folders', 'skills in the project'], watch: ['hiding things from you', 'ignoring its other rules', 'downloading and running a script', 'sending your data out', 'keys it uses'],
        m: 'skills on one laptop, shared by every project there. None held.' },
      { k: 'mcp', name: 'MCP servers', n: '1', c: '#14D18F', c2: '#0BAF76', c3: '#6EE8BC', d: 'The tools your agents connect to. Fetched into quarantine with every script off, and never started.',
        looks: ['your editors’ MCP settings', '<code>npx</code> servers, in quarantine', 'compiled servers, with REA'], watch: ['what each tool can touch', 'keys it’s handed in config', 'what it was built from'],
        m: 'MCP server on that laptop: compiled Rust, read as far as its build record.' },
      { k: 'app', name: 'Your build', n: '1', c: '#FF7AB8', c2: '#E8559A', c3: '#FFA6CF', d: 'What you’re about to ship, checked before it leaves.',
        looks: ['<code>--app dist/</code>', 'your build folder, in Settings'], watch: ['secrets that slipped in', '.env files and source maps', 'risky Electron switches', 'IPC doors that don’t check', 'Electron fuses'],
        m: 'deliberately risky test build. Held, as it should be.' },
    ];
    const stage = $('.ystage', yard), scene = $('.scene3', yard), tag = $('#ytag'), bars = $('#ybars');
    // the stack, top to bottom: your build, MCP servers, agent skills, packages
    scene.insertAdjacentHTML('beforeend', [...K].reverse().map((c, i) => `<div class="c3" data-i="${K.indexOf(c)}" style="--y:${(i - 1.5) * 64}px;--c:${c.c};--c2:${c.c2};--c3:${c.c3}" role="button" tabindex="0" aria-label="Open ${c.name}">
      <div class="f fr"><b>${c.name}</b><small>${c.n} aboard</small></div><div class="f bk"></div><div class="f tp"></div><div class="f bt"></div><div class="f lf"></div>
      <div class="f in3"><svg viewBox="0 0 100 62" aria-hidden="true">${ART[c.k]}</svg></div>
      <div class="f en"><div class="dr l"></div><div class="dr r"></div></div></div>`).join(''));
    bars.innerHTML = K.map((c, i) => `<button type="button" data-i="${i}" style="--c:${c.c}" aria-pressed="false"><i></i><span>${c.name}</span></button>`).join('');
    const boxes = $$('.c3', scene), mochi = $('.mochi3', scene);
    let cur = -1, t0 = 0, raf = 0, seen = false, idleUntil = 0;
    function show(i) {
      cur = i; t0 = performance.now();
      boxes.forEach(b => b.classList.toggle('open', +b.dataset.i === i));
      $$('button', bars).forEach(b => { b.setAttribute('aria-pressed', +b.dataset.i === i); b.style.removeProperty('--p'); });
      const c = K[i];
      tag.innerHTML = `<div class="swap"><h3>${c.name}</h3></div><p class="yd swap">${c.d}</p>
        <div class="swap"><h4>Where it looks</h4><div class="chips3">${c.looks.map(x => `<span>${x}</span>`).join('')}</div></div>
        <div class="swap"><h4>What it watches for</h4><div class="chips3">${c.watch.map(x => `<span>${x}</span>`).join('')}</div></div>
        <div class="ym swap"><b>${c.n}</b><span>${c.m}</span></div>`;
      if (!REDUCED) { mochi.classList.remove('hop'); void mochi.offsetWidth; mochi.classList.add('hop'); }
    }
    // it plays by itself, one container every few seconds, until you pick one; then it waits for you
    const LEN = 5200;
    const tick = now => {
      raf = requestAnimationFrame(tick);
      if (!seen || REDUCED || now < idleUntil || document.hidden) { t0 = now; return; }  // paused: the current one starts over
      const p = Math.min(1, (now - t0) / LEN);
      $(`button[data-i="${cur}"]`, bars)?.style.setProperty('--p', `${p * 100}%`);
      if (p >= 1) show((cur + 1) % K.length);
    };
    const pick = i => { idleUntil = performance.now() + 14000; show(i); $(`button[data-i="${i}"]`, bars).style.setProperty('--p', '100%'); };
    scene.addEventListener('click', e => { const b = e.target.closest('.c3'); if (b) pick(+b.dataset.i); });
    scene.addEventListener('keydown', e => { const b = e.target.closest('.c3'); if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(+b.dataset.i); } });
    bars.addEventListener('click', e => { const b = e.target.closest('button'); if (b) pick(+b.dataset.i); });
    // the stack turns a little toward your pointer
    if (!REDUCED && matchMedia('(pointer: fine)').matches) {
      stage.addEventListener('pointermove', e => { const r = stage.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
        scene.style.setProperty('--ry', `${-34 + x * 16}deg`); scene.style.setProperty('--rx', `${-16 - y * 8}deg`); });
      stage.addEventListener('pointerleave', () => { scene.style.removeProperty('--ry'); scene.style.removeProperty('--rx'); });
    }
    const fit = () => scene.style.setProperty('--s', Math.min(1, stage.clientWidth / 640, stage.clientHeight / 560).toFixed(3));
    addEventListener('resize', fit); fit();
    new IntersectionObserver(es => { seen = es[0].isIntersecting; if (seen && cur < 0) show(0); }, { threshold: .3 }).observe(stage);
    raf = requestAnimationFrame(tick);
  }
})();
