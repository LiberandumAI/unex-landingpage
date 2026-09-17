import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { CoinScene, HERO_STATE, type CoinState } from './scene';

gsap.registerPlugin(ScrollTrigger);

// ---------------------------------------------------------------------------
// Smooth scroll — Lenis drives ScrollTrigger; GSAP's ticker drives everything.
// ---------------------------------------------------------------------------
const lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, smoothWheel: true, syncTouch: false });
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((t) => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);

const heroBg = document.querySelector<HTMLElement>('[data-hero-bg]')!;
const heroShade = document.querySelector<HTMLElement>('[data-hero-shade]')!;
const handsBg = document.querySelector<HTMLElement>('[data-hands-bg]')!;
const handsVideo = document.querySelector<HTMLVideoElement>('[data-hands-video]')!;
const canvas = document.querySelector<HTMLCanvasElement>('[data-stage]')!;
const scene = new CoinScene(canvas);
if (import.meta.env.DEV) Object.assign(window, { __coin: scene, __lenis: lenis });
lenis.on('scroll', () => scene.setScrollVelocity(lenis.velocity));

// Scroll-scrubbed video: the hands enter the frame while the coin descends.
// If /hands.mp4 is absent the poster (hands.jpg) stays and nothing else changes.
handsVideo.addEventListener('error', () => handsVideo.classList.add('is-missing'), true);
handsVideo.pause();
handsVideo.load();
let handsScrub: { from: number; to: number } | null = null;

// ---------------------------------------------------------------------------
// Coin poses per panel. The timeline only moves the *target*; the scene chases
// it with inertia and spins the coin by itself (see scene.ts).
// ---------------------------------------------------------------------------
const KEYFRAMES: Record<string, Partial<CoinState>> = {
  hero: HERO_STATE,
  // lift-off: centred between heading and index, spinning, seen from above
  topics: { x: -0.07, y: 0.0, rx: -0.55, rz: 0.05, s: 0.58, shadow: 0, spin: 1, yaw: 0 },
  // course panels: parked at the right edge; between panels the coin FLIPS
  // (yaw += PI) instead of wandering — BTC, then ETH, then BTC again.
  p1: { x: 1.02, y: -0.02, rx: -0.18, rz: 0.08, s: 1.2, shadow: 0, spin: 0.12, yaw: 0 },
  p2: { x: 1.02, y: -0.02, rx: -0.18, rz: 0.08, s: 1.2, shadow: 0, spin: 0.12, yaw: Math.PI },
  p3: { x: 1.02, y: -0.02, rx: -0.18, rz: 0.08, s: 1.2, shadow: 0, spin: 0.12, yaw: Math.PI * 2 },
  // low-left under the sticky FAQ heading
  faq: { x: -0.36, y: -0.42, rx: -0.75, rz: 0.15, s: 0.8, shadow: 0, spin: 0.8, yaw: Math.PI * 2 },
  // approach: rises above the frame, upright, while the hands panel pins
  handsAbove: { x: 0.09, y: 0.62, rx: -0.15, rz: 0.2, s: 0.55, shadow: 0, spin: 0.35, yaw: Math.PI * 2, idle: 1 },
  // landing: drops vertically into the open palms, settles face-up with a contact shadow
  hands: { x: 0.09, y: -0.13, rx: 0, rz: 0.2, s: 0.6, shadow: 1, spin: 0, yaw: Math.PI * 2, idle: 0 },
  // stays in the hands; the contacts panel slides over the scene
  contacts: { x: 0.09, y: -0.13, rx: 0, rz: 0.2, s: 0.6, shadow: 1, spin: 0, yaw: Math.PI * 2, idle: 0 },
};

