/* Developer mode — the Well.
   A tetromino per project falls and locks into a stack as you scroll. Camera
   pulls back and orbits as the stack builds; HUD labels project from each
   locked piece to a leader line at the edge of frame.

   Real-time WebGL, not video: the pieces are lit geometry, so they respond to
   camera and pointer. Nothing here is pre-rendered.

   Budget notes, since this page previously had a lag problem:
     - 5 pieces x 4 cubes = 20 meshes, one shared geometry, instanced edges
     - DPR capped at 1.75; no post-processing (grain/vignette are CSS)
     - renders only while the stage is on screen, and only when scroll or
       pointer actually changed something */
import * as THREE from './vendor/three.module.min.js';

const SHAPES = {
  // offsets in cells, origin at piece centre
  I: [[-1.5, 0], [-0.5, 0], [0.5, 0], [1.5, 0]],
  O: [[-0.5, 0.5], [0.5, 0.5], [-0.5, -0.5], [0.5, -0.5]],
  T: [[-1, 0], [0, 0], [1, 0], [0, -1]],
  L: [[-0.5, 1], [-0.5, 0], [-0.5, -1], [0.5, -1]],
  S: [[-1, -0.5], [0, -0.5], [0, 0.5], [1, 0.5]],
  J: [[0.5, 1], [0.5, 0], [0.5, -1], [-0.5, -1]]
};
const ORDER = ['I', 'L', 'T', 'S', 'O', 'J'];

