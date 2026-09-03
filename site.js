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
      if (mode === 'dev')  { renderLab(); labCity(document.querySelector('.lab-grid')); }
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

  /* ── Developer mode: neon city ──
     A seeded skyline drawn once to an offscreen buffer, then composited each
     frame with the cheap, moving parts on top: window flicker, sweeping
     searchlights, and a wet-street reflection that wobbles. Redrawing the
     buildings every frame would be pointless — they never change. */
  var labStarted = false;
  function labCity(canvas) {
    if (labStarted || !canvas) return;
    labStarted = true;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var NEON = ['#FF007A', '#00FFB3', '#A700FF', '#FFEA00'];
    var VOID = '#1B1B2A';

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = 0, h = 0, sky = null, horizon = 0, t = 0, raf = 0, running = false;
    var windows = [], beams = [], seed = 20260903;

    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    function pick(a) { return a[(rnd() * a.length) | 0]; }

    function buildSky() {
      horizon = Math.round(h * 0.62);
      sky = document.createElement('canvas');
      sky.width = Math.round(w * dpr);
      sky.height = Math.round(h * dpr);
      var c = sky.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed = 20260903;
      windows = [];

      // Four depth layers, far to near: dimmer, hazier, shorter.
      for (var layer = 0; layer < 4; layer++) {
        var depth = layer / 3;
        var alpha = 0.30 + depth * 0.70;
        var maxH  = h * (0.16 + depth * 0.30);
        var minH  = h * (0.05 + depth * 0.10);
        var bw    = 26 + depth * 46;
        var x = -40;

        while (x < w + 40) {
          var bwv = bw * (0.6 + rnd() * 0.9);
          var bh  = minH + rnd() * (maxH - minH);
          var top = horizon - bh;

          c.fillStyle = 'rgba(11, 11, 20,' + (0.55 + depth * 0.45) + ')';
          c.fillRect(x, top, bwv, bh);

          // Rooftop neon edge — the thing that makes it read as a city at night.
          if (rnd() > 0.42) {
            var edge = pick(NEON);
            c.strokeStyle = edge;
            c.globalAlpha = 0.35 + depth * 0.5;
            c.lineWidth = 1.6;
            c.beginPath(); c.moveTo(x, top); c.lineTo(x + bwv, top); c.stroke();
            c.globalAlpha = 1;
          }

          // A vertical neon strip running down some facades.
          if (rnd() > 0.62 && bwv > 22) {
            var sx = x + 4 + rnd() * (bwv - 10);
            c.strokeStyle = pick(NEON);
            c.globalAlpha = 0.28 + depth * 0.42;
            c.lineWidth = 2.2;
            c.beginPath(); c.moveTo(sx, top + 8); c.lineTo(sx, horizon - 6); c.stroke();
            c.globalAlpha = 1;
          }

          // Windows. Collected, not drawn — the animated pass owns them.
          var cols = Math.max(1, Math.floor(bwv / 9));
          var rows = Math.max(1, Math.floor(bh / 11));
          for (var cxi = 0; cxi < cols; cxi++) {
            for (var ry = 0; ry < rows; ry++) {
              if (rnd() > 0.38) continue;
              windows.push({
                x: x + 4 + cxi * 9,
                y: top + 6 + ry * 11,
                c: pick(NEON),
                a: (0.25 + rnd() * 0.6) * alpha,
                f: rnd() > 0.92 ? 0.6 + rnd() * 2.4 : 0,   // flicker rate
                p: rnd() * 6.28
              });
            }
          }
          x += bwv + 2 + rnd() * 7;
        }
      }

      beams = [];
      for (var b = 0; b < 3; b++) {
        beams.push({ x: rnd() * w, c: pick(NEON), sp: 0.12 + rnd() * 0.22, p: rnd() * 6.28 });
      }
    }

    function size() {
      var r = canvas.getBoundingClientRect();
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildSky();
    }

    function frame() {
      if (!running) return;
      t += 0.016;

      ctx.clearRect(0, 0, w, h);

      // Sky wash above the skyline.
      var g = ctx.createLinearGradient(0, 0, 0, horizon);
      g.addColorStop(0,    'rgba(27, 27, 42, 0)');
      g.addColorStop(0.55, 'rgba(167, 0, 255, 0.16)');
      g.addColorStop(1,    'rgba(255, 0, 122, 0.20)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, horizon);

      // Searchlights, behind the buildings.
      for (var i = 0; i < beams.length; i++) {
        var bm = beams[i];
        var bx = (bm.x + Math.sin(t * bm.sp + bm.p) * w * 0.32 + w) % w;
        var bg = ctx.createLinearGradient(bx, horizon, bx, horizon - h * 0.55);
        bg.addColorStop(0, bm.c + '44');
        bg.addColorStop(1, bm.c + '00');
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.moveTo(bx - 3, horizon);
        ctx.lineTo(bx - 34, horizon - h * 0.55);
        ctx.lineTo(bx + 34, horizon - h * 0.55);
        ctx.lineTo(bx + 3, horizon);
        ctx.closePath();
        ctx.fill();
      }

      ctx.drawImage(sky, 0, 0, w, h);

      // Windows, with the flickering subset animated.
      for (var k = 0; k < windows.length; k++) {
        var wd = windows[k];
        var a = wd.a;
        if (wd.f) a *= 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * wd.f * 6 + wd.p));
        ctx.globalAlpha = a;
        ctx.fillStyle = wd.c;
        ctx.fillRect(wd.x, wd.y, 3, 4);
      }
      ctx.globalAlpha = 1;

      // Wet street: the skyline mirrored, squashed, wobbling, fading out.
      ctx.save();
      ctx.globalAlpha = 0.32;
      ctx.translate(0, horizon * 2);
      ctx.scale(1, -0.55);
      ctx.drawImage(sky, Math.sin(t * 0.7) * 2, 0, w, h);
      ctx.restore();

      var fade = ctx.createLinearGradient(0, horizon, 0, h);
      fade.addColorStop(0, 'rgba(27, 27, 42, 0.25)');
      fade.addColorStop(1, 'rgba(27, 27, 42, 0.98)');
      ctx.fillStyle = fade;
      ctx.fillRect(0, horizon, w, h - horizon);

      // Street grid receding, drawn over the reflection.
      var fl = h * 0.42;
      for (var d = 0; d < 20; d++) {
        var z = d + 1 - ((t * 0.35) % 1);
        var y = horizon + fl / z;
        if (y > h) continue;
        ctx.strokeStyle = 'rgba(0, 255, 179,' + (0.18 * (1 - d / 20)) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      var cx = w / 2;
      for (var m = -14; m <= 14; m++) {
        ctx.strokeStyle = 'rgba(167, 0, 255, 0.10)';
        ctx.beginPath(); ctx.moveTo(cx, horizon); ctx.lineTo(cx + m * (w / 10), h); ctx.stroke();
      }

      // Horizon bloom.
      var hb = ctx.createLinearGradient(0, horizon - 26, 0, horizon + 10);
      hb.addColorStop(0, 'rgba(255, 234, 0, 0)');
      hb.addColorStop(0.7, 'rgba(255, 0, 122, 0.20)');
      hb.addColorStop(1, 'rgba(0, 255, 179, 0.16)');
      ctx.fillStyle = hb;
      ctx.fillRect(0, horizon - 26, w, 36);

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

    x.fillStyle = '#12121f'; x.fillRect(0, 0, 480, 270);
    x.strokeStyle = 'rgba(167,0,255,0.22)'; x.lineWidth = 1;
    for (var gx = 0; gx <= 480; gx += 24) { x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, 270); x.stroke(); }
    for (var gy = 0; gy <= 270; gy += 24) { x.beginPath(); x.moveTo(0, gy); x.lineTo(480, gy); x.stroke(); }

    for (var n = 0; n < 16; n++) {
      var px = Math.floor(rnd() * 20) * 24;
      var py = Math.floor(rnd() * 11) * 24;
      x.strokeStyle = ['#FF007A','#00FFB3','#A700FF','#FFEA00'][(rnd()*4)|0];
      x.lineWidth = 2;
      x.beginPath(); x.moveTo(px, py);
      var steps = 2 + Math.floor(rnd() * 3);
      for (var st = 0; st < steps; st++) {
        if (rnd() > 0.5) px += (rnd() > 0.5 ? 24 : -24) * (1 + Math.floor(rnd() * 3));
        else py += (rnd() > 0.5 ? 24 : -24) * (1 + Math.floor(rnd() * 2));
        x.lineTo(px, py);
      }
      x.stroke();
      x.fillStyle = '#FFEA00';
      x.beginPath(); x.arc(px, py, 3, 0, Math.PI * 2); x.fill();
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
