/* Editable Report Comparator: shared behaviour for the five frontend-design versions.
   The engineering logic is carried over unchanged from concepts/concept-05-refined: conclusion text, row ordering,
   chart geometry, clipboard and editing behaviour. What is new:
     - render() builds the page as named parts and hands them to a per-version compose(), so each version can arrange
       the same content its own way;
     - the chart accepts a colour palette (minor colour polish only; with DEFAULT_CHART it emits the same SVG as before);
     - arrow glyphs in the page UI are real icons. */
(function () {
  'use strict';
  const C = window.CAE, I = C.icon, E = C.esc;
  const UNITS = ['MPa', 'GPa', 'kPa', 'mm', 'm', '%', 'N', 'kN', 'g'];

  // The palette the chart already ships with. Versions may only nudge these values.
  const DEFAULT_CHART = {
    bg: '#fbfaf7', grid: '#eeece7', axis: '#9a9d95', tick: '#74776f', ink: '#1b1d1a', title: '#484b45',
    base: '#8a8d92', pass1: '#a7c49a', pass2: '#97b78a', best: '#4f7f55',
    fail: '#9c2a1f', rec: '#2f6b3a', ref: '#e8761a', refText: '#c4651a',
  };

  function mount(cfg) {
    const app = document.getElementById('app');
    const pal = Object.assign({}, DEFAULT_CHART, cfg.chart || {});
    // The evidence table stacks into one card per design when ITS OWN width drops below cfg.cardsBelow
    // (any layout, any zoom). Injected right before the version's own <style> so the version can still override it.
    const cardsBelow = cfg.cardsBelow || 1000, compactBelow = cfg.compactBelow || 640;
    const cardCss = `@container tbl (max-width: ${cardsBelow}px) {
  .twi { overflow: visible; border: 0 !important; box-shadow: none !important; background: transparent !important; border-radius: 0 !important; }
  table.ev { background: transparent; }
  .ev thead { display: none; }
  .ev, .ev tbody { display: block; }
  .ev tbody tr:not(.det) { display: grid; grid-template-columns: 78px minmax(0, 1.25fr) minmax(0, 1fr) 118px; grid-template-areas: "role name desc res" ". chg mg st" ". act act act"; background: var(--surface); box-shadow: 0 0 0 1px var(--line); border-radius: var(--r); margin-bottom: 8px; padding: 6px 0; }
  .ev tbody tr.base:not(.det) { background: var(--base-row); }
  .ev tbody tr.det { display: block; margin: -4px 0 8px; box-shadow: 0 0 0 1px var(--line); border-radius: 0 0 var(--r) var(--r); }
  .ev tbody td, .ev tbody tr.base td { display: block; border: 0; height: auto; padding: 5px 12px; min-width: 0 !important; background: transparent; box-shadow: none !important; }
  .ev tbody tr.det td { display: block; background: var(--surface-2); }
  .ev td:nth-child(1) { grid-area: role; } .ev td:nth-child(2) { grid-area: name; } .ev td:nth-child(3) { grid-area: desc; } .ev td:nth-child(4) { grid-area: res; }
  .ev td:nth-child(5) { grid-area: chg; } .ev td:nth-child(6) { grid-area: mg; } .ev td:nth-child(7) { grid-area: st; } .ev td:nth-child(8) { grid-area: act; }
  .ev td.r { text-align: left; } .ti.rv { text-align: left; width: calc(100% + 12px); margin-right: 0; }
  .ev td[data-l]::before { content: attr(data-l); display: block; font-size: 11px; letter-spacing: .07em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 1px; }
  .mg .tr { max-width: none; }
}
@container tbl (max-width: ${compactBelow}px) {
  .ev tbody tr:not(.det) { grid-template-columns: 62px minmax(0, 1fr) minmax(0, 1fr); grid-template-areas: "role name name" ". desc desc" ". res chg" ". mg st" ". act act"; }
}`;
    const cardStyle = document.createElement('style');
    cardStyle.textContent = cardCss;
    document.head.insertBefore(cardStyle, document.head.querySelector('style'));


    let sortMode = 'result';            // result (worst → best, ends at the best design) | input
    let open = new Set();               // expanded detail rows
    let frozen = false, cache = null;   // keep row order stable while a number is being typed
    let approachOpen = false, undoMsg = '', undoT = null;
    let custom = {};                    // caseKey -> manually edited conclusion HTML
    let extra = {};                     // caseKey -> [{id, text}] free remarks
    let tableTitles = {};               // caseKey -> optional evidence table title
    let seq = 0;
    let last = null, rendering = false, pointerDown = false, resortT = null, resizeT = null, lastW = 0;

    function drawChart() {
      const box = document.getElementById('chartbox'); if (!box || !last) return;
      lastW = Math.round(box.clientWidth);
      const W = Math.max(300, Math.min(1000, lastW || 960));
      box.innerHTML = chartSvg(last.ev, last.rows, W);
    }
    function maybeRedraw() { const box = document.getElementById('chartbox'); if (box && Math.round(box.clientWidth) !== lastW) drawChart(); }
    window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(maybeRedraw, 60); });
    if (window.ResizeObserver) new ResizeObserver(() => { clearTimeout(resizeT); resizeT = setTimeout(maybeRedraw, 60); }).observe(document.body);
    window.addEventListener('pointerdown', () => { pointerDown = true; }, true);
    window.addEventListener('pointerup', () => { pointerDown = false; }, true);
    // Re-sort rows only once editing is finished: never while typing, tabbing between results, or mid-click.
    function resortSoon() {
      clearTimeout(resortT);
      resortT = setTimeout(function tick() {
        const ae = document.activeElement;
        if (pointerDown || (ae && ae.matches && ae.matches('input[data-act="val"]'))) { resortT = setTimeout(tick, 150); return; }
        C.emit();
      }, 220);
    }

    const kk = () => C.caseKey();
    const sgn = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±');
    const fmtM = (m, u) => `${m >= 0 ? '+' : '−'}${C.fmt(Math.abs(m))} ${u}`;

    // ---------- written finding / conclusion (same rules as the table; regenerated from live data) ----------
    function narrative(ev, withRanking) {
      const u = ev.unit, b = ev.baseline, bd = ev.bestDesign, lower = ev.direction === 'lower';
      if (!bd || !b || b.value === null) return 'Enter a baseline result and at least one design result to generate the finding.';
      const metric = E(ev.metric.name.toLowerCase());
      let s;
      if (ev.best && !ev.best.isBaseline) {
        s = `<b>${E(bd.name)}</b> gives the ${lower ? 'lowest' : 'highest'} ${metric}, <b>${C.fmt(bd.value)} ${E(u)}</b>, which is <b>${C.fmtPct(bd.deltaPct)} ${bd.better ? 'better' : 'worse'}</b> than the baseline <b>${E(b.name)} (${C.fmt(b.value)} ${E(u)})</b>.`;
      } else {
        s = `No design variant improves on the baseline <b>${E(b.name)} (${C.fmt(b.value)} ${E(u)})</b>; the closest is <b>${E(bd.name)}</b> at <b>${C.fmt(bd.value)} ${E(u)}</b>.`;
      }
      if (ev.refValue !== null && ev.designCount > 0) {
        const refn = E((ev.ref.name || 'reference').toLowerCase());
        const fails = ev.designs.filter((r) => r.pass === false).map((r) => E(r.name));
        const n = ev.designCount, lim = `<b>${C.fmt(ev.refValue)} ${E(u)}</b>`;
        if (ev.passCount === n) s += ` All ${n} design variant${n === 1 ? '' : 's'} satisfy the ${refn} criterion of ${lim}`;
        else if (ev.passCount === 0) s += ` No design variant satisfies the ${refn} criterion of ${lim}`;
        else s += ` ${fails.length > 1 ? fails.slice(0, -1).join(', ') + ' and ' + fails[fails.length - 1] : fails[0]} ${fails.length === 1 ? 'does' : 'do'} not satisfy the ${refn} criterion of ${lim}`;
        s += b.pass === false ? `, whereas the baseline ${lower ? 'exceeds' : 'falls short of'} it by <b>${C.fmtPct(Math.abs(b.marginPct))}</b>.` : '.';
      }
      if (withRanking) {
        const r = ev.designs.filter((x) => x.rank !== null).sort((x, y) => x.rank - y.rank).map((x) => E(x.letter));
        if (r.length > 1) s += ` Ranking of variants: ${r.join(' &gt; ')}.`;
      }
      return s;
    }

    function orderedRows(ev) {
      const lower = ev.direction === 'lower';
      let ds = ev.designs.slice();
      if (sortMode === 'result') {
        const key = (r) => (r.value === null ? Infinity : lower ? -r.value : r.value);   // worst first, best last, empty at the end
        ds.sort((a, b) => key(a) - key(b));
        if (frozen && cache) {
          const idx = new Map(cache.map((id, i) => [id, i]));
          ds.sort((a, b) => (idx.has(a.id) ? idx.get(a.id) : 1e9) - (idx.has(b.id) ? idx.get(b.id) : 1e9));
        }
      }
      const out = [ev.baseline].concat(ds).filter(Boolean);
      cache = out.filter((r) => !r.isBaseline).map((r) => r.id);
      return out;
    }

    // ---------- chart (SVG, so it can be copied into a report as an image) ----------
    function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
    function barFill(r, rows, P) {
      const mids = rows.filter((q) => !q.isBaseline && !q.isBest), mi = mids.indexOf(r);
      return r.isBaseline ? P.base : r.isBest ? P.best : (mi <= 0 ? P.pass1 : P.pass2);
    }
    function chartSvg(ev, rows, W, P) {
      P = P || pal;
      const u = ev.unit, narrow = W < 640, padL = narrow ? 118 : 176, padR = narrow ? 54 : 70, pitch = 44, barH = 22, axisH = 52;
      const title = (tableTitles[kk()] || '').trim().replace(/\s+/g, ' ');
      const titleLines = [];
      if (title) {
        const chars = Array.from(title), maxChars = Math.max(15, Math.floor((W - 40) / 12));
        for (let i = 0; i < chars.length;) {
          let end = Math.min(chars.length, i + maxChars);
          if (end < chars.length) {
            let split = end;
            while (split > i && chars[split] !== ' ') split--;
            if (split > i) end = split;
          }
          const text = chars.slice(i, end).join('').trim();
          if (text) titleLines.push(text);
          i = end;
          while (chars[i] === ' ') i++;
        }
      }
      // Keep the title inside the SVG, centered above the bars and acceptance-limit label.
      const top = 44 + (titleLines.length ? 42 + (titleLines.length - 1) * 28 : 0);
      const H = top + rows.length * pitch + axisH;
      const vals = rows.map((r) => r.value ?? 0).concat(ev.refValue !== null ? [ev.refValue] : []);
      const step = niceStep((Math.max(...vals, 1e-9) * 1.12) / 7), max = Math.ceil((Math.max(...vals, 1e-9) * 1.08) / step) * step;
      const x = (v) => padL + (v / max) * (W - padL - padR);
      const y0 = top, y1 = top + rows.length * pitch;
      let g = `<rect width="${W}" height="${H}" fill="${P.bg}"/>`;
      if (titleLines.length) {
        g += `<g role="presentation" data-role="svg-chart-title" fill="${P.ink}" font-size="20" font-weight="700" text-anchor="middle">`;
        titleLines.forEach((line, i) => { g += `<text x="${W / 2}" y="${30 + i * 28}">${E(line)}</text>`; });
        g += '</g>';
      }
      for (let t = 0; t <= max + 1e-9; t += step) {
        g += `<line x1="${x(t)}" x2="${x(t)}" y1="${y0 - 6}" y2="${y1}" stroke="${P.grid}" stroke-width="1"/>`;
        g += `<text x="${x(t)}" y="${y1 + 20}" font-size="13" text-anchor="middle" fill="${P.tick}">${C.fmt(+t.toFixed(6))}</text>`;
      }
      g += `<line x1="${padL}" x2="${W - padR}" y1="${y1}" y2="${y1}" stroke="${P.axis}" stroke-width="1.2"/><line x1="${padL}" x2="${padL}" y1="${y0 - 6}" y2="${y1}" stroke="${P.axis}" stroke-width="1.2"/>`;
      rows.forEach((r, i) => {
        const cy = top + i * pitch + pitch / 2, by = cy - barH / 2;
        const lim = narrow ? 13 : 20, nm = r.name.length > lim ? r.name.slice(0, lim - 1) + '…' : r.name;
        g += `<text x="${padL - 12}" y="${cy + 5}" font-size="${narrow ? 14 : 16}" text-anchor="end" fill="${P.ink}">${E(nm)}</text>`;
        if (r.value !== null) {
          const fill = barFill(r, rows, P);
          const failed = r.pass === false, recommended = r.isBest && !r.isBaseline && r.pass !== false;
          const vx = x(r.value) + 12, vw = String(C.fmt(r.value)).length * 10.4;
          g += `<rect x="${padL}" y="${by}" width="${Math.max(1, x(r.value) - padL)}" height="${barH}" fill="${fill}"/>`;
          g += `<text x="${vx}" y="${cy + 6}" font-size="18" font-weight="700" fill="${failed ? P.fail : P.ink}">${C.fmt(r.value)}</text>`;
          if (failed) g += `<text x="${vx + vw + 10}" y="${cy + 5.5}" font-size="14" font-weight="700" fill="${P.fail}" stroke="${P.bg}" stroke-width="5" stroke-linejoin="round" paint-order="stroke">${narrow ? '×' : '× FAIL'}</text>`;
          if (recommended) g += `<text x="${vx + vw + 10}" y="${cy + 5.5}" font-size="14" font-weight="600" fill="${P.rec}" stroke="${P.bg}" stroke-width="5" stroke-linejoin="round" paint-order="stroke">${narrow ? '✓' : '✓ Recommended'}</text>`;
        }
      });
      if (ev.refValue !== null) {
        g += `<line x1="${x(ev.refValue)}" x2="${x(ev.refValue)}" y1="${y0 - 10}" y2="${y1}" stroke="${P.ref}" stroke-width="2.8" stroke-dasharray="7 5"/>`;
        const rEnd = x(ev.refValue) > W - 120;
        g += `<text x="${rEnd ? Math.min(x(ev.refValue) + 6, W - 6) : x(ev.refValue)}" y="${y0 - 18}" font-size="15" font-weight="700" text-anchor="${rEnd ? 'end' : 'middle'}" fill="${P.refText}">${E(ev.ref.name)} = ${C.fmt(ev.refValue)} ${E(u)}</text>`;
      }
      g += `<text x="${(padL + W - padR) / 2}" y="${H - 8}" font-size="14" text-anchor="middle" fill="${P.title}">${E(ev.metric.name)} (${E(u)})</text>`;
      return `<svg id="chart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="'Source Sans 3','Segoe UI',Arial,sans-serif" role="img" aria-label="Horizontal bar chart of ${E(ev.metric.name)} per design against ${E(ev.ref.name)}">${g}</svg>`;
    }

    function remarkItems(ev) {
      const items = ev.rows.filter((r) => r.isBaseline).concat(ev.rows.filter((r) => !r.isBaseline)).map((r) => ({ id: r.id, who: r.isBaseline ? 'Baseline' : r.tag, text: r.note, v: true }));
      (extra[kk()] || []).forEach((x) => items.push({ id: x.id, who: 'Remark', text: x.text, v: false }));
      return items;
    }
    const badgeHTML = (isCustom) => (isCustom
      ? `Edited manually — no longer follows the table. <button data-act="regen">Regenerate</button>`
      : `Auto-generated from the table · type here to edit`);

    // ---------- render: build named parts, let the version arrange them ----------
    function render() {
      const s = C.state, ev = C.evaluate(), u = ev.unit, lower = ev.direction === 'lower', b = ev.baseline, bd = ev.bestDesign;
      const rows = orderedRows(ev);
      const designRank = {}; ev.designs.filter((r) => r.rank !== null).sort((a, c) => a.rank - c.rank).forEach((r, i) => (designRank[r.id] = i + 1));
      const maxM = Math.max(1e-9, ...ev.rows.map((r) => (r.margin === null ? 0 : Math.abs(r.margin))));
      const arrow = (r, px) => (r.delta < 0 ? I('down', px) : r.delta > 0 ? I('up', px) : '');

      const anOpts = s.analyses.map((a) => `<option ${a === s.current.analysis ? 'selected' : ''}>${E(a)}</option>`).join('');
      const meOpts = s.metrics.map((m) => `<option value="${m.key}" ${m.key === s.current.metric ? 'selected' : ''}>${E(m.name || 'Blank / Custom')}</option>`).join('');
      const metricDef = C.metricByKey(s.current.metric);
      const customUnitActive = metricDef.customUnit === true || !!(u && !UNITS.includes(u));
      const unOpts = ['', ...UNITS].map((x) => `<option value="${E(x)}" ${!customUnitActive && x === u ? 'selected' : ''}>${E(x || 'No unit')}</option>`).join('') +
        `<option value="__custom__" ${customUnitActive ? 'selected' : ''}>Custom / type a unit…</option>`;
      const blOpts = ev.rows.map((r) => `<option value="${r.id}" ${r.isBaseline ? 'selected' : ''}>${E(r.name)}</option>`).join('');

      // header parts
      const brand = `<div class="brand"><span class="tag">CONCEPT</span><div><h1>CAE Simulation Result Comparator</h1><p class="sub">Compare CAE design variants and generate report-ready summaries</p></div></div>`;
      const tools = `<div class="tools noprint"><span class="pill">Example: Bracket</span><button class="tlink" data-act="reset">Reset example</button>
        <button class="tlink" data-act="approach" aria-expanded="${approachOpen}">${I('chevRight', 13)}Design approach</button></div>`;
      const approach = approachOpen ? `<div class="approach noprint" role="note">${(cfg.approach || []).map((x) => `<div><b>${E(x.h)}</b>${E(x.p)}</div>`).join('')}</div>` : '';

      // setup fields
      const field = {
        analysis: `<label class="fld an"><span>Analysis</span><select data-act="analysis">${anOpts}</select></label>`,
        metric: `<label class="fld me"><span>Metric</span><select data-act="metric">${meOpts}</select>${C.metricByKey(s.current.metric).custom ? `<input style="margin-top:8px" data-k="metricname" data-act="metricname" value="${E(C.metricByKey(s.current.metric).name)}" placeholder="Enter metric name" aria-label="Custom metric name">` : ''}</label>`,
        unit: `<label class="fld un"><span>Unit</span><select data-act="unit">${unOpts}</select>${customUnitActive ? `<input style="margin-top:8px" data-k="customunit" data-act="customunit" value="${E(u)}" placeholder="e.g. mm/s², G, N/mm" aria-label="Enter custom unit" autocomplete="off">` : ""}</label>`,
        reference: `<label class="fld rf"><span>Engineering reference</span><input data-k="rn" data-act="refname" value="${E(ev.ref.name)}" placeholder="e.g. Yield Stress"></label>`,
        limit: `<label class="fld lm"><span>Limit (${E(u)})</span><input class="mono-n" data-k="rv" data-act="refval" inputmode="decimal" value="${Number.isFinite(ev.ref.value) ? ev.ref.value : ''}" placeholder="none" title="Leave empty to hide the limit"></label>`,
        direction: `<label class="fld dr"><span>Preferred direction</span><select data-act="dir"><option value="lower" ${lower ? 'selected' : ''}>Lower is better</option><option value="higher" ${!lower ? 'selected' : ''}>Higher is better</option></select></label>`,
        baseline: `<label class="fld bl"><span>Baseline</span><select data-act="baseline">${blOpts}</select></label>`,
        print: `<div class="fld pr noprint"><span aria-hidden="true">&nbsp;</span><button class="btn pri" data-act="print">${I('print', 17)}Print / Save PDF</button></div>`,
      };

      // 01 finding
      const mg = bd ? bd.margin : null;
      const titleInner = bd ? (ev.best && !ev.best.isBaseline ? `${E(bd.name)} <small>(${E(bd.tag)})</small>` : `No improvement <small>(closest: ${E(bd.name)})</small>`) : '—';
      const find = {
        title: `<h3 class="ftitle">${titleInner}</h3>`,
        status: `<p class="cstat noprint" data-role="cbadge">${badgeHTML(custom[kk()] !== undefined)}</p>`,
        text: `<div class="ctext" id="concl" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Engineering finding and conclusion, editable" spellcheck="false">${custom[kk()] !== undefined ? custom[kk()] : narrative(ev, true)}</div>`,
        copy: `<button class="btn sm copy noprint" data-act="copyconcl">${I('copy', 14)}<span>Copy to report</span></button>`,
      };
      const kpi = {
        result: `<div class="kpi k-result"><span class="kl">Result (${E(ev.metric.name)})</span>
          <span class="kv num">${bd ? C.fmt(bd.value) : '—'}<small>${E(u)}</small></span>
          ${bd && bd.pass !== null ? `<span class="badge ${bd.pass ? 'p' : 'f'}">${I(bd.pass ? 'check' : 'x', 14)}${bd.pass ? 'PASS' : 'FAIL'}</span>` : '<span class="badge n">NO LIMIT</span>'}</div>`,
        improvement: `<div class="kpi k-imp"><span class="kl">Improvement vs baseline</span>
          <span class="kv mid num ${bd && bd.better ? 'g' : bd && bd.worse ? 'w' : ''}">${bd && bd.deltaPct !== null ? `${arrow(bd, 28)}<span>${C.fmtPct(bd.deltaPct)}</span>` : '—'}</span>
          <span class="ks">${bd && b && bd.deltaPct !== null ? `${bd.delta < 0 ? 'lower' : bd.delta > 0 ? 'higher' : 'equal'} than ${C.fmt(b.value)} ${E(u)}` : ''}</span></div>`,
        margin: `<div class="kpi k-mar"><span class="kl">Reference margin</span>
          <span class="kv small-v num">${mg !== null ? fmtM(mg, '').trim() : '—'}<small>${mg !== null ? E(u) : ''}</small></span>
          <span class="ks">${mg !== null ? `${mg >= 0 ? 'to' : 'over'} ${E(ev.ref.name)} (${C.fmt(ev.refValue)} ${E(u)})` : 'no limit set'}</span></div>`,
      };
      kpi.row = `<div class="kpis">${kpi.result}${kpi.improvement}${kpi.margin}</div>`;

      // 02 evidence
      const tableTitle = (tableTitles[kk()] || '').trim();
      const body = rows.map((r) => {
        const chg = r.isBaseline ? `<span class="chg z">—</span><span class="chg-s">Reference design</span>`
          : r.deltaPct === null ? `<span class="chg z">—</span>`
          : `<span class="chg ${r.better ? 'g' : r.worse ? 'w' : 'z'}">${arrow(r, 14)}${C.fmtPct(r.deltaPct)}</span><span class="chg-s">(${sgn(r.delta)}${C.fmt(Math.abs(r.delta))} ${E(u)})</span>`;
        const mgn = r.margin === null ? '<span class="chg z">—</span>'
          : `<div class="mg"><b>${fmtM(r.margin, E(u))}</b><div class="tr" aria-hidden="true"><i class="${r.pass ? 'p' : 'f'}" style="width:${Math.max(3, (Math.abs(r.margin) / maxM) * 100)}%"></i></div></div>`;
        const st = r.pass === null ? '<span class="badge sm n">—</span>' : `<span class="badge sm ${r.pass ? 'p' : 'f'}">${I(r.pass ? 'check' : 'x', 12)}${r.pass ? 'PASS' : 'FAIL'}</span>`;
        const isOpen = open.has(r.id);
        const det = isOpen ? `<tr class="det"><td colspan="8"><dl>
            <div><dt>Utilisation of limit</dt><dd class="num">${r.util === null ? '—' : C.fmt(r.util * 100) + '%'}</dd></div>
            <div><dt>Margin to limit</dt><dd class="num">${r.marginPct === null ? '—' : (r.marginPct >= 0 ? '+' : '−') + C.fmtPct(Math.abs(r.marginPct))}</dd></div>
            <div><dt>Δ vs baseline</dt><dd class="num">${r.delta === null ? '—' : `${sgn(r.delta)}${C.fmt(Math.abs(r.delta))} ${E(u)}`}</dd></div>
            <div><dt>Rank among variants</dt><dd class="num">${r.isBaseline ? 'baseline' : designRank[r.id] ? `${designRank[r.id]} of ${ev.designs.length}` : '—'}</dd></div></dl></td></tr>` : '';
        return `
        <tr class="${r.isBaseline ? 'base' : ''} ${r.isBest && !r.isBaseline ? 'best' : ''} ${r.pass === false ? 'nok' : ''}">
          <td><span class="role ${r.isBaseline ? 'b' : ''}">${r.isBaseline ? 'BASE' : '#' + (designRank[r.id] ?? '–')}${r.isBest && !r.isBaseline ? '<i>best</i>' : ''}</span></td>
          <td><input class="ti nm" data-k="n:${r.id}" data-act="name" data-id="${r.id}" value="${E(r.name)}" aria-label="Design name"><span class="subl">${r.isBaseline ? 'Comparison baseline' : E(r.tag)}</span></td>
          <td data-l="Description"><input class="ti ds" data-k="d:${r.id}" data-act="note" data-id="${r.id}" value="${E(r.note)}" placeholder="add description…" aria-label="${E(r.name)} description"></td>
          <td class="r" data-l="Result (${E(u)})"><input class="ti rv" data-k="v:${r.id}" data-act="val" data-id="${r.id}" inputmode="decimal" value="${r.value === null ? '' : r.value}" placeholder="—" aria-label="${E(r.name)} result in ${E(u)}"></td>
          <td data-l="Change vs baseline">${chg}</td><td data-l="Reference margin">${mgn}</td><td data-l="State">${st}</td>
          <td class="act"><div class="acts">${r.isBaseline ? '<span>Baseline</span>' : `<button data-act="base" data-id="${r.id}">Use as baseline</button>`}
            <button data-act="det" data-id="${r.id}" aria-expanded="${isOpen}">Details</button>
            ${r.isBaseline ? '' : `<button class="d" data-act="rm" data-id="${r.id}" aria-label="Remove ${E(r.name)}">Remove</button>`}</div></td>
        </tr>${det}`;
      }).join('');
      const evid = {
        sort: `<div class="seg noprint" role="group" aria-label="Row order"><button data-act="sort" data-v="result" aria-pressed="${sortMode === 'result'}">By result</button><button data-act="sort" data-v="input" aria-pressed="${sortMode === 'input'}">Input order</button></div><button class="btn sm noprint" data-act="copytable">${I('copy', 14)}<span>Copy table</span></button>`,
        add: `<button class="btn noprint" data-act="add">${I('plus', 15)}Add design variant</button>`,
        table: `<div class="ev-title-editor noprint"><label for="evidence-table-title">Table title <span>(optional)</span></label><input id="evidence-table-title" data-k="tabletitle" data-act="tabletitle" type="text" autocomplete="off" placeholder="e.g. Rail tensile comparison" value="${E(tableTitles[kk()] || '')}" aria-label="Optional table title"></div>
        <h3 class="ev-table-title" data-role="table-title-preview" ${tableTitle ? '' : 'hidden'}>${E(tableTitle)}</h3>
        <div class="tw"><div class="twi"><table class="ev"><thead><tr>
          <th>Role / rank</th><th>Design</th><th>Description</th><th class="r">Result<small>(${E(u)})</small></th><th>Change vs baseline</th><th>Reference margin<small>(to ${E(ev.refValue !== null ? C.fmt(ev.refValue) + ' ' + u : 'limit')})</small></th><th>State</th><th class="act">Actions</th>
        </tr></thead><tbody>${body}</tbody></table></div></div>`,
      };

      // 03 chart
      const legendItems = rows.map((r) => `<li><span class="sw" style="background:${barFill(r, rows, pal)}"></span><span class="t">${E(r.name)} (${C.fmt(r.value)} ${E(u)})</span></li>`).join('');
      const pf = {
        copy: `<button class="btn sm noprint" data-act="copychart">${I('copy', 14)}<span>Copy chart (PNG)</span></button>`,
        chart: `<div class="chartbox" id="chartbox"></div>`,
        legend: `<aside class="legend"><p><b>Acceptance:</b> ${E(ev.metric.name)} ${ev.refValue !== null ? `${lower ? '≤' : '≥'} ${C.fmt(ev.refValue)} ${E(u)} (${E(ev.ref.name)})` : '— no limit set'}. ${lower ? 'Lower' : 'Higher'} values are better.</p>
          <ul>${ev.refValue !== null ? `<li><span class="ln"></span><span class="t">${E(ev.ref.name)} (${C.fmt(ev.refValue)} ${E(u)})</span></li>` : ''}${legendItems}</ul></aside>`,
        hint: `${E(ev.metric.name)} (${E(u)}) · zero-based shared scale`,
      };

      // 04 remarks
      const items = remarkItems(ev);
      const rm = {
        copy: `<button class="btn sm copy noprint" data-act="copyrem">${I('copy', 14)}<span>Copy to report</span></button>`,
        list: `<ol class="rl" id="rl">${items.map((it, i) => `<li><span class="no">(${i + 1})</span><span class="who">${E(it.who)}</span>
          <input data-k="r:${it.id}" data-act="${it.v ? 'note' : 'xrem'}" data-id="${it.id}" value="${E(it.text)}" placeholder="add remark…" aria-label="${E(it.who)} remark">
          ${it.v ? '<span></span>' : `<button class="x noprint" data-act="xrm" data-id="${it.id}" aria-label="Delete remark">${I('x', 14)}</button>`}</li>`).join('')}</ol>`,
        add: `<button class="addrem noprint" data-act="addrem">${I('plus', 13)}Add remark</button>`,
      };

      const toast = undoMsg ? `<div class="toast noprint" role="status">${E(undoMsg)}<button data-act="undo">${I('undo', 13)}Undo</button></div>` : '';

      const parts = {
        name: { find: 'Engineering finding', evidence: 'Supporting evidence', profile: 'Measurement profile', remarks: 'Remarks' },
        hint: { evidence: 'Result and improvement stay editable in the report.', profile: pf.hint },
        brand, tools, approach, field, find, kpi, ev: evid, pf, rm, toast,
      };

      const sy = window.scrollY;
      last = { ev, rows }; rendering = true;
      try { C.preserveFocus(() => { app.innerHTML = cfg.compose(parts); }); } finally { rendering = false; }
      drawChart();
      if (Math.abs(window.scrollY - sy) > 1) window.scrollTo(0, sy);
    }

    // ---------- clipboard helpers ----------
    async function copyRich(html, text) {
      try {
        if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
          await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
          return true;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
      } catch (e) { /* fall through */ }
      const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; } ta.remove(); return ok;
    }
    function flashBtn(btn, ok, label) {
      const span = btn.querySelector('span'); if (!span) return; const old = label;
      span.textContent = ok ? 'Copied' : 'Copy failed'; btn.disabled = true;
      setTimeout(() => { span.textContent = old; btn.disabled = false; }, 1600);
    }
    async function chartPng() {
      const svg = document.getElementById('chart'); const vb = svg.viewBox.baseVal;
      const exportSvg = svg.cloneNode(true);
      const plate = exportSvg.querySelector('rect'); if (plate) plate.setAttribute('fill', '#ffffff');
      const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(exportSvg));
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
      // Export the exact SVG contents, including its centered title, without a second heading.
      const c = document.createElement('canvas'); c.width = vb.width * 2; c.height = vb.height * 2;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return new Promise((res) => c.toBlob(res, 'image/png'));
    }

    // ---------- events ----------
    function typing(fn) { frozen = true; try { fn(); } finally { frozen = false; } }
    app.addEventListener('input', (e) => {
      if (rendering) return;
      const el = e.target, a = el.dataset.act, id = el.dataset.id;
      if (el.id === 'concl') {
        const k = kk(); if (el.innerText.trim() === '') delete custom[k]; else custom[k] = el.innerHTML;
        const bdg = app.querySelector('[data-role="cbadge"]'); if (bdg) bdg.innerHTML = badgeHTML(custom[k] !== undefined);
        return;
      }
      if (a === 'name') typing(() => C.setName(id, el.value));
      else if (a === 'note') typing(() => C.setNote(id, el.value));
      else if (a === 'val') typing(() => C.setValue(id, el.value));
      else if (a === 'metricname') typing(() => { C.metricByKey(C.state.current.metric).name = el.value; C.emit(); });
      else if (a === 'customunit') typing(() => {
        const met = C.metricByKey(C.state.current.metric);
        met.customUnit = true; met.unit = el.value; met.customUnitText = el.value; C.emit();
      });
      else if (a === 'tabletitle') {
        tableTitles[kk()] = el.value;
        const preview = app.querySelector('[data-role="table-title-preview"]');
        if (preview) { preview.textContent = el.value.trim(); preview.hidden = !el.value.trim(); }
        drawChart();
      }
      else if (a === 'refname') typing(() => C.setRef({ name: el.value }));
      else if (a === 'refval') typing(() => C.setRef({ value: el.value }));
      else if (a === 'xrem') { const x = (extra[kk()] || []).find((y) => y.id === id); if (x) x.text = el.value; }
    });
    app.addEventListener('change', (e) => {
      if (rendering) return;
      const el = e.target, a = el.dataset.act;
      if (a === 'analysis') C.setAnalysis(el.value);
      else if (a === 'metric') C.setMetric(el.value);
      else if (a === 'unit') {
        const met = C.metricByKey(C.state.current.metric);
        if (el.value === '__custom__') {
          met.customUnit = true; met.unit = met.customUnitText || ''; C.emit();
          const input = app.querySelector('[data-act="customunit"]'); if (input) input.focus();
        } else {
          if (met.customUnit || (met.unit && !UNITS.includes(met.unit))) met.customUnitText = met.unit;
          met.customUnit = false; met.unit = el.value; C.emit();
        }
      }
      else if (a === 'dir') C.setDirection(el.value);
      else if (a === 'baseline') C.setBaseline(el.value);
    });
    app.addEventListener('focusout', (e) => {
      if (rendering || !e.target.dataset || e.target.dataset.act !== 'val') return;
      resortSoon();
    });
    app.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur();
      if (e.key === 'Escape' && e.target.id === 'concl') e.target.blur();
    });
    app.addEventListener('paste', (e) => {
      if (e.target.id !== 'concl') return;             // keep pasted text plain inside the conclusion
      e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
    });
    app.addEventListener('click', async (e) => {
      const el = e.target.closest('[data-act]'); if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
      const a = el.dataset.act, id = el.dataset.id;
      if (a === 'print') window.print();
      else if (a === 'reset') { custom = {}; extra = {}; tableTitles = {}; open = new Set(); undoMsg = ''; C.reset(); }
      else if (a === 'approach') { approachOpen = !approachOpen; render(); }
      else if (a === 'sort') { sortMode = el.dataset.v; render(); }
      else if (a === 'base') C.setBaseline(id);
      else if (a === 'det') { open.has(id) ? open.delete(id) : open.add(id); render(); }
      else if (a === 'add') { const nid = C.addVariant({}); const n = document.querySelector(`[data-k="n:${nid}"]`); if (n) { n.focus(); n.select(); n.scrollIntoView({ block: 'nearest' }); } }
      else if (a === 'rm') { const v = C.state.variants.find((x) => x.id === id); undoMsg = `Removed “${v ? v.name : ''}”`; clearTimeout(undoT); undoT = setTimeout(() => { undoMsg = ''; render(); }, 5000); C.removeVariant(id); }
      else if (a === 'undo') { undoMsg = ''; C.undo(); }
      else if (a === 'regen') { delete custom[kk()]; render(); }
      else if (a === 'addrem') { const k = kk(); (extra[k] = extra[k] || []).push({ id: 'x' + ++seq, text: '' }); render(); const inp = [...document.querySelectorAll('#rl input')].pop(); if (inp) inp.focus(); }
      else if (a === 'xrm') { const k = kk(); extra[k] = (extra[k] || []).filter((x) => x.id !== id); render(); }
      else if (a === 'copytable') {
        const ev = C.evaluate(), dataRows = last ? last.rows : orderedRows(ev);
        const headers = ['Role', 'Design', 'Description', 'Result' + (ev.unit ? ' (' + ev.unit + ')' : ''), 'Change vs baseline', 'Reference margin', 'State'];
        const values = dataRows.map((r) => [
          r.isBaseline ? 'BASE' : r.tag, r.name, r.note || '', C.fmt(r.value),
          r.deltaPct === null ? '—' : C.fmtPct(r.deltaPct, { signed: true }),
          r.margin === null ? '—' : (r.margin >= 0 ? '+' : '−') + C.fmt(Math.abs(r.margin)),
          r.pass === null ? '—' : (r.pass ? 'PASS' : 'FAIL'),
        ]);
        const cellStyle = 'background-color:#ffffff!important;color:#111111;border:1px solid #cccccc;padding:7px 10px;text-align:left;';
        const cells = (items, tag) => '<tr>' + items.map((x) => '<' + tag + ' style="' + cellStyle + '">' + E(x) + '</' + tag + '>').join('') + '</tr>';
        const tableTitle = (tableTitles[kk()] || '').trim();
        const caption = tableTitle ? '<caption style="caption-side:top;text-align:left;background-color:#ffffff;color:#111111;font-size:18px;font-weight:700;padding:10px 0;">' + E(tableTitle) + '</caption>' : '';
        const html = '<table style="border-collapse:collapse;background-color:#ffffff;color:#111111;">' + caption + cells(headers, 'th') + values.map((row) => cells(row, 'td')).join('') + '</table>';
        const plain = (tableTitle ? tableTitle + '\n' : '') + [headers, ...values].map((row) => row.join('\t')).join('\n');
        flashBtn(el, await copyRich(html, plain), 'Copy table');
      }
      else if (a === 'copyconcl') { const d = document.getElementById('concl'); flashBtn(el, await copyRich(`<p>${d.innerHTML}</p>`, d.innerText.trim()), 'Copy to report'); }
      else if (a === 'copyrem') {
        const items = remarkItems(C.evaluate()).filter((it) => it.text.trim() || it.v);
        const text = items.map((it, i) => `(${i + 1}) ${it.who} — ${it.text}`).join('\n');
        const html = items.map((it, i) => `<p>(${i + 1}) <b>${E(it.who)}</b> — ${E(it.text)}</p>`).join('');
        flashBtn(el, await copyRich(html, text), 'Copy to report');
      }
      else if (a === 'copychart') {
        const span = el.querySelector('span');
        try {
          const blob = await chartPng();
          if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); flashBtn(el, true, 'Copy chart (PNG)'); }
          else throw new Error('no image clipboard');
        } catch (err) {
          try { const blob = await chartPng(); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'measurement-profile.png'; link.click(); span.textContent = 'Saved as PNG'; setTimeout(() => (span.textContent = 'Copy chart (PNG)'), 1800); }
          catch (e2) { flashBtn(el, false, 'Copy chart (PNG)'); }
        }
      }
    });

    // test hook: the chart for the current data at a given width, optionally with another palette
    window.ReportApp.chartFor = (W, palette) => chartSvg(last.ev, last.rows, W, palette ? Object.assign({}, DEFAULT_CHART, palette) : pal);
    C.subscribe(render);
  }

  window.ReportApp = { mount, DEFAULT_CHART };
})();
