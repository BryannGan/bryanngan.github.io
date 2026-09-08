/* Boots the WebGL well only when developer mode is actually shown.

   dev3d.js — and the 166 KB (gzipped) of three.js it imports — is pulled in
   with a dynamic import() from inside boot(), so the module graph is never
   fetched or parsed for a visitor who never opens this mode. A static
   `import { mountWell } from './dev3d.js'` here would make the browser fetch
   the whole graph on every page load, whatever the mode; that is what this
   file used to do, and it cost research and chef visitors 690 KB each. */

let mounted = null;
let loading = null;

function load() {
  if (!loading) {
    loading = import('./dev3d.js');
    loading.catch(() => { loading = null; });   // let a later attempt retry
  }
  return loading;
}

function boot() {
  if (mounted) { mounted.resize(); return; }
  const stage = document.getElementById('well-stage');
  const canvas = document.getElementById('well-canvas');
  if (!stage || !canvas || !window.LAB) return;
  load().then(({ mountWell }) => {
    if (mounted) return;                                        // a second boot() raced us
    if (document.documentElement.getAttribute('data-mode') !== 'dev') return;
    mounted = mountWell({
      stage, canvas,
      hud: document.getElementById('hud'),
      head: document.querySelector('.well-head'),
      lines: document.getElementById('hud-lines'),
      items: window.LAB
    });
    document.documentElement.classList.add('well-on');
  }).catch(err => {
    // No WebGL, the context was refused, or the module never arrived — the
    // shelf below still stands.
    console.warn('well: falling back to the flat shelf', err);
    document.documentElement.classList.add('well-off');
  });
}

function check() {
  if (document.documentElement.getAttribute('data-mode') === 'dev') boot();
}

new MutationObserver(check).observe(document.documentElement,
  { attributes: true, attributeFilter: ['data-mode'] });

document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', check)
  : check();

// Opening the mode menu is a strong hint that a switch is coming; start the
// download then so the well is ready by the time "Developer" is picked.
const sw = document.getElementById('mode-switch');
if (sw) sw.addEventListener('toggle', () => { if (sw.open) load().catch(() => {}); });

// Scroll meter for the well.
addEventListener('scroll', () => {
  const track = document.getElementById('well-track');
  const fill = document.getElementById('well-meter-fill');
  const cue = document.getElementById('well-cue');
  if (!track || !fill) return;
  const r = track.getBoundingClientRect();
  const span = r.height - innerHeight;
  const p = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 0;
  fill.style.transform = 'scaleY(' + p + ')';
  if (cue) cue.classList.toggle('is-gone', p > 0.04);
}, { passive: true });
