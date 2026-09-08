/* ══════════════════════════════════════════════════════════════════
   Hangul Trainer — application logic
   Data comes from data.js (generated). Nothing here is generated;
   edit freely.
   ══════════════════════════════════════════════════════════════ */
'use strict';
const D = window.HANGUL_DATA;
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sample = (a, n) => shuffle(a).slice(0, n);
const DAY = 864e5;
const MAX_INTERVAL = 365;    // days — everything resurfaces at least once a year
const MAX_EASE = 3.0;        // ceiling on the SM-2 multiplier
const MAX_VOL = 10;      // 1000%, when Web Audio is available to do it safely

/* ═══════════════════════════════════════════════════════ storage ═══ */
const Store = (() => {
  const KEY = 'hangul.v1';
  let usable = true;
  try { localStorage.setItem('__probe', '1'); localStorage.removeItem('__probe'); }
  catch (e) { usable = false; }
  let mem = null;

  const blank = () => ({ cards: {}, log: [], settings: { rom: false, theme: null }, created: Date.now() });

  function read() {
    if (mem) return mem;
    if (usable) {
      try { mem = JSON.parse(localStorage.getItem(KEY)) || blank(); }
      catch (e) { mem = blank(); }
    } else mem = blank();
    if (!mem.cards) mem.cards = {};
    if (!mem.log) mem.log = [];
    if (!mem.settings) mem.settings = { rom: false, theme: null };
    return mem;
  }
  /* Merge another copy of the state into ours, in place. `mem` keeps its
     identity because the rest of the app holds a direct reference to it. */
  function mergeInto(target, other) {
    if (!other || typeof other !== 'object') return target;
    const oc = other.cards || {};
    for (const k in oc) {
      const a = target.cards[k], b = oc[k];
      if (!b || typeof b !== 'object') continue;
      const newer = !a || (b.seen || 0) > (a.seen || 0) ||
                    ((b.seen || 0) === (a.seen || 0) && (b.last || 0) > (a.last || 0));
      if (newer) target.cards[k] = b;
    }
    if (Array.isArray(other.log) && other.log.length) {
      const have = new Set(target.log.map(l => l.k + '@' + l.t));
      for (const l of other.log) if (!have.has(l.k + '@' + l.t)) target.log.push(l);
      target.log.sort((x, y) => x.t - y.t);
      if (target.log.length > 6000) target.log = target.log.slice(-4000);
    }
    if (other.created && (!target.created || other.created < target.created))
      target.created = other.created;
    return target;
  }

  let pending = null;
  function write() {
    if (!usable) return;
    try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) {}
  }
  function flush() {
    if (!usable) return;
    try {
      // Another tab may have written since we last read. Fold its work in
      // rather than overwriting it.
      let disk = null;
      try { disk = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
      if (disk) mergeInto(mem, disk);
      localStorage.setItem(KEY, JSON.stringify(mem));
    } catch (e) {}
  }
  function save() {
    if (!usable) return;
    clearTimeout(pending);
    pending = setTimeout(flush, 250);
  }
  // Pick up writes made by other tabs while this one is open.
  if (usable) {
    window.addEventListener('storage', e => {
      if (e.key !== KEY || !e.newValue) return;
      let incoming;
      try { incoming = JSON.parse(e.newValue); } catch (err) { return; }
      mergeInto(read(), incoming);
      // If two tabs wrote in the same instant, the loser's work is still in
      // our memory but no longer on disk. Write the union back. This settles
      // after one round: once both sides match, `extra` is false.
      const inc = incoming.cards || {};
      let extra = false;
      for (const k in mem.cards) {
        const ours = mem.cards[k], theirs = inc[k];
        if (!theirs || (ours.seen || 0) > (theirs.seen || 0)) { extra = true; break; }
      }
      if (extra) save();
      if (typeof window.__onStoreSync === 'function') window.__onStoreSync();
    });
    // Don't lose the last few seconds of a session on close.
    window.addEventListener('pagehide', () => { clearTimeout(pending); flush(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { clearTimeout(pending); flush(); }
    });
  }
  return {
    get state() { return read(); },
    save, usable,
    /* Both of these overwrite rather than merge, and mutate `mem` in place so
       the `S` reference held throughout the app stays valid. */
    replace(obj) {
      clearTimeout(pending);
      const m = read();
      m.cards = (obj && obj.cards) || {};
      m.log = (obj && Array.isArray(obj.log)) ? obj.log : [];
      m.settings = (obj && obj.settings) || m.settings;
      m.created = (obj && obj.created) || Date.now();
      write();
    },
    flush,
    reset() {
      clearTimeout(pending);
      const m = read();
      m.cards = {}; m.log = []; m.created = Date.now();   // settings are preferences, not progress
      write();
    },
  };
})();
const S = Store.state;

/* ═════════════════════════════════════════════════════════ audio ═══ */
const Sound = (() => {
  const cache = new Map();
  let current = null, warned = false, filesOk = null, failures = 0, token = 0;
  let vol = 1, actx = null, gain = null, postGain = null, graphTried = false, graphOk = false;
  const SHAPE = 3;                       // tanh drive baked into the curve
  const SS = SHAPE / Math.tanh(SHAPE);   // its small-signal gain, ~3.015

  function ensureGraph() {
    if (graphTried) return graphOk;
    graphTried = true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return (graphOk = false);
    try {
      actx = new AC();

      /* Volume drives a tanh soft-clipper. Dividing by the curve's small-signal
         gain keeps 100% transparent; past that the extra drive turns into
         saturation, which fills out the waveform and so keeps getting louder
         well after a plain limiter would have stopped helping.
         Measured: +5 dB at 200%, +8 dB at 300%, +13 dB at 1000%. */
      gain = actx.createGain();
      gain.gain.value = vol / SS;

      const shaper = actx.createWaveShaper();
      const N = 4096, curve = new Float32Array(N), k = Math.tanh(SHAPE);
      for (let i = 0; i < N; i++) curve[i] = Math.tanh(((i / (N - 1)) * 2 - 1) * SHAPE) / k;
      shaper.curve = curve;
      shaper.oversample = '4x';          // keeps the saturation from aliasing

      /* 4x oversampling overshoots the curve's bound by ~7% under heavy drive,
         so the ceiling comes down as the drive goes up. At 100% it stays 0.98,
         which is why quiet listening loses nothing. */
      postGain = actx.createGain();
      postGain.gain.value = postFor(vol);

      // Final catch for anything the shaper's filters let slip past.
      const lim = actx.createDynamicsCompressor();
      lim.threshold.value = -0.5; lim.knee.value = 0; lim.ratio.value = 20;
      lim.attack.value = 0.0005; lim.release.value = 0.05;

      gain.connect(shaper); shaper.connect(postGain);
      postGain.connect(lim); lim.connect(actx.destination);
      graphOk = true;
    } catch (e) { graphOk = false; }
    return graphOk;
  }
  /* An element can only be handed to createMediaElementSource once, and doing so
     takes over its output — so track which are already routed. */
  function route(a) {
    if (a.__routed) return true;
    if (!ensureGraph()) return false;
    try { actx.createMediaElementSource(a).connect(gain); a.__routed = true; }
    catch (e) { return false; }
    return true;
  }
  function postFor(v) {
    return 0.98 - 0.06 * Math.min(1, Math.max(0, (v - 1) / 3));
  }
  function setVolume(v) {
    vol = Math.max(0, Math.min(MAX_VOL, v));
    if (gain) gain.gain.value = vol / SS;
    if (postGain) postGain.gain.value = postFor(vol);
    // anything we could not route can still be attenuated the plain way
    cache.forEach(a => { if (!a.__routed) a.volume = Math.min(1, vol); });
    return vol;
  }
  function boostable() { return ensureGraph(); }
  let voice = null;

  function pickVoice() {
    if (!window.speechSynthesis) return null;
    const vs = speechSynthesis.getVoices();
    return vs.find(v => v.lang === 'ko-KR' || v.lang === 'ko_KR')
        || vs.find(v => (v.lang || '').toLowerCase().startsWith('ko')) || null;
  }
  if (window.speechSynthesis) {
    voice = pickVoice();
    speechSynthesis.onvoiceschanged = () => { voice = pickVoice(); };
  }

  function speak(text) {
    if (!window.speechSynthesis) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR'; u.rate = 0.85; u.volume = Math.min(1, vol);
      if (voice) u.voice = voice;
      speechSynthesis.speak(u);
    } catch (e) {}
  }

  function warn() {
    if (warned) return;
    warned = true;
    const w = $('#audioWarn'); if (w) w.hidden = false;
  }
  function fail(text, clear) {
    // Fall back for this clip immediately, but only give up on the whole
    // recorded library after repeated genuine failures.
    if (++failures >= 2) { filesOk = false; warn(); }
    speak(text); setTimeout(clear, 700);
  }

  /* Play a Korean string. Marks `node` with .playing for the duration. */
  function play(text, node) {
    if (!text) return;
    const mine = ++token;
    const id = D.clips[text];
    if (current) { try { current.pause(); current.currentTime = 0; } catch (e) {} }
    $$('.playing').forEach(n => n.classList.remove('playing'));
    if (node) node.classList.add('playing');
    const clear = () => { if (node) node.classList.remove('playing'); };

    if (!id || filesOk === false) { speak(text); setTimeout(clear, 700); return; }

    let a = cache.get(id);
    if (!a) {
      a = new Audio('audio/' + id + '.m4a');
      a.preload = 'auto';
      cache.set(id, a);
    }
    if (!route(a)) a.volume = Math.min(1, vol);
    // Browsers start the context suspended until a gesture; this call is one.
    if (actx && actx.state === 'suspended') { try { actx.resume(); } catch (e) {} }
    a.onended = clear;
    a.onerror = () => { if (mine === token) fail(text, clear); else clear(); };
    current = a;
    try { a.currentTime = 0; } catch (e) {}
    const pr = a.play();
    if (pr && pr.catch) pr.catch(err => {
      // Superseded by a newer click, refused as autoplay, or aborted because
      // we paused it to start the next sound. None of these mean the file is
      // broken, and treating them as such would silently kill the recorded
      // voice for the rest of the session.
      if (mine !== token) { clear(); return; }
      const n = err && err.name;
      if (n === 'NotAllowedError' || n === 'AbortError') { clear(); return; }
      fail(text, clear);
    });
    else setTimeout(clear, 1200);
    if (filesOk === null) filesOk = true;
    if (a.readyState >= 3) failures = 0;   // a clean load clears earlier strikes
  }
  return { play, setVolume, boostable, get volume() { return vol; } };
})();

