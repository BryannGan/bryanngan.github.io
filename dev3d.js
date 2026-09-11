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

/* Material identity per project. These read as anodised, brushed and glazed
   surfaces, not as primaries.

   Deepened when the ground went from black to a lit room. The old values
   were picked to hold up against a void, where a mid-tone is the brightest
   thing in frame; drop the same colour onto cream at studio exposure and it
   washes out to pastel — the pieces went from anodised to sugared almonds.
   Roughness is up and metalness down for the same reason: a strong
   environment blows out polished chamfers into white rims. */
const LOOKS = [
  { color: 0x466a89, rough: 0.58, metal: 0.10, tex: 'brushed' },  // steel blue
  { color: 0x94702a, rough: 0.62, metal: 0.10, tex: 'grid'    },  // brass
  { color: 0x3a7466, rough: 0.54, metal: 0.06, tex: 'speckle' },  // teal glaze
  { color: 0x8b5163, rough: 0.68, metal: 0.03, tex: 'matte'   },  // rose ceramic
  { color: 0x5e5285, rough: 0.58, metal: 0.08, tex: 'brushed' },  // violet
  { color: 0x8d744c, rough: 0.72, metal: 0.02, tex: 'matte'   }   // sand
];

/* Everything generated here runs off this, never Math.random.

   The grain, the speckle and the dust used the global RNG, so every reload
   produced a slightly different scene: the surfaces re-scattered and the
   motes landed somewhere new. It is a small difference per element and a
   noticeable one in aggregate — the page never looked the same twice, which
   reads as clutter rather than as texture. A fixed seed makes the build
   identical on every visit, and makes a visual regression something you can
   actually compare against a screenshot. */
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

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

  let seed = 0;
  for (let i = 0; i < kind.length; i++) seed = (seed * 31 + kind.charCodeAt(i)) >>> 0;
  const rnd = makeRng(seed + 0x9e37);

  if (kind === 'brushed') {
    for (let i = 0; i < 1500; i++) {
      const y = rnd() * S;
      const v = 118 + rnd() * 68;
      x.strokeStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
      x.lineWidth = 0.4 + rnd() * 0.9;
      x.beginPath(); x.moveTo(0, y); x.lineTo(S, y + (rnd() - 0.5) * 4); x.stroke();
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
      const r = 0.8 + rnd() * 2.6;
      const v = rnd() > 0.5 ? 168 : 96;
      x.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.45)';
      x.beginPath(); x.arc(rnd() * S, rnd() * S, r, 0, Math.PI * 2); x.fill();
    }
  } else {                                   // matte — soft cast blotches
    for (let i = 0; i < 300; i++) {
      const v = 108 + rnd() * 52;
      x.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.20)';
      x.beginPath();
      x.arc(rnd() * S, rnd() * S, 4 + rnd() * 16, 0, Math.PI * 2);
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
  // VSM blurs the penumbra. PCF gave a hard stencil edge, which on a light
  // ground reads as a sticker rather than a shadow.
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.86;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xefe9e0, 0.020);

  {
    const ec = document.createElement('canvas');
    ec.width = 256; ec.height = 128;
    const ex = ec.getContext('2d');
    const g = ex.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0.00, '#fffdf9');   // ceiling bounce
    g.addColorStop(0.42, '#f3ece1');   // upper wall
    g.addColorStop(0.52, '#f7f1e6');   // the softbox band, i.e. the highlight
    g.addColorStop(0.60, '#e8ddcc');   // warm lower wall
    g.addColorStop(1.00, '#d9d0c2');   // floor bounce
    ex.fillStyle = g; ex.fillRect(0, 0, 256, 128);
    // A couple of bright patches so reflections have something to travel across.
    ex.fillStyle = 'rgba(255,255,255,0.55)';
    ex.beginPath(); ex.ellipse(70, 50, 30, 11, 0, 0, Math.PI * 2); ex.fill();
    ex.fillStyle = 'rgba(120,104,86,0.20)';
    ex.beginPath(); ex.ellipse(196, 64, 22, 8, 0, 0, Math.PI * 2); ex.fill();

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
  scene.add(new THREE.HemisphereLight(0xfff6ea, 0xc4b8a6, 0.40));

  const key = new THREE.DirectionalLight(0xfff4e8, 4.0);
  key.position.set(-7, 17, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 5;
  key.shadow.blurSamples = 16;
  key.shadow.camera.left = -14; key.shadow.camera.right = 14;
  key.shadow.camera.top = 18;   key.shadow.camera.bottom = -6;
  key.shadow.camera.near = 1;   key.shadow.camera.far = 52;
  key.shadow.bias = -0.0009;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  // Warm light coming back off the floor, so undersides carry colour.
  const bounce = new THREE.DirectionalLight(0xffd8b8, 0.55);
  bounce.position.set(5, -8, 6);
  scene.add(bounce);

  const rim = new THREE.DirectionalLight(0xdfeaff, 0.6);
  rim.position.set(9, 5, -8);
  scene.add(rim);

  /* ── Floor: a faint grid the stack lands on, fading into fog ── */
  const grid = new THREE.GridHelper(70, 70, 0xb9ad9c, 0xcfc5b6);
  grid.material.transparent = true;
  grid.material.opacity = 0.26;
  grid.position.y = -0.001;
  scene.add(grid);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(38, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xe2dacd, roughness: 0.97, metalness: 0 })
  );
  floor.position.y = -0.02;
  floor.receiveShadow = true;
  scene.add(floor);

  /* ── Pieces ── */
  /* Cells are on a 1.0 grid, so the visible joint between two of them is the
     leftover space PLUS both chamfers — and the chamfer is the part that
     catches you out. 0.94 left a 0.06 seam; against the old black ground
     those read as shadow and the slab looked solid, but against a lit room
     they showed the floor through every joint and the stack became a sheet of
     separate tiles. 0.99 closed most of it and still left 0.13 of daylight
     once both 0.06 chamfers were counted, visible as pale lines across the
     finished slab and between neighbouring pieces.

     The joint is (1 - size) + 2 * chamfer, and the chamfer is the dominant
     term — going 0.99/0.06 to 1.01/0.07 changed it from 0.13 to 0.13 and
     looked identical, because widening the chamfer gave back exactly what
     overlapping the cubes had won. 1.015 with a 0.045 chamfer puts it at
     0.075: neighbours overlap so nothing shows through, and the groove is
     half what it was. Adjust the chamfer first if this needs tightening
     again. */
  const CUBE = roundedBox(1.015, 0.045, 3);
  // Edge overlay is taken from a plain box so the wireframe stays crisp —
  // running EdgesGeometry over the chamfered mesh produces a mess of facets.
  const EDGES = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.015, 1.015, 1.015));

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
      normalScale: new THREE.Vector2(0.20, 0.20),
      envMapIntensity: 0.24,
      emissive: 0x000000,
      emissiveIntensity: 1
    });
    const edge = new THREE.LineBasicMaterial({
      color: 0x2a2219, transparent: true, opacity: 0
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
      hover: 0, lock: 0, committed: false, commit: 0
    };
    group.position.set(restX, group.userData.startY, 0);
    scene.add(group);
    return group;
  });

  const stackTop = Math.max(...pieces.map(p => p.userData.restY)) + 1.2;

  /* ── Ambient pieces ──
     The room is empty until the first project piece drops, because all five
     wait above the frame until you scroll. Against the old black ground that
     was fine — a dark void reads as deliberate. A lit room reads as unfinished.

     This is the standalone studio study's arrangement, ported: pieces on slow
     orbits at mixed radius, height and depth, kept apart and off the type by
     a short relaxation each frame.

     An intermediate version put them on fixed elliptical loops instead, so
     spacing would be correct by construction with no solver. Spacing was
     indeed perfect and it looked wrong: three tidy conveyor belts, and every
     loop's nearest point projected onto screen centre, so pieces queued
     through the headline one after another. The scattered arrangement reads
     as a room with things in it, which is the point.

     Radius, height and depth are stepped by different coprime multiples of
     the index. Keying them all off i makes them correlate, and the pieces
     bunch into one arc leaving the opposite side of the frame bare. */
  const AMB_SHAPES = [
    [[0, 0], [1, 0], [2, 0], [2, 1]],
    [[0, 0], [0, 1], [1, 1], [1, 2]],
    [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[0, 0], [1, 0], [2, 0], [1, 1]],
    [[1, 0], [2, 0], [0, 1], [1, 1]]
  ];
  /* Mostly coloured now — rust, blue, teal, purple and amber — with a few
     neutrals left as rests. All-neutral read as unfinished greyboxing, and
     half-and-half still read as mostly white. Everything is muted and of
     similar value so the labelled project pieces keep the loudest colour.

     Ordered so no two neighbouring indices share a family: index maps to a
     golden-angle position, so a run of one colour here becomes a clump of it
     on screen. */
  const AMB_TONES = [
    0xdcd3c4, 0xc9553f, 0x5a83a8, 0xe4dcce, 0x7a63b8, 0x3f8d7d, 0xc9a53a,
    0xcbc0ae, 0xb8683d, 0x4f7a9c, 0x6a55a0, 0xe1d9cb, 0x4f8f7f, 0xb8942e,
    0xd2c8b7, 0xc9553f, 0x7a63b8, 0x5a83a8, 0xd8cfbf, 0xc9a53a, 0x3f8d7d,
    0x6a55a0, 0xdcd3c4, 0xb8683d, 0x4f7a9c, 0xb8942e
  ];
  const AMB_TEX = ['matte', 'brushed', 'speckle', 'matte', 'brushed', 'speckle'];

  /* Their own cube, and the size is load-bearing.

     Cells sit on a 1.0 grid, so the visible joint between two cells is the
     leftover space PLUS both chamfers — and the chamfer is the part that
     catches you out. At 0.96 with a 0.105 chamfer the flat face is only 0.75
     across, so the joint opened to a quarter of a cell and you could see the
     room straight through it: four loose blocks, not one piece.

     1.01 makes adjacent cells overlap slightly, so nothing can show through
     at any angle, and the chamfer alone forms the groove. Keep the size above
     1.0 for that reason; shrink it and the gaps come back. */
  const AMB_CUBE = roundedBox(1.01, 0.085, 3);
  const AMB_SCALE = 0.78;
  /* 24, not 23: the radius band is picked by (i * 7) % 8, so a multiple of
     eight covers every band the same number of times. At 23 the coverage went
     lopsided and the cloud visibly bunched toward the middle. */
  const AMB_COUNT = 24;
  const ambRng = makeRng(0x2f19);
  const ambientRoot = new THREE.Group();
  scene.add(ambientRoot);

  const ambient = [];
  for (let i = 0; i < AMB_COUNT; i++) {
    const cells = AMB_SHAPES[i % AMB_SHAPES.length];
    let cx = 0, cy = 0;
    cells.forEach(([c, r]) => { cx += c; cy += r; });
    cx /= cells.length; cy /= cells.length;

    // Same procedural surface treatment as the project pieces. Flat colour
    // reads as untextured plastic once the ground is this bright.
    const maps = surfaceMaps(AMB_TEX[i % AMB_TEX.length]);
    const mat = new THREE.MeshStandardMaterial({
      color: AMB_TONES[i % AMB_TONES.length],
      roughness: 0.62, metalness: 0.05, envMapIntensity: 0.22,
      roughnessMap: maps.rough,
      normalMap: maps.normal,
      normalScale: new THREE.Vector2(0.18, 0.18),
      transparent: true, opacity: 0
    });

    const g = new THREE.Group();
    const local = [];
    let far = 0;
    cells.forEach(([c, r]) => {
      const m = new THREE.Mesh(AMB_CUBE, mat);
      m.position.set(c - cx, r - cy, 0);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
      local.push(m.position.clone());
      far = Math.max(far, m.position.length());
    });
    g.scale.setScalar(AMB_SCALE);

    g.userData = {
      mat, local,
      // Bounding radius, for separation. The floor uses the true lowest
      // corner instead, since a sphere can never let a piece near the ground.
      radius: (far + 1.01 * 0.87) * AMB_SCALE,
      cubeDrop: 1.01 * 0.87 * AMB_SCALE,
      // Base position in the ground plane. The cloud is re-centred on the
      // origin after the loop, then rotated rigidly — see below.
      bx: Math.cos(i * 2.39996) * (3.6 + ((i * 7) % 8) * 1.35),
      bz: Math.sin(i * 2.39996) * (3.6 + ((i * 7) % 8) * 1.35) * (0.55 + ((i * 11) % 5) * 0.13),
      y0: 1.1 + ((i * 5) % 9) * 0.60,
      bob: 0.10 + ambRng() * 0.16,
      phase: ambRng() * 6.283,
      spin: new THREE.Vector3((ambRng() - .5) * 0.20, (ambRng() - .5) * 0.28, (ambRng() - .5) * 0.16)
    };
    g.rotation.set(ambRng() * 3, ambRng() * 3, ambRng() * 3);
    ambientRoot.add(g);
    ambient.push(g);
  }

  /* Centre the cloud on the point the camera actually looks at.

     Each piece used to carry a `depth` offset that only ever pushed it away
     from the lens, so the whole cloud's centre of mass sat about six units
     behind the aim point — measured at (-0.97, 3.57, -5.74) against a look-at
     of (0, 0.7, 0). On screen that reads as the drift being off-centre and
     weighted to one side, which it was.

     Subtracting the mean of the base positions fixes it exactly, and because
     every piece then orbits the origin at the same angular rate, the cloud is
     a rigid rotation about that centre — so it stays centred for all time
     rather than only at t = 0. */
  {
    let mx = 0, mz = 0;
    for (const g of ambient) { mx += g.userData.bx; mz += g.userData.bz; }
    mx /= ambient.length; mz /= ambient.length;
    for (const g of ambient) { g.userData.bx -= mx; g.userData.bz -= mz; }
  }

  /* ── Dust: cheap depth cue, one draw call ── */
  const dustN = 260;
  const dustPos = new Float32Array(dustN * 3);
  const dustRng = makeRng(0x51ed);
  for (let i = 0; i < dustN; i++) {
    dustPos[i * 3] = (dustRng() - 0.5) * 44;
    dustPos[i * 3 + 1] = dustRng() * 30;
    dustPos[i * 3 + 2] = (dustRng() - 0.5) * 44;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0x7d7263, size: 0.055, transparent: true, opacity: 0.30, depthWrite: false
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
  if (location.search.indexOf('audit') >= 0) window.__well = { ambient, pieces };
  const T0 = performance.now();
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

  /* ── Committing to the build ──

     Scroll used to map one-to-one onto the whole sequence, so a piece hung in
     mid-air at whatever height your scroll position happened to land on.
     Nothing about the page said it was waiting for more scroll; it just
     looked stuck, and it looked stuck once per project.

     Every piece is now a commitment rather than a scrub. Each has its own
     gate on the scroll track; cross it and that piece falls the rest of the
     way on its own clock, about three quarters of a second, whether or not
     you keep scrolling. Scroll decides *when* a piece is released, never how
     far down it is — so the stack is only ever mid-drop while a drop is
     actually playing, and never parks halfway.

     RELEASE is the hysteresis. With a bare threshold a scroll resting exactly
     on one would commit and un-commit on alternate frames; scrolling back
     past gate minus RELEASE sends that piece home again.

     The last gate sits at 0.82, leaving the tail of the track for the camera
     to finish its pull-back after the final piece lands. */
  const GATE = 0.06;      // ~11vh of scroll on the shortened track
  const LAST_GATE = 1.0;  // the last gate lands at 0.81, leaving a short tail
  const RELEASE = 0.02;
  const gates = pieces.map((_, i) => GATE + (i / pieces.length) * (LAST_GATE - GATE));
  let lastFrame = performance.now();

  /* The headline's exclusion zone, measured from the real elements.

     Hard-coding an ellipse would drift out of register the moment the type
     resized, and the title and pillars are both clamp()-scaled. Measuring the
     live boxes keeps the opening locked to the words at any viewport, and
     keeps working if the copy changes length. Cached per canvas size. */
  let zoneKey = '', zoneVal = null;
  function safeZone() {
    const k = w + 'x' + h;
    if (zoneVal !== null && zoneKey === k) return zoneVal;
    zoneKey = k;
    const els = [document.querySelector('.lab-title'), document.querySelector('.spec-row')].filter(Boolean);
    if (!els.length) return (zoneVal = false);
    const box = canvas.getBoundingClientRect();
    let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
    for (const el of els) {
      const q = el.getBoundingClientRect();
      l = Math.min(l, q.left - box.left); r = Math.max(r, q.right - box.left);
      t = Math.min(t, q.top - box.top);   b = Math.max(b, q.bottom - box.top);
    }
    const px = w * 0.045, py = h * 0.075;   // breathing room around the glyphs
    l -= px; r += px; t -= py; b += py;
    return (zoneVal = {
      cx: ((l + r) / 2 / w) * 2 - 1,
      cy: -(((t + b) / 2 / h) * 2 - 1),
      rx: (r - l) / w,
      ry: (b - t) / h
    });
  }

  /* Ambient drift.

     Three constraints: stay off the headline, stay out of each other and the
     project pieces, stay above the floor. Separation, the floor and the
     project-piece test are positional corrections rebuilt from the orbit each
     frame, so nothing accumulates, and they are iterated because resolving
     one can break another.

     The headline correction is handled differently, and that difference is
     the whole reason this reads smoothly. Applied like the others it snapped
     on the frame a piece touched the text box and off again the frame it
     cleared: the audit measured ~290 units/second of displacement against an
     orbital speed of about one, which is exactly the teleporting that was
     visible. It is now a stored offset eased toward the required clearance,
     computed from the orbit position before the solver runs, so the solver
     sees a smoothly moving target instead of a discontinuous one. */
  const av = new THREE.Vector3(), aRight = new THREE.Vector3();
  let ambLast = 0;

  function updateAmbient(tSec, fade) {
    ambientRoot.visible = fade > 0.004;
    if (!ambientRoot.visible) return;

    const z0 = safeZone();
    const p0 = camera.projectionMatrix.elements[0], p5 = camera.projectionMatrix.elements[5];
    aRight.setFromMatrixColumn(camera.matrixWorld, 0);
    const dt = Math.min(0.05, Math.max(0.001, tSec - ambLast));
    ambLast = tSec;
    const ease = 1 - Math.exp(-2.6 * dt);              // frame-rate independent

    for (const g of ambient) {
      const d = g.userData;
      d.mat.opacity = fade;
      // Rigid rotation of the mean-centred cloud about the aim point.
      const th = tSec * 0.05, ct = Math.cos(th), st = Math.sin(th);
      g.position.set(
        d.bx * ct + d.bz * st,
        d.y0 + Math.sin(tSec * 0.5 + d.phase) * d.bob,
        -d.bx * st + d.bz * ct
      );
      if (!reduced) {
        g.rotation.x += d.spin.x * 0.016;
        g.rotation.y += d.spin.y * 0.016;
        g.rotation.z += d.spin.z * 0.016;
      }

      // Lowest corner under the current rotation, cached for the solver: it
      // only depends on rotation, and recomputing it per pass cost 22 fps.
      let low = Infinity;
      for (const p of d.local) {
        av.copy(p).applyEuler(g.rotation).multiplyScalar(AMB_SCALE);
        if (av.y < low) low = av.y;
      }
      d.minY = -low + d.cubeDrop;

      /* Off the type, sideways only.

         Vertically there is nowhere to go: the floor is at y = 0 and the
         camera at about y = 1.6, so a piece of this radius resting on the
         ground still projects a top edge above the headline's lower bound at
         any depth. Sideways always has room. */
      let need = 0;
      if (z0) {
        av.copy(g.position).applyMatrix4(camera.matrixWorldInverse);
        if (av.z < -0.5) {
          const dist = -av.z;
          const nx = (av.x * p0) / dist, ny = (av.y * p5) / dist;
          /* A fraction of the bounding radius, not all of it: a sphere badly
             overstates an L tetromino, and at full radius the effective text
             box covered most of the screen and flung every piece out of
             frame. That was measured when the hero camera sat eight units
             out; it now stands back at about fourteen, so projected radii are
             smaller and this can afford to be stricter. */
          const pr = d.radius * 0.78;
          const ox = (z0.rx + (pr * p0) / dist) - Math.abs(nx - z0.cx);
          const oy = (z0.ry + (pr * p5) / dist) - Math.abs(ny - z0.cy);
          if (ox > 0 && oy > 0) need = (nx >= z0.cx ? 1 : -1) * ox * (dist / p0);
        }
      }
      d.pushX += (need - d.pushX) * ease;
      if (Math.abs(d.pushX) > 1e-4) g.position.addScaledVector(aRight, d.pushX);
    }

    for (let pass = 0; pass < 4; pass++) {
      // Project pieces win: the blanks move around them, never the reverse.
      for (const g of ambient) {
        const min = g.userData.radius + 2.2;
        for (const p of pieces) {
          let dx = g.position.x - p.position.x, dy = g.position.y - p.position.y, dz = g.position.z - p.position.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= min * min || d2 === 0) continue;
          const d = Math.sqrt(d2), push = min - d;
          g.position.x += (dx / d) * push; g.position.y += (dy / d) * push; g.position.z += (dz / d) * push;
        }
      }

      /* Never so near the lens that one blank swallows the frame. Dropped
         during the port from the standalone study, where the camera sits far
         enough back that it never mattered; here the camera is about eight
         units out and pitching it up for the hero brought near pieces into
         shot at enormous size. Unlike the type test this correction fades to
         zero at its threshold, so it stays smooth. */
      for (const g of ambient) {
        av.copy(g.position).sub(camera.position);
        const dc = av.length(), minC = g.userData.radius + 5.0;
        if (dc > 1e-4 && dc < minC) g.position.copy(camera.position).addScaledVector(av.multiplyScalar(1 / dc), minC);
      }

      for (const g of ambient) {
        if (g.position.y < g.userData.minY) g.position.y = g.userData.minY;
      }

      for (let i = 0; i < ambient.length; i++) {
        const A = ambient[i], ra = A.userData.radius;
        for (let j = i + 1; j < ambient.length; j++) {
          const B = ambient[j];
          const min = ra + B.userData.radius + 0.15;
          let dx = B.position.x - A.position.x, dy = B.position.y - A.position.y, dz = B.position.z - A.position.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= min * min || d2 === 0) continue;
          const d = Math.sqrt(d2), push = (min - d) * 0.58;   // over-relaxed
          dx /= d; dy /= d; dz /= d;
          A.position.x -= dx * push; A.position.y -= dy * push; A.position.z -= dz * push;
          B.position.x += dx * push; B.position.y += dy * push; B.position.z += dz * push;
        }
      }
    }

    for (const g of ambient) {
      if (g.position.y < g.userData.minY) g.position.y = g.userData.minY;
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    readScroll();

    const dt = Math.min(0.05, Math.max(0.001, ((now || performance.now()) - lastFrame) / 1000));
    lastFrame = now || performance.now();

    parX += (tgtX - parX) * 0.07;
    parY += (tgtY - parY) * 0.07;
    if (Math.abs(tgtX - parX) > 0.001 || Math.abs(tgtY - parY) > 0.001) dirty = true;

    /* Each piece runs its own gate and its own clock. `drive` is gone: there
       is no longer one number mapping scroll onto the whole sequence, because
       that is exactly what let a piece sit half-fallen. */
    const n = pieces.length;
    const fall = 1 - Math.exp(-3.4 * dt);          // frame-rate independent
    let built = 0;
    for (let i = 0; i < n; i++) {
      const p = pieces[i];
      const u = p.userData;

      if (!u.committed && progress >= gates[i]) u.committed = true;
      else if (u.committed && progress <= gates[i] - RELEASE) u.committed = false;
      const was = u.commit;
      u.commit += ((u.committed ? 1 : 0) - u.commit) * fall;
      if (Math.abs(u.commit - was) > 0.0002) dirty = true;
      built += u.commit;

      const t = easeOut(u.commit);
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
      // Wireframe overlay is hover-only now. It existed to put a crisp
      // white edge on each cube against the void; on the lit ground the same
      // lines read as a bright halo tracing every block, because the sharp
      // box edges sit just outside the chamfered mesh. Rendering it only
      // under the pointer keeps the hover affordance and drops the halo.
      u.edge.opacity = u.hover * 0.34;
    }
    built /= n;

    /* `commit` is the first piece's, and it is what the front-page elements
       fade on — the handover belongs to that one landing. `built` is the mean
       across all pieces and is what the camera follows, so the framing settles
       as each piece lands rather than sliding with raw scroll. */
    const commit = pieces[0].userData.commit;

    // Camera rises with the build and pulls back only enough to keep the
    // whole slab in frame. Sized against stackTop so it stays framed if the
    // number of projects changes.
    const cy = 1.6 + built * (stackTop * 0.62);
    // Closer than it was: the slab sat small in a large empty room once the
    // ground went light, because there is no longer a dark surround to make
    // it feel big.
    let cz = stackTop * 1.24 + built * stackTop * 0.40;
    const orbit = -0.62 + built * 1.15 + parX * 0.45;

    /* Hero lift: pitch the camera up while the blanks are on screen, so the
       floor sits far lower in frame.

       The floor cannot simply be moved down — it is the plane the stack lands
       on, and the lowest cubes rest within a hundredth of a unit of it. What
       reads as "the floor is too high" is really the horizon, and the horizon
       is set by camera pitch, not by the plane's height. Aiming higher during
       the hero drops the floor down the frame and opens the space around the
       type; it eases back to the signed-off build framing well before the
       first piece lands, so the build itself is untouched. */
    const hero = 1 - commit;
    const heroLift = 1.7 * hero;
    /* Stand further back for the hero too. The cloud spans radius 3.6 to 13
       around the origin while the build camera sits only about 8 out, so a
       good third of the blanks pass between the lens and the aim point and
       fill the frame. Backing off puts the whole cloud in front of the
       camera, which is what makes it read as a room rather than a pile-up. */
    cz += 5.6 * hero;
    camera.position.set(Math.sin(orbit) * cz, cy + parY * 1.6 + heroLift * 0.30, Math.cos(orbit) * cz);
    camera.lookAt(0, 0.7 + built * stackTop * 0.42 + heroLift, 0);
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

    /* The blanks hold the room before the build and clear out once it starts,
       so they never compete with the labelled stack.

       Keyed to `commit`, not to raw scroll. They used to fade across a span of
       scroll position, which stopped matching the moment the first drop got
       its own clock: the piece would land while the room was still half full
       of blanks, and everything only cleared when the SECOND piece landed. The
       handover belongs to the first landing, so it is tied to the same
       commitment that drives it — gone by 0.75, which is where easeOut has
       already put the piece on the floor.

       This is the one thing on the page that animates without being driven by
       scroll or pointer, so it has to force a redraw while it is visible —
       the renderer is otherwise strictly on-demand. */
    const ambFade = clamp01(1 - (commit - 0.04) / 0.71);
    updateAmbient((performance.now() - T0) / 1000, ambFade);
    if (!reduced && ambFade > 0.004) dirty = true;

    dust.rotation.y += 0.0006;

    // The head yields as the first piece comes down, on the same clock.
    if (opts.head) {
      const fade = clamp01((commit - 0.04) / 0.66);
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
    // Land everything immediately and render one frame. `commit` has to be
    // set too, or the drive stays at zero and the frame that renders shows an
    // empty well.
    progress = 1;
    for (const p of pieces) {
      p.position.set(p.userData.restX, p.userData.restY, 0);
      p.rotation.set(0, 0, 0);
      p.userData.lock = 1;
      p.userData.committed = true;
      p.userData.commit = 1;
    }
    dirty = true;
    start();
    setTimeout(stop, 100);
  }

  return { start, stop, resize };
}
