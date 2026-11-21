// Live DeskWall themes on the page. Each theme is the same self-contained page the app uses,
// loaded in an iframe in "wallpaper" mode and driven by messages: desktop-icon rectangles and
// the cursor. Here the "desktop icons" are draggable HTML tiles, so the scenery grows around
// them exactly like in the app.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ICONS = [
  ['Documents', '#e0a73c'], ['Photos', '#3fc9a8'], ['Projects', '#ec8a4a'],
  ['Steam', '#4a7fd6'], ['Browser', '#5fbf73'], ['Notes', '#9b7be0'],
];

class Scene {
  constructor(stage, { layout, count = ICONS.length, theme, poster = true }) {
    this.stage = stage;
    this.frame = stage.querySelector('iframe');
    this.layout = layout;
    this.theme = theme;
    this.active = false;
    this.ready = false;
    this.raf = 0;
    this.icons = [];
    const holder = stage.querySelector('.icons');
    for (let i = 0; i < count; i++) {
      const [label, color] = ICONS[i % ICONS.length];
      const el = document.createElement('div');
      el.className = 'dicon';
      el.innerHTML = `<i style="background:${color}"></i><b>${label}</b>`;
      el.tabIndex = 0;
      holder.append(el);
      this.icons.push({ el, fx: 0, fy: 0 });
      this.drag(el, this.icons[i]);
    }
    this.place();
    addEventListener('message', ev => {
      if (ev.source !== this.frame.contentWindow || ev.origin !== location.origin) return;
      const m = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
      if (m.t === 'ready') { this.ready = true; this.send(); this.post({ t: 'pause', v: !this.active }); }
      if (m.t === 'drawn') stage.classList.add('live');
    });
    addEventListener('resize', () => { this.place(); this.send(); });
    // forward the cursor so the scene reacts to it
    stage.addEventListener('pointermove', e => this.pointer(e, true));
    stage.addEventListener('pointerleave', e => this.pointer(e, false));
  }
  place() {
    const pts = this.layout(this.stage.clientWidth, this.stage.clientHeight);
    this.icons.forEach((ic, i) => {
      const p = pts[i % pts.length];
      if (!ic.moved) { ic.fx = p[0]; ic.fy = p[1]; }
      ic.el.style.left = (ic.fx * this.stage.clientWidth) + 'px';
      ic.el.style.top = (ic.fy * this.stage.clientHeight) + 'px';
    });
  }
  post(m) { try { this.frame.contentWindow?.postMessage(JSON.stringify(m), location.origin); } catch { /* frame not ready */ } }
  rects() {
    const k = devicePixelRatio || 1, sb = this.stage.getBoundingClientRect();
    return this.icons.map(({ el }) => {
      const r = el.getBoundingClientRect();
      return [(r.left - sb.left) * k, (r.top - sb.top) * k, (r.right - sb.left) * k, (r.bottom - sb.top) * k];
    });
  }
  send() { if (this.ready) this.post({ t: 'icons', vis: true, r: this.rects() }); }
  queue() { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.send(); }); }
  pointer(e, inside, down = false) {
    if (!this.ready) return;
    const sb = this.stage.getBoundingClientRect();
    this.post({ t: 'pointer', in: inside, x: e.clientX - sb.left, y: e.clientY - sb.top, down });
  }
  drag(el, ic) {
    let ox = 0, oy = 0, on = false;
    el.addEventListener('pointerdown', e => {
      on = true; ic.moved = true; el.setPointerCapture(e.pointerId); el.classList.add('held');
      const r = el.getBoundingClientRect(); ox = e.clientX - r.left; oy = e.clientY - r.top;
      this.pointer(e, true, true);
    });
    el.addEventListener('pointermove', e => {
      if (!on) return;
      const sb = this.stage.getBoundingClientRect();
      const x = Math.min(Math.max(e.clientX - sb.left - ox, 0), sb.width - el.offsetWidth);
      const y = Math.min(Math.max(e.clientY - sb.top - oy, 0), sb.height - el.offsetHeight);
      ic.fx = x / sb.width; ic.fy = y / sb.height;
      el.style.left = x + 'px'; el.style.top = y + 'px';
      this.queue();
      this.pointer(e, true, true);
    });
    const end = e => { if (!on) return; on = false; el.classList.remove('held'); this.pointer(e, true, false); this.send(); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
  load(id) {
    this.theme = id; this.ready = false; this.stage.classList.remove('live');
    this.frame.src = `theme/${id}.html?wallpaper`;
  }
  // run only while on screen, to spare the GPU
  setActive(on) {
    if (on === this.active) return;
    this.active = on;
    if (on && !this.frame.getAttribute('src')) this.load(this.theme);
    else this.post({ t: 'pause', v: !on });
  }
}

const hero = document.querySelector('.hero');
const heroScene = new Scene(hero, {
  theme: 'mycelium', count: 5,
  layout: (w, h) => w < 820
    ? [[.08, .13], [.3, .2], [.56, .12], [.76, .22], [.18, .34]]
    : [[.60, .2], [.74, .3], [.66, .5], [.86, .22], [.84, .56]],
});

const showcase = document.querySelector('.showcase');
const showScene = new Scene(showcase, {
  theme: 'ripples', count: 6,
  layout: (w) => w < 640
    ? [[.07, .06], [.07, .35], [.65, .08], [.4, .42], [.68, .46], [.08, .66]]
    : [[.05, .08], [.05, .46], [.7, .1], [.42, .38], [.8, .5], [.22, .62]],
});

if (reduce) { hero.classList.add('still'); heroScene.load('mycelium'); showScene.load('ripples'); }
else {
  new IntersectionObserver(es => es.forEach(e => (e.target === hero ? heroScene : showScene).setActive(e.isIntersecting)), { rootMargin: '120px' })
    .observe(hero);
  new IntersectionObserver(es => es.forEach(e => showScene.setActive(e.isIntersecting)), { rootMargin: '200px' }).observe(showcase);
}

// theme tabs
const tabs = document.querySelectorAll('.tabs button');
tabs.forEach(btn => btn.addEventListener('click', () => {
  tabs.forEach(b => b.setAttribute('aria-selected', b === btn));
  document.querySelector('.themecopy').textContent = btn.dataset.copy;
  showcase.dataset.theme = btn.dataset.theme;
  showScene.load(btn.dataset.theme);
  showScene.active = true;
}));

// reveal on scroll
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .15 });
document.querySelectorAll('.rv').forEach(el => io.observe(el));
