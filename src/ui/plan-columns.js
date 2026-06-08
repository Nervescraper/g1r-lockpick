// Decide how many columns the Full Plan list should use. The plan reads as a single
// column whenever it already fits the height the modal can give it. When it's taller
// than that — the browser is short — it spills into the fewest columns that bring each
// column back within the height, but never more than fit across the viewport's width.
// So: wide-but-short → multiple columns; tall-enough or narrow → one column.
export function planColumnCount({ naturalHeight, availHeight, colWidth, availWidth, gap = 32 }) {
  if (!(naturalHeight > availHeight + 1)) return 1; // already fits one column
  if (!(colWidth > 0) || !(availWidth > 0)) return 1; // nothing measurable to split
  // How many columns of colWidth (with gaps between them) fit the available width.
  const fitWide = Math.max(1, Math.floor((availWidth + gap) / (colWidth + gap)));
  const needed = Math.ceil(naturalHeight / availHeight);
  return Math.max(1, Math.min(needed, fitWide));
}
