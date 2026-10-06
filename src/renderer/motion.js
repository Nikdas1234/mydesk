// Small animation helpers. Everything stops when the user switched
// animations off in the settings (body.no-motion) or in Windows.
import { leavingRows } from './motion-logic.js';

// Same curve as --ease in styles.css: quick start, soft landing.
export const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

const MAX_STAGGERED_ROWS = 15;

export function motionAllowed() {
  return !document.body.classList.contains('no-motion')
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Switches all animations on or off (setting "Animationen"). */
export function setMotion(enabled) {
  document.body.classList.toggle('no-motion', !enabled);
}

/**
 * Counts from 0 up to `value` and writes `format(current)` into the element.
 * Without motion the final text is set at once.
 */
export function countUp(element, value, format, duration = 700) {
  if (!motionAllowed() || !(value > 0)) {
    element.textContent = format(value);
    return;
  }
  const start = performance.now();
  const step = (time) => {
    if (!element.isConnected) return;
    const progress = Math.min(1, (time - start) / duration);
    const eased = 1 - (1 - progress) ** 3;
    element.textContent = format(progress < 1 ? value * eased : value);
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function riseIn(elements, stepMs, startMs = 0) {
  elements.forEach((child, index) => {
    child.classList.add('rise-in');
    child.style.animationDelay = `${startMs + index * stepMs}ms`;
  });
}

/** Gives the children of `container` a staggered entrance (class + delay). */
export function stagger(container, stepMs = 60) {
  if (!motionAllowed()) return;
  riseIn([...container.children], stepMs);
}

const ROWS = '.list-row, .mail-row';
const LISTS = '.list, .mail-list';
const rowsOf = (node) => [...node.querySelectorAll(ROWS)];
const keyOf = (row) => (row.querySelector('.list-row-main') ?? row).textContent;

// The first rows of every list come in one after the other; the rest of a
// long list is simply there.
function staggerRows(root, startMs = 0) {
  riseIn(rowsOf(root).slice(0, MAX_STAGGERED_ROWS), 28, startMs);
}

// Puts the rows that are gone back as ghosts and lets them fold away, so the
// rows below move up instead of jumping.
function foldAway(oldList, newList) {
  const oldRows = [...oldList.children].filter((row) => row.matches(ROWS));
  const newRows = [...newList.children].filter((row) => row.matches(ROWS));
  if (newRows.length === 0) return;
  for (const { index, before } of leavingRows(oldRows.map(keyOf), newRows.map(keyOf))) {
    const ghost = oldRows[index];
    ghost.classList.remove('rise-in');
    ghost.classList.add('is-leaving');
    ghost.inert = true;
    ghost.setAttribute('aria-hidden', 'true');
    newList.insertBefore(ghost, newRows[before] ?? null);
    const style = getComputedStyle(ghost);
    const fold = ghost.animate(
      [
        { height: `${ghost.offsetHeight}px`, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, opacity: 1 },
        { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 },
      ],
      { duration: 300, easing: EASE },
    );
    fold.finished.then(() => ghost.remove(), () => ghost.remove());
  }
}

/**
 * Watches the content area and animates what the views draw, without the
 * views knowing: a view that appears comes in piece by piece, a list that
 * appears after a scan comes in row by row, and rows that are gone after a
 * redraw fold away. The views redraw by replacing everything inside their
 * root (.view); that is what this looks for.
 */
export function watchContent(content) {
  new MutationObserver((records) => {
    if (!motionAllowed()) return;

    const mounted = records
      .filter((record) => record.target === content)
      .flatMap((record) => [...record.addedNodes])
      .find((node) => node.isConnected && node.classList?.contains('view'));
    if (mounted) {
      riseIn([...mounted.children], 45);
      staggerRows(mounted, 120);
      return;
    }

    // Only the first redraw of a batch holds the rows the user actually saw.
    const redraw = records.find((record) => record.removedNodes.length > 0
      && record.target.isConnected && record.target.classList?.contains('view'));
    if (!redraw) return;
    const root = redraw.target;
    const removed = [...redraw.removedNodes].filter((node) => node.nodeType === Node.ELEMENT_NODE);
    const oldLists = removed.flatMap((node) => [...node.querySelectorAll(LISTS)]);
    const newLists = [...root.querySelectorAll(LISTS)];
    if (oldLists.length === 0) staggerRows(root);
    else if (oldLists.length === newLists.length) oldLists.forEach((list, index) => foldAway(list, newLists[index]));
  }).observe(content, { childList: true, subtree: true });
}
