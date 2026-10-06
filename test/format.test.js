const { test } = require('node:test');
const assert = require('node:assert/strict');

test('formatBytes formats sizes in German notation (base 1024)', async () => {
  const { formatBytes } = await import('../src/renderer/format.js');
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1023), '1023 B');
  assert.equal(formatBytes(1536), '1,5 KB');
  assert.equal(formatBytes(5 * 1024 ** 2), '5,0 MB');
  assert.equal(formatBytes(9019431321), '8,4 GB');
});