/* ═══════════════════════════════════════════════════════════ srs ═══
   SM-2 with a short relearning step. Intervals are in days; a lapse
   drops the card back to ten minutes so you re-see it this session. */
const SRS = (() => {
  function card(key) {
    let c = S.cards[key];
    if (!c) c = S.cards[key] = { ef: 2.5, iv: 0, reps: 0, lapses: 0, due: 0, seen: 0, ok: 0 };
    return c;
  }
  function grade(key, q) {                       // q: 0 again · 3 hard · 4 good · 5 easy
    const c = card(key), now = Date.now();
    c.seen++;
    if (q >= 3) c.ok++;
    if (q < 3) {
      c.reps = 0; c.lapses++; c.iv = 0;
      c.due = now + 6e5;                          // ten minutes
    } else {
      c.reps++;
      c.iv = c.reps === 1 ? 1 : c.reps === 2 ? 4 : Math.round(c.iv * c.ef);
      // Cap at a year so nothing can quietly leave the review rotation, and
      // cap ease so repeated "Easy" cannot rocket a card straight to that cap.
      c.iv = Math.min(c.iv, MAX_INTERVAL);
      c.ef = Math.min(MAX_EASE, Math.max(1.3, c.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))));
      c.due = now + c.iv * DAY;
    }
    c.last = now;
    S.log.push({ k: key, q, t: now });
    if (S.log.length > 6000) S.log = S.log.slice(-4000);
    Store.save();
    return c;
  }
  const isDue    = k => { const c = S.cards[k]; return !c || c.due <= Date.now(); };
  const isNew    = k => !S.cards[k];
  const mastery  = k => { const c = S.cards[k]; return c ? Math.min(1, c.iv / 21) : 0; };
  return { card, grade, isDue, isNew, mastery };
})();

/* ═══════════════════════════════════════════════════════════ ui ═══ */
let ROM = !!S.settings.rom;
function applyRom() {
  $('#romToggle').classList.toggle('on', ROM);
  $('#romLabel').textContent = ROM ? 'Romanization on' : 'Romanization off';
  $$('.rom, .r').forEach(n => n.classList.toggle('hidden', !ROM && n.dataset.hideable === '1'));
}
function setRom(v) { ROM = v; S.settings.rom = v; Store.save(); applyRom(); }

function applyTheme() {
  const t = S.settings.theme;
  if (t) document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
}
/* ── volume ─────────────────────────────────────────────────────────
   Stored as a multiplier: 1 = your system volume, up to 3 = three times it.
   Values above 1 need the Web Audio graph; without it we can only attenuate. */
let VOL = typeof S.settings.vol === 'number' ? S.settings.vol : 1;
let premute = VOL || 1;

/* The slider is 0-100 positions, not percent. Linear over the first half
   (silent to 100%), logarithmic over the second (100% to 1000%), so the range
   people actually live in is not squeezed into a tenth of the track. */
const posToVol = p => p <= 50 ? p / 50 : Math.pow(10, (p - 50) / 50);
const volToPos = v => v <= 1 ? v * 50 : 50 + 50 * Math.log10(v);
const showPct = v => {
  const n = v * 100;
  return (n >= 200 ? Math.round(n / 10) * 10 : Math.round(n / 5) * 5) + '%';
};

const HOT = 4;      // above this the saturation is audible, so say so

function applyVolume(save) {
  const max = Sound.boostable() ? MAX_VOL : 1;
  VOL = Math.max(0, Math.min(max, VOL));
  Sound.setVolume(VOL);
  const slider = $('#volSlider'), wrap = $('#volWrap'), icon = $('#volIcon');
  if (slider) {
    slider.max = String(Math.round(volToPos(max)));
    slider.value = String(Math.round(volToPos(VOL)));
  }
  const lbl = $('#volLabel');
  if (lbl) lbl.textContent = showPct(VOL);
  if (wrap) {
    wrap.classList.toggle('muted', VOL === 0);
    wrap.classList.toggle('boosted', VOL > 1);
    wrap.classList.toggle('hot', VOL > HOT);
    wrap.title = VOL > HOT
      ? `${showPct(VOL)} — well past your system volume. The signal is saturating here, so it keeps getting louder but the voice starts to sound gritty.`
      : VOL > 1
        ? `${showPct(VOL)} — louder than your system volume, soft-clipped so it cannot distort.`
        : max === 1
          ? 'Playback volume. Going above 100% needs Web Audio, which this browser did not provide.'
          : 'Playback volume, independent of your system volume  ·  [ and ]';
  }
  if (icon) {
    icon.textContent = VOL === 0 ? '\uD83D\uDD07' : VOL > 1 ? '\uD83D\uDD0A' : VOL < 0.5 ? '\uD83D\uDD08' : '\uD83D\uDD09';
    icon.title = VOL === 0 ? 'Unmute  ·  M' : 'Mute  ·  M';
  }
  if (save !== false) { S.settings.vol = VOL; Store.save(); }
}
/* Step by slider position, so one keypress moves a similar amount whether you
   are at 40% or at 600%. */
function nudgeVolume(steps) {
  const max = Sound.boostable() ? MAX_VOL : 1;
  const pos = Math.max(0, Math.min(volToPos(max), volToPos(VOL) + steps * 2));
  VOL = Math.min(max, posToVol(pos));
  applyVolume();
  toast(VOL === 0 ? 'Muted' : `Volume ${showPct(VOL)}`);
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, 2200);
}

/* romanization span helper */
const romSpan = (txt, cls) =>
  `<span class="${cls || 'rom'} ${ROM ? '' : 'hidden'}" data-hideable="1">${esc(txt)}</span>`;

/* Pinyin approximation, shown alongside the romanization on the Chart page.
   Follows the same R toggle, so it cannot become a crutch either. */
const pySpan = o =>
  `<span class="py rom ${ROM ? '' : 'hidden'}" data-hideable="1" title="${esc(o.pyNote || '')}">` +
  `<i>拼</i>${esc(o.py || '/')}</span>`;

/* ═════════════════════════════════════════════════ pools & keys ═══ */
const jamoKey = ch => 'j:' + ch;
const sylKey  = s  => 's:' + s;
const wordKey = w  => 'w:' + w;

const ALL_JAMO = [...D.consonants.map(c => ({ ch: c.ch, rom: c.rom, kind: 'cons', o: c })),
                  ...D.vowels.map(v => ({ ch: v.ch, rom: v.rom, kind: 'vowel', o: v }))];
const JAMO_BY_CH = Object.fromEntries(ALL_JAMO.map(j => [j.ch, j]));

const ALL_SYL = (() => {
  const out = [];
  D.grid.cells.forEach(row => row.forEach(c => out.push({ ch: c.s, rom: c.r })));
  return out;
})();
const ALL_WORDS = (() => {
  const out = [];
  D.wordSets.forEach(ws => ws.items.forEach(it =>
    out.push({ ch: it.w, rom: it.r, meaning: it.m, set: ws.title })));
  (D.vocab || []).forEach(c => c.items.forEach(it =>
    out.push({ ch: it.w, rom: it.r, meaning: it.m, set: c.title })));
  D.batchim.forEach(b => b.examples.forEach(e =>
    out.push({ ch: e.w, rom: e.r, meaning: e.m, set: 'Batchim' })));
  const seen = new Set();
  return out.filter(w => !seen.has(w.ch) && seen.add(w.ch));
})();

