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
      var n = Math.round(Math.min(420, Math.max(90, (w * h) / 1750)));
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
    function angleAt(x, y) {
      var sx = x * 0.0042, sy = y * 0.0042;
      return (
        Math.sin(sx + t * 0.22) * 1.35 +
        Math.cos(sy * 1.24 - t * 0.17) * 1.15 +
        Math.sin((sx + sy) * 0.62 + t * 0.11) * 0.85
      );
    }

    function frame() {
      if (!running) return;
      t += 0.0055;

      // Fade toward paper instead of clearing, which leaves trails.
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(253, 252, 250, 0.030)';
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
