const { test } = require('node:test');
const assert = require('node:assert/strict');

function fakeApi({ junk, downloads, programs, cancel } = {}) {
  const calls = [];
  return {
    calls,
    junk: { scan: junk || (async () => []) },
    downloads: { scan: downloads || (async () => []) },
    programs: { scan: programs || (async () => []) },
    cancel: async (name) => {
      calls.push(['cancel', name]);
      if (cancel) await cancel(name);
    },
  };
}

test('store keeps one value per key, null until set', async () => {
  const { createStore } = await import('../src/renderer/store.js');
  const store = createStore(() => fakeApi());
  assert.equal(store.get('junk'), null);
  assert.equal(store.get('downloads'), null);
  assert.equal(store.get('programs'), null);
  store.set('junk', [1]);
  assert.deepEqual(store.get('junk'), [1]);
  assert.equal(store.get('downloads'), null);
  assert.throws(() => store.get('nope'), /Unknown store key/);
  assert.throws(() => store.set('nope', 1), /Unknown store key/);
  assert.throws(() => store.subscribe('nope', () => {}), /Unknown store key/);
});

test('subscribe notifies on set and can be undone', async () => {
  const { createStore } = await import('../src/renderer/store.js');
  const store = createStore(() => fakeApi());
  const seen = [];
  const off = store.subscribe('junk', (value) => seen.push(value));
  store.set('junk', 'a');
  store.set('downloads', 'other key');
  store.set('junk', 'b');
  off();
  store.set('junk', 'c');
  assert.deepEqual(seen, ['a', 'b']);
});

test('scan stores the result and reports running / idle', async () => {
  const { createStore } = await import('../src/renderer/store.js');
  const store = createStore(() => fakeApi({ junk: async () => [{ id: 'x', bytes: 5 }] }));
  const states = [];
  store.subscribe('junk', (_value, status) => states.push(status.running));
  assert.deepEqual(store.getStatus('junk'), { running: false, error: null });
  const promise = store.scan('junk');
  assert.equal(store.getStatus('junk').running, true);
  await promise;
  assert.deepEqual(store.get('junk'), [{ id: 'x', bytes: 5 }]);
  assert.deepEqual(store.getStatus('junk'), { running: false, error: null });
  assert.deepEqual(states, [true, false]);
});

test('a running scan is not started twice', async () => {
  const { createStore } = await import('../src/renderer/store.js');
  let started = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const store = createStore(() =>
    fakeApi({
      downloads: async () => {
        started += 1;
        await gate;
        return [];
      },
    }),
  );
  const first = store.scan('downloads');
  const second = store.scan('downloads');
  assert.equal(first, second);
  release();
  await first;
  assert.equal(started, 1);
  await store.scan('downloads');
  assert.equal(started, 2);
});

test('a cancelled scan keeps the previous value and shows no error', async () => {
  const { createStore } = await import('../src/renderer/store.js');
  const store = createStore(() => fakeApi({ junk: async () => ({ cancelled: true }) }));
  store.set('junk', ['old']);
  await store.scan('junk');
  assert.deepEqual(store.get('junk'), ['old']);
  assert.deepEqual(store.getStatus('junk'), { running: false, error: null });
});

test('a failing scan ends in the status, not as an exception, and can be retried', async () => {
  const { createStore } = await import('../src/renderer/store.js');
  let fail = true;
  const store = createStore(() =>
    fakeApi({
      junk: async () => {
        if (fail) throw new Error('Kaputt');
        return ['ok'];
      },
    }),
  );
  store.set('junk', ['old']);
  await store.scan('junk');
  assert.deepEqual(store.getStatus('junk'), { running: false, error: 'Kaputt' });
  assert.deepEqual(store.get('junk'), ['old']);
  fail = false;
  await store.scan('junk');
  assert.deepEqual(store.getStatus('junk'), { running: false, error: null });
  assert.deepEqual(store.get('junk'), ['ok']);
});

test('a scan that throws synchronously does not leave the key locked', async () => {
  const { createStore } = await import('../src/renderer/store.js');
  let fail = true;
  const store = createStore(() =>
    fakeApi({
      junk: () => {
        if (fail) throw new Error('sofort');
        return Promise.resolve(['ok']);
      },
    }),
  );
  await store.scan('junk');
  assert.equal(store.getStatus('junk').error, 'sofort');
  fail = false;
  await store.scan('junk');
  assert.deepEqual(store.get('junk'), ['ok']);
});