const POOLS = {
  letters:   { label: 'Letters',   key: jamoKey, items: () => ALL_JAMO },
  syllables: { label: 'Syllables', key: sylKey,  items: () => ALL_SYL },
  words:     { label: 'Words',     key: wordKey, items: () => ALL_WORDS },
};
function poolOf(key) {
  return key[0] === 'j' ? POOLS.letters : key[0] === 's' ? POOLS.syllables : POOLS.words;
}
function itemFor(key) {
  const body = key.slice(2);
  if (key[0] === 'j') return JAMO_BY_CH[body];
  if (key[0] === 's') return ALL_SYL.find(x => x.ch === body);
  return ALL_WORDS.find(x => x.ch === body);
}

/* ═════════════════════════════════════════════════════ view: learn ═══ */
let curLesson = 1, curLetter = null;

function renderLearn() {
  const rail = $('#lessonRail'); rail.innerHTML = '';
  D.lessons.forEach(L => {
    const done = L.items.filter(ch => SRS.mastery(jamoKey(ch)) >= .5).length;
    const pct = Math.round(done / L.items.length * 100);
    const b = el('button', 'lesson-chip' + (L.id === curLesson ? ' on' : ''),
      `<div class="n">Step ${L.id}</div><div class="t">${esc(L.title)}</div>
       <div class="g">${L.items.join(' ')}</div>
       <div class="bar"><i style="width:${pct}%"></i></div>`);
    b.onclick = () => { curLesson = L.id; curLetter = null; renderLearn(); };
    rail.appendChild(b);
  });

  const L = D.lessons.find(x => x.id === curLesson);
  const body = $('#lessonBody'); body.innerHTML = '';
  body.appendChild(el('div', 'lesson-note', esc(L.note)));

  const grid = el('div', 'letter-grid');
  L.items.forEach(ch => grid.appendChild(letterCard(ch)));
  body.appendChild(grid);

  const det = el('div'); det.id = 'letterDetail';
  body.appendChild(det);
  if (curLetter) showDetail(curLetter);
}

