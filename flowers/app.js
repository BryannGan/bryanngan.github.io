/* ==========================================================================
   PET-SAFE / BOUQUET — frontend controller
   Talks to api.py only. All identification / segmentation / toxicity logic
   lives server-side in the original pipeline.
   ========================================================================== */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const SEV = {
  none:     { c: 'var(--safe)',     fill: 0, label: 'NON-TOXIC' },
  mild:     { c: 'var(--mild)',     fill: 1, label: 'MILD'      },
  moderate: { c: 'var(--moderate)', fill: 1, label: 'MODERATE'  },
  severe:   { c: 'var(--severe)',   fill: 1, label: 'SEVERE'    },
  unknown:  { c: 'var(--unknown)',  fill: 0, label: 'UNKNOWN'   },
};

const BE = window.BACKEND;   // live.js (api.py) or baked.js (static demo)
const state = { sid: null, w: 0, h: 0, pets: ['cat', 'dog'], scale: 'medium', busy: false };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── chrome ──────────────────────────────────────────────────────────── */
const led = $('#led'), sysline = $('#sysline');
function sys(msg, s = 'ok') {
  sysline.textContent = msg;
  led.dataset.s = s === 'ok' ? '' : s;
}

setInterval(() => {
  const d = new Date();
  $('[data-meta="clock"]').textContent =
    [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map(n => String(n).padStart(2, '0')).join(':');
}, 1000);
$('#year').textContent = new Date().getFullYear();

/* ── boot ────────────────────────────────────────────────────────────── */
(async function boot() {
  try {
    const m = await BE.meta();
    $('#spec-species').textContent  = m.species;
    $('#spec-verified').textContent = m.verified;
    $('#lede-species').textContent  = m.species;
    $('#foot-species').textContent  = m.species;
    $('#foot-verified').textContent = m.verified;
    $('[data-meta="segmodel"]').textContent = m.seg_model;
    if (!m.providers.length) sys('NO PROVIDER KEY', 'alert');
  } catch { sys('API UNREACHABLE', 'alert'); }
})();

/* ── reveal on scroll ────────────────────────────────────────────────── */
const io = new IntersectionObserver(es => {
  es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
}, { threshold: .12 });
const watch = el => { el.classList.add('rv'); io.observe(el); };

/* ── pets ────────────────────────────────────────────────────────────── */
$$('.pet').forEach(b => b.addEventListener('click', () => {
  b.classList.toggle('on');
  const on = $$('.pet.on').map(x => x.dataset.pet);
  if (!on.length) { b.classList.add('on'); return; }
  state.pets = on;
  if (state.sid) location.reload();
}));

/* ── intake ──────────────────────────────────────────────────────────── */
const drop = $('#drop'), file = $('#file');
if (drop && file) {
['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => {
  e.preventDefault(); drop.classList.add('hot');
}));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => {
  e.preventDefault(); drop.classList.remove('hot');
}));
drop.addEventListener('drop', e => {
  const f = e.dataTransfer.files?.[0];
  if (f) start(f);
});
file.addEventListener('change', () => { if (file.files[0]) start(file.files[0]); });
}

/* ── sample picker + photo credit (baked demo only) ──────────────────── */
async function buildPicker() {
  const host = $('#picker');
  if (!host || !BE.photos) return;
  const photos = await BE.photos();
  host.innerHTML = photos.map((p, i) => `
    <button type="button" class="samp" data-slug="${p.slug}">
      <span class="samp-shot"><img src="demo/${p.thumb || p.photo}" alt="" loading="lazy"></span>
      <span class="samp-meta">
        <span class="samp-i">${String(i + 1).padStart(2, '0')}</span>
        <span class="samp-n">${esc(niceTitle(p.credit.title))}</span>
        <span class="samp-d">${p.blooms.length} TAPPABLE BLOOM(S)</span>
      </span>
    </button>`).join('');
  $$('.samp', host).forEach(b => b.addEventListener('click', () => {
    if (state.busy) return;
    $$('.samp').forEach(x => x.classList.toggle('on', x === b));
    start(b.dataset.slug, b.querySelector('.samp-n').textContent.toUpperCase());
  }));
}

