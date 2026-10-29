// CAE Result Comparator: shared state + calculation core for the six UI concepts.
// The calculation rules mirror the published tool and are NOT redesigned here:
//   delta %   = (design - baseline) / baseline x 100
//   improved  = delta moves in the preferred direction (lower / higher is better)
//   pass      = lower-is-better: value <= reference ; higher-is-better: value >= reference
//   margin %  = distance to the reference, positive = inside the criterion
// Plain script (no build step). Exposes window.CAE.
(function () {
  'use strict';

  // ---------- sample study (Static / Max Stress is the brief's example; other cases are sample data) ----------
  const SAMPLE = {
    analyses: ['Static Analysis', 'Sagging', 'Shock', 'Drop'],
    metrics: [
      { key: 'stress', name: 'Max Stress', unit: 'MPa', refName: 'Yield Stress', ref: 295, direction: 'lower' },
      { key: 'disp', name: 'Displacement', unit: 'mm', refName: 'Allowable Deflection', ref: 1.75, direction: 'lower' },
      { key: 'strain', name: 'Max Plastic Strain', unit: '%', refName: 'Strain Limit', ref: 0.8, direction: 'lower' },
      { key: 'blank', name: '', unit: '', refName: '', ref: null, direction: 'lower', custom: true },
    ],
    variants: [
      { id: 'v1', name: 'Original Design', note: 'As-built geometry, t = 2.0 mm', parent: null },
      { id: 'v2', name: 'HSK Rev.A', note: 'Fillet R3 at bracket root', parent: 'v1' },
      { id: 'v3', name: 'HSK Rev.B', note: 'Rev.A + lightening hole', parent: 'v2' },
      { id: 'v4', name: 'Reinforced', note: 'Added rib, t = 2.4 mm', parent: 'v1' },
    ],
    baselineId: 'v1',
    current: { analysis: 'Static Analysis', metric: 'stress' },
    cases: {
      'Static Analysis|stress': { ref: { name: 'Yield Stress', value: 295, on: true }, direction: 'lower', values: { v1: 312, v2: 259, v3: 272, v4: 241 } },
      'Static Analysis|disp': { ref: { name: 'Allowable Deflection', value: 1.75, on: true }, direction: 'lower', values: { v1: 1.84, v2: 1.62, v3: 1.71, v4: 1.38 } },
      'Sagging|disp': { ref: { name: 'Allowable Deflection', value: 3.0, on: true }, direction: 'lower', values: { v1: 3.12, v2: 2.74, v3: 2.95, v4: 2.41 } },
      'Shock|stress': { ref: { name: 'Dynamic Allowable', value: 355, on: true }, direction: 'lower', values: { v1: 388, v2: 341, v3: 352, v4: 362 } },
      'Drop|strain': { ref: { name: 'Strain Limit', value: 0.8, on: true }, direction: 'lower', values: { v1: 0.92, v2: 0.78, v3: 0.84, v4: 0.66 } },
    },
    caseOrder: ['Static Analysis|stress', 'Static Analysis|disp', 'Sagging|disp', 'Shock|stress', 'Drop|strain'],
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  let S = clone(SAMPLE);
  let seq = 10;
  const subs = [];
  const undoStack = [];

  function emit() { for (const f of subs) f(api); }
  function snapshot(label) { undoStack.push({ label, s: clone(S) }); if (undoStack.length > 30) undoStack.shift(); }

  // ---------- number helpers ----------
  function parseNum(str) {
    if (str === null || str === undefined) return null;
    const t = String(str).trim().replace(/,/g, '');
    if (t === '' || t === '-' || t === '.') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  function fmt(v) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    const p = Number(v.toPrecision(4));
    return p.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }
  function fmtPct(p, opts = {}) {
    if (p === null || p === undefined || !Number.isFinite(p)) return '—';
    const a = Math.abs(p).toFixed(opts.dp ?? 1);
    if (opts.signed) return (p > 0 ? '+' : p < 0 ? '−' : '±') + a + '%';
    return a + '%';
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- case access ----------
  function metricByKey(k) { return S.metrics.find((m) => m.key === k) || S.metrics[0]; }
  function keyOf(a, m) { return a + '|' + m; }
  function ensureCase(a, m) {
    const k = keyOf(a, m);
    if (!S.cases[k]) {
      const met = metricByKey(m);
      S.cases[k] = { ref: { name: met.refName, value: met.ref, on: true }, direction: met.direction, values: {} };
      if (!S.caseOrder.includes(k)) S.caseOrder.push(k);
    }
    return S.cases[k];
  }
  function currentCase() { return ensureCase(S.current.analysis, S.current.metric); }

  // ---------- calculations (unchanged engineering meaning) ----------
  function evaluate(caseKey) {
    const [a, m] = caseKey ? caseKey.split('|') : [S.current.analysis, S.current.metric];
    const c = ensureCase(a, m);
    const originalMetric = metricByKey(m);
    const met = originalMetric.name ? originalMetric : { ...originalMetric, name: 'Custom metric' };
    const dir = c.direction;
    const ref = c.ref && c.ref.on && Number.isFinite(c.ref.value) ? c.ref.value : null;
    const baseV = c.values[S.baselineId] ?? null;
    let letter = 0;
    const rows = S.variants.map((v, i) => {
      const isBaseline = v.id === S.baselineId;
      const value = c.values[v.id] ?? null;
      const tagLetter = isBaseline ? '' : String.fromCharCode(65 + letter++);
      let delta = null, deltaPct = null;
      if (!isBaseline && value !== null && baseV !== null) {
        delta = value - baseV;
        deltaPct = baseV !== 0 ? (delta / baseV) * 100 : null;
      }
      const better = delta === null ? null : dir === 'lower' ? delta < 0 : delta > 0;
      const worse = delta === null ? null : dir === 'lower' ? delta > 0 : delta < 0;
      let pass = null, margin = null, marginPct = null, util = null;
      if (ref !== null && value !== null) {
        pass = dir === 'lower' ? value <= ref : value >= ref;
        margin = dir === 'lower' ? ref - value : value - ref;
        marginPct = ref !== 0 ? (margin / Math.abs(ref)) * 100 : null;
        util = ref !== 0 ? value / ref : null;
      }
      return {
        id: v.id, index: i, name: v.name, note: v.note || '', parent: v.parent || null,
        isBaseline, tag: isBaseline ? 'Baseline' : 'Design ' + tagLetter, letter: tagLetter,
        value, delta, deltaPct, better, worse, same: delta === 0,
        pass, margin, marginPct, util, rank: null, isBest: false,
      };
    });
    const valued = rows.filter((r) => r.value !== null);
    const sorted = valued.slice().sort((x, y) => (dir === 'lower' ? x.value - y.value : y.value - x.value));
    sorted.forEach((r, i) => { r.rank = i + 1; });
    if (sorted.length > 1) sorted[0].isBest = true;
    const designs = rows.filter((r) => !r.isBaseline);
    const baseline = rows.find((r) => r.isBaseline) || null;
    const passing = designs.filter((r) => r.pass === true);
    const failing = designs.filter((r) => r.pass === false);
    const best = sorted[0] || null;
    const bestDesign = sorted.find((r) => !r.isBaseline) || null;
    const vals = valued.map((r) => r.value);
    return {
      key: keyOf(a, m), analysis: a, metric: met, unit: met.unit, direction: dir,
      ref: c.ref, refValue: ref, rows, designs, baseline, sorted, best, bestDesign,
      passCount: passing.length, failCount: failing.length, designCount: designs.length,
      min: vals.length ? Math.min(...vals) : null, max: vals.length ? Math.max(...vals) : null,
      mean: vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null,
    };
  }

  // Plain-language conclusion, usable by every concept.
  function conclusion(ev) {
    ev = ev || evaluate();
    const u = ev.unit, b = ev.baseline;
    if (!ev.bestDesign || !b || b.value === null) return 'Enter a baseline and at least one design value to compare.';
    const bd = ev.bestDesign;
    const dirWord = ev.direction === 'lower' ? 'lowest' : 'highest';
    let s = `${bd.name} has the ${dirWord} ${ev.metric.name} at ${fmt(bd.value)} ${u}`;
    if (bd.deltaPct !== null) s += `, ${fmtPct(bd.deltaPct)} ${bd.better ? 'better than' : bd.worse ? 'worse than' : 'equal to'} ${b.name} (${fmt(b.value)} ${u})`;
    s += '.';
    if (ev.refValue !== null) {
      const n = ev.designCount;
      if (ev.passCount === n) s += ` All ${n} design${n === 1 ? '' : 's'} meet ${ev.ref.name} (${fmt(ev.refValue)} ${u}).`;
      else if (ev.passCount === 0) s += ` No design meets ${ev.ref.name} (${fmt(ev.refValue)} ${u}).`;
      else s += ` ${ev.passCount} of ${n} designs meet ${ev.ref.name} (${fmt(ev.refValue)} ${u}).`;
      if (b.pass === false) s += ` The baseline exceeds it by ${fmtPct(Math.abs(b.marginPct))}.`;
    }
    if (ev.best && ev.best.isBaseline) s = `No design improves on the baseline. ` + s;
    return s;
  }

  // ---------- mutations ----------
  function nextName() {
    const n = S.variants.length;
    return 'Design ' + String.fromCharCode(64 + Math.min(n, 26));
  }
  const api = {
    get state() { return S; },
    subscribe(f) { subs.push(f); f(api); },
    emit,
    evaluate, conclusion, fmt, fmtPct, parseNum, esc, metricByKey,
    caseKey: () => keyOf(S.current.analysis, S.current.metric),
    currentCase,
    hasData: (k) => !!S.cases[k] && Object.keys(S.cases[k].values).length > 0,
    reset() { S = clone(SAMPLE); undoStack.length = 0; emit(); },
    canUndo: () => undoStack.length > 0,
    undoLabel: () => (undoStack.length ? undoStack[undoStack.length - 1].label : ''),
    undo() { const u = undoStack.pop(); if (u) { S = u.s; emit(); } },

    setValue(id, v, caseKey) {
      const c = caseKey ? S.cases[caseKey] : currentCase();
      const n = typeof v === 'number' ? v : parseNum(v);
      if (n === null) delete c.values[id]; else c.values[id] = n;
      emit();
    },
    setName(id, name) { const v = S.variants.find((x) => x.id === id); if (v) { v.name = name; emit(); } },
    setNote(id, note) { const v = S.variants.find((x) => x.id === id); if (v) { v.note = note; emit(); } },
    setParent(id, parent) { const v = S.variants.find((x) => x.id === id); if (v) { v.parent = parent; emit(); } },
    addVariant(opts = {}) {
      const id = 'v' + ++seq;
      const v = { id, name: opts.name || nextName(), note: opts.note || '', parent: opts.parent ?? S.baselineId };
      if (opts.after) { const i = S.variants.findIndex((x) => x.id === opts.after); S.variants.splice(i + 1, 0, v); }
      else S.variants.push(v);
      if (opts.value !== undefined && opts.value !== null) currentCase().values[id] = opts.value;
      emit();
      return id;
    },
    removeVariant(id) {
      if (S.variants.length <= 1) return;
      const v = S.variants.find((x) => x.id === id);
      snapshot(`Removed “${v ? v.name : 'design'}”`);
      S.variants = S.variants.filter((x) => x.id !== id);
      for (const k in S.cases) delete S.cases[k].values[id];
      for (const x of S.variants) if (x.parent === id) x.parent = v ? v.parent : S.baselineId;
      if (S.baselineId === id) S.baselineId = S.variants[0].id;
      emit();
    },
    setBaseline(id) { if (S.variants.some((x) => x.id === id)) { S.baselineId = id; emit(); } },
    moveVariant(id, d) {
      // Designs step over the baseline so the visible order among designs always changes.
      const i = S.variants.findIndex((x) => x.id === id);
      let j = i + d;
      if (id !== S.baselineId && S.variants[j] && S.variants[j].id === S.baselineId) j += d;
      if (i < 0 || j < 0 || j >= S.variants.length) return;
      const [v] = S.variants.splice(i, 1); S.variants.splice(j, 0, v); emit();
    },
    setRef(patch, caseKey) {
      const c = caseKey ? S.cases[caseKey] : currentCase();
      if ('value' in patch) { const n = typeof patch.value === 'number' ? patch.value : parseNum(patch.value); c.ref.value = n === null ? NaN : n; }
      if ('name' in patch) c.ref.name = patch.name;
      if ('on' in patch) c.ref.on = !!patch.on;
      emit();
    },
    setDirection(d, caseKey) { const c = caseKey ? S.cases[caseKey] : currentCase(); c.direction = d === 'higher' ? 'higher' : 'lower'; emit(); },
    toggleDirection(caseKey) { const c = caseKey ? S.cases[caseKey] : currentCase(); api.setDirection(c.direction === 'lower' ? 'higher' : 'lower', caseKey); },
    setAnalysis(a) { if (!S.analyses.includes(a)) S.analyses.push(a); S.current.analysis = a; ensureCase(a, S.current.metric); emit(); },
    setMetric(k) { S.current.metric = k; ensureCase(S.current.analysis, k); emit(); },
    setCurrentCase(k) { const [a, m] = k.split('|'); S.current = { analysis: a, metric: m }; ensureCase(a, m); emit(); },
    addAnalysis(name) { name = String(name || '').trim(); if (name && !S.analyses.includes(name)) S.analyses.push(name); emit(); },
    addMetric({ name, unit, refName, ref, direction }) {
      const key = 'm' + ++seq;
      S.metrics.push({ key, name, unit: unit || '', refName: refName || 'Reference', ref: ref ?? NaN, direction: direction || 'lower' });
      emit(); return key;
    },
    addCase(a, m) { ensureCase(a, m); emit(); return keyOf(a, m); },
    removeCase(k) {
      snapshot('Removed load case'); S.caseOrder = S.caseOrder.filter((x) => x !== k); delete S.cases[k];
      if (keyOf(S.current.analysis, S.current.metric) === k && S.caseOrder[0]) { const [a, m] = S.caseOrder[0].split('|'); S.current = { analysis: a, metric: m }; }
      emit();
    },
    // Bulk paste: lines of "name<TAB>value" or "name,value"
    pasteRows(text) {
      const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      let added = 0;
      for (const line of lines) {
        const parts = line.split(/\t|;|,(?=\s*-?[\d.]+\s*$)/);
        if (parts.length < 2) continue;
        const value = parseNum(parts[parts.length - 1]);
        const name = parts.slice(0, -1).join(' ').trim();
        if (value === null || !name) continue;
        const existing = S.variants.find((v) => v.name.toLowerCase() === name.toLowerCase());
        if (existing) currentCase().values[existing.id] = value;
        else { const id = 'v' + ++seq; S.variants.push({ id, name, note: '', parent: S.baselineId }); currentCase().values[id] = value; }
        added++;
      }
      if (added) emit();
      return added;
    },
  };

  // ---------- focus-preserving re-render helper ----------
  // Elements that should keep focus across innerHTML re-renders carry data-k="unique-key".
  api.preserveFocus = function (fn) {
    const a = document.activeElement;
    const k = a && a.getAttribute && a.getAttribute('data-k');
    let s0 = null, s1 = null, typed = null;
    if (k) {
      try { s0 = a.selectionStart; s1 = a.selectionEnd; } catch (e) { /* not a text field */ }
      // Keep exactly what the user typed ("0.", "-", "1e"): the re-render rebuilds inputs from the parsed number.
      if (a.tagName === 'INPUT' && a.type !== 'checkbox' && a.type !== 'radio') typed = a.value;
    }
    fn();
    if (k) {
      const el = document.querySelector(`[data-k="${CSS.escape(k)}"]`);
      if (el) {
        el.focus({ preventScroll: true });
        if (typed !== null && el.value !== typed) el.value = typed;
        try { if (s0 !== null) el.setSelectionRange(s0, s1); } catch (e) { /* ignore */ }
      }
    }
  };

  // ---------- icons (Lucide, ISC licence; inline SVG, decorative by default) ----------
  const P = {
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
    up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    anchor: '<path d="M12 22V8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/><circle cx="12" cy="5" r="3"/>',
    award: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
    chevDown: '<path d="m6 9 6 6 6-6"/>',
    chevLeft: '<path d="m15 18-6-6 6-6"/>',
    chevRight: '<path d="m9 18 6-6-6-6"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
    print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    branch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    swap: '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
    target: '<circle cx="12" cy="12" r="10"/><path d="M22 12h-4"/><path d="M6 12H2"/><path d="M12 6V2"/><path d="M12 22v-4"/>',
    reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    grip: '<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
    sort: '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
    gallery: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    minus: '<path d="M5 12h14"/>',
    equal: '<path d="M5 9h14"/><path d="M5 15h14"/>',
  };
  api.icon = function (name, size = 16, extra = '') {
    return `<svg class="ic ${extra}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || ''}</svg>`;
  };

  // Shared "back to gallery" link markup.
  api.galleryLink = function (label) {
    return `<a class="cae-gallery-link" href="../index.html" title="Back to concept gallery">${api.icon('gallery', 14)}<span>${label || 'Gallery'}</span></a>`;
  };

  window.CAE = api;
})();