function letterCard(ch) {
  const j = JAMO_BY_CH[ch];
  const m = SRS.mastery(jamoKey(ch));
  const tag = j.kind === 'cons' ? (j.o.tense ? 'tense' : j.o.aspirated ? 'aspir' : '') : '';
  const b = el('button', 'letter' + (curLetter === ch ? ' playing' : ''),
    `${tag ? `<span class="tag">${tag}</span>` : ''}
     <div class="ch">${ch}</div>
     ${romSpan(j.rom)}
     <i class="mastery" style="width:${m * 100}%"></i>`);
  b.onclick = () => {
    curLetter = ch;
    Sound.play(j.kind === 'cons' ? j.o.demo : j.o.name, b);
    renderLearn();
    setTimeout(() => {
      const d = $('#letterDetail');
      if (d) d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  };
  return b;
}

function showDetail(ch) {
  const j = JAMO_BY_CH[ch], o = j.o, host = $('#letterDetail');
  const rows = [];
  rows.push(['Sound', esc(o.sound)]);
  if (j.kind === 'cons') {
    rows.push(['Name', `<strong style="font-family:var(--kr)">${o.name}</strong> — every consonant’s name demonstrates it twice: once at the top of a block, once at the bottom.`]);
    rows.push(['Why this shape', esc(o.shape)]);
    if (o.from) rows.push(['Built from', `<strong style="font-family:var(--kr);font-size:17px">${o.from}</strong>`]);
  } else {
    rows.push(['Written as', esc(o.build)]);
  }

  let plays = '';
  if (j.kind === 'cons') {
    plays = `<button class="play-btn" data-t="${esc(o.demo)}"><span class="kr">${o.demo}</span><span class="lbl">with ㅏ</span></button>
             <button class="play-btn" data-t="${esc(o.neutral)}"><span class="kr">${o.neutral}</span><span class="lbl">bare sound</span></button>
             <button class="play-btn" data-t="${esc(o.name)}"><span class="kr">${o.name}</span><span class="lbl">letter name</span></button>`;
  } else {
    const row = ['ㄱ', 'ㄴ', 'ㅁ', 'ㅅ'].map(c => {
      const s = composeSyl(c, ch);
      return `<button class="play-btn" data-t="${s}"><span class="kr">${s}</span></button>`;
    }).join('');
    plays = `<button class="play-btn" data-t="${esc(o.name)}"><span class="kr">${o.name}</span><span class="lbl">on its own</span></button>` + row;
  }

  host.innerHTML = `<div class="detail">
    <div class="detail-big"><div class="ch">${ch}</div><div class="rom">${esc(o.rom)}</div></div>
    <div class="detail-rows">
      ${rows.map(([k, v]) => `<div class="drow"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}
      <div class="drow"><div class="k">Hear it</div><div class="v"><div class="play-row">${plays}</div></div></div>
    </div></div>`;
  $$('.play-btn', host).forEach(b => b.onclick = () => Sound.play(b.dataset.t, b));
}

/* syllable composition (mirrors build/generate.py) */
const INI = [...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'];
const MED = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'];
const FIN = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];
function composeSyl(i, m, f) {
  const fi = f ? FIN.indexOf(f) : 0;
  return String.fromCharCode(0xAC00 + (INI.indexOf(i) * 21 + MED.indexOf(m)) * 28 + (fi < 0 ? 0 : fi));
}
function decomposeSyl(s) {
  const c = s.charCodeAt(0) - 0xAC00;
  if (c < 0 || c > 11171) return null;
  return { i: INI[Math.floor(c / 588)], m: MED[Math.floor((c % 588) / 28)], f: FIN[c % 28] };
}

/* Distractors that actually test something. A vowel hidden among consonants
   is free marks; a vowel among other vowels is a real discrimination. */
function distractors(target, pool, n) {
  const rest = pool.items().filter(x => x.ch !== target.ch);
  let near = [];
  if (pool === POOLS.letters) {
    const kind = (JAMO_BY_CH[target.ch] || {}).kind;
    near = rest.filter(x => (JAMO_BY_CH[x.ch] || {}).kind === kind);
  } else if (pool === POOLS.syllables) {
    const d = decomposeSyl(target.ch);
    if (d) near = rest.filter(x => {
      const e = decomposeSyl(x.ch);
      return e && (e.i === d.i || e.m === d.m);
    });
  } else {
    const L = [...target.ch].length;
    near = rest.filter(x => Math.abs([...x.ch].length - L) <= 1);
  }
  const picked = sample(near, n);
  if (picked.length < n) {
    const have = new Set(picked.map(x => x.ch).concat(target.ch));
    picked.push(...sample(rest.filter(x => !have.has(x.ch)), n - picked.length));
  }
  return picked;
}

/* ═════════════════════════════════════════════════════ view: chart ═══ */
function renderChart() {
  const host = $('#chartBody'); host.innerHTML = '';

  host.appendChild(el('div', 'py-legend',
    `<h4><i>拼</i> Pinyin approximations</h4>
     <p>Each letter also carries the closest Mandarin Pinyin spelling. Hover one for the
        detail. Two things are worth knowing up front:</p>
     <ul>
       <li><strong>ㅈ is j and ㅊ is q</strong> — never zh or ch. Korean keeps the tongue
           flat; it has no retroflex sounds at all.</li>
       <li><strong>Mandarin b d g j z line up with Korean's tense letters</strong>
           (ㅃ ㄸ ㄲ ㅉ ㅆ), because both are unaspirated. Korean's plain letters
           (ㅂ ㄷ ㄱ ㅈ) sit between Mandarin's unaspirated and aspirated series, which is
           why they are the hardest ones to place.</li>
       <li>A <code>/</code> means the sound has no Pinyin spelling — ㅕ, ㅠ, ㅡ and ㅢ
           genuinely do not exist in Mandarin.</li>
     </ul>
     <p class="py-toggle-hint">Both romanizations follow the <kbd>R</kbd> toggle.</p>`));

  const block = (title, sub, right) => {
    const h = el('div', 'section-h',
      `<h2>${title}</h2><span class="sub">${sub}</span>${right ? `<span class="sub-r">${right}</span>` : ''}`);
    host.appendChild(h);
  };

  block('Plain consonants', 'The five source shapes and their relatives', '9 letters');
  const g1 = el('div', 'letter-grid');
  ['ㄱ','ㄴ','ㄷ','ㄹ','ㅁ','ㅂ','ㅅ','ㅇ','ㅈ'].forEach(c => g1.appendChild(chartCard(c)));
  host.appendChild(g1);

  block('Aspirated', 'One extra stroke — one extra puff of air', '5 letters');
  const g2 = el('div', 'derive');
  D.consonants.filter(c => c.aspirated).forEach(c => {
    const r = el('div', 'derive-row',
      `<button class="mini" data-t="${esc(base(c.from))}">${c.from}</button>
       <span class="arrow">+ stroke →</span>
       <button class="mini" data-t="${esc(c.demo)}">${c.ch}</button>
       <span class="lbl">${esc(c.rom)}${pySpan(c)}</span>`);
    g2.appendChild(r);
  });
  host.appendChild(g2);

  block('Tense', 'The same letter written twice — throat locked, no air', '5 letters');
  const g3 = el('div', 'derive');
  D.consonants.filter(c => c.tense).forEach(c => {
    const r = el('div', 'derive-row',
      `<button class="mini" data-t="${esc(base(c.from))}">${c.from}</button>
       <span class="arrow">doubled →</span>
       <button class="mini" data-t="${esc(c.demo)}">${c.ch}</button>
       <span class="lbl">${esc(c.rom)}${pySpan(c)}</span>`);
    g3.appendChild(r);
  });
  host.appendChild(g3);

  block('Basic vowels', 'A person, the earth, and the sun', '10 letters');
  const g4 = el('div', 'letter-grid');
  D.vowels.filter(v => v.basic).forEach(v => g4.appendChild(chartCard(v.ch)));
  host.appendChild(g4);

  block('Compound vowels', 'Two vowels fused into one glide', '11 letters');
  const g5 = el('div', 'letter-grid');
  D.vowels.filter(v => !v.basic).forEach(v => g5.appendChild(chartCard(v.ch)));
  host.appendChild(g5);

  $$('.mini', host).forEach(b => { if (b.dataset.t) b.onclick = () => Sound.play(b.dataset.t, b); });
}
function base(ch) { const c = D.consonants.find(x => x.ch === ch); return c ? c.demo : ch; }
function chartCard(ch) {
  const j = JAMO_BY_CH[ch], m = SRS.mastery(jamoKey(ch));
  const b = el('button', 'letter has-py',
    `<div class="ch">${ch}</div>${romSpan(j.rom)}${pySpan(j.o)}` +
    `<i class="mastery" style="width:${m * 100}%"></i>`);
  b.onclick = () => Sound.play(j.kind === 'cons' ? j.o.demo : j.o.name, b);
  return b;
}

/* ═════════════════════════════════════════════════ view: syllables ═══ */
let bI = 'ㄱ', bM = 'ㅏ', bF = '';
function renderBuild() {
  const host = $('#builder');
  host.innerHTML = `<div class="builder"><div class="builder-top">
      <div>
        <div class="picker"><div class="picker-lbl">First — the opening consonant</div>
          <div class="picker-row" id="pkI"></div></div>
        <div class="picker"><div class="picker-lbl">Second — the vowel</div>
          <div class="picker-row" id="pkM"></div></div>
        <div class="picker"><div class="picker-lbl">Third — the batchim, optional</div>
          <div class="picker-row" id="pkF"></div></div>
      </div>
      <div class="build-out" id="buildOut"></div>
    </div></div>`;

  const fill = (id, list, cur, set, isNone) => {
    const row = $(id); row.innerHTML = '';
    list.forEach(ch => {
      const b = el('button', 'pk' + (ch === cur ? ' on' : '') + (ch === '' ? ' none' : ''),
        ch === '' ? 'none' : ch);
      b.onclick = () => { set(ch); paintBuild(true); $$('.pk', row).forEach(x => x.classList.remove('on')); b.classList.add('on'); };
      row.appendChild(b);
    });
  };
  fill('#pkI', INI, bI, v => bI = v);
  fill('#pkM', MED, bM, v => bM = v);
  fill('#pkF', FIN, bF, v => bF = v);
  paintBuild();
  renderGrid();
}
function paintBuild(autoplay) {
  const s = composeSyl(bI, bM, bF);
  const rom = (D.grid.romInitials[bI] || '') + D.grid.romMedials[bM] +
              (bF ? finalRom(bF) : '');
  const has = !!D.clips[s];
  $('#buildOut').innerHTML =
    `<button class="blk" id="blkPlay">${s}</button>
     <div class="rom ${ROM ? '' : 'hidden'}" data-hideable="1">${esc(rom)}</div>
     <div class="parts">${bI} + ${bM}${bF ? ' + ' + bF : ''}</div>
     ${has ? '' : '<div class="warnx">Not pre-recorded — using the browser voice</div>'}`;
  $('#blkPlay').onclick = e => Sound.play(s, e.currentTarget);
  if (autoplay) Sound.play(s, $('#blkPlay'));
}
function finalRom(f) {
  const g = D.batchim.find(b => b.letters.includes(f));
  return g ? g.rom : '';
}
function renderGrid() {
  const host = $('#gridBody');
  host.innerHTML = `<div class="section-h"><h2>All 399 blocks</h2>
      <span class="sub">19 consonants × 21 vowels, every one recorded</span></div>
    <div class="grid-wrap"><table class="grid"><thead><tr id="gh"></tr></thead><tbody id="gb"></tbody></table></div>
    <p class="grid-hint">Read across a row to hear one consonant against every vowel; read down a column to hear one vowel against every consonant. Rows are the fastest way to internalise a letter. The headers are clickable too — a consonant plays its name, a vowel plays itself.</p>`;
  /* Row and column headers are letters in their own right, so they play too.
     A consonant plays its name (기역), which demonstrates the sound at the top
     and the bottom of a block; a vowel's name is simply the vowel. */
  const headBtn = (ch, axis) => {
    const j = JAMO_BY_CH[ch];
    const b = el('button', 'gh-btn ' + axis,
      `<span class="gh-ch">${ch}</span>` +
      `<span class="gh-r rom ${ROM ? '' : 'hidden'}" data-hideable="1">${esc(j.rom)}</span>`);
    b.title = j.kind === 'cons'
      ? `${ch} — ${j.rom}, called ${j.o.name}. ${j.o.sound}`
      : `${ch} — ${j.rom}. ${j.o.sound}`;
    b.onclick = () => Sound.play(j.o.name, b);
    return b;
  };

  const gh = $('#gh');
  gh.appendChild(el('th', 'corner', ''));
  D.grid.medials.forEach(m => {
    const th = el('th', 'vh');
    th.appendChild(headBtn(m, 'col'));
    gh.appendChild(th);
  });
  const gb = $('#gb');
  D.grid.cells.forEach((row, ri) => {
    const tr = el('tr');
    const th = el('th', 'ch');
    th.appendChild(headBtn(D.grid.initials[ri], 'row'));
    tr.appendChild(th);
    row.forEach(c => {
      const td = el('td');
      const b = el('button', 'cell', c.s + (ROM ? `<span class="r">${esc(c.r)}</span>` : ''));
      b.onclick = () => Sound.play(c.s, b);
      td.appendChild(b); tr.appendChild(td);
    });
    gb.appendChild(tr);
  });
}

/* ═══════════════════════════════════════════════════ view: batchim ═══ */
function renderBatchim() {
  const host = $('#batchimBody');
  host.innerHTML = `<div class="section-h"><h2>The seven sounds</h2>
      <span class="sub">27 possible letters collapse into these</span></div>
    <div class="bat-grid" id="batG"></div>
    <div class="section-h"><h2>Minimal pairs</h2>
      <span class="sub">Two words that differ only in the batchim — train your ear here</span></div>
    <div class="pairs" id="batP"></div>`;

  const g = $('#batG');
  D.batchim.forEach(b => {
    const c = el('div', 'bat',
      `<div class="bat-head">
         <div class="bat-sound">${b.sound}</div>
         <div><div class="bat-rom">${esc(b.rom)}</div>
              <div class="bat-sub">${b.letters.length} letter${b.letters.length > 1 ? 's' : ''} → 1 sound</div></div>
       </div>
       <div class="bat-letters">${b.letters.map(l => `<span>${l}</span>`).join('')}</div>
       <div class="bat-hint">${esc(b.hint)}</div>
       <div class="bat-ex">${b.examples.map(e =>
         `<button class="ex-btn" data-t="${esc(e.w)}"><span class="w">${e.w}</span>
            <span class="r ${ROM ? '' : 'hidden'}" data-hideable="1">${esc(e.r)}</span>
            <span class="m">${esc(e.m)}</span></button>`).join('')}</div>`);
    g.appendChild(c);
  });

  const p = $('#batP');
  D.minimalPairs.forEach(mp => {
    const c = el('div', 'pair',
      `<div class="pair-top">
         <button class="pair-w" data-t="${esc(mp.a)}">${mp.a}</button>
         <span class="pair-vs">vs</span>
         <button class="pair-w" data-t="${esc(mp.b)}">${mp.b}</button>
         <span class="pair-rom rom ${ROM ? '' : 'hidden'}" data-hideable="1">${esc(mp.rom)}</span>
       </div><div class="pair-note">${esc(mp.note)}</div>`);
    p.appendChild(c);
  });
  $$('[data-t]', host).forEach(b => b.onclick = () => Sound.play(b.dataset.t, b));
}

/* ═════════════════════════════════════════════════════ view: rules ═══ */
function renderRules() {
  const host = $('#rulesBody'); host.innerHTML = '';
  D.rules.sort((a, b) => a.order - b.order).forEach(r => {
    const c = el('div', 'rule',
      `<div class="rule-head"><span class="rule-n">${r.order}</span>
         <h3>${esc(r.name)}</h3><span class="rule-kr">${r.kr}</span></div>
       <div class="rule-text">${esc(r.rule)}</div>
       <div class="rule-ex">${r.ex.map(e =>
         `<div class="transform">
            <button class="tf-w" data-t="${esc(e.spelled)}">${e.spelled}</button>
            <span class="tf-arr">→</span>
            <button class="tf-w said" data-t="${esc(e.said)}">${e.said}</button>
            <span class="tf-m">${esc(e.meaning)}</span>
          </div>`).join('')}</div>`);
    host.appendChild(c);
  });
  $$('[data-t]', host).forEach(b => b.onclick = () => Sound.play(b.dataset.t, b));
}

/* ── stacked foldable sections ──────────────────────────────────────
   Words and Verbs both lay every section out down the page rather than
   hiding them behind one-at-a-time tabs, so you can scroll straight
   through. Fold state is remembered. */
function folded(key) {
  const f = S.settings.folded || (S.settings.folded = {});
  return !!f[key];
}
function setFolded(key, v) {
  const f = S.settings.folded || (S.settings.folded = {});
  if (v) f[key] = 1; else delete f[key];
  Store.save();
}
function foldAll(keys, v) {
  const f = S.settings.folded || (S.settings.folded = {});
  keys.forEach(k => { if (v) f[k] = 1; else delete f[k]; });
  Store.save();
}
/* Section bodies are always in the DOM; folding toggles a class. That keeps a
   fold O(1) instead of re-rendering a thousand cards, and means the stored
   state and what is on screen can never disagree. */
function sectionShell(key, title, sub, count, body) {
  const open = !folded(key);
  return `<section class="fold${open ? '' : ' shut'}" data-sec="${esc(key)}">
      <button class="fold-head${open ? ' open' : ''}" data-fold="${esc(key)}">
        <span class="caret">${open ? '\u25BE' : '\u25B8'}</span>
        <span class="ft">${esc(title)}</span>
        ${sub ? `<span class="fs">${esc(sub)}</span>` : ''}
        <span class="fc">${count}</span>
      </button>
      <div class="fold-body">${body}</div>
    </section>`;
}
function applyFold(key) {
  const sec = $$(`.fold[data-sec="${CSS.escape(key)}"]`)[0];
  if (!sec) return;
  const open = !folded(key);
  sec.classList.toggle('shut', !open);
  const head = $('.fold-head', sec);
  head.classList.toggle('open', open);
  $('.caret', head).textContent = open ? '\u25BE' : '\u25B8';
}
function wireFolds(host) {
  $$('.fold-head', host).forEach(b => b.onclick = () => {
    const k = b.dataset.fold;
    setFolded(k, !folded(k));
    applyFold(k);
    if (b.getBoundingClientRect().top < 58)
      window.scrollTo({ top: b.getBoundingClientRect().top + window.scrollY - 70 });
  });
}
function jumpTo(key) {
  setFolded(key, false);
  applyFold(key);
  const n = $$(`.fold-head[data-fold="${CSS.escape(key)}"]`)[0];
  if (n) window.scrollTo({ top: n.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' });
}
function applyFoldAll(keys) { keys.forEach(applyFold); }

/* ═════════════════════════════════════════════════════ view: words ═══ */
let wordQuery = '';

function wordCats() {
  return [
    ...D.wordSets.map(ws => ({ key: 'read:' + ws.id, group: 'Reading practice',
                               title: ws.title, blurb: ws.blurb, items: ws.items })),
    ...(D.vocab || []).map(c => ({ key: 'vocab:' + c.id, group: 'Vocabulary',
                                   title: c.title, blurb: c.blurb, items: c.items })),
  ];
}
function searchWords(q) {
  q = q.trim().toLowerCase();
  if (!q) return null;
  const hits = [];
  for (const c of wordCats()) {
    for (const it of c.items) {
      if (it.w.includes(q) || (it.r || '').toLowerCase().includes(q) ||
          (it.m || '').toLowerCase().includes(q)) {
        hits.push({ ...it, from: c.title });
        if (hits.length >= 200) return hits;
      }
    }
  }
  return hits;
}

function renderWords() {
  const host = $('#wordsBody');
  const cats = wordCats();
  const total = cats.reduce((n, c) => n + c.items.length, 0);

  host.innerHTML = `
    <div class="list-bar">
      <div class="word-search">
        <input id="wordQ" type="search" placeholder="Search ${total} words — Hangul, romanization or meaning"
               value="${esc(wordQuery)}" autocomplete="off" spellcheck="false">
        <span id="wordQCount"></span>
      </div>
      <div class="fold-actions">
        <button class="ghost sm" id="expandAllW">Expand all</button>
        <button class="ghost sm" id="collapseAllW">Collapse all</button>
      </div>
    </div>
    <div class="cat-groups" id="catGroups"></div>
    <div id="wordResult"></div>`;

  const groups = $('#catGroups');
  let last = null;
  cats.forEach(c => {
    if (c.group !== last) {
      last = c.group;
      groups.appendChild(el('div', 'cat-label', esc(c.group)));
      groups.appendChild(el('div', 'cat-row'));
    }
    const b = el('button', 'cat-chip', `${esc(c.title)}<span class="n">${c.items.length}</span>`);
    b.onclick = () => { if (wordQuery) { wordQuery = ''; renderWords(); } jumpTo('w:' + c.key); };
    groups.lastChild.appendChild(b);
  });

  const keys = cats.map(c => 'w:' + c.key);
  const foldAllW = v => {
    if (wordQuery) { wordQuery = ''; $('#wordQ').value = ''; }  // else nothing visible changes
    foldAll(keys, v); paintWordResult(); applyFoldAll(keys);
  };
  $('#expandAllW').onclick = () => foldAllW(false);
  $('#collapseAllW').onclick = () => foldAllW(true);

  const q = $('#wordQ');
  q.oninput = () => { wordQuery = q.value; paintWordResult(); };
  q.onkeydown = e => { if (e.key === 'Escape') { q.value = ''; wordQuery = ''; paintWordResult(); } };
  paintWordResult();
  if (wordQuery) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
}

function paintWordResult() {
  const host = $('#wordResult'), counter = $('#wordQCount');
  const hits = searchWords(wordQuery);
  $$('.cat-chip', $('#catGroups')).forEach(b => b.classList.toggle('dim', !!hits));

  if (hits) {
    counter.textContent = hits.length >= 200 ? '200+ matches' : `${hits.length} match${hits.length === 1 ? '' : 'es'}`;
    host.innerHTML = hits.length
      ? `<div class="word-grid">${hits.map(it => wordCard(it, it.from)).join('')}</div>`
      : `<div class="empty"><div class="big">없어요</div>No word matches that.</div>`;
  } else {
    counter.textContent = '';
    host.innerHTML = wordCats().map(c => sectionShell(
      'w:' + c.key, c.title, c.group === 'Reading practice' ? 'reading set' : '', c.items.length,
      `${c.blurb ? `<p class="cat-blurb">${esc(c.blurb)}</p>` : ''}
       <div class="word-grid">${c.items.map(it => wordCard(it)).join('')}</div>`)).join('');
    wireFolds(host);
  }
  $$('[data-t]', host).forEach(b => b.onclick = () => Sound.play(b.dataset.t, b));
  applyRom();
}

function wordCard(it, from) {
  return `<button class="word" data-t="${esc(it.w)}">
      <span class="w">${esc(it.w)}</span>
      <span class="r ${ROM ? '' : 'hidden'}" data-hideable="1">${esc(it.r || '')}</span>
      <span class="m">${esc(it.m || '')}</span>
      ${from ? `<span class="from">${esc(from)}</span>` : ''}
    </button>`;
}

/* ═════════════════════════════════════════════════════ view: verbs ═══ */
let verbOpen = null, verbQuery = '';
const CLS_LABEL = { reg:'regular', ha:'하다', p:'ㅂ irregular', t:'ㄷ irregular',
                    s:'ㅅ irregular', reu:'르 irregular', eu:'ㅡ drops', h:'ㅎ irregular' };

function renderVerbs() {
  const rulesHost = $('#verbRules');
  if (!rulesHost.dataset.done) {
    rulesHost.innerHTML = `<div class="rule-stack">${D.verbRules.map(r =>
      `<div class="vrule"><span class="rule-n">${r.n}</span>
         <div><h3>${esc(r.title)}</h3><p>${esc(r.text)}</p></div></div>`).join('')}</div>`;
    rulesHost.dataset.done = '1';
  }
  const groups = D.verbGroups;
  const host = $('#verbBody');
  host.innerHTML = `
    <div class="list-bar">
      <div class="word-search"><input id="verbQ" type="search" value="${esc(verbQuery)}"
        placeholder="Search ${groups.reduce((n,g)=>n+g.items.length,0)} verbs — Hangul or meaning"
        autocomplete="off" spellcheck="false"><span id="verbQCount"></span></div>
      <div class="fold-actions">
        <button class="ghost sm" id="expandAllV">Expand all</button>
        <button class="ghost sm" id="collapseAllV">Collapse all</button>
      </div>
    </div>
    <div class="cat-row" id="verbCats"></div>
    <div id="verbList"></div>`;

  const row = $('#verbCats');
  groups.forEach(g => {
    const b = el('button', 'cat-chip', `${esc(g.title)}<span class="n">${g.items.length}</span>`);
    b.onclick = () => { if (verbQuery) { verbQuery = ''; renderVerbs(); } jumpTo('v:' + g.id); };
    row.appendChild(b);
  });
  const keys = groups.map(g => 'v:' + g.id);
  const foldAllV = v => {
    if (verbQuery) { verbQuery = ''; $('#verbQ').value = ''; }
    foldAll(keys, v); paintVerbs(); applyFoldAll(keys);
  };
  $('#expandAllV').onclick = () => foldAllV(false);
  $('#collapseAllV').onclick = () => foldAllV(true);

  const q = $('#verbQ');
  q.oninput = () => { verbQuery = q.value; paintVerbs(); };
  q.onkeydown = e => { if (e.key === 'Escape') { q.value = ''; verbQuery = ''; paintVerbs(); } };
  paintVerbs();
  if (verbQuery) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
}

function paintVerbs() {
  const host = $('#verbList'), counter = $('#verbQCount');
  const qq = verbQuery.trim().toLowerCase();
  $$('.cat-chip', $('#verbCats')).forEach(b => b.classList.toggle('dim', !!qq));

  if (qq) {
    const items = [];
    D.verbGroups.forEach(g => g.items.forEach(v => {
      if (v.w.includes(qq) || v.m.toLowerCase().includes(qq) || (v.r||'').toLowerCase().includes(qq))
        items.push(v);
    }));
    counter.textContent = `${items.length} match${items.length === 1 ? '' : 'es'}`;
    host.innerHTML = items.length
      ? `<div class="verb-grid">${items.map(verbCard).join('')}</div>`
      : `<div class="empty"><div class="big">없어요</div>No verb matches that.</div>`;
  } else {
    counter.textContent = '';
    host.innerHTML = D.verbGroups.map(g => sectionShell(
      'v:' + g.id, g.title,
      g.kind === 'adj' ? 'descriptive — conjugates like an action verb' : 'action verbs',
      g.items.length,
      `<div class="verb-grid">${g.items.map(verbCard).join('')}</div>`)).join('');
    wireFolds(host);
  }

  $$('.verb', host).forEach(card => {
    card.querySelector('.verb-head').onclick = () => {
      const w = card.dataset.w;
      verbOpen = verbOpen === w ? null : w;
      paintVerbs();
    };
  });
  $$('[data-t]', host).forEach(b => b.onclick = e => { e.stopPropagation(); Sound.play(b.dataset.t, b); });
  applyRom();
}

function verbCard(v) {
  const open = verbOpen === v.w;
  const forms = [['present','Present, polite'],['past','Past'],
                 ['future','Future / intention'],['formal','Formal']];
  return `<div class="verb${open ? ' open' : ''}" data-w="${esc(v.w)}">
    <div class="verb-head">
      <button class="verb-play" data-t="${esc(v.w)}">${esc(v.w)}</button>
      <div class="verb-meta">
        <span class="m">${esc(v.m)}</span>
        <span class="r ${ROM ? '' : 'hidden'}" data-hideable="1">${esc(v.r)}</span>
      </div>
      ${v.cls !== 'reg' ? `<span class="cls ${v.cls === 'ha' ? 'ha' : 'irr'}">${esc(CLS_LABEL[v.cls])}</span>` : ''}
      <span class="chev">${open ? '−' : '+'}</span>
    </div>
    ${open ? `<div class="verb-forms">${forms.map(([k, label]) =>
      `<div class="vform">
         <span class="k">${label}</span>
         <button class="v" data-t="${esc(v[k])}">${esc(v[k])}</button>
         <span class="r ${ROM ? '' : 'hidden'}" data-hideable="1">${esc(v[k + 'R'])}</span>
       </div>`).join('')}
       <div class="vform"><span class="k">Negative</span>
         <button class="v" data-t="${esc(v.negative)}">${esc(v.negative)}</button>
         <span class="r ${ROM ? '' : 'hidden'}" data-hideable="1"></span></div>
     </div>` : ''}
  </div>`;
}

/* ═════════════════════════════════════════════════ view: sentences ═══ */
let sentTab = 'order';
function renderSent() {
  const host = $('#sentBody');
  host.innerHTML = `<div class="cat-row" id="sentTabs"></div><div id="sentBodyInner"></div>`;
  const tabs = [['order','Word order'],['particles','Particles'],['patterns','Patterns']];
  const row = $('#sentTabs');
  tabs.forEach(([id, label]) => {
    const b = el('button', 'cat-chip' + (id === sentTab ? ' on' : ''), label);
    b.onclick = () => { sentTab = id; renderSent(); };
    row.appendChild(b);
  });
  paintSent();
}

function paintSent() {
  const inner = $('#sentBodyInner');
  if (sentTab === 'order') {
    const o = D.order;
    inner.innerHTML = `<div class="sent-lead"><h2>${esc(o.title)}</h2><p>${esc(o.text)}</p></div>
      <div class="ex-list">${o.examples.map(exRow).join('')}</div>`;
  } else if (sentTab === 'particles') {
    const key = 's:particles';
    inner.innerHTML = sectionShell(key, 'Particles',
      'the words that say what each part is doing', D.particles.length,
      D.particles.map(p => `
        <div class="pcard flat">
          <div class="pcard-head"><span class="pk">${esc(p.p)}</span>
            <span class="pn">${esc(p.name)}</span></div>
          <p class="prule">${esc(p.rule)}</p>
          <div class="ex-list">${p.ex.map(exRow).join('')}</div>
        </div>`).join(''));
    wireFolds(inner);
  } else {
    const groups = [];
    D.patterns.slice().sort((a, b) => a.order - b.order).forEach(p => {
      let g = groups.find(x => x.name === p.g);
      // Key off the first pattern's id, which is stable, rather than the group's
      // display name — renaming a group would otherwise discard its fold state.
      if (!g) groups.push(g = { name: p.g, key: 'sg:' + p.id, items: [] });
      g.items.push(p);
    });
    inner.innerHTML = `<div class="fold-actions" style="margin-bottom:14px">
        <button class="ghost sm" id="expandAllS">Expand all</button>
        <button class="ghost sm" id="collapseAllS">Collapse all</button>
      </div>` + groups.map(g => {
      return sectionShell(g.key, g.name, '', g.items.length,
        g.items.map(p => `
          <div class="pcard flat">
            <div class="pcard-head"><span class="rule-n">${p.order}</span>
              <h3>${esc(p.title)}</h3><span class="pform">${esc(p.form)}</span></div>
            <p class="prule">${esc(p.rule)}</p>
            <div class="ex-list">${p.ex.map(exRow).join('')}</div>
          </div>`).join(''));
    }).join('');
    const keys = groups.map(g => g.key);
    $('#expandAllS').onclick = () => { foldAll(keys, false); applyFoldAll(keys); };
    $('#collapseAllS').onclick = () => { foldAll(keys, true); applyFoldAll(keys); };
    wireFolds(inner);
  }
  $$('[data-t]', inner).forEach(b => b.onclick = () => Sound.play(b.dataset.t, b));
  applyRom();
}

function exRow(e) {
  return `<div class="exrow">
    <button class="ex-kr" data-t="${esc(e.s)}">${esc(e.s)}</button>
    <div class="ex-side">
      <span class="ex-m">${esc(e.m)}</span>
      <span class="r ${ROM ? '' : 'hidden'}" data-hideable="1">${esc(e.r)}</span>
      ${e.note ? `<span class="ex-note">${esc(e.note)}</span>` : ''}
    </div></div>`;
}

/* ══════════════════════════════════════════════════ view: practice ═══ */
let scope = 'letters';
const MODES = [
  { id: 'srs', ic: '🔁', name: 'Review what’s due',
    blurb: 'The spaced-repetition queue. Only items the algorithm says you are about to forget — the highest-value minutes you can spend.' },
  { id: 'listen', ic: '👂', name: 'Listen and pick',
    blurb: 'Hear a sound, choose the character. The hardest direction and the one that actually transfers to understanding speech.' },
  { id: 'recall', ic: '👁', name: 'See and say',
    blurb: 'A character appears, you say it aloud, then reveal and grade yourself. Fast passes through a whole set.' },
];

function dueCount() {
  let n = 0;
  Object.keys(POOLS).forEach(p => {
    POOLS[p].items().forEach(it => {
      const k = POOLS[p].key(it.ch);
      if (S.cards[k] && S.cards[k].due <= Date.now()) n++;
    });
  });
  return n;
}
function renderDrillHome() {
  sess = null;                      // otherwise the key handler keeps grading a hidden round
  $('#drillSession').hidden = true;
  const home = $('#drillHome'); home.hidden = false;
  const due = dueCount();

  home.innerHTML = `<div class="intro">
      <h1>Practice</h1>
      <p>Pick what to draw from, then how to be tested. Every answer feeds one shared schedule, so a letter you miss in a listening drill comes back sooner everywhere.</p>
    </div>
    <div class="scope" id="scopeRow"></div>
    <div class="drill-modes" id="modeRow"></div>`;

  const sr = $('#scopeRow');
  Object.entries(POOLS).forEach(([id, p]) => {
    const items = p.items();
    const d = items.filter(it => { const c = S.cards[p.key(it.ch)]; return c && c.due <= Date.now(); }).length;
    const b = el('button', 'scope-btn' + (scope === id ? ' on' : ''),
      `${p.label}<span class="c">${items.length}${d ? ` · ${d} due` : ''}</span>`);
    b.onclick = () => { scope = id; renderDrillHome(); };
    sr.appendChild(b);
  });

  const mr = $('#modeRow');
  MODES.forEach(m => {
    const p = POOLS[scope], items = p.items();
    let meta;
    if (m.id === 'srs') {
      const d = items.filter(it => { const c = S.cards[p.key(it.ch)]; return c && c.due <= Date.now(); }).length;
      const fresh = items.filter(it => !S.cards[p.key(it.ch)]).length;
      meta = d ? `<b>${d}</b> due now · ${fresh} never seen` : `Nothing due · <b>${fresh}</b> new to introduce`;
    } else {
      meta = `${items.length} in ${POOLS[scope].label.toLowerCase()} · 20 per round`;
    }
    const b = el('button', 'mode',
      `<div class="ic">${m.ic}</div><h3>${esc(m.name)}</h3><p>${esc(m.blurb)}</p>
       <div class="meta">${meta}</div>`);
    b.onclick = () => startSession(m.id);
    mr.appendChild(b);
  });

  const t = $('.tab[data-view="drill"] .badge') || null;
  const tab = $('.tab[data-view="drill"]');
  tab.innerHTML = 'Practice' + (due ? ` <span class="badge">${due}</span>` : '');
}

/* ────────────────────────────────────────────────────── session ─── */
let sess = null;
function startSession(mode) {
  const p = POOLS[scope];
  let items = p.items().slice();

  if (mode === 'srs') {
    const due = items.filter(it => { const c = S.cards[p.key(it.ch)]; return c && c.due <= Date.now(); });
    const fresh = shuffle(items.filter(it => !S.cards[p.key(it.ch)])).slice(0, Math.max(0, 12 - due.length));
    items = shuffle(due).concat(fresh).slice(0, 30);
    if (!items.length) { toast('Nothing due — everything is scheduled ahead.'); return; }
  } else {
    items = sample(items, 20);
  }

  sess = { mode, pool: p, items, i: 0, right: 0, wrong: 0, missed: [], revealed: false, answered: false };
  $('#drillHome').hidden = true;
  $('#drillSession').hidden = false;
  paintQuestion();
}

function paintQuestion() {
  const host = $('#drillSession');
  if (sess.i >= sess.items.length) return paintDone();
  const it = sess.items[sess.i];
  const total = sess.items.length;
  const isWord = sess.pool === POOLS.words;
  sess.revealed = false; sess.answered = false;

  const bar = `<div class="sess-bar">
      <button class="ghost sm" id="quitS">← Exit</button>
      <div class="sess-prog"><i style="width:${sess.i / total * 100}%"></i></div>
      <div class="sess-count">${sess.i + 1} / ${total}</div>
      <div class="sess-score"><span class="ok">${sess.right}</span> · <span class="no">${sess.wrong}</span></div>
    </div>`;

  if (sess.mode === 'listen') {
    const others = distractors(it, sess.pool, 5);
    const choices = shuffle(others.concat([it]));
    host.innerHTML = `<div class="sess">${bar}
      <div class="q-card">
        <div class="q-prompt">Which one did you hear?</div>
        <button class="q-speaker" id="spk">▶</button>
        <div class="q-sub">Click to replay &nbsp;·&nbsp; <kbd>space</kbd></div>
      </div>
      <div class="choices" id="ch"></div>
      <div class="keyhint">Answer with <kbd>1</kbd>–<kbd>6</kbd></div></div>`;
    const spk = $('#spk');
    spk.onclick = () => Sound.play(it.ch, spk);
    setTimeout(() => Sound.play(it.ch, spk), 220);
    const cr = $('#ch');
    choices.forEach((c, n) => {
      const b = el('button', 'choice' + (isWord ? ' word' : ''),
        `${c.ch}<span class="r">${n + 1}</span>`);
      b.onclick = () => answerChoice(b, c, it, cr);
      cr.appendChild(b);
    });
    sess._choices = choices;
  } else {
    // recall / srs — show, self-grade
    const cls = isWord || it.ch.length > 1 ? 'q-big word' : 'q-big';
    host.innerHTML = `<div class="sess">${bar}
      <div class="q-card">
        <div class="q-prompt">Say it out loud, then reveal</div>
        <div class="${cls}" id="qBig">${esc(it.ch)}</div>
        <div class="q-sub" id="qSub">&nbsp;</div>
        <div id="qRev"></div>
      </div>
      <div id="qActions"></div>
      <div class="keyhint"><kbd>space</kbd> reveal &nbsp;·&nbsp; then <kbd>1</kbd> again <kbd>2</kbd> hard <kbd>3</kbd> good <kbd>4</kbd> easy</div></div>`;
    $('#qBig').onclick = () => Sound.play(it.ch, $('#qBig'));
    $('#qActions').innerHTML =
      `<button class="btn wide" id="revealBtn">Reveal &amp; hear it</button>`;
    $('#revealBtn').onclick = reveal;
  }
  $('#quitS').onclick = () => { sess = null; renderDrillHome(); renderStats(); };
}

function reveal() {
  if (sess.revealed) return;
  sess.revealed = true;
  const it = sess.items[sess.i];
  Sound.play(it.ch, $('#qBig'));
  const j = sess.pool === POOLS.letters ? JAMO_BY_CH[it.ch] : null;
  const note = j ? (j.kind === 'cons' ? j.o.sound : j.o.sound) : '';
  $('#qRev').innerHTML = `<div class="q-reveal">
      <div class="rom" data-hideable="0">${esc(it.rom || '')}</div>
      ${it.meaning ? `<div class="meaning">${esc(it.meaning)}</div>` : ''}
      ${note ? `<div class="note">${esc(note)}</div>` : ''}
    </div>`;
  $('#qActions').innerHTML = `<div class="grades">
      <button class="grade" data-g="0"><span class="g">Again</span><span class="n">1</span></button>
      <button class="grade" data-g="3"><span class="g">Hard</span><span class="n">2</span></button>
      <button class="grade" data-g="4"><span class="g">Good</span><span class="n">3</span></button>
      <button class="grade" data-g="5"><span class="g">Easy</span><span class="n">4</span></button>
    </div>`;
  $$('.grade').forEach(b => b.onclick = () => submitGrade(+b.dataset.g));
}

function submitGrade(q) {
  if (!sess.revealed) return;
  const it = sess.items[sess.i];
  SRS.grade(sess.pool.key(it.ch), q);
  if (q >= 3) sess.right++; else { sess.wrong++; sess.missed.push(it); }
  sess.i++;
  paintQuestion();
}

function answerChoice(btn, chosen, correct, container) {
  if (sess.answered) return;
  sess.answered = true;
  const ok = chosen.ch === correct.ch;
  $$('.choice', container).forEach(b => {
    b.disabled = true;
    const t = b.textContent.replace(/\d+$/, '').trim();
    if (t === correct.ch) b.classList.add('right');
  });
  if (!ok) btn.classList.add('wrong');
  SRS.grade(sess.pool.key(correct.ch), ok ? 4 : 0);
  if (ok) sess.right++; else { sess.wrong++; sess.missed.push(correct); }
  if (!ok) Sound.play(correct.ch);
  const mine = sess;
  setTimeout(() => {
    if (sess !== mine) return;      // exited, or a new round already started
    sess.i++; paintQuestion();
  }, ok ? 480 : 1250);
}

function paintDone() {
  const host = $('#drillSession');
  const total = sess.right + sess.wrong;
  const pct = total ? Math.round(sess.right / total * 100) : 0;
  const missed = sess.missed;
  host.innerHTML = `<div class="sess"><div class="done">
      <div class="big">${pct >= 90 ? '잘했어요' : pct >= 60 ? '좋아요' : '괜찮아요'}</div>
      <h2>Round complete</h2>
      <p>${pct >= 90 ? 'Clean run. These are scheduled well into the future now.'
                     : pct >= 60 ? 'Solid. The ones you missed will come back within minutes.'
                     : 'This set is still new — that is exactly what the schedule is for.'}</p>
      <div class="done-stats">
        <div class="done-stat"><div class="v">${pct}%</div><div class="k">Accuracy</div></div>
        <div class="done-stat"><div class="v">${sess.right}</div><div class="k">Right</div></div>
        <div class="done-stat"><div class="v">${sess.wrong}</div><div class="k">Missed</div></div>
      </div>
      ${missed.length ? `<div class="missed"><h4>Worth another look</h4>
        <div class="missed-row">${missed.map(m =>
          `<button class="play-btn" data-t="${esc(m.ch)}"><span class="kr">${esc(m.ch)}</span>
             <span class="lbl">${esc(m.rom || '')}</span></button>`).join('')}</div></div>` : ''}
      <div class="sess-actions">
        <button class="btn" id="againB">Another round</button>
        <button class="btn alt" id="backB">Back to practice</button>
      </div>
    </div></div>`;
  $$('[data-t]', host).forEach(b => b.onclick = () => Sound.play(b.dataset.t, b));
  const mode = sess.mode;
  $('#againB').onclick = () => startSession(mode);
  $('#backB').onclick = () => { sess = null; renderDrillHome(); renderStats(); };
  sess = null;
  renderDrillHome.badgeOnly = true;
  const due = dueCount();
  $('.tab[data-view="drill"]').innerHTML = 'Practice' + (due ? ` <span class="badge">${due}</span>` : '');
}

/* ═════════════════════════════════════════════════════ view: stats ═══ */
function renderStats() {
  const host = $('#statsBody');
  const keys = Object.keys(S.cards);
  const now = Date.now();
  const seen = keys.length;
  const due = keys.filter(k => S.cards[k].due <= now).length;
  const strong = keys.filter(k => S.cards[k].iv >= 21).length;
  const totalRev = S.log.length;
  const acc = totalRev ? Math.round(S.log.filter(l => l.q >= 3).length / totalRev * 100) : 0;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayRev = S.log.filter(l => l.t >= today.getTime()).length;

  // streak of days with at least one review
  const days = new Set(S.log.map(l => { const d = new Date(l.t); d.setHours(0,0,0,0); return d.getTime(); }));
  let streak = 0, cur = today.getTime();
  while (days.has(cur)) { streak++; cur -= DAY; }

  const jamoDone = ALL_JAMO.filter(j => SRS.mastery(jamoKey(j.ch)) >= .5).length;

  host.innerHTML = `
    <div class="stat-cards">
      <div class="stat"><div class="v">${jamoDone}<span style="font-size:16px;color:var(--ink-3)">/40</span></div>
        <div class="k">Letters learned</div><div class="sub">Reviewed at 11-day intervals or more</div></div>
      <div class="stat"><div class="v">${due}</div><div class="k">Due now</div>
        <div class="sub">${seen} cards in rotation</div></div>
      <div class="stat"><div class="v">${strong}</div><div class="k">Long-term</div>
        <div class="sub">Scheduled 3+ weeks out</div></div>
      <div class="stat"><div class="v">${acc}%</div><div class="k">Lifetime accuracy</div>
        <div class="sub">${totalRev} reviews</div></div>
      <div class="stat"><div class="v">${streak}</div><div class="k">Day streak</div>
        <div class="sub">${todayRev} reviews today</div></div>
    </div>

    <div class="section-h"><h2>Letter mastery</h2>
      <span class="sub">Bar height is how far out each letter is scheduled</span></div>
    <div class="heat" id="heatC"></div>
    <div class="legend">
      <span><i style="background:var(--line)"></i>Never seen</span>
      <span><i style="background:var(--warn)"></i>Learning</span>
      <span><i style="background:var(--good)"></i>Known</span>
    </div>

    <div class="section-h"><h2>Your data</h2>
      <span class="sub">${Store.usable ? 'Saved in this browser' : 'NOT saved — browser storage is unavailable here'}</span></div>
    <p style="color:var(--ink-2);font-size:14px;max-width:640px">
      Progress lives in this browser’s local storage for this exact address. Clearing site data, or opening the app from a different path, starts a fresh history — so export a backup now and then.
      ${Store.usable ? '' : '<br><strong style="color:var(--warn)">Storage is blocked right now.</strong> Open the folder and double-click <code>start.command</code> so the app is served over http, where saving works.'}
    </p>
    <div class="data-actions">
      <button class="ghost" id="expB">Export backup</button>
      <button class="ghost" id="impB">Import backup</button>
      <button class="ghost" id="rstB">Reset all progress</button>
      <input type="file" id="impF" accept="application/json" hidden>
    </div>`;

  const heat = $('#heatC');
  ALL_JAMO.forEach(j => {
    const k = jamoKey(j.ch), c = S.cards[k], m = SRS.mastery(k);
    const col = !c ? 'var(--line)' : m >= 1 ? 'var(--good)' : 'var(--warn)';
    const b = el('button', 'heat-c',
      `${j.ch}<i style="width:${c ? Math.max(22, m * 100) : 0}%;background:${col}"></i>`);
    b.title = c ? `${j.rom} — ${c.ok}/${c.seen} correct, next in ${c.iv} day${c.iv === 1 ? '' : 's'}`
                : `${j.rom} — not yet studied`;
    b.onclick = () => Sound.play(j.kind === 'cons' ? j.o.demo : j.o.name, b);
    heat.appendChild(b);
  });

  $('#expB').onclick = () => {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const a = el('a'); a.href = URL.createObjectURL(blob);
    a.download = `hangul-progress-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    toast('Backup downloaded');
  };
  $('#impB').onclick = () => $('#impF').click();
  $('#impF').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const obj = JSON.parse(r.result);
        if (!obj.cards) throw 0;
        Store.replace(obj);
        toast('Backup restored'); setTimeout(() => location.reload(), 600);
      } catch (err) { toast('That file could not be read'); }
    };
    r.readAsText(f);
  };
  $('#rstB').onclick = () => {
    if (!confirm('Erase all progress and scheduling? This cannot be undone.')) return;
    Store.reset(); toast('Progress cleared'); setTimeout(() => location.reload(), 500);
  };
}