const niceTitle = t => t.replace(/\.(jpg|jpeg|png)$/i, '').replace(/_/g, ' ');

function showCredit(c) {
  const el = $('#credit');
  if (!el) return;
  el.innerHTML = `PHOTO — ${esc(niceTitle(c.title))} · ${esc(c.artist)} · ` +
    `${esc(c.license)} · <a href="${c.source}" target="_blank" rel="noopener">SOURCE</a>`;
}

buildPicker();

/* ── run log ─────────────────────────────────────────────────────────── */
const runlog = $('#runlog');
let logRow = 0;
function log(k, v, cls = '') {
  const el = document.createElement('div');
  el.className = 'row';
  el.style.animationDelay = (logRow++ * 55) + 'ms';
  el.innerHTML = `<span class="k">${k}</span> <span class="v ${cls}">${v}</span>`;
  runlog.appendChild(el);
  return el;
}
function logCaret(text) {
  const el = document.createElement('div');
  el.className = 'row';
  el.style.animationDelay = (logRow++ * 55) + 'ms';
  el.innerHTML = `<span class="k">${text}</span> <span class="caret"></span>`;
  runlog.appendChild(el);
  return el;
}

/* ── main flow ───────────────────────────────────────────────────────── */
async function start(input, label) {
  document.documentElement.dataset.state = 'running';
  $('#run').hidden = false;
  runlog.innerHTML = ''; logRow = 0;
  sys('ANALYSING', 'busy');

  log('&gt; INGEST', label || `${input.name} · ${(input.size / 1024).toFixed(0)} KB`);
  log('&gt; SUBSTRATE', 'DECODE OK', 'ok');
  const pending = logCaret('&gt; IDENTIFY / WHOLE FIELD');

  $('#run').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });

  let d;
  try {
    d = await BE.session(input, state.pets);
  } catch (err) {
    pending.remove();
    log('&gt; FAULT', String(err.message || err));
    sys('IDENTIFY FAILED', 'alert');
    return;
  }

  pending.remove();
  log('&gt; IDENTIFY', `${d.raw_count} DETECTION(S) · ${d.timing.identify}s`, 'ok');
  log('&gt; MODEL', d.model.toUpperCase());
  log('&gt; SAM ENCODE', `${d.timing.encode}s · READY FOR TAP`, 'ok');
  log('&gt; TOXICITY', 'TABLE LOOKUP · NO INFERENCE', 'ok');

  Object.assign(state, { sid: d.sid, w: d.w, h: d.h });
  $('[data-meta="model"]').textContent = d.model;

  setTimeout(() => paint(d), reduced ? 0 : 520);
}

/* the verdict sentence — recomputed whenever the shared list changes, since
   a tap can correct/merge records and move n_types */
function writeVerdictText(v) {
  $('#vdetail').innerHTML =
    v.state === 'FLAGGED'
      ? `<strong>${v.toxic.length}</strong> of <strong>${v.n_types}</strong> identified flower types are toxic to ${state.pets.join(' / ')} — <strong>${v.toxic.join(', ')}</strong>. Tap each bloom below to confirm the identification before you trust it.`
      : v.state === 'CAUTION'
        ? `No catalogued toxic species found, but at least one flower could not be matched to the ${$('#spec-species').textContent}-species table. Unidentified is not the same as safe.`
        : `No flowers toxic to ${state.pets.join(' / ')} were identified. Confirm by tapping each bloom — the whole-field pass can miss a flower it never saw.`;
}