/** Portrait phones: the coin keeps to the lower/right so the stacked text stays readable. */
const KEYFRAMES_MOBILE: Record<string, Partial<CoinState>> = {
  hero: { x: 0.3, y: -0.42, rz: -0.35, s: 1.0 },
  topics: { x: 0.45, y: 0.62, s: 0.5 },
  p1: { x: 0.95, y: 0.55, s: 0.9 },
  p2: { x: 0.95, y: 0.55, s: 0.9 },
  p3: { x: 0.95, y: 0.55, s: 0.9 },
  faq: { x: -0.5, y: -0.55, s: 0.6 },
  // the 16:9 video is centre-cropped on portrait screens: the palms sit right of centre
  handsAbove: { x: 0.34, y: 0.7, s: 0.62 },
  hands: { x: 0.34, y: -0.13, s: 0.66 },
  contacts: { x: 0.34, y: -0.13, s: 0.66 },
};
const isPortrait = () => innerWidth < innerHeight || innerWidth <= 768;
const frame = (key: string): Partial<CoinState> | undefined => {
  const base = KEYFRAMES[key];
  if (!base) return undefined;
  return isPortrait() ? { ...base, ...KEYFRAMES_MOBILE[key] } : base;
};

let master: gsap.core.Timeline | null = null;

/** Shares of the hands hold: the video (hands entering and opening) runs a beat
 *  ahead of the coin, so the palms are open before it arrives. */
const VIDEO_FROM = 0.02;
const VIDEO_TO = 0.4;
const DROP_FROM = 0.06;
const DROP_TO = 0.5;

interface Seg {
  el: HTMLElement;
  key: string;
  start: number; // section top reaches viewport top
  holdEnd: number; // pinned panel starts leaving
}

/**
 * One master timeline scrubbed over the whole page (Liber technique).
 * Each section is taller than its pinned panel; the coin holds its pose while
 * the panel is pinned and moves (eased) in the gap before the next panel.
 * Every keyframe is a fromTo with the full previous pose, so the target is
 * deterministic no matter how the user jumps around.
 */
