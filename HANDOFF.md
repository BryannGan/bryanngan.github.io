# Handoff — bryanngan.github.io

For the next session picking this up. Read this before changing anything; a
lot of what looks arbitrary here is load-bearing, and several decisions were
reached by rejecting the obvious alternative first.

Live at <https://bryanngan.github.io>. GitHub Pages serves `main` — note the
repo's *default* branch is still `master`, a stale one-commit branch from
before the site existed. Deploys work; only the GitHub repo landing page is
misleading.

---

## 1. The shape of it

One document, three faces. `data-mode` on `<html>` selects which sections show
and which palette applies:

| Mode | Content | Register |
|---|---|---|
| `research` (default) | About, Research, News, Awards, Publications, Conferences, Mentoring | Warm paper, clay accent, IBM Plex |
| `chef` | The Kitchen — 18 dishes | Spring park: leaf green, hand-drawn SVG botanicals, drifting petals |
| `dev` | The Well — WebGL project scene + shelf | Cinematic near-monochrome, one warm accent |

Mode persists to `localStorage` and can be forced with `?mode=chef` so a link
opens in a given face. **Research is what renders with no JS at all** — every
other mode is additive.

Section nav (About / Research / …) is research-only; chef and dev hide it,
since those modes have no such sections to point at.

### Files

```
index.html      all three modes in one document
style.css       ~2000 lines, sectioned by mode with banner comments
site.js         flow field, petals, mode switching, reveals, nav tracking
kitchen.js      chef manifest — one object per dish
lab.js          dev manifest — one object per project
dev3d.js        the WebGL scene (three.js)
dev-boot.js     lazy-loads dev3d only when dev mode opens
vendor/         three.js r169, vendored (166 KB gzipped, no CDN)
research.html   Cardiovascular Research detail page
trading.html    Algorithmic Trading detail page
flowers/        Pet-Safe Bouquet demo — self-contained, DO NOT INLINE (§5)
hangul/         Hangul Trainer deployment — 24 MB, almost all audio
```

Content lives in the two manifests. Adding a dish or a project is a data edit,
never a markup edit.

---

## 2. Performance — the numbers, and why they're fragile

Measured, not estimated. Re-measure after any scene change.

- Front page: **29 KB gzipped core**, 20 requests, DOMContentLoaded ~42 ms
- three.js: **166 KB gzipped, dev mode only**, never parsed otherwise
- `/hangul/`: 394 KB, **zero audio requests on load** — clips are ~8 KB each,
  fetched only when clicked
- Every canvas holds **60 fps**

Three rules that were learned the hard way and will bite again:

**Never repaint a whole canvas for a small change.** The dev scene once did a
full-size `drawImage` every frame when only a few windows were blinking — about
543 Mpx/s at dpr 2, and the page crawled on Retina. It now composites the
skyline once and patches only the rectangles that changed. Measured 60 → 0
full-canvas blits per second.

**Test at dpr 2.** The headless browser reports `devicePixelRatio: 1`, which is
a quarter of the cost on a Retina Mac. A canvas that is smooth in testing can
still be unusable on the user's machine.

**Canvases measured while hidden come back 0×0**, and a window-resize listener
never fires on a mode switch. Every field watches its own box with a
`ResizeObserver` (`observeBox` in `site.js`). That helper tracks the hidden
state explicitly, because returning from hidden at the *same* size gives an
unchanged size key — a size comparison alone skips the reseed and leaves the
previous frame's trails burned in.

---

## 3. Developer mode — the Well

`dev3d.js`. One tetromino per project falls and locks as you scroll; camera
pulls back and orbits; HUD labels project from each locked piece to a leader
line at the frame edge. Hover lights a piece, click opens the project.

- **The packing is deliberate.** The five pieces tile a 4-wide well exactly —
  20 cells, no gaps — so the stack closes into a solid slab. Rows 0–3 tile;
  the top two pieces leave a ragged silhouette on purpose. See `PACKING`.
  More than five projects and extra pieces land as bars on the next row up.
- **Label sides are fixed per piece, not derived from projected position.**
  They used to be `projectedX < width/2`, and the centred cap pieces sat within
  a pixel of that line, so camera drift flipped them every frame. It looked
  like flashing. Do not "improve" this back into a projection test.
- **Surfaces**: each project has its own colour and material. Patterns are
  drawn as height fields and Sobelled into normal maps at runtime — roughness
  and metalness maps alone only modulate specular response and read as flat
  paint. Cubes are chamfered (`roundedBox`) because sharp corners catch no
  highlight. There's a small procedural environment so metals have something
  to reflect.
- Texture is easy to overdrive. Fine grain reads as material; coarse grain
  reads as damage. If it looks like static, lower the Sobel gain and
  `normalScale` before touching anything else.

**`well-v1` is a git tag marking the version Bryan explicitly signed off on.**
If a redesign goes wrong:

```
git checkout well-v1 -- dev3d.js dev-boot.js style.css index.html
```

---

## 4. Design history — do not re-litigate

