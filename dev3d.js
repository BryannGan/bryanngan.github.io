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

/* Packing, not a random pile.
   Cells are [col, row] in a 4-wide well, row 0 at the bottom. The first five
   pieces tile rows 0-4 exactly — 5 tetrominoes, 20 cells, no gaps — so the
   stack closes into a solid slab instead of a scatter. Anything beyond five
   lands as a clean bar on the next row up. */
const PACKING = [
  [[0, 0], [1, 0], [2, 0], [2, 1]],   // J across the floor, turning up
  [[3, 0], [3, 1], [3, 2], [2, 2]],   // L up the right wall, turning in
  [[0, 1], [1, 1], [0, 2], [1, 2]],   // O filling the left pocket
  [[0, 3], [1, 3], [2, 3], [1, 4]],   // T on row 3, stem up
  [[3, 3], [3, 4], [2, 4], [2, 5]]    // S climbing the right, leaving a ragged top
];
const WELL_W = 4;

function cellsFor(i) {
  if (i < PACKING.length) return PACKING[i];
  const row = 5 + (i - PACKING.length);
  return [[0, row], [1, row], [2, row], [3, row]];
}

/* Material identity per project. Muted enough to stay cinematic — these read
   as anodised, brushed and glazed surfaces, not as primaries. */
const LOOKS = [
  { color: 0x5f9bd8, rough: 0.32, metal: 0.55, tex: 'brushed' },  // steel blue
  { color: 0xe0ae3c, rough: 0.40, metal: 0.50, tex: 'grid'    },  // brass
  { color: 0x2fc0a8, rough: 0.26, metal: 0.24, tex: 'speckle' },  // teal glaze
  { color: 0xd66e8c, rough: 0.54, metal: 0.12, tex: 'matte'   },  // rose ceramic
  { color: 0x8b74e0, rough: 0.32, metal: 0.38, tex: 'brushed' },  // violet
  { color: 0xd4ab78, rough: 0.62, metal: 0.10, tex: 'matte'   }   // sand
];

/* Procedural surface maps. Drawn once into a small canvas and reused as a
   roughness map, so the light breaks up across a face instead of reading as
   flat plastic. No image files, no extra requests. */
const texCache = {};

/* Draws the pattern as a HEIGHT field. Everything else is derived from it. */
function heightField(kind, S) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = '#808080';
  x.fillRect(0, 0, S, S);

  if (kind === 'brushed') {
    for (let i = 0; i < 1500; i++) {
      const y = Math.random() * S;
      const v = 118 + Math.random() * 68;
      x.strokeStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
      x.lineWidth = 0.4 + Math.random() * 0.9;
      x.beginPath(); x.moveTo(0, y); x.lineTo(S, y + (Math.random() - 0.5) * 4); x.stroke();
    }
  } else if (kind === 'grid') {
    // Recessed channels with raised pads — reads as machined plate.
    x.strokeStyle = '#6a6a6a'; x.lineWidth = 2;
    for (let g = 0; g <= S; g += 32) {
      x.beginPath(); x.moveTo(g, 0); x.lineTo(g, S); x.stroke();
      x.beginPath(); x.moveTo(0, g); x.lineTo(S, g); x.stroke();
    }
    x.fillStyle = '#a4a4a4';
    for (let gx = 16; gx < S; gx += 32) for (let gy = 16; gy < S; gy += 32) {
      x.beginPath(); x.arc(gx, gy, 4.5, 0, Math.PI * 2); x.fill();
    }
  } else if (kind === 'speckle') {
    for (let i = 0; i < 3200; i++) {
      const r = 0.8 + Math.random() * 2.6;
      const v = Math.random() > 0.5 ? 168 : 96;
      x.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.45)';
      x.beginPath(); x.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2); x.fill();
    }
  } else {                                   // matte — soft cast blotches
    for (let i = 0; i < 300; i++) {
      const v = 108 + Math.random() * 52;
      x.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.20)';
      x.beginPath();
      x.arc(Math.random() * S, Math.random() * S, 4 + Math.random() * 16, 0, Math.PI * 2);
      x.fill();
    }
  }
  return { canvas: c, ctx: x, S };
}