/* ── verdict paint ───────────────────────────────────────────────────── */
function paint(d) {
  document.documentElement.dataset.state = 'done';
  const v = d.verdict;
  document.documentElement.dataset.v = v.state;

  $('#verdict').hidden = false;
  $('#explore').hidden = false;
  $('#vstate').textContent = v.state;

  const nTox = v.toxic.length;
  writeVerdictText(v);

  sys(v.state === 'FLAGGED' ? 'TOXIC SPECIES PRESENT'
      : v.state === 'CAUTION' ? 'UNRESOLVED SPECIES' : 'NO TOXIC SPECIES',
      v.state === 'FLAGGED' ? 'alert' : 'ok');

  countTo($('#c-types'), v.n_types);
  countTo($('#c-toxic'), nTox);
  countTo($('#c-located'), d.flowers.filter(f => f.located).length);

  telemetry(d);
  cards(d.flowers);

  // explore plate
  $('#photo').src = d.photo_url;
  if (d.credit) showCredit(d.credit);
  $('#plate-dims').textContent = `${d.w}×${d.h}`;
  $('#overlay').setAttribute('viewBox', `0 0 ${d.w} ${d.h}`);

  watch($('#verdict')); watch($('#explore'));
  $('#verdict').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

function telemetry(d) {
  const rows = [
    ['INPUT',      `${d.w}×${d.h}`],
    ['IDENT MODEL', d.model],
    ['IDENT TIME', `${d.timing.identify}s`],
    ['SEGMENT',    'sam2.1_b'],
    ['ENCODE',     `${d.timing.encode}s`],
    ['CATALOG',    `${$('#spec-species').textContent} SPP`],
    ['VERIFIED',   `${$('#spec-verified').textContent} ASPCA`],
    ['PETS',        state.pets.join(' / ').toUpperCase()],
  ];
  $('#telemetry').innerHTML = rows.map(([k, v]) =>
    `<div class="tl"><div class="tl-k">${k}</div><div class="tl-v">${v}</div></div>`).join('');
}

function countTo(el, n) {
  if (reduced) { el.textContent = n; return; }
  const t0 = performance.now(), dur = 700;
  (function tick(t) {
    const p = Math.min(1, (t - t0) / dur);
    el.textContent = Math.round(n * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(tick);
  })(t0);
}

const SRC = { verdict: '', confirmed: 'TAP-CONFIRMED', explored: 'TAP-CONFIRMED',
              corrected: 'TAP-CORRECTED', new: 'TAP-FOUND' };

function cards(flowers) {
  const wrap = $('#cards');
  wrap.innerHTML = flowers.map((f, i) => {
    const sv = SEV[f.severity] || SEV.unknown;
    const conf = f.confidence == null ? null : Math.round(f.confidence * 100);
    const pets = Object.entries(f.toxic_to).map(([p, t]) =>
      `<div class="petcell" data-t="${t}"><i class="pmark"></i>${p.toUpperCase()} ${
        t === 'yes' ? 'TOXIC' : t === 'no' ? 'SAFE' : 'UNKNOWN'}</div>`).join('');
    return `
      <article class="card" style="--sev:${sv.c}" data-i="${i}">
        <div class="card-top">
          <span class="card-idx">${String(i + 1).padStart(2, '0')}</span>
          <span class="card-src" data-s="${f.source}">${SRC[f.source] || ''}</span>
        </div>
        <div class="card-name">${esc(f.common_name || '—')}</div>
        <div class="card-latin">${esc(f.canonical_label)}</div>
        ${conf == null ? '' : `
        <div class="meter">
          <div class="meter-head"><span>CONFIDENCE</span><span>${conf}%</span></div>
          <div class="meter-track"><div class="meter-fill" data-w="${conf}"></div></div>
        </div>`}
        <div class="sevrow">
          <i class="sevmark" data-fill="${sv.fill}"></i>
          <span class="sevtext">${f.in_db ? sv.label : 'NOT IN TABLE'}</span>
          ${f.in_db && f.aspca_verified !== 'yes'
            ? `<span class="sevnote unver">· UNVERIFIED ROW</span>` : ''}
        </div>
        <div class="pets">${pets}</div>
        ${f.clinical_signs
          ? `<div class="signs">IF EATEN — ${esc(f.clinical_signs).toUpperCase()}</div>`
          : f.in_db ? '' : `<div class="signs">NO TABLE ENTRY — TREAT AS UNSAFE.</div>`}
      </article>`;
  }).join('');

  $$('.card', wrap).forEach((c, i) => {
    c.style.animationDelay = (i * 70) + 'ms';
    c.classList.add('in');
  });
  setTimeout(() => $$('.meter-fill', wrap).forEach(m => m.style.width = m.dataset.w + '%'),
             reduced ? 0 : 420);
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ── explore: tap → segment → identify ───────────────────────────────── */
const plateBody = $('#plateBody'), overlay = $('#overlay'), reticle = $('#reticle');


/* rendered image box inside the (letterboxed) plate — object-fit:contain */
function imgBox(){
  const r = plateBody.getBoundingClientRect();
  const ar = state.w / state.h, cr = r.width / r.height;
  const w = ar > cr ? r.width  : r.height * ar;
  const h = ar > cr ? r.width / ar : r.height;
  return { left:r.left + (r.width-w)/2, top:r.top + (r.height-h)/2,
           width:w, height:h, ox:(r.width-w)/2, oy:(r.height-h)/2 };
}

plateBody.addEventListener('click', async ev => {
  if (!state.sid || state.busy) return;
  const b = imgBox();
  const rx = (ev.clientX - b.left) / b.width, ry = (ev.clientY - b.top) / b.height;
  if (rx < 0 || rx > 1 || ry < 0 || ry > 1) return;   // clicked the letterbox

  reticle.style.left = (b.ox + rx * b.width) + 'px';
  reticle.style.top  = (b.oy + ry * b.height) + 'px';
  reticle.classList.remove('on'); void reticle.offsetWidth; reticle.classList.add('on');

  await segment(rx * state.w, ry * state.h);
});

async function segment(x, y) {
  state.busy = true;
  $('#plate-hint').textContent = 'SEGMENTING…';
  sys('SAM DECODE', 'busy');
  overlay.innerHTML = '';

  let s;
  try { s = await BE.segment(state.sid, x, y); }
  catch { s = { ok: false, reason: 'network' }; }

  if (!s.ok) {
    state.busy = false;
    $('#plate-hint').textContent = 'NO OBJECT THERE — TAP MORE SQUARELY ON A BLOOM';
    sys('NO MASK', 'alert');
    return;
  }

  drawMask(s.polygons);
  $('#plate-hint').textContent = 'MASK LOCKED';
  $('#plate-dec').textContent =
    `DECODE ${s.decode_ms}ms · ${s.coverage}% FIELD`;

  buildScales(s.scales, s.default_scale);
  $('#roEmpty').hidden = true;
  $('#roBody').hidden = false;

  await identify(s.default_scale);
}

function drawMask(polys) {
  const ns = 'http://www.w3.org/2000/svg';
  overlay.innerHTML = '';
  polys.forEach((pts, i) => {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', 'M' + pts.map(q => q.join(',')).join('L') + 'Z');
    overlay.appendChild(p);
    if (!reduced) {
      const len = p.getTotalLength();
      p.style.setProperty('--len', len);
      p.style.animationDelay = (i * 90) + 'ms';
      p.classList.add('draw');
    }
  });
}

function buildScales(scales, active) {
  $('#scales').innerHTML = scales.map(s =>
    `<button type="button" class="scale${s === active ? ' on' : ''}" data-s="${s}">${s.toUpperCase()}</button>`
  ).join('');
  $$('.scale').forEach(b => b.addEventListener('click', () => {
    if (state.busy || b.classList.contains('on')) return;
    identify(b.dataset.s);
  }));
}

async function identify(scale) {
  state.busy = true;
  state.scale = scale;
  $$('.scale').forEach(b => {
    b.classList.toggle('on', b.dataset.s === scale);
    b.disabled = true;
  });
  const body = $('#roBody');
  body.classList.add('busy');
  sys('IDENTIFYING BLOOM', 'busy');
  $('#roCommon').textContent = '········';
  $('#roLatin').textContent  = 'AWAITING IDENTIFIER';

  let d;
  try {
    d = await BE.focus(state.sid, scale, state.pets);
  } catch (err) {
    body.classList.remove('busy');
    $$('.scale').forEach(b => b.disabled = false);
    state.busy = false;
    $('#roCommon').textContent = 'FAULT';
    $('#roLatin').textContent = String(err.message || err);
    sys('IDENTIFY FAILED', 'alert');
    return;
  }

  body.classList.remove('busy');
  $$('.scale').forEach(b => b.disabled = false);
  state.busy = false;

  const { ident, tox, recon } = d;
  const sv = SEV[tox.severity] || SEV.unknown;

  $('#focus').src = d.focus_url;
  const crop = $('.ro-crop'); crop.style.animation = 'none'; void crop.offsetWidth;
  crop.style.animation = '';

  $('#roCommon').textContent = ident.common_name || '—';
  $('#roLatin').textContent  = `${ident.canonical_label} · ${scale.toUpperCase()} CROP · ${d.identify_ms}ms`;

  const conf = Math.round((ident.confidence ?? 0) * 100);
  $('#roConf').textContent = conf + '%';
  $('#roFill').style.width = '0%';
  requestAnimationFrame(() => { $('#roFill').style.width = conf + '%'; });

  const RECON = {
    confirmed: '✓ CONFIRMS AN ENTRY IN THE VERDICT LIST',
    corrected: '✎ CORRECTED THE VERDICT LIST',
    new:       '+ NOT IN THE VERDICT — ADDED',
    explored:  '✓ CONFIRMS AN ENTRY IN THE VERDICT LIST',
  };
  const rc = $('#roRecon');
  rc.dataset.r = recon; rc.textContent = RECON[recon] || '';

  const pets = Object.entries(tox.toxic_to).map(([p, t]) =>
    `<div class="petcell" data-t="${t}"><i class="pmark"></i>${p.toUpperCase()} ${
      t === 'yes' ? 'TOXIC' : t === 'no' ? 'SAFE' : 'UNKNOWN'}</div>`).join('');
  $('#roTox').innerHTML = `
    <div class="sevrow" style="--sev:${sv.c}">
      <i class="sevmark" data-fill="${sv.fill}"></i>
      <span class="sevtext">${tox.in_db ? sv.label : 'NOT IN TABLE'}</span>
      ${tox.in_db && tox.aspca_verified !== 'yes'
        ? `<span class="sevnote unver">· UNVERIFIED ROW</span>` : ''}
    </div>
    <div class="pets">${pets}</div>
    ${tox.clinical_signs
      ? `<div class="signs">IF EATEN — ${esc(tox.clinical_signs).toUpperCase()}</div>`
      : tox.in_db ? '' : `<div class="signs">NO TABLE ENTRY — TREAT AS UNSAFE.</div>`}`;

  // the shared list changed — repaint verdict
  document.documentElement.dataset.v = d.verdict.state;
  $('#vstate').textContent = d.verdict.state;
  writeVerdictText(d.verdict);
  countTo($('#c-types'), d.verdict.n_types);
  countTo($('#c-toxic'), d.verdict.toxic.length);
  countTo($('#c-located'), d.flowers.filter(f => f.located).length);
  cards(d.flowers);

  sys(tox.toxic_to && Object.values(tox.toxic_to).includes('yes')
      ? 'TOXIC BLOOM CONFIRMED' : 'BLOOM IDENTIFIED',
      Object.values(tox.toxic_to).includes('yes') ? 'alert' : 'ok');
}