function setupChoreography(): void {
  master?.scrollTrigger?.kill();
  master?.kill();
  gsap.set('[data-rise], [data-rows] > *', { clearProps: 'all' });

  const vh = innerHeight;
  const H = Math.max(1, document.documentElement.scrollHeight - vh);
  const segs: Seg[] = gsap.utils.toArray<HTMLElement>('[data-section]').map((el) => ({
    el,
    key: el.dataset.section!,
    start: gsap.utils.clamp(0, 1, el.offsetTop / H),
    holdEnd: gsap.utils.clamp(0, 1, (el.offsetTop + el.offsetHeight - vh) / H),
  }));

  master = gsap.timeline({
    defaults: { ease: 'none', immediateRender: false },
    scrollTrigger: { start: 0, end: H, scrub: 1.1 },
  });

  // --- coin ---
  let pose: CoinState = { ...HERO_STATE, ...(isPortrait() ? KEYFRAMES_MOBILE.hero : {}) };
  Object.assign(scene.target, pose);
  segs.forEach((seg, i) => {
    if (i === 0) return;
    const to = frame(seg.key);
    if (!to) return;
    const prev = segs[i - 1];
    // Flowing sections (FAQ, contacts) have no pinned hold: transition while they enter.
    const from = prev.el.classList.contains('sec--flow') ? Math.max(prev.start, seg.start - vh / H) : prev.holdEnd;
    const tween = (target: Partial<CoinState>, t0: number, t1: number, ease: string) => {
      const next: CoinState = { ...pose, ...target };
      master!.fromTo(scene.target, { ...pose }, { ...next, duration: Math.max(t1 - t0, 0.002), ease }, t0);
      pose = next;
    };
    if (seg.key === 'hands') {
      // Two beats: settle high in the frame while the panel arrives, then descend
      // in lockstep with the video (hands entering and opening) and land as it ends.
      const hold = seg.holdEnd - seg.start;
      tween(frame('handsAbove')!, from, seg.start, 'power2.inOut');
      tween(to, seg.start + hold * DROP_FROM, seg.start + hold * DROP_TO, 'power2.in');
    } else {
      tween(to, from, seg.start, 'power2.inOut');
    }
  });

  // --- text: rises in during the transition into each panel ---
  segs.forEach((seg, i) => {
    if (i === 0) return;
    if (seg.el.classList.contains('sec--flow')) {
      // Flowing sections are shorter than the viewport: reveal on enter, once.
      seg.el.querySelectorAll('[data-rise], [data-rows] > *').forEach((el) => {
        gsap.fromTo(el, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.8, ease: 'power2.out', scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
      });
      return;
    }
    const prev = segs[i - 1];
    const tr = Math.max(seg.start - (prev.el.classList.contains('sec--flow') ? seg.start - vh / H : prev.holdEnd), 0.002);
    const t0 = seg.start - tr * 0.5;
    const w = tr * 0.5 + Math.max(seg.holdEnd - seg.start, 0) * 0.1 + 0.002;
    const rises = seg.el.querySelectorAll('[data-rise]');
    if (rises.length) master!.to(rises, { y: 0, opacity: 1, duration: w * 0.6, ease: 'power2.out', stagger: (w * 0.3) / rises.length }, t0);
    const rows = seg.el.querySelectorAll('[data-rows] > *');
    if (rows.length) master!.to(rows, { y: 0, opacity: 1, duration: w * 0.5, ease: 'power2.out', stagger: (w * 0.45) / rows.length }, t0 + w * 0.3);
  });

  // --- backgrounds ---
  const topics = segs[1];
  master.fromTo(heroShade, { opacity: 1 }, { opacity: 0, duration: Math.max(segs[0].holdEnd * 0.3, 0.002) }, 0);
  master.fromTo(heroShade, { opacity: 0 }, { opacity: 0, duration: 0.001 }, segs[0].holdEnd); // stays off
  master.fromTo(heroBg, { opacity: 1 }, { opacity: 0, duration: Math.max(topics.start - segs[0].holdEnd, 0.002) * 0.7 }, segs[0].holdEnd);

  const hands = segs.find((s) => s.key === 'hands');
  const contacts = segs.find((s) => s.key === 'contacts');
  if (hands && contacts) {
    const hi = segs.indexOf(hands);
    const enterFrom = hands.start - vh / H;
    master.fromTo(handsBg, { opacity: 0 }, { opacity: 1, duration: (hands.start - enterFrom) * 0.6 }, enterFrom);
    // Video window: the panel is already pinned and the desk is fully visible;
    // the hands come in first, the coin drops after them.
    void hi;
    const hold = hands.holdEnd - hands.start;
    handsScrub = { from: (hands.start + hold * VIDEO_FROM) * H, to: (hands.start + hold * VIDEO_TO) * H };
  }

  // Scrubbed triggers only render on progress *change*; force the state for the
  // current scroll position (page load, anchor restore, rebuild after resize).
  master.progress(gsap.utils.clamp(0, 1, scrollY / H), false);
}

/**
 * Phones: the page flows normally; the coin appears twice — resting under the
 * hero copy, and dropping into the palms at the end. Everything in between is
 * plain, fast, readable.
 */
function setupChoreographyMobile(): void {
  master?.scrollTrigger?.kill();
  master?.kill();
  gsap.set('[data-rise], [data-rows] > *', { clearProps: 'all' });
  scene.setActive(false);

  const vh = innerHeight;
  const H = Math.max(1, document.documentElement.scrollHeight - vh);
  const p = (px: number) => gsap.utils.clamp(0, 1, px / H);

  master = gsap.timeline({
    defaults: { ease: 'none', immediateRender: false },
    scrollTrigger: { start: 0, end: H, scrub: 0.6 },
  });

  // The phone coin is a pre-rendered image: it flies out through the top on the
  // first scroll and is hidden for good once the hero has passed.
  // The wrapper flies; the image inside keeps its own CSS swing (±20°).
  const coin = document.querySelector<HTMLElement>('[data-hero-coin]');
  if (coin) {
    master.fromTo(
      coin,
      { y: 0, scale: 1 },
      { y: -vh * 1.3, scale: 0.55, duration: p(vh * 0.7), ease: 'power2.in' },
      p(vh * 0.05),
    );
    ScrollTrigger.create({
      start: vh * 0.9,
      end: 'max',
      onToggle: (self) => coin.classList.toggle('is-gone', self.isActive),
    });
  }
  master.fromTo(heroShade, { opacity: 1 }, { opacity: 0, duration: p(vh * 0.3) }, 0);
  master.fromTo(heroBg, { opacity: 1 }, { opacity: 0, duration: p(vh * 0.5) }, p(vh * 0.35));

  ScrollTrigger.create({
    start: vh * 0.95,
    end: 'max',
    onToggle: (self) => document.body.classList.toggle('is-past-hero', self.isActive),
  });

  // Text: reveal on enter for every section.
  document.querySelectorAll<HTMLElement>('[data-section]:not(.sec--hero)').forEach((sec) => {
    sec.querySelectorAll<HTMLElement>('[data-rise], [data-rows] > *').forEach((el, i) => {
      gsap.fromTo(el, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.7, delay: Math.min(i * 0.05, 0.3), ease: 'power2.out', scrollTrigger: { trigger: el, start: 'top 92%', once: true } });
    });
  });

  master.progress(gsap.utils.clamp(0, 1, scrollY / H), false);
}

