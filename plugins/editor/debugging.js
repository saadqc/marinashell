import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, gutter, GutterMarker } from '@codemirror/view';

export const debugMarkers = StateEffect.define();
const markerState = StateField.define({
  create: () => ({ points: [], line: null }),
  update(value, transaction) {
    let next = value;
    if (transaction.docChanged) next = { points: value.points.map(p => ({ ...p, position: transaction.changes.mapPos(p.position, 1) })), line: null };
    for (const effect of transaction.effects) if (effect.is(debugMarkers)) {
      const position = n => transaction.state.doc.line(Math.max(1, Math.min(transaction.state.doc.lines, n))).from;
      next = { points: effect.value.points.map(p => ({ ...p, position: position(p.line) })), line: effect.value.line ? position(effect.value.line) : null };
    }
    return next;
  }
});
class Marker extends GutterMarker {
  constructor(point) { super(); this.point = point; }
  eq(other) { return JSON.stringify(this.point) === JSON.stringify(other.point); }
  toDOM() {
    const el = document.createElement('span');
    el.textContent = this.point ? '●' : '·';
    el.className = 'mse-breakpoint' + (this.point ? ' present' : '') + (this.point?.enabled === false ? ' disabled' : '') + (this.point?.conditional ? ' conditional' : '') + (this.point?.verified === false ? ' unverified' : '');
    el.title = this.point ? (this.point.message || (this.point.conditional ? 'Conditional breakpoint — right-click to edit' : 'Breakpoint — click to remove')) : 'Click to add breakpoint';
    return el;
  }
}
export function debuggingExtension(doc, provider) {
  return [markerState, gutter({
    class: 'mse-breakpoint-gutter', initialSpacer: () => new Marker(null),
    lineMarker(view, line) { return new Marker(view.state.field(markerState).points.find(p => p.position === line.from) || null); },
    lineMarkerChange: update => update.docChanged || update.transactions.some(t => t.effects.some(e => e.is(debugMarkers))),
    domEventHandlers: {
      mousedown(view, line, event) {
        if (event.button !== 0) return false;
        event.preventDefault(); provider.toggle(doc, view.state.doc.lineAt(line.from).number); return true;
      },
      contextmenu(view, line, event) {
        event.preventDefault(); event.stopPropagation(); provider.edit(doc, view.state.doc.lineAt(line.from).number); return true;
      }
    }
  }), EditorView.decorations.compute([markerState], state => {
    const value = state.field(markerState);
    return value.line == null ? Decoration.none : Decoration.set([Decoration.line({ class: 'mse-debug-line' }).range(value.line)]);
  }), EditorView.updateListener.of(update => {
    if (!update.docChanged) return;
    const points = update.state.field(markerState).points;
    provider.map?.(doc, points.map(p => ({ id: p.id, line: update.state.doc.lineAt(p.position).number })));
  })];
}
