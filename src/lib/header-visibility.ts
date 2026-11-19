/** Track distance from the last scroll extreme, so small reversals do not
 * flicker the header or cancel an otherwise deliberate upward gesture. */
export function createHeaderVisibility(initialY = 0) {
  let visible = true;
  let anchor = Math.max(0, initialY);

  return (scrollY: number, keepVisible = false) => {
    const y = Math.max(0, scrollY);
    if (keepVisible || y <= 120) {
      visible = true;
      anchor = y;
    } else if (visible) {
      anchor = Math.min(anchor, y);
      if (y - anchor >= 64) {
        visible = false;
        anchor = y;
      }
    } else {
      anchor = Math.max(anchor, y);
      if (anchor - y >= 40) {
        visible = true;
        anchor = y;
      }
    }
    return visible;
  };
}
