/* Motion layer.
   Everything here is additive: the page is complete and readable with this
   file absent or blocked. Nothing below moves content into place — elements
   start visible in CSS and are only *offset* once JS confirms it can animate
   them back, so a failure here can never leave the page blank. */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.add('js');
  if (reduced) return;
  document.documentElement.classList.add('motion');

  /* ── Hero flow field ──────────────────────────────────────────────
     Particles advected through a divergence-light velocity field, drawn as
     decaying trails. It is a toy of the thing this site is about: tracer
     paths in a flow. Sines rather than a noise library keeps it dependency
     free and cheap enough to idle at 60fps. */
  function flowField(canvas) {
    var ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = 0, h = 0, particles = [], running = false, raf = 0, t = 0;

    // Pointer acts as a vortex seeded into the field. `grip` eases in and out
    // so the disturbance arrives and decays rather than snapping.
    var mx = -1e4, my = -1e4, grip = 0, wanted = 0;
    var SWIRL_R = 190;

    var INK = [
      'rgba(168, 92, 60,',    // clay
      'rgba(74, 100, 128,',   // slate
      'rgba(63, 111, 101,'    // sage
    ];

    function resize() {
      var r = canvas.getBoundingClientRect();
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }

    function seed() {
      // Density scales with area so a wide monitor isn't sparse and a phone
      // isn't melting.
      var n = Math.round(Math.min(900, Math.max(160, (w * h) / 980)));
      particles = [];
      for (var i = 0; i < n; i++) particles.push(spawn());
      ctx.clearRect(0, 0, w, h);
    }

    function spawn() {
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        life: 90 + Math.random() * 260,
        age: Math.random() * 120,
        c: INK[(Math.random() * INK.length) | 0],
        a: 0.13 + Math.random() * 0.20
      };
    }

    // Smooth, slowly-rotating angle field.
    function baseAngle(x, y) {
      var sx = x * 0.0042, sy = y * 0.0042;
      return (
        Math.sin(sx + t * 0.22) * 1.35 +
        Math.cos(sy * 1.24 - t * 0.17) * 1.15 +
        Math.sin((sx + sy) * 0.62 + t * 0.11) * 0.85
      );
    }

    // Blend the ambient field toward a tangential (circulating) direction
    // near the pointer, falling off smoothly to nothing at SWIRL_R.
    function angleAt(x, y) {
      var a = baseAngle(x, y);
      if (grip < 0.01) return a;

      var dx = x - mx, dy = y - my;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > SWIRL_R || d < 0.001) return a;

      var falloff = (1 - d / SWIRL_R);
      var weight = falloff * falloff * grip;
      var tangent = Math.atan2(dy, dx) + Math.PI / 2;

      // Shortest-path blend between two angles.
      var delta = Math.atan2(Math.sin(tangent - a), Math.cos(tangent - a));
      return a + delta * weight;
    }

    function frame() {
      if (!running) return;
      t += 0.0055;
      grip += (wanted - grip) * 0.055;

      // Fade toward paper instead of clearing, which leaves trails.
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(253, 252, 250, 0.034)';
      ctx.fillRect(0, 0, w, h);

      ctx.lineWidth = 1.15;
      ctx.lineCap = 'round';

      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        var a = angleAt(p.x, p.y);
        var nx = p.x + Math.cos(a) * 1.25;
        var ny = p.y + Math.sin(a) * 1.25;

        ctx.strokeStyle = p.c + p.a + ')';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(nx, ny);
        ctx.stroke();

        p.x = nx; p.y = ny; p.age++;
        if (p.age > p.life || nx < -20 || nx > w + 20 || ny < -20 || ny > h + 20) {
          particles[i] = spawn();
        }
      }
      raf = requestAnimationFrame(frame);
    }

    function start() { if (!running) { running = true; raf = requestAnimationFrame(frame); } }
    function stop() { running = false; cancelAnimationFrame(raf); }

    resize();
    window.addEventListener('resize', debounce(resize, 180));

    var host = canvas.parentNode;
    host.addEventListener('pointermove', function (e) {
      var r = canvas.getBoundingClientRect();
      mx = e.clientX - r.left;
      my = e.clientY - r.top;
      wanted = 1;
    }, { passive: true });
    host.addEventListener('pointerleave', function () { wanted = 0; }, { passive: true });
    document.addEventListener('visibilitychange', function () {
      document.hidden ? stop() : start();
    });
    // Don't burn frames on a hero that has scrolled away.
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        es[0].isIntersecting ? start() : stop();
      }, { threshold: 0 }).observe(canvas);
    } else {
      start();
    }
  }

  /* ── Scroll progress rail ── */
  function scrollRail(bar) {
    var tick = false;
    function update() {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var p = max > 0 ? window.scrollY / max : 0;
      bar.style.transform = 'scaleX(' + Math.min(1, Math.max(0, p)) + ')';
      tick = false;
    }
    window.addEventListener('scroll', function () {
      if (!tick) { tick = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  /* ── Reveal on entry ──
     Offset applied here, not in CSS, so no-JS keeps everything in place. */
  function reveals() {
    if (!('IntersectionObserver' in window)) return;
    var targets = document.querySelectorAll(
      'section[id] > .container > h2, .project-card, .news-list li, ' +
      '.pub-list li, .conf-list li, .service-list li, .award-list li, .hero-readout div'
    );
    if (!targets.length) return;

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.01 });

    Array.prototype.forEach.call(targets, function (el, i) {
      el.classList.add('will-reveal');
      // Stagger within a group, capped so long lists don't crawl.
      el.style.transitionDelay = (Math.min(i % 8, 7) * 45) + 'ms';
      io.observe(el);
    });
  }

  /* ── Nav reflects position ── */
  function navTracking() {
    var links = document.querySelectorAll('.nav-links a[href^="#"]');
    if (!links.length || !('IntersectionObserver' in window)) return;

    var map = {};
    Array.prototype.forEach.call(links, function (a) {
      var el = document.getElementById(a.getAttribute('href').slice(1));
      if (el) map[el.id] = a;
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        Array.prototype.forEach.call(links, function (a) { a.classList.remove('is-current'); });
        if (map[e.target.id]) map[e.target.id].classList.add('is-current');
      });
    }, { rootMargin: '-45% 0px -50% 0px' });

    Object.keys(map).forEach(function (id) { io.observe(document.getElementById(id)); });
  }

  /* ── Hero parallax ── */
  function heroDrift(hero) {
    var inner = hero.querySelector('.hero-inner');
    if (!inner) return;
    var tick = false;
    window.addEventListener('scroll', function () {
      if (tick) return;
      tick = true;
      requestAnimationFrame(function () {
        var y = window.scrollY;
        if (y < window.innerHeight) {
          inner.style.transform = 'translate3d(0,' + (y * 0.12) + 'px,0)';
          inner.style.opacity = String(Math.max(0, 1 - y / (window.innerHeight * 0.85)));
        }
        tick = false;
      });
    }, { passive: true });
  }

  /* ── Card preview ──
     preload="none" keeps the front page light; the clip is only fetched
     when someone actually hovers the card. */
  function cardPreviews() {
    document.querySelectorAll('.project-card.has-preview, .pub-list li.has-thumb').forEach(function (card) {
      var v = card.querySelector('video');
      if (!v) return;
      card.addEventListener('pointerenter', function () {
        var play = v.play();
        if (play && play.catch) play.catch(function () {});
      });
      card.addEventListener('pointerleave', function () {
        v.pause();
        v.currentTime = 0;
      });
    });
  }

  /* ── Modes ──
     Research is the default and is what a no-JS visitor gets. A ?mode= param
     wins over the stored choice so a link can open in a given mode. */
  var MODES = ['research', 'chef', 'dev'];
  var LABELS = { research: 'Research', chef: 'Chef', dev: 'Developer' };

  function modes() {
    var box = document.getElementById('mode-switch');
    if (!box) return;

    var current = box.querySelector('.mode-current');
    var buttons = box.querySelectorAll('.mode-menu button');

    function apply(mode, remember) {
      if (MODES.indexOf(mode) === -1) mode = 'research';
      document.documentElement.setAttribute('data-mode', mode);
      if (current) current.textContent = LABELS[mode];
      Array.prototype.forEach.call(buttons, function (b) {
        b.setAttribute('aria-selected', String(b.dataset.mode === mode));
      });
      if (remember) {
        try { localStorage.setItem('site-mode', mode); } catch (e) {}
      }
      if (mode === 'chef') { renderKitchen(); petalField(document.getElementById('kitchen')); }
      if (mode === 'dev')  { renderLab(); labCity(document.querySelector('.grid-city')); }
    }

    Array.prototype.forEach.call(buttons, function (b) {
      b.addEventListener('click', function () {
        apply(b.dataset.mode, true);
        box.removeAttribute('open');
      });
    });

    // Click-away and Escape close the menu.
    document.addEventListener('click', function (e) {
      if (box.hasAttribute('open') && !box.contains(e.target)) box.removeAttribute('open');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') box.removeAttribute('open');
    });

    var url = new URLSearchParams(location.search).get('mode');
    var saved = null;
    try { saved = localStorage.getItem('site-mode'); } catch (e) {}
    apply(url || saved || 'research', false);
  }

  /* ── Plate grid ──
     Built from window.KITCHEN. Pointer opens on hover; click and keyboard
     pin it open, so touch works without a hover state to depend on. */
  var kitchenBuilt = false;
  function renderKitchen() {
    if (kitchenBuilt) return;
    var grid = document.getElementById('plate-grid');
    var empty = document.getElementById('kitchen-empty');
    var data = window.KITCHEN || [];
    if (!grid) return;

    if (!data.length) { if (empty) empty.style.display = 'block'; return; }
    if (empty) empty.style.display = 'none';
    kitchenBuilt = true;

    data.forEach(function (d) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'plate' + (d.size ? ' is-' + d.size : '');
      card.setAttribute('aria-expanded', 'false');

      var img = document.createElement('img');
      img.src = 'assets/kitchen/' + d.src;
      img.alt = d.name || '';
      img.loading = 'lazy';
      card.appendChild(img);

      var label = document.createElement('span');
      label.className = 'plate-label';
      label.textContent = d.name || '';
      card.appendChild(label);

      var reveal = document.createElement('span');
      reveal.className = 'plate-reveal';
      var h = document.createElement('span');
      h.className = 'plate-name';
      h.textContent = d.name || '';
      reveal.appendChild(h);

      if (d.notes && d.notes.length) {
        var ul = document.createElement('ul');
        ul.className = 'plate-notes';
        d.notes.forEach(function (n) {
          var li = document.createElement('li');
          li.textContent = n;
          ul.appendChild(li);
        });
        reveal.appendChild(ul);
      }
      card.appendChild(reveal);

      var pin = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      pin.setAttribute('class', 'plate-pin');
      pin.setAttribute('viewBox', '0 0 40 40');
      pin.setAttribute('aria-hidden', 'true');
      var pinUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      pinUse.setAttribute('href', '#bot-blossom');
      pin.appendChild(pinUse);
      card.appendChild(pin);

      var pinned = false;
      function open(on) {
        card.classList.toggle('is-open', on);
        card.setAttribute('aria-expanded', String(on));
      }
      card.addEventListener('pointerenter', function () { if (!pinned) open(true); });
      card.addEventListener('pointerleave', function () { if (!pinned) open(false); });
      card.addEventListener('click', function () {
        pinned = !pinned;
        card.classList.toggle('is-pinned', pinned);
        open(pinned);
      });
      card.addEventListener('focus', function () { open(true); });
      card.addEventListener('blur', function () { if (!pinned) open(false); });

      grid.appendChild(card);
    });
  }

  /* ── Drifting petals ──
     Chef mode's counterpart to the research flow field. Petals fall, sway on
     a per-petal sine, and tumble; drawn as two arcs so they read as a petal
     rather than a dot. Built once, only when chef mode is first shown. */
  var petalsStarted = false;
  function petalField(host) {
    if (petalsStarted || !host) return;
    petalsStarted = true;

    var canvas = document.createElement('canvas');
    canvas.className = 'petal-field';
    canvas.setAttribute('aria-hidden', 'true');
    host.insertBefore(canvas, host.firstChild);

    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = 0, h = 0, petals = [], raf = 0, running = false;
    var TINTS = ['rgba(246,211,220,', 'rgba(255,255,255,', 'rgba(226,240,205,', 'rgba(250,232,198,'];

    function size() {
      var r = host.getBoundingClientRect();
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var n = Math.round(Math.min(70, Math.max(22, w / 22)));
      petals = [];
      for (var i = 0; i < n; i++) petals.push(spawn(true));
    }

    function spawn(anywhere) {
      return {
        x: Math.random() * w,
        y: anywhere ? Math.random() * h : -20,
        r: 4 + Math.random() * 6,
        vy: 0.22 + Math.random() * 0.5,
        sway: 0.4 + Math.random() * 1.0,
        phase: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.02,
        rot: Math.random() * Math.PI,
        c: TINTS[(Math.random() * TINTS.length) | 0],
        a: 0.4 + Math.random() * 0.45
      };
    }

    function frame() {
      if (!running) return;
      ctx.clearRect(0, 0, w, h);
      for (var i = 0; i < petals.length; i++) {
        var p = petals[i];
        p.phase += 0.012;
        p.y += p.vy;
        p.x += Math.sin(p.phase) * p.sway;
        p.rot += p.spin;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c + p.a + ')';
        ctx.beginPath();
        ctx.moveTo(0, -p.r);
        ctx.quadraticCurveTo(p.r * 0.9, 0, 0, p.r);
        ctx.quadraticCurveTo(-p.r * 0.9, 0, 0, -p.r);
        ctx.fill();
        ctx.restore();

        if (p.y > h + 24) petals[i] = spawn(false);
      }
      raf = requestAnimationFrame(frame);
    }

    function start() { if (!running) { running = true; raf = requestAnimationFrame(frame); } }
    function stop() { running = false; cancelAnimationFrame(raf); }

    size();
    window.addEventListener('resize', debounce(size, 200));
    document.addEventListener('visibilitychange', function () { document.hidden ? stop() : start(); });
    start();
  }

  /* ── Developer mode: poster skyline ──
     Bright ground. Flat colour blocks with heavy black keylines — no glow,
     no gradient-into-black. The black is an outline, never the background.
     Geometry is deterministic and drawn once; only the sun rings, the road
     dashes and a few blinking windows move. */
  var labStarted = false;
  function labCity(canvas) {
    if (labStarted || !canvas) return;
    labStarted = true;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var FILL = ['#EAFF00', '#7B2FF7', '#FF2D95', '#00E5FF', '#FFFFFF'];
    var LINE = '#0B0616';

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = 0, h = 0, hz = 0, sky = null, blinks = [], t = 0, raf = 0, running = false;
    var seed = 11;
    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

    function build() {
      var ref = Math.min(h, (window.innerHeight || 800));
      hz = Math.round(ref * 0.94);
      sky = document.createElement('canvas');
      sky.width = Math.round(w * dpr);
      sky.height = Math.round(h * dpr);
      var c = sky.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed = 11;
      blinks = [];

      c.lineJoin = 'round';
      c.lineCap = 'round';

      // Skyline: flat blocks, heavy keyline, drawn far to near.
      [1, 0].forEach(function (near) {
        var bwBase = near ? w * 0.115 : w * 0.085;
        var step = near ? -w * 0.04 : w * 0.02;
        var LEFT_END = w * 0.26, RIGHT_START = w * 0.74;
        while (step < w + 40) {
          var bw = bwBase * (0.62 + rnd() * 0.85);
          var bh = ref * (near ? 0.15 : 0.10) * (0.55 + rnd() * 1.15);
          var x = step, top = hz - bh, cut = 8 + rnd() * 22;

          // Skip anything that would land in the centre channel.
          if (x + bw > LEFT_END && x < RIGHT_START) {
            step = RIGHT_START;
            continue;
          }

          c.fillStyle = near ? FILL[(rnd() * FILL.length) | 0] : '#FFFFFF';
          c.globalAlpha = near ? 1 : 0.55;
          c.beginPath();
          c.moveTo(x, hz);
          c.lineTo(x, top + cut);
          c.lineTo(x + cut, top);
          c.lineTo(x + bw - cut * 0.5, top + cut * 0.3);
          c.lineTo(x + bw, top + cut);
          c.lineTo(x + bw, hz);
          c.closePath();
          c.fill();
          c.globalAlpha = 1;
          c.strokeStyle = LINE;
          c.lineWidth = near ? 4 : 2.5;
          c.stroke();

          if (near) {
            // Windows are punched-out black rectangles, not lights.
            var cols = Math.max(1, Math.floor(bw / 20));
            var rows = Math.max(1, Math.floor(bh / 26));
            for (var cx = 0; cx < cols; cx++) {
              for (var ry = 0; ry < rows; ry++) {
                if (rnd() > 0.62) continue;
                var wx = x + 10 + cx * 20, wy = top + 16 + ry * 26;
                if (wx + 9 > x + bw - 6 || wy + 12 > hz - 6) continue;
                c.fillStyle = LINE;
                c.fillRect(wx, wy, 9, 12);
                if (rnd() > 0.88) blinks.push({ x: wx, y: wy, p: rnd() * 6.28, s: 1 + rnd() * 2.5 });
              }
            }
          }
          step += bw + (near ? 6 : 14) + rnd() * 12;
        }
      });
    }

    function size() {
      var r = canvas.getBoundingClientRect();
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
    }

    function frame() {
      if (!running) return;
      t += 0.016;

      // The sky fill used to clear the canvas; it lives in CSS now.
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(sky, 0, 0, w, h);

      // A few windows blink off.
      for (var i = 0; i < blinks.length; i++) {
        var b = blinks[i];
        if (Math.sin(t * b.s + b.p) > 0.7) {
          ctx.fillStyle = '#EAFF00';
          ctx.fillRect(b.x, b.y, 9, 12);
        }
      }

      raf = requestAnimationFrame(frame);
    }

    function start() { if (!running) { running = true; raf = requestAnimationFrame(frame); } }
    function stop() { running = false; cancelAnimationFrame(raf); }

    size();
    window.addEventListener('resize', debounce(size, 220));
    document.addEventListener('visibilitychange', function () { document.hidden ? stop() : start(); });
    start();
  }

  /* Generated capsule art for builds with no screenshot: a deterministic
     circuit plate seeded off the title, so each card is distinct but stable
     between loads. */
  function circuitPlate(seed) {
    var c = document.createElement('canvas');
    c.width = 480; c.height = 270;
    var x = c.getContext('2d');
    if (!x) return c;

    var s = 0;
    for (var i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
    function rnd() { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }

    x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, 480, 270);
    x.strokeStyle = 'rgba(11,6,22,0.14)'; x.lineWidth = 1;
    for (var gx = 0; gx <= 480; gx += 24) { x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, 270); x.stroke(); }
    for (var gy = 0; gy <= 270; gy += 24) { x.beginPath(); x.moveTo(0, gy); x.lineTo(480, gy); x.stroke(); }

    for (var n = 0; n < 16; n++) {
      var px = Math.floor(rnd() * 20) * 24;
      var py = Math.floor(rnd() * 11) * 24;
      x.strokeStyle = ['#FF2D95','#7B2FF7','#00B8D4','#EAFF00'][(rnd()*4)|0];
      x.lineWidth = 6;
      x.beginPath(); x.moveTo(px, py);
      var steps = 2 + Math.floor(rnd() * 3);
      for (var st = 0; st < steps; st++) {
        if (rnd() > 0.5) px += (rnd() > 0.5 ? 24 : -24) * (1 + Math.floor(rnd() * 3));
        else py += (rnd() > 0.5 ? 24 : -24) * (1 + Math.floor(rnd() * 2));
        x.lineTo(px, py);
      }
      x.stroke();
      x.fillStyle = '#0B0616';
      x.beginPath(); x.arc(px, py, 4.5, 0, Math.PI * 2); x.fill();
    }
    return c;
  }

  var labBuilt = false;
  function renderLab() {
    if (labBuilt) return;
    var grid = document.getElementById('lab-grid');
    var data = window.LAB || [];
    if (!grid || !data.length) return;
    labBuilt = true;

    var count = document.getElementById('lab-count');
    if (count) count.textContent = data.length + ' builds';

    data.forEach(function (d) {
      var cap = document.createElement(d.href ? 'a' : 'div');
      cap.className = 'cap';
      if (d.href) {
        cap.href = d.href;
        if (/^https?:/.test(d.href)) { cap.target = '_blank'; cap.rel = 'noopener'; }
      }

      var art = document.createElement('div');
      art.className = 'cap-art';
      if (d.art) {
        var img = document.createElement('img');
        img.src = 'assets/lab/' + d.art;
        img.alt = ''; img.loading = 'lazy';
        art.appendChild(img);
      } else {
        art.appendChild(circuitPlate(d.title || 'build'));
      }

      var st = document.createElement('span');
      st.className = 'cap-status';
      st.setAttribute('data-s', d.status || '');
      st.textContent = d.status || '';
      art.appendChild(st);

      var yr = document.createElement('span');
      yr.className = 'cap-year';
      yr.textContent = d.year || '';
      art.appendChild(yr);
      var note = document.createElement('span');
      note.className = 'cap-flood-note';
      note.textContent = d.href ? 'Open \u2192' : 'Coming soon';
      cap.appendChild(note);

      cap.appendChild(art);

      var body = document.createElement('div');
      body.className = 'cap-body';

      var h3 = document.createElement('h3');
      h3.className = 'cap-title';
      h3.textContent = d.title || '';
      body.appendChild(h3);

      var tl = document.createElement('p');
      tl.className = 'cap-tagline';
      tl.textContent = d.tagline || '';
      body.appendChild(tl);

      if (d.tags && d.tags.length) {
        var tw = document.createElement('div');
        tw.className = 'cap-tags';
        d.tags.forEach(function (tg) {
          var sp = document.createElement('span');
          sp.textContent = tg;
          tw.appendChild(sp);
        });
        body.appendChild(tw);
      }
      cap.appendChild(body);
      grid.appendChild(cap);
    });
  }

  function debounce(fn, ms) {
    var id;
    return function () { clearTimeout(id); id = setTimeout(fn, ms); };
  }

  function init() {
    var canvas = document.querySelector('.hero-field');
    if (canvas) flowField(canvas);

    var rail = document.querySelector('.scroll-rail i');
    if (rail) scrollRail(rail);

    var hero = document.querySelector('.hero');
    if (hero) heroDrift(hero);

    reveals();
    navTracking();
    cardPreviews();
    modes();

    // Hero type animates in on load.
    requestAnimationFrame(function () {
      document.querySelectorAll('.hero .line > span, .hero-eyebrow, .hero-body, .hero-cue')
        .forEach(function (el) { el.classList.add('is-in'); });
    });
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();
})();
