export const MAX_RECENT = 5;
export const LARGE_FILE_BYTES = 2 * 1024 * 1024;
export const DEFAULT_TREE_PAGE_SIZE = 500;
export const LOCAL_HOST_VALUE = '__local__';
export const LOCAL_HOST_LABEL = 'Local shell';
export const GROUP_LAYOUTS = [
  { id: '1x1', label: '1 × 1', title: 'One terminal', columns: 1, rows: 1 },
  { id: '2x1', label: '2 × 1', title: 'Two columns', columns: 2, rows: 1 },
  { id: '1x2', label: '1 × 2', title: 'Two rows', columns: 1, rows: 2 },
  { id: '3-left', label: 'Three panes', title: 'Three panes (two left, one right)', columns: 2, rows: 2, capacity: 3,
    slots: [{ column: '1', row: '1' }, { column: '2', row: '1 / span 2' }, { column: '1', row: '2' }] },
  { id: '2x2', label: '2 × 2', title: 'Four panes', columns: 2, rows: 2 }
];
