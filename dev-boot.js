/* Boots the WebGL well only when developer mode is actually shown, so the
   166 KB of three.js is never parsed for a visitor who never opens it. */
import { mountWell } from './dev3d.js';

let mounted = null;

function boot() {
  if (mounted) { mounted.resize(); return; }
  const stage = document.getElementById('well-stage');
  const canvas = document.getElementById('well-canvas');
  if (!stage || !canvas || !window.LAB) return;
  try {
    mounted = mountWell({
      stage, canvas,
      hud: document.getElementById('hud'),
      head: document.querySelector('.well-head'),
      lines: document.getElementById('hud-lines'),
      items: window.LAB
    });
    document.documentElement.classList.add('well-on');
  } catch (err) {
    // No WebGL, or the context was refused — the shelf below still stands.
    console.warn('well: falling back to the flat shelf', err);
    document.documentElement.classList.add('well-off');
  }
}

function check() {
  if (document.documentElement.getAttribute('data-mode') === 'dev') boot();
}

new MutationObserver(check).observe(document.documentElement,
  { attributes: true, attributeFilter: ['data-mode'] });

document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', check)
  : check();

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
