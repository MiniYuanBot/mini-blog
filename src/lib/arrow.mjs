/** Shared SVG geometry for Astro links and build-time Markdown footnotes. */
export const arrowGeometry = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  strokeWidth: 1.75,
  shaft: { x1: 4, y1: 12, x2: 18, y2: 12 },
  head: '12 6 18 12 12 18',
};

export const arrowRotation = { right: 0, left: 180, up: -90, down: 90, 'up-right': -45 };

/**
 * @param {keyof typeof arrowRotation} direction
 * @returns {import('hast').Element}
 */
export function arrowHast(direction) {
  return {
    type: 'element',
    tagName: 'svg',
    properties: {
      className: ['arrow-icon'],
      dataArrowDirection: direction,
      xmlns: 'http://www.w3.org/2000/svg',
      width: arrowGeometry.width,
      height: arrowGeometry.height,
      viewBox: arrowGeometry.viewBox,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: arrowGeometry.strokeWidth,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      ariaHidden: 'true',
      focusable: 'false',
    },
    children: [{
      type: 'element',
      tagName: 'g',
      properties: { transform: `rotate(${arrowRotation[direction]} 12 12)` },
      children: [
        { type: 'element', tagName: 'line', properties: { className: ['arrow-shaft'], ...arrowGeometry.shaft }, children: [] },
        { type: 'element', tagName: 'polyline', properties: { className: ['arrow-head'], points: arrowGeometry.head }, children: [] },
      ],
    }],
  };
}

/** Preserve remark's reference labels and repeated-reference numbering while
 * replacing only its generated decorative return glyph.
 * @param {number} _referenceIndex
 * @param {number} rereferenceIndex
 * @returns {import('hast').ElementContent[]}
 */
export function footnoteBackContent(_referenceIndex, rereferenceIndex) {
  return [
    arrowHast('up'),
    ...(rereferenceIndex > 1 ? [{
      type: /** @type {const} */ ('element'),
      tagName: 'sup',
      properties: {},
      children: [{ type: /** @type {const} */ ('text'), value: String(rereferenceIndex) }],
    }] : []),
  ];
}