/* ═══════════════════════════════════════════════════════ routing ═══ */
const RENDER = {
  learn: renderLearn, chart: renderChart, build: renderBuild,
  batchim: renderBatchim, rules: renderRules, words: renderWords,
  verbs: renderVerbs, sent: renderSent,
  drill: renderDrillHome, stats: renderStats,
};
let view = 'learn';
function go(v) {
  if (!RENDER[v]) v = 'learn';
  view = v;
  $$('.view').forEach(s => s.classList.toggle('on', s.dataset.view === v));
  $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.view === v));
  RENDER[v]();
  applyRom();
  location.hash = v;
  window.scrollTo({ top: 0, behavior: 'instant' });
}
$$('.tab').forEach(t => t.onclick = () => go(t.dataset.view));

/* ══════════════════════════════════════════════════════ keyboard ═══ */
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;

  if (e.key === '[') { nudgeVolume(-1); return; }
  if (e.key === ']') { nudgeVolume(1); return; }
  if (e.key === 'm' || e.key === 'M') {
    if (VOL === 0) { VOL = premute || 1; } else { premute = VOL; VOL = 0; }
    applyVolume();
    toast(VOL === 0 ? 'Muted' : `Volume ${Math.round(VOL * 100)}%`);
    return;
  }
  if (e.key === 'r' || e.key === 'R') {
    setRom(!ROM);
    if (!(view === 'drill' && sess)) go(view);   // never re-render out of a live round
    return;
  }

  if (view === 'drill' && sess) {
    if (e.key === ' ') {
      e.preventDefault();
      if (sess.mode === 'listen') { const s = $('#spk'); if (s) s.click(); }
      else if (!sess.revealed) reveal();
      return;
    }
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 6) {
      e.preventDefault();
      if (sess.mode === 'listen') { const b = $$('.choice')[n - 1]; if (b && !b.disabled) b.click(); }
      else if (sess.revealed && n <= 4) { const b = $$('.grade')[n - 1]; if (b) b.click(); }
      return;
    }
    if (e.key === 'Escape') { sess = null; renderDrillHome(); }
  }
});

