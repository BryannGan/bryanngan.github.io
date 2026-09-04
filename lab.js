/* Developer-mode project manifest.
   One entry per build. Mirrors kitchen.js — add an object, nothing else.

   title   : the build
   tagline : one line, store-blurb voice
   tags    : short chips, Steam-style
   status  : SHIPPED | LIVE | IN DEV | PROTOTYPE | ARCHIVED
   year    : string
   href    : optional link
   art     : optional image in assets/lab/. Omit and the card renders a
             generated circuit plate instead, which is the intended look
             for anything without a screenshot yet.

   The last three are deliberate placeholders — replace them. */
window.LAB = [
  {
    title: 'MIROS',
    tagline: 'Medical image to reduced-order simulation. Angiography in, patient-specific hemodynamics out, in minutes.',
    tags: ['Python', 'SimVascular', 'CMA-ES', 'Open source'],
    status: 'SHIPPED',
    year: '2026',
    href: 'https://github.com/BryannGan/MIROS'
  },
  {
    title: 'This Site',
    tagline: 'Three modes, one document. Hand-authored canvas fields, SVG botanicals, zero framework.',
    tags: ['Vanilla JS', 'Canvas', 'CSS'],
    status: 'LIVE',
    year: '2026',
    href: 'https://github.com/BryannGan/bryanngan.github.io'
  },
  {
    title: 'Pet-Safe Bouquet Check',
    tagline: 'Tap any flower in a bouquet. SAM 2 isolates the bloom, a vision model names it, a static table says whether it will hurt your cat.',
    tags: ['SAM 2', 'Gemini', 'Python', 'Interactive demo'],
    status: 'LIVE',
    year: '2026',
    href: 'flowers/',
    art: 'flowers.jpg'
  },
  { title: 'Project Slot 05', tagline: 'Replace me.', tags: ['TBD'], status: 'PROTOTYPE', year: '—' },
  { title: 'Project Slot 06', tagline: 'Replace me.', tags: ['TBD'], status: 'PROTOTYPE', year: '—' }
];
