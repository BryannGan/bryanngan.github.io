/* ==========================================================================
   BAKED BACKEND — the demo with no server behind it.

   Serves the same shapes api.py returns, out of demo/manifest.json. The UI
   in app.js cannot tell the difference; only the transport changes.

   What is genuinely re-executed here, not replayed:
     * reconcile()          ported from core.py, so tap ORDER matters
     * annotate_toxicity()  the same plain table lookup, never inferred
     * the verdict roll-up

   What is frozen: the two model calls (whole-image identify, per-bloom
   identify) and the SAM masks. Those are the parts that need a GPU-less
   server and an API key, and they are exactly reproducible for a fixed
   photo, so freezing them costs the visitor nothing.
   ========================================================================== */

const Baked = (() => {
  let M = null;                       // manifest
  let sessions = {};                  // slug -> {bouquet, bloom, photo}

  const load = async () => {
    if (!M) M = await (await fetch('demo/manifest.json')).json();
    return M;
  };

  /* ---- ports of the Python pipeline ---------------------------------- */

  // metrics.annotate_toxicity — plain lookup against the baked table
  function annotate(flowers, pets) {
    return flowers.map(f => {
      const label = f.canonical_label ?? 'unknown';
      const row = label !== 'unknown' ? M.toxicity.rows[label] : null;
      if (!row) {
        return { ...f, in_db: false, severity: 'unknown', aspca_verified: 'no',
                 clinical_signs: '',
                 toxic_to: Object.fromEntries(pets.map(p => [p, 'unknown'])) };
      }
      return { ...f, in_db: true, severity: row.severity,
               aspca_verified: row.aspca_verified,
               clinical_signs: row.clinical_signs,
               toxic_to: Object.fromEntries(pets.map(p => [p, row['toxic_' + p] ?? 'unknown'])) };
    });
  }

  // core.seed_bouquet — one record per flower TYPE
  function seed(vflowers) {
    const out = [], seen = new Set();
    for (const f of vflowers) {
      const l = f.canonical_label ?? 'unknown';
      if (seen.has(l)) continue;
      seen.add(l);
      out.push({ canonical_label: l, common_name: f.common_name,
                 confidence: f.confidence, located: false, bloom: null,
                 source: 'verdict' });
    }
    return out;
  }

  // core._absorb_duplicates
  function absorb(bouquet, keep) {
    const label = keep.canonical_label;
    const survivors = [];
    for (const r of bouquet) {
      if (r === keep || r.canonical_label !== label) { survivors.push(r); continue; }
      if (keep.bloom == null && r.bloom != null) { keep.bloom = r.bloom; keep.located = true; }
    }
    bouquet.length = 0; bouquet.push(...survivors);
  }

  // core.reconcile — bloom id stands in for the mask-IoU identity test,
  // which is exact here because every baked bloom is a distinct mask.
  function reconcile(bouquet, ident, bloomId) {
    for (const r of bouquet) {
      if (r.bloom != null && r.bloom === bloomId) {
        const changed = r.canonical_label !== ident.canonical_label;
        Object.assign(r, { canonical_label: ident.canonical_label,
                           common_name: ident.common_name,
                           confidence: ident.confidence, located: true,
                           source: changed ? 'corrected' : 'explored' });
        if (changed) absorb(bouquet, r);
        return changed ? 'corrected' : 'confirmed';
      }
    }
    for (const r of bouquet) {
      if (r.canonical_label === ident.canonical_label) {
        Object.assign(r, { located: true, bloom: bloomId, source: 'confirmed',
                           common_name: ident.common_name,
                           confidence: ident.confidence });
        return 'confirmed';
      }
    }
    bouquet.push({ canonical_label: ident.canonical_label,
                   common_name: ident.common_name, confidence: ident.confidence,
                   located: true, bloom: bloomId, source: 'new' });
    return 'new';
  }

  // api._verdict
  function verdict(annotated, pets) {
    const toxic = annotated.filter(f => f.in_db && pets.some(p => f.toxic_to[p] === 'yes'))
                           .map(f => f.common_name);
    const unknown = annotated.some(f => !f.in_db);
    return { state: toxic.length ? 'FLAGGED' : (unknown ? 'CAUTION' : 'CLEAR'),
             toxic, has_unknown: unknown, n_types: annotated.length };
  }

  const payload = (s, pets) => {
    const flowers = annotate(s.bouquet.map(r => ({
      common_name: r.common_name, canonical_label: r.canonical_label,
      confidence: r.confidence, source: r.source, located: r.located })), pets);
    return { flowers, verdict: verdict(flowers, pets) };
  };

  /* ---- point -> bloom ------------------------------------------------- */
  const inPoly = (x, y, poly) => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };

  function pick(photo, x, y) {
    for (const b of photo.blooms)
      if (b.polygons.some(p => inPoly(x, y, p))) return b;
    // near-miss tolerance, so a slightly-off tap still feels responsive
    let best = null, bd = Infinity;
    const tol = Math.hypot(photo.w, photo.h) * 0.06;
    for (const b of photo.blooms) {
      const d = Math.hypot(x - b.centroid[0], y - b.centroid[1]);
      if (d < bd) { bd = d; best = b; }
    }
    return bd <= tol ? best : null;
  }

  /* ---- the api.py-shaped surface -------------------------------------- */
  return {
    async meta() {
      await load();
      return { species: M.toxicity.species, verified: M.toxicity.verified,
               providers: ['gemini'], seg_model: M.seg_model,
               severities: ['none', 'mild', 'moderate', 'severe', 'unknown'] };
    },

    async photos() { await load(); return M.photos; },

    async session(slug, pets) {
      await load();
      const p = M.photos.find(x => x.slug === slug);
      const bouquet = seed(p.verdict_flowers);
      sessions[slug] = { bouquet, bloom: null, photo: p };
      return { sid: slug, w: p.w, h: p.h, ...payload(sessions[slug], pets),
               timing: p.timing, provider: 'gemini', model: p.model,
               raw_count: p.raw_count, photo_url: 'demo/' + p.photo,
               credit: p.credit };
    },

    async segment(slug, x, y) {
      const s = sessions[slug];
      const b = pick(s.photo, x, y);
      if (!b) { s.bloom = null; return { ok: false, reason: 'no object at that point' }; }
      s.bloom = b;
      return { ok: true, polygons: b.polygons, bbox: b.bbox,
               coverage: b.coverage, decode_ms: b.decode_ms,
               scales: Object.keys(b.scales),
               default_scale: b.scales[M.default_scale] ? M.default_scale
                                                        : Object.keys(b.scales)[0] };
    },

    async focus(slug, scale, pets) {
      const s = sessions[slug];
      const rec = s.bloom.scales[scale];
      const status = reconcile(s.bouquet, rec.ident, s.bloom.id);
      const tox = annotate([{ canonical_label: rec.ident.canonical_label,
                              common_name: rec.ident.common_name }], pets)[0];
      return { ident: rec.ident, tox, recon: status, scale,
               focus_url: 'demo/' + rec.focus, identify_ms: rec.identify_ms,
               ...payload(s, pets) };
    },
  };
})();