/* Sobel the height field into a tangent-space normal map. This is what makes
   the faces stop reading as flat colour: the shading now varies per texel
   because the normals do, rather than only the specular response. */
function normalFrom(height, strength) {
  const { S } = height;
  const src = height.ctx.getImageData(0, 0, S, S).data;
  const out = document.createElement('canvas');
  out.width = out.height = S;
  const ox = out.getContext('2d');
  const img = ox.createImageData(S, S);
  const at = (X, Y) => src[(((Y + S) % S) * S + ((X + S) % S)) * 4] / 255;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))
               - (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1));
      const dy = (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1))
               - (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1));
      let nx = dx * strength, ny = dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * S + x) * 4;
      img.data[i]     = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ox.putImageData(img, 0, 0);
  return out;
}

function surfaceMaps(kind) {
  if (texCache[kind]) return texCache[kind];
  const S = 256;
  const height = heightField(kind, S);

  const rough = new THREE.CanvasTexture(height.canvas);
  const normal = new THREE.CanvasTexture(normalFrom(height, kind === 'grid' ? 2.2 : 1.3));
  for (const t of [rough, normal]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2.6, 2.6);
    t.anisotropy = 4;
  }
  texCache[kind] = { rough, normal };
  return texCache[kind];
}

/* Chamfered cube. Sharp box corners have no facet to catch a highlight, so
   every edge died into the neighbouring face. Rounding the corners gives each
   edge a bright rim and the stack reads as objects rather than a painted wall.
   three.js keeps RoundedBoxGeometry in examples/, so it is built here. */