let videoTime = 0;
function scrubHandsVideo(): void {
  if (scene.isMobile) return; // phones play the clip once on enter (see setupNav) — seeking per frame stutters
  if (!handsScrub || handsVideo.classList.contains('is-missing') || !handsVideo.duration) return;
  const raw = gsap.utils.clamp(0, 1, (lenis.scroll - handsScrub.from) / (handsScrub.to - handsScrub.from));
  const target = raw * handsVideo.duration;
  videoTime += (target - videoTime) * 0.18; // ease seeking so it never stutters
  if (Math.abs(handsVideo.currentTime - videoTime) > 1 / 60) handsVideo.currentTime = videoTime;
}

// ---------------------------------------------------------------------------
// Nav: auto-hide on scroll down, mark the active section, smooth anchors.
// ---------------------------------------------------------------------------
function setupNav(): void {
  const nav = document.querySelector<HTMLElement>('[data-nav]')!;
  ScrollTrigger.create({
    start: 'top -80',
    end: 'max',
    onUpdate: (self) => nav.classList.toggle('is-hidden', self.direction === 1),
    onLeaveBack: () => nav.classList.remove('is-hidden'),
  });

  document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((link) => {
    const id = link.getAttribute('href')!.slice(1);
    const target = id ? document.getElementById(id) : null;
    if (!target) return;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      lenis.scrollTo(target, { offset: 0, duration: 1.8 });
    });
  });

  // Phones: the hands finale is a static banner; drop the video element entirely.
  if (scene.isMobile) handsVideo.remove();

  // Background mood per section (see body[data-scene] in style.css).
  document.querySelectorAll<HTMLElement>('[data-section]').forEach((sec) => {
    ScrollTrigger.create({
      trigger: sec,
      start: 'top 60%',
      end: 'bottom 60%',
      onToggle: (self) => {
        if (self.isActive) document.body.dataset.scene = sec.dataset.section!;
      },
    });
  });

  document.querySelectorAll<HTMLAnchorElement>('.nav__links a').forEach((link) => {
    const target = document.getElementById(link.getAttribute('href')!.slice(1));
    if (!target) return;
    ScrollTrigger.create({
      trigger: target,
      start: 'top 50%',
      end: 'bottom 50%',
      onToggle: (self) => link.classList.toggle('is-active', self.isActive),
    });
  });
}

