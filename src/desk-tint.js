// DESK theme: fill the change cells (%, bp) with green or red; a bigger move gives a stronger fill.
// Only sets a data attribute and a CSS variable; the colours live in styles.css, so other themes ignore it.
const CELL = /([+\-−]?\d+(?:\.\d+)?)\s*(%|bp)/;

function paint(root) {
  if (document.documentElement.dataset.theme !== 'desk') return;
  root.querySelectorAll('.tbl td.up, .tbl td.down').forEach((td) => {
    const m = CELL.exec(td.textContent);
    if (!m) return;
    const size = Math.abs(parseFloat(m[1].replace('−', '-'))) / (m[2] === 'bp' ? 20 : 3);
    td.dataset.tint = '1';
    td.style.setProperty('--tint', (0.1 + 0.5 * Math.min(1, size)).toFixed(2));
  });
}

export function startDeskTint(root) {
  let queued = false;
  const run = () => { queued = false; paint(root); };
  // watches only added/changed content (not attributes), so our own style changes cannot loop
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } })
    .observe(root, { childList: true, subtree: true, characterData: true });
  paint(root);
  return run;
}