Developer mode went through many rejected directions before landing. The
pattern in the rejections is worth knowing:

1. Ink-splatter Splatoon → rejected. He meant the *poster* language (flat
   colour fields, halftone, heavy type), not the ink mechanic.
2. Neon night city → "too dark", repeatedly, through several brightness passes.
3. Bright poster → good, but not what he ultimately wanted.
4. Cinematic WebGL → accepted.

The root cause of the churn: **on a dark ground, bright colour can only appear
as glow, which reads dim however far saturation is pushed.** Several rounds
were spent turning up brightness when the ground was the problem. If a similar
"too dark / not colourful enough" loop starts, change the ground, not the
saturation.

Related: chef mode and research mode are settled. Don't restyle them to match
dev mode — the three registers are intentionally different.

---

## 5. Constraints that will break things if ignored

**Never load `flowers/app.css` into a page that also loads `style.css`.** They
currently share six class names — `cap`, `line`, `org`, `plate`, `spec`, `w3` —
and `.cap` and `.plate` are load-bearing on both sides; `.cap` *is* the shelf
card. The demo is linked out for this reason. An `<iframe>` is also safe.
(The demo's own handoff listed seven, including `vignette`; that one left
`style.css` during a dev-mode rewrite. Re-check with the snippet below rather
than trusting either number — the overlap moves as the CSS changes.)

```bash
python3 - <<'EOF'
import re
a = set(re.findall(r'\.([a-zA-Z][\w-]*)', open('flowers/app.css').read()))
b = set(re.findall(r'\.([a-zA-Z][\w-]*)', open('style.css').read()))
print(sorted(a & b))
EOF
```

**Do not touch the flowers demo's internals.** Photo attribution is a licence
requirement (three of four samples are CC BY-SA 4.0): keep `#credit`, the
`credit` field in `demo/manifest.json`, and `CREDITS.md`. Keep the "not
veterinary advice" footer. Its severity palette is colourblind-validated —
changing its colours breaks an accessibility property.

**Never fabricate research figures.** Everything on `research.html` is real
output from Bryan's work. Hand-authored schematics may illustrate methodology,
never results. Dev-mode cover art plays by different rules — it's decorative —
but the two pages are deliberately not held to the same standard.

**Contrast**: pastel fills only, never pastel text. Every text colour in
`style.css` carries its measured ratio in a comment. The hero bio is near-black
at 15:1 specifically because the flow field moves behind it — a 5:1 grey that
passes on flat paper does not survive streamlines crossing the glyphs.

---

## 6. Open work

- **`research.html` needs text and figures.** Five projects, all flat
  undifferentiated bullet lists, no hierarchy, no "why this matters" line.
  Figures cover tissue mechanics, hemodynamics and EP well; **LPN calibration
  and MIROS have none** — the plan was hand-authored SVG schematics (the LPN is
  literally an RC circuit; MIROS is a pipeline). Ask before writing prose; the
  technical claims are his and must survive verbatim.
- **Unresolved attribution**: several strong figures came from
  `~/Documents/Research/Conferences/SB3C_2025/SLIDES/figures_lei/`. Unclear
  whether they're Bryan's own work for the collaboration with Prof. Lei Shi or
  that group's. Confirm before the research page is finalised.
- **`kitchen.js` names and notes are placeholders** written from the
  photographs. Some are certainly wrong, and the second line of each is an
  invented feeling that should be his or deleted.
- **Project Slot 06** is the last unfilled placeholder in `lab.js`.
- **`/hangul/` is a copy.** The trainer has its own repo,
  `BryannGan/korean-hangul-trainer`, with audio committed, but Pages isn't
  enabled there. Enabling it and pointing the card at that URL removes 24 MB
  and 2,400 files from this repo and fixes the drift — right now edits in
  `~/Documents/Korean` don't reach the site until someone re-copies.
- **Default branch** is still `master`.

---

## 7. Working on it

Use the bundled server, not `python3 -m http.server`:

```bash
python3 tools/devserve.py            # http://localhost:8765
```

Chromium holds a stale `style.css` across same-URL navigations even with
no-store. Two screenshots once came back identical to the original while the
file on disk was already correct, which cost real time chasing a change that
had already worked. `tools/devserve.py` stamps stylesheet hrefs with the
file's mtime, so the URL changes whenever the file does.

`playwright-cli` (installed globally, needs the conda Node on PATH) drives a
real browser for screenshots and measurement:

```bash
playwright-cli open
playwright-cli goto "http://localhost:8765/index.html?mode=dev"
playwright-cli screenshot
playwright-cli eval "() => ({ ... })"
```

Do not call `getContext()` on a canvas you are only inspecting — it claims the
context and the app's own `getContext` then fails. That produced a fake bug
report once.

Node, npm, ffmpeg and cwebp all live in `~/miniconda3/bin` (installed via
conda-forge; there is no Homebrew on this machine). ffmpeg and cwebp are how
the media was processed — GIFs to H.264, stills to WebP, ~102 MB of source
figures down to 1.7 MB.