test('cancel asks the main process only while a scan runs', async () => {
  const { createStore } = await import('../src/renderer/store.js');
  const api = fakeApi({ programs: async () => ({ cancelled: true }) });
  const store = createStore(() => api);
  await store.cancel('programs');
  assert.deepEqual(api.calls, []);
  const promise = store.scan('programs');
  await store.cancel('programs');
  await promise;
  assert.deepEqual(api.calls, [['cancel', 'programs']]);
});

test('cancel swallows a failing cancel call', async () => {
  const { createStore } = await import('../src/renderer/store.js');
  const api = fakeApi({
    cancel: async () => {
      throw new Error('weg');
    },
  });
  const store = createStore(() => api);
  const promise = store.scan('junk');
  await store.cancel('junk');
  await promise;
});

test('watch stops listening once the element left the page', async () => {
  const { createStore } = await import('../src/renderer/store.js');
  const store = createStore(() => fakeApi());
  const element = { isConnected: true };
  let calls = 0;
  store.watch(element, ['junk', 'downloads'], () => {
    calls += 1;
  });
  store.set('junk', 1);
  store.set('downloads', 2);
  assert.equal(calls, 2);
  element.isConnected = false;
  store.set('junk', 3);
  store.set('downloads', 4);
  element.isConnected = true;
  store.set('junk', 5);
  assert.equal(calls, 2);
});

test('a listener that throws neither stops the others nor makes scan reject', async (t) => {
  const { createStore } = await import('../src/renderer/store.js');
  const errors = t.mock.method(console, 'error', () => {});
  const store = createStore(() => fakeApi({ junk: async () => [{ id: 'x', bytes: 1 }] }));
  const seen = [];
  store.subscribe('junk', () => { throw new Error('broken view'); });
  store.subscribe('junk', (value) => seen.push(value));

  await store.scan('junk'); // must resolve

  assert.deepEqual(store.get('junk'), [{ id: 'x', bytes: 1 }]);
  assert.deepEqual(store.getStatus('junk'), { running: false, error: null });
  assert.deepEqual(seen, [null, [{ id: 'x', bytes: 1 }]]);
  assert.ok(errors.mock.callCount() >= 2);

  store.set('junk', ['y']); // set is protected, too
  assert.deepEqual(seen[seen.length - 1], ['y']);
});

test('a throwing listener cannot leave a scan "running" for ever', async (t) => {
  const { createStore } = await import('../src/renderer/store.js');
  t.mock.method(console, 'error', () => {});
  const store = createStore(() => fakeApi({ junk: async () => [] }));
  store.subscribe('junk', () => { throw new Error('broken view'); });
  await store.scan('junk');
  await store.scan('junk'); // a second scan starts, so nothing is stuck in `running`
  assert.equal(store.getStatus('junk').running, false);
});

test('invalidate sends a stored result back to "not checked yet" and notifies', async () => {
  const { createStore } = await import('../src/renderer/store.js');
  const store = createStore(() => fakeApi({ junk: async () => [{ id: 'x' }] }));
  await store.scan('junk');
  const seen = [];
  store.subscribe('junk', (value) => seen.push(value));
  store.invalidate('junk');
  assert.equal(store.get('junk'), null);
  assert.deepEqual(seen, [null]);
  assert.throws(() => store.invalidate('nope'), /Unknown store key/);
});

test('a scan that was running when invalidate was called does not store its (stale) result', async () => {
  const { createStore } = await import('../src/renderer/store.js');
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const store = createStore(() => fakeApi({ junk: async () => { await gate; return [{ id: 'old' }]; } }));
  const promise = store.scan('junk');
  await Promise.resolve();
  store.invalidate('junk');
  release();
  await promise;
  assert.equal(store.get('junk'), null);
  assert.deepEqual(store.getStatus('junk'), { running: false, error: null });

  // The next scan works normally again.
  const second = createStore(() => fakeApi({ junk: async () => [{ id: 'new' }] }));
  await second.scan('junk');
  assert.deepEqual(second.get('junk'), [{ id: 'new' }]);
});

test('setCleaning is shared state with a notification, per key', async () => {
  const { createStore } = await import('../src/renderer/store.js');
  const store = createStore(() => fakeApi());
  const seen = [];
  store.subscribe('junk', () => seen.push(store.isCleaning('junk')));
  assert.equal(store.isCleaning('junk'), false);
  store.setCleaning('junk', true);
  assert.equal(store.isCleaning('junk'), true);
  assert.equal(store.isCleaning('downloads'), false);
  store.setCleaning('junk', false);
  assert.deepEqual(seen, [true, false]);
});