export function mountWell(opts) {
  const stage = opts.stage;
  const canvas = opts.canvas;
  const hud = opts.hud;
  const lines = opts.lines;
  const items = opts.items || [];
  if (!stage || !canvas || !items.length) return null;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Renderer ── */
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: true, powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0d12, 0.032);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);

  /* ── Light: cold key, warm rim, dim fill. Kept to three so the frame cost
        stays flat regardless of how many pieces are on screen. ── */
  scene.add(new THREE.HemisphereLight(0xa8c8ea, 0x121a24, 0.95));

  const key = new THREE.DirectionalLight(0xeaf3ff, 3.1);
  key.position.set(6, 14, 8);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xffb27a, 2.0);
  rim.position.set(-9, 4, -7);
  scene.add(rim);

  // Cool bounce from beneath so the undersides don't go to pure black.
  const fill = new THREE.DirectionalLight(0x5f86b5, 0.9);
  fill.position.set(-3, -6, 5);
  scene.add(fill);

  /* ── Floor: a faint grid the stack lands on, fading into fog ── */
  const grid = new THREE.GridHelper(70, 70, 0x2b3a4d, 0x18222e);
  grid.material.transparent = true;
  grid.material.opacity = 0.5;
  grid.position.y = -0.001;
  scene.add(grid);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(38, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x0d131b, roughness: 0.92, metalness: 0.1 })
  );
  floor.position.y = -0.02;
  scene.add(floor);

  /* ── Pieces ── */
  const CUBE = new THREE.BoxGeometry(0.94, 0.94, 0.94);
  const EDGES = new THREE.EdgesGeometry(CUBE);

  const pieces = items.map((item, i) => {
    const shape = SHAPES[ORDER[i % ORDER.length]];
    const group = new THREE.Group();

    const body = new THREE.MeshStandardMaterial({
      color: 0xb9cde2, roughness: 0.26, metalness: 0.42,
      emissive: 0x16222f, emissiveIntensity: 1
    });
    const edge = new THREE.LineBasicMaterial({ color: 0xe6f2ff, transparent: true, opacity: 0.5 });

    shape.forEach(([cx, cy]) => {
      const m = new THREE.Mesh(CUBE, body);
      m.position.set(cx, cy, 0);
      group.add(m);
      const l = new THREE.LineSegments(EDGES, edge);
      l.position.copy(m.position);
      group.add(l);
    });

    // Where the piece comes to rest: stacked bottom-up, alternating offset so
    // the stack reads as a built structure rather than a column.
    const restY = 0.9 + i * 2.05;
    const restX = (i % 2 === 0 ? -1 : 1) * (0.7 + (i % 3) * 0.5);

    group.userData = {
      item, body, edge, index: i,
      restY, restX,
      startY: restY + 22 + i * 2,
      spin: (i % 2 ? 1 : -1) * (0.6 + (i % 3) * 0.35),
      hover: 0, lock: 0
    };
    group.position.set(restX, group.userData.startY, 0);
    scene.add(group);
    return group;
  });

  const stackTop = 0.9 + (pieces.length - 1) * 2.05;

  /* ── Dust: cheap depth cue, one draw call ── */
  const dustN = 260;
  const dustPos = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 44;
    dustPos[i * 3 + 1] = Math.random() * 30;
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * 44;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0x9fc4e8, size: 0.06, transparent: true, opacity: 0.5, depthWrite: false
  }));
  scene.add(dust);

  /* ── HUD: one label per piece, positioned by projecting the piece ── */
  const labels = pieces.map((p, i) => {
    const el = document.createElement('a');
    el.className = 'hud-label';
    const it = p.userData.item;
    if (it.href) {
      el.href = it.href;
      if (/^https?:/.test(it.href)) { el.target = '_blank'; el.rel = 'noopener'; }
    }
    el.innerHTML =
      '<span class="hud-idx">' + String(i + 1).padStart(2, '0') + '</span>' +
      '<span class="hud-body"><span class="hud-title"></span>' +
      '<span class="hud-tag"></span></span>';
    el.querySelector('.hud-title').textContent = it.title || '';
    el.querySelector('.hud-tag').textContent = (it.tags || []).slice(0, 2).join(' · ');
    hud.appendChild(el);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('class', 'hud-line');
    lines.appendChild(line);

    return { el, line, piece: p };
  });

  /* ── Sizing ── */
  let w = 0, h = 0;
  function resize() {
    const r = stage.getBoundingClientRect();
    w = Math.max(1, r.width); h = Math.max(1, r.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    lines.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    dirty = true;
  }

  /* ── Pointer ── */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2(-2, -2);
  let hovered = null, parX = 0, parY = 0, tgtX = 0, tgtY = 0;

  canvas.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    tgtX = ndc.x * 0.55;
    tgtY = ndc.y * 0.35;
    dirty = true;
  }, { passive: true });

  canvas.addEventListener('pointerleave', () => {
    ndc.set(-2, -2); tgtX = 0; tgtY = 0; dirty = true;
  }, { passive: true });

  canvas.addEventListener('click', () => {
    if (hovered && hovered.userData.item.href) {
      const it = hovered.userData.item;
      if (/^https?:/.test(it.href)) window.open(it.href, '_blank', 'noopener');
      else location.href = it.href;
    }
  });

  /* ── Scroll ── */
  let progress = 0, dirty = true;
  function readScroll() {
    const r = stage.parentElement.getBoundingClientRect();
    const span = r.height - window.innerHeight;
    const p = span > 0 ? (-r.top) / span : 0;
    const next = Math.min(1, Math.max(0, p));
    if (Math.abs(next - progress) > 0.0004) { progress = next; dirty = true; }
  }

  const clamp01 = v => Math.min(1, Math.max(0, v));
  const easeOut = t => 1 - Math.pow(1 - t, 3);

  function frame() {
    raf = requestAnimationFrame(frame);
    readScroll();

    parX += (tgtX - parX) * 0.07;
    parY += (tgtY - parY) * 0.07;
    if (Math.abs(tgtX - parX) > 0.001 || Math.abs(tgtY - parY) > 0.001) dirty = true;

    // Pieces drop in sequence across the first 80% of the scroll.
    const n = pieces.length;
    for (let i = 0; i < n; i++) {
      const p = pieces[i];
      const u = p.userData;
      const from = (i / n) * 0.78;
      const to = from + 0.78 / n;
      const t = easeOut(clamp01((progress - from) / (to - from)));

      u.lock = t;
      p.position.y = u.startY + (u.restY - u.startY) * t;
      p.position.x = u.restX + (1 - t) * u.spin * 3.2;
      p.rotation.z = (1 - t) * u.spin * 2.4;
      p.rotation.y = (1 - t) * u.spin * 1.6;

      const hv = (hovered === p ? 1 : 0);
      u.hover += (hv - u.hover) * 0.16;
      if (Math.abs(hv - u.hover) > 0.002) dirty = true;

      u.body.color.setHSL(0.57, 0.16 + u.hover * 0.24, 0.62 + u.hover * 0.18);
      u.body.emissiveIntensity = 1 + u.hover * 2.2;
      u.body.emissive.setHex(u.hover > 0.02 ? 0x2b4a63 : 0x0a1018);
      u.edge.opacity = 0.42 + t * 0.2 + u.hover * 0.4;
    }

    // Camera pulls back and rises as the stack grows.
    const cy = 4.5 + progress * (stackTop * 0.72);
    const cz = 15 + progress * 12;
    const orbit = -0.5 + progress * 1.05 + parX * 0.5;
    camera.position.set(Math.sin(orbit) * cz, cy + parY * 2.2, Math.cos(orbit) * cz);
    camera.lookAt(0, Math.min(cy - 1.5, stackTop * 0.55), 0);

    dust.rotation.y += 0.0006;

    // The head yields to the scene once building starts.
    if (opts.head) {
      const fade = clamp01((progress - 0.06) / 0.16);
      opts.head.style.opacity = String(1 - fade);
      opts.head.style.transform = 'translateY(calc(-50% - ' + (fade * 26) + 'px))';
    }

    if (dirty) {
      // Hover test only when something moved.
      if (ndc.x > -1.5) {
        ray.setFromCamera(ndc, camera);
        const hit = ray.intersectObjects(pieces, true)[0];
        let g = hit ? hit.object.parent : null;
        if (g && !g.userData.item) g = null;
        if (g !== hovered) { hovered = g; canvas.style.cursor = g ? 'pointer' : ''; }
      } else if (hovered) {
        hovered = null; canvas.style.cursor = '';
      }

      renderer.render(scene, camera);
      updateHud();
      dirty = false;
    }
  }

  const v = new THREE.Vector3();
  function updateHud() {
    for (let i = 0; i < labels.length; i++) {
      const L = labels[i];
      const u = L.piece.userData;
      const shown = u.lock > 0.94;
      L.el.classList.toggle('is-in', shown);
      L.line.classList.toggle('is-in', shown);
      if (!shown) continue;

      v.set(L.piece.position.x, L.piece.position.y, L.piece.position.z).project(camera);
      const sx = (v.x * 0.5 + 0.5) * w;
      const sy = (-v.y * 0.5 + 0.5) * h;

      // Labels alight on whichever side the piece leans, clamped inside frame.
      const left = sx < w * 0.5;
      const lx = left ? Math.max(24, w * 0.07) : Math.min(w - 24, w * 0.93);
      const ly = Math.min(h - 40, Math.max(40, sy));

      L.el.classList.toggle('is-left', left);
      L.el.style.transform = 'translate(' + (left ? lx : lx) + 'px,' + ly + 'px)';
      L.line.setAttribute('points', sx + ',' + sy + ' ' +
        (left ? sx - (sx - lx) * 0.55 : sx + (lx - sx) * 0.55) + ',' + ly + ' ' + lx + ',' + ly);
    }
  }

  /* ── Lifecycle ── */
  let raf = 0, running = false;
  function start() { if (!running) { running = true; dirty = true; raf = requestAnimationFrame(frame); } }
  function stop() { running = false; cancelAnimationFrame(raf); }

  resize();
  addEventListener('resize', () => { resize(); }, { passive: true });
  addEventListener('scroll', () => { dirty = true; }, { passive: true });
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());

  if ('ResizeObserver' in window) {
    new ResizeObserver(entries => {
      const r = entries[0].contentRect;
      if (r.width > 2 && r.height > 2) resize();
    }).observe(stage);
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(es => es[0].isIntersecting ? start() : stop(),
      { threshold: 0 }).observe(stage);
  } else {
    start();
  }

  if (reduced) {
    // Land everything immediately and render one frame.
    progress = 1;
    for (const p of pieces) {
      p.position.set(p.userData.restX, p.userData.restY, 0);
      p.rotation.set(0, 0, 0);
      p.userData.lock = 1;
    }
    dirty = true;
    start();
    setTimeout(stop, 100);
  }

  return { start, stop, resize };
}