function roundedBox(size, radius, seg) {
  const g = new THREE.BoxGeometry(size, size, size, seg, seg, seg);
  const pos = g.attributes.position;
  const half = size / 2 - radius;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ix = Math.max(-half, Math.min(half, v.x));
    const iy = Math.max(-half, Math.min(half, v.y));
    const iz = Math.max(-half, Math.min(half, v.z));
    const dx = v.x - ix, dy = v.y - iy, dz = v.z - iz;
    const d = Math.hypot(dx, dy, dz) || 1;
    pos.setXYZ(i, ix + (dx / d) * radius, iy + (dy / d) * radius, iz + (dz / d) * radius);
  }
  g.computeVertexNormals();
  return g;
}

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
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.32;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0d12, 0.032);

  {
    const ec = document.createElement('canvas');
    ec.width = 256; ec.height = 128;
    const ex = ec.getContext('2d');
    const g = ex.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0.00, '#0a1420');   // zenith
    g.addColorStop(0.42, '#33546f');   // upper sky
    g.addColorStop(0.52, '#8fb4d4');   // horizon band, the specular highlight
    g.addColorStop(0.60, '#7a4a2e');   // warm underside
    g.addColorStop(1.00, '#0b0c10');   // ground
    ex.fillStyle = g; ex.fillRect(0, 0, 256, 128);
    // A couple of bright patches so reflections have something to travel across.
    ex.fillStyle = 'rgba(255,255,255,0.32)';
    ex.beginPath(); ex.ellipse(70, 52, 26, 9, 0, 0, Math.PI * 2); ex.fill();
    ex.fillStyle = 'rgba(255,186,130,0.24)';
    ex.beginPath(); ex.ellipse(196, 60, 20, 7, 0, 0, Math.PI * 2); ex.fill();

    const envTex = new THREE.CanvasTexture(ec);
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(envTex).texture;
    pmrem.dispose();
    envTex.dispose();
  }

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);

  /* ── Light: cold key, warm rim, dim fill. Kept to three so the frame cost
        stays flat regardless of how many pieces are on screen. ── */
  scene.add(new THREE.HemisphereLight(0xbcd8f2, 0x1a2430, 1.25));

  const key = new THREE.DirectionalLight(0xeaf3ff, 2.6);
  key.position.set(6, 14, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -12; key.shadow.camera.right = 12;
  key.shadow.camera.top = 16;   key.shadow.camera.bottom = -4;
  key.shadow.camera.near = 1;   key.shadow.camera.far = 44;
  key.shadow.bias = -0.0016;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xffb27a, 2.0);
  rim.position.set(-9, 4, -7);
  scene.add(rim);

  // Cool bounce from beneath so the undersides don't go to pure black.
  const fill = new THREE.DirectionalLight(0x5f86b5, 0.8);
  fill.position.set(-3, -6, 5);
  scene.add(fill);

  // Two close point lights travel with the stack. Metals need something to
  // reflect — with only distant directionals the brushed and grid maps had
  // nothing to catch and read as flat paint.
  const spark = new THREE.PointLight(0xbfe0ff, 26, 26, 2);
  scene.add(spark);
  const sparkWarm = new THREE.PointLight(0xffb98a, 18, 22, 2);
  scene.add(sparkWarm);

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
  floor.receiveShadow = true;
  scene.add(floor);

  /* ── Pieces ── */
  const CUBE = roundedBox(0.94, 0.075, 3);
  // Edge overlay is taken from a plain box so the wireframe stays crisp —
  // running EdgesGeometry over the chamfered mesh produces a mess of facets.
  const EDGES = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.94, 0.94, 0.94));

  const pieces = items.map((item, i) => {
    const cells = cellsFor(i);
    const look = LOOKS[i % LOOKS.length];
    const group = new THREE.Group();

    const maps = surfaceMaps(item.tex || look.tex);
    const body = new THREE.MeshStandardMaterial({
      color: item.color || look.color,
      roughness: look.rough,
      metalness: look.metal,
      roughnessMap: maps.rough,
      aoMap: maps.rough,
      aoMapIntensity: 0.25,
      normalMap: maps.normal,
      normalScale: new THREE.Vector2(0.32, 0.32),
      envMapIntensity: 0.6,
      emissive: 0x000000,
      emissiveIntensity: 1
    });
    const edge = new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.14
    });

    // Cells are absolute in the well; the group origin is the piece centroid
    // so it spins about itself on the way down and still lands on the grid.
    let cx = 0, cy = 0;
    cells.forEach(([c, r]) => { cx += c; cy += r; });
    cx /= cells.length; cy /= cells.length;

    cells.forEach(([c, r]) => {
      const m = new THREE.Mesh(CUBE, body);
      m.position.set(c - cx, r - cy, 0);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
      const l = new THREE.LineSegments(EDGES, edge);
      l.position.copy(m.position);
      group.add(l);
    });

    const restX = cx - (WELL_W - 1) / 2;      // centre the well on the origin
    const restY = cy + 0.5;

    group.userData = {
      item, body, edge, index: i,
      restY, restX,
      baseColor: new THREE.Color(item.color || look.color),
      startY: restY + 20 + i * 1.6,
      spin: (i % 2 ? 1 : -1) * (0.6 + (i % 3) * 0.35),
      hover: 0, lock: 0
    };
    group.position.set(restX, group.userData.startY, 0);
    scene.add(group);
    return group;
  });

  const stackTop = Math.max(...pieces.map(p => p.userData.restY)) + 1.2;

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

    return { el, line, piece: p, left: i % 2 === 0 };
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

      // Lift the piece's own hue rather than pushing every piece to one colour.
      u.body.color.copy(u.baseColor).offsetHSL(0, u.hover * 0.10, u.hover * 0.16);
      u.body.emissive.copy(u.baseColor).multiplyScalar(0.30 * u.hover);
      u.edge.opacity = 0.10 + t * 0.06 + u.hover * 0.45;
    }

    // Camera rises with the build and pulls back only enough to keep the
    // whole slab in frame. Sized against stackTop so it stays framed if the
    // number of projects changes.
    const cy = 1.6 + progress * (stackTop * 0.62);
    const cz = stackTop * 1.55 + progress * stackTop * 0.55;
    const orbit = -0.62 + progress * 1.15 + parX * 0.45;
    camera.position.set(Math.sin(orbit) * cz, cy + parY * 1.6, Math.cos(orbit) * cz);
    camera.lookAt(0, 0.7 + progress * stackTop * 0.42, 0);

    // Keep the practicals near whatever is currently being built.
    const focus = 1.2 + progress * stackTop * 0.85;
    spark.position.set(3.4, focus + 2.6, 4.2);
    sparkWarm.position.set(-4.0, focus - 0.6, -3.2);

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

      // Side is assigned per piece, not derived from projected position.
      const left = L.left;
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
