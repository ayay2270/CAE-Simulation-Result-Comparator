/* Chart colour polish per version: overrides only. Anything not listed keeps the chart's existing colour
   (ReportApp.DEFAULT_CHART). Geometry, labels, annotations, bar order and values are not touched. */
window.CHART_PALETTES = {
  // Swiss, hairline report: warm paper neutrals become true neutrals; the orange limit label is darkened to pass 4.5:1 on white.
  swissReport: { bg: '#ffffff', grid: '#ececee', axis: '#8e8e93', tick: '#6f6f76', ink: '#111111', title: '#4a4a4f', refText: '#b95a12' },
  // Swiss, drawing sheet: same neutrals, slightly firmer scale so it holds up inside a ruled cell.
  swissSheet: { bg: '#ffffff', grid: '#e2e2e6', axis: '#7c7c84', tick: '#5f5f66', ink: '#111111', title: '#3d3d44', refText: '#b95a12' },
  // Industrial: the chart stays a light exhibit plate on the dark page; neutral white plate, darker ticks.
  industrial: { bg: '#ffffff', grid: '#e6e6e6', axis: '#8a8a8a', tick: '#5e5e5e', ink: '#0b0c0a', title: '#3a3a3a', refText: '#b95a12' },
  // Organic: the plate takes the sand of its card, greys warm up to stone, greens lean olive, red leans terracotta.
  organic: { bg: '#e8dcc7', grid: '#d6c9b0', axis: '#8a8068', tick: '#5a553f', ink: '#2a281c', title: '#4a4632', base: '#8d8776', pass1: '#b9c58f', pass2: '#7ea28c', best: '#3f5f2c', fail: '#8e2f17', rec: '#3c5a2a', ref: '#d4691f', refText: '#9a4616' },
  // Brutalist: white plate, black ink, plain grey grid, red slightly stronger to sit beside the page's pure red.
  brutalist: { bg: '#ffffff', grid: '#e3e3e3', axis: '#444444', tick: '#444444', ink: '#000000', title: '#000000', fail: '#a8200f', refText: '#b95a12' },
};
