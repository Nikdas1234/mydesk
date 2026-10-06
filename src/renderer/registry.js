// Registry of views and the switching between them. Kept apart from app.js so
// that view modules can import registerView without a circular import.
import { motionAllowed, EASE } from './motion.js';

const LEAVE_MS = 140;

const views = new Map();
const listeners = new Set();
let currentId = null;
let showToken = 0;

function notifyChange() {
  for (const callback of [...listeners]) callback();
}

/**
 * Registers (or replaces) a view.
 * @param {string} id
 * @param {{ title: string, icon: string, render(container: HTMLElement): void }} view
 */
export function registerView(id, view) {
  views.set(id, view);
  notifyChange();
}

/** All registered views, id -> view, in registration order. */
export function getViews() {
  return views;
}

/** Id of the view that is shown (or about to be shown); null before the first one. */
export function getCurrentId() {
  return currentId;
}

/** Calls `callback()` after a view was registered or the shown view changed. */
export function onRegistryChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function renderInto(content, view) {
  content.replaceChildren();
  try {
    view.render(content);
  } catch (err) {
    console.error(err);
    content.replaceChildren();
    const line = document.createElement('p');
    line.className = 'error-line';
    line.textContent = `Diese Ansicht konnte nicht angezeigt werden: ${(err && err.message) || err}`;
    content.append(line);
  }
  content.scrollTop = 0;
}

/** Switches to a view: the old one slides out to the left, the new one comes in from the right. */
export function showView(id) {
  const view = views.get(id);
  const content = document.getElementById('content');
  if (!view || !content) return;
  const token = ++showToken;
  currentId = id;
  notifyChange();

  if (content.childElementCount === 0 || !motionAllowed()) {
    renderInto(content, view);
    return;
  }
  const leave = content.animate(
    [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-12px)' }],
    { duration: LEAVE_MS, easing: 'ease-in', fill: 'forwards' },
  );
  setTimeout(() => {
    leave.cancel();
    if (token !== showToken) return;
    renderInto(content, view);
    content.animate(
      [{ opacity: 0, transform: 'translateX(12px)' }, { opacity: 1, transform: 'none' }],
      { duration: 320, easing: EASE },
    );
  }, LEAVE_MS);
}