// ---------------------------------------------------------------------------
// Mobile burger menu.
// ---------------------------------------------------------------------------
function setupMenu(): void {
  const burger = document.querySelector<HTMLButtonElement>('[data-burger]');
  const menu = document.querySelector<HTMLElement>('[data-menu]');
  if (!burger || !menu) return;
  const set = (open: boolean) => {
    document.body.classList.toggle('is-menu', open);
    burger.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-hidden', String(!open));
    if (open) lenis.stop();
    else lenis.start();
  };
  burger.addEventListener('click', () => set(!document.body.classList.contains('is-menu')));
  menu.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const target = document.getElementById(a.getAttribute('href')!.slice(1));
      set(false);
      if (target) {
        e.preventDefault();
        setTimeout(() => lenis.scrollTo(target, { offset: -8, duration: 1.2 }), 60);
      }
    });
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') set(false);
  });
}

// ---------------------------------------------------------------------------
// Programme sheets: native <dialog>, scroll locked while open.
// ---------------------------------------------------------------------------
function setupDialogs(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-dialog]').forEach((btn) => {
    const dlg = document.getElementById(btn.dataset.dialog!) as HTMLDialogElement | null;
    if (!dlg) return;
    btn.addEventListener('click', () => {
      dlg.showModal();
      lenis.stop();
    });
  });
  document.querySelectorAll<HTMLDialogElement>('dialog.sheet').forEach((dlg) => {
    dlg.addEventListener('close', () => lenis.start());
    dlg.querySelector('[data-close]')?.addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close(); // backdrop click
    });
  });
}

// ---------------------------------------------------------------------------
// Loader: an overlay only — every piece of content is in the DOM from the first
// byte, so crawlers see the full page. Waits for fonts, the hero photo and the
// coin, then fades. Never longer than 3.5 s.
// ---------------------------------------------------------------------------
function setupLoader(): Promise<void> {
  const loader = document.querySelector<HTMLElement>('[data-loader]');
  const bar = document.querySelector<HTMLElement>('[data-loader-bar]');
  if (!loader) return Promise.resolve();
  lenis.stop();
  let done = 0;
  const steps = 3;
  const tick = () => bar && (bar.style.transform = `scaleX(${(++done / steps).toFixed(3)})`);
  const heroImg = new Promise<void>((r) => {
    const img = new Image();
    img.onload = img.onerror = () => r();
    img.src = '/hero-desk.jpg';
  });
  const all = Promise.all([
    document.fonts.ready.then(tick),
    heroImg.then(tick),
    (scene.isMobile ? Promise.resolve() : scene.ready$).then(tick),
  ]);
  const minTime = new Promise<void>((r) => setTimeout(r, 1400)); // let the mark finish drawing
  const maxTime = new Promise<void>((r) => setTimeout(r, 3500));
  return Promise.race([Promise.all([all, minTime]), maxTime]).then(() => {
    if (bar) bar.style.transform = 'scaleX(1)';
    // give the bar its last beat, then wipe the veil away
    setTimeout(() => {
      loader.classList.add('is-done');
      lenis.start();
      setTimeout(() => loader.remove(), 1000);
    }, 220);
  });
}

async function boot(): Promise<void> {
  setupNav();
  setupMenu();
  setupDialogs();
  const loaded = setupLoader();

  const noGl = new URLSearchParams(location.search).has('nogl'); // diagnostics
  gsap.ticker.add((time) => {
    if (!noGl) scene.render(time);
    scrubHandsVideo();
  });

  try {
    if (!noGl && !scene.isMobile) await scene.load('/assets/unex-coin.glb');
  } catch (err) {
    console.error('[unex] coin failed to load', err);
  }
  loaded.then(() => gsap.from('.sec--hero [data-rise]', { opacity: 0, y: 18, duration: 1.1, ease: 'power2.out', stagger: 0.08 }));
  const build = () => (scene.isMobile ? setupChoreographyMobile() : setupChoreography());
  ScrollTrigger.refresh();
  build();

  // Layout changes move the sections — rebuild the timeline from fresh offsets.
  // (Phones fire resize when the address bar collapses; ignore width-stable ones.)
  let resizeTimer = 0;
  let lastW = innerWidth;
  window.addEventListener('resize', () => {
    if (scene.isMobile && innerWidth === lastW) return;
    lastW = innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      ScrollTrigger.refresh();
      build();
    }, 200);
  });
}

boot();
