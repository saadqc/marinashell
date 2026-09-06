export function modal(title, { wide = false } = {}) {
  const previous = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = `workspace-dialog${wide ? ' wide' : ''}`;
  const heading = document.createElement('h2');
  heading.textContent = title;
  heading.id = `dialog-${crypto.randomUUID()}`;
  dialog.setAttribute('aria-labelledby', heading.id);
  const body = document.createElement('div'); body.className = 'workspace-dialog-body';
  const footer = document.createElement('div'); footer.className = 'workspace-dialog-footer';
  dialog.append(heading, body, footer);
  document.body.append(dialog);
  const close = () => { dialog.close(); dialog.remove(); previous?.focus(); };
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.showModal();
  return { dialog, body, footer, close };
}
export function button(text, action, className = '') {
  const element = document.createElement('button');
  element.type = 'button'; element.textContent = text; element.className = className;
  if (action) element.addEventListener('click', action);
  return element;
}
export function confirmAction(title, message, label = 'Confirm') {
  return new Promise(resolve => {
    const view = modal(title);
    view.body.textContent = message;
    view.dialog.addEventListener('close', () => resolve(false), { once: true });
    view.footer.append(button('Cancel', () => { resolve(false); view.close(); }, 'ghost-btn'),
      button(label, () => { resolve(true); view.close(); }, 'danger'));
  });
}
export function showError(error) {
  const view = modal('Unable to complete action');
  view.body.textContent = error?.message || String(error);
  view.footer.append(button('Close', view.close));
}
