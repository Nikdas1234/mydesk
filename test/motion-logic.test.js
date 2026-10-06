const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../src/renderer/motion-logic.js');

test('leavingRows names the rows that are gone and where they sat', async () => {
  const { leavingRows } = await load();
  assert.deepEqual(leavingRows(['a', 'b', 'c'], ['a', 'c']), [{ index: 1, before: 1 }]);
  assert.deepEqual(leavingRows(['a', 'b', 'c'], ['b', 'c']), [{ index: 0, before: 0 }]);
  assert.deepEqual(leavingRows(['a', 'b', 'c'], ['a', 'b']), [{ index: 2, before: 2 }]);
  assert.deepEqual(leavingRows(['a', 'b', 'c', 'd'], ['a', 'd']), [{ index: 1, before: 1 }, { index: 2, before: 1 }]);
});

test('leavingRows finds nothing when the rows are the same', async () => {
  const { leavingRows } = await load();
  assert.deepEqual(leavingRows(['a', 'b'], ['a', 'b']), []);
  assert.deepEqual(leavingRows([], ['a']), []);
});

test('leavingRows counts rows with the same text one by one', async () => {
  const { leavingRows } = await load();
  assert.deepEqual(leavingRows(['a', 'a', 'b'], ['a', 'b']), [{ index: 1, before: 1 }]);
});

test('leavingRows gives up when too much changed at once', async () => {
  const { leavingRows } = await load();
  assert.deepEqual(leavingRows(['a', 'b', 'c', 'd'], ['d'], 2), []);
  assert.equal(leavingRows(['a', 'b', 'c', 'd'], ['d'], 3).length, 3);
});
