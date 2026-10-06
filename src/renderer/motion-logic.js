// Pure logic of the animations (no DOM access).

/**
 * Which rows of a list are gone after a redraw. `oldKeys` and `newKeys` are
 * the texts of the rows before and after, in their order.
 * @returns {{ index: number, before: number }[]} `index` = place in the old
 *   list, `before` = place in the new list the row sat in front of. Empty when
 *   more than `limit` rows left at once: then the list simply changes.
 */
export function leavingRows(oldKeys, newKeys, limit = 10) {
  const remaining = new Map();
  for (const key of newKeys) remaining.set(key, (remaining.get(key) ?? 0) + 1);

  const gone = [];
  let pointer = 0;
  oldKeys.forEach((key, index) => {
    const left = remaining.get(key) ?? 0;
    if (left > 0) {
      remaining.set(key, left - 1);
      const found = newKeys.indexOf(key, pointer);
      if (found !== -1) pointer = found + 1;
    } else {
      gone.push({ index, before: pointer });
    }
  });
  return gone.length > limit ? [] : gone;
}