/* ════════════════════════════════════════════════════════ start ═══ */
$('#romToggle').onclick = () => { setRom(!ROM); if (!(view === 'drill' && sess)) go(view); };
$('#themeToggle').onclick = () => {
  const order = [null, 'light', 'dark'];
  const i = order.indexOf(S.settings.theme || null);
  S.settings.theme = order[(i + 1) % 3];
  Store.save(); applyTheme();
  toast(S.settings.theme ? `${S.settings.theme} theme` : 'following system theme');
};

$('#volSlider').addEventListener('input', e => {
  VOL = posToVol(+e.target.value);
  if (VOL > 0) premute = VOL;
  applyVolume();
});
// Preview the level as you drag, so you can hear what you are setting.
$('#volSlider').addEventListener('change', () => { if (VOL > 0) Sound.play('\uAC00'); });
$('#volIcon').onclick = () => {
  if (VOL === 0) { VOL = premute || 1; } else { premute = VOL; VOL = 0; }
  applyVolume();
};

applyTheme();
applyVolume(false);
go((location.hash || '#learn').slice(1));
const _d = dueCount();
if (_d) $('.tab[data-view="drill"]').innerHTML = `Practice <span class="badge">${_d}</span>`;
window.__onStoreSync = () => { if (!sess) { try { RENDER[view](); applyRom(); } catch (e) {} } };
window.addEventListener('hashchange', () => {
  const v = location.hash.slice(1);
  if (v && v !== view) go(v);
});
