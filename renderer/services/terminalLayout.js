// Rectangles are stored in top-to-bottom, left-to-right tab order, independent
// of tab IDs so dragging tabs also reorders the panes.
export const readingOrder = (a, b) => a.y - b.y || a.x - b.x;

export function layoutRectangles(layout) {
  const count = layout.capacity || layout.columns * layout.rows;
  return Array.from({ length: count }, (_, index) => {
    const slot = layout.slots?.[index];
    const column = slot ? Number(slot.column.split(' / ')[0]) - 1 : index % layout.columns;
    const row = slot ? Number(slot.row.split(' / ')[0]) - 1 : Math.floor(index / layout.columns);
    const width = slot?.column.includes('span') ? Number(slot.column.split('span ')[1]) : 1;
    const height = slot?.row.includes('span') ? Number(slot.row.split('span ')[1]) : 1;
    return { x: column / layout.columns, y: row / layout.rows, width: width / layout.columns, height: height / layout.rows };
  });
}

export function rectangleGrid(rectangles) {
  const boundaries = (axis, size) => [...new Set([0, 1, ...rectangles.flatMap(rect => [rect[axis], rect[axis] + rect[size]])])].sort((a, b) => a - b);
  const columns = boundaries('x', 'width');
  const rows = boundaries('y', 'height');
  const tracks = points => points.slice(1).map((point, index) => `minmax(0, ${point - points[index]}fr)`).join(' ');
  return {
    columns: tracks(columns), rows: tracks(rows),
    slots: rectangles.map(rect => ({ column: `${columns.indexOf(rect.x) + 1} / ${columns.indexOf(rect.x + rect.width) + 1}`,
      row: `${rows.indexOf(rect.y) + 1} / ${rows.indexOf(rect.y + rect.height) + 1}` }))
  };
}
