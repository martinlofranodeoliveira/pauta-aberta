/* Transaction tests adapted from Decisões Abertas, MIT, Copyright (c) 2026 Contribuidores da LOFRANO TECNOLOGIA. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, forceCloseDatabase } from 'fake-indexeddb';
import { emptyNotebook, normalizeNotebook } from '../assets/domain.mjs';
import { createStore, StorageError } from '../assets/store.mjs';

const NAME = 'pauta-test';

function createExampleNotebook() {
  const meeting = { id: 'reuniao-demo', title: 'Mostra do Bairro Aurora',
    objective: 'Organizar uma mostra inteiramente fictícia.', date: '2026-11-09', time: '14:00',
    location: 'Sala imaginária', status: 'closed',
    participants: [{ id: 'pessoa-a', name: 'Pessoa A', attendance: 'present' }],
    agenda: [{ id: 'sinalizacao', title: 'Sinalização', minutes: 12, status: 'discussed', notes: 'Notas fictícias.' }],
    decisions: [{ id: 'decisao-a', topicId: 'sinalizacao', text: 'Reutilizar placas.', reason: 'Evitar desperdício.' }],
    actions: [{ id: 'acao-a', topicId: 'sinalizacao', text: 'Revisar a sinalização.', ownerId: 'pessoa-a', due: '2026-11-10', status: 'open' }],
  };
  return normalizeNotebook({ schemaVersion: 1, meetings: [{ ...structuredClone(meeting),
    minutes: [{ version: 1, closedAt: '2026-11-08T15:00:00.000Z', meeting: structuredClone(meeting) }],
  }] });
}

function opened(t, indexedDB = new IDBFactory(), name = NAME) {
  const store = createStore({ indexedDB, name });
  t.after(() => store.close());
  return store;
}

function openRaw(indexedDB, name = NAME, version) {
  return new Promise((resolve, reject) => {
    const request = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function rawTransaction(indexedDB, mode, callback, name = NAME) {
  const db = await openRaw(indexedDB, name);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('workspaces', mode);
      let result;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error);
      callback(transaction.objectStore('workspaces'), (value) => { result = value; });
    });
  } finally { db.close(); }
}

function rawPut(indexedDB, value, key = 'default') {
  return rawTransaction(indexedDB, 'readwrite', (store) => store.put(value, key));
}

function allRecords(indexedDB) {
  return rawTransaction(indexedDB, 'readonly', (store, done) => {
    store.getAll().onsuccess = (event) => done(event.target.result);
  });
}

function instrumentFactory(indexedDB, instrument) {
  return { open(...args) {
    const request = indexedDB.open(...args);
    request.addEventListener('success', () => instrument(request.result));
    return request;
  } };
}

test('constructing an adapter is lazy and loading an absent workspace writes no record', async (t) => {
  const indexedDB = new IDBFactory();
  let calls = 0;
  const factory = { open(...args) { calls += 1; return indexedDB.open(...args); } };
  const store = opened(t, factory);
  assert.equal(calls, 0);
  assert.deepEqual(await indexedDB.databases(), []);
  assert.deepEqual(await store.load(), { revision: 0, document: null });
  assert.deepEqual(await store.load(), { revision: 0, document: null });
  assert.equal(calls, 1);
  assert.deepEqual(await allRecords(indexedDB), []);
});

test('the default application database name and version are explicit', async (t) => {
  const indexedDB = new IDBFactory();
  const store = createStore({ indexedDB }); t.after(() => store.close());
  await store.load();
  assert.deepEqual(await indexedDB.databases(), [{ name: 'lofrano-pauta-aberta-v1', version: 1 }]);
});

test('save detaches inputs before yielding and returns detached committed records', async (t) => {
  const indexedDB = new IDBFactory();
  const store = opened(t, indexedDB);
  const document = createExampleNotebook();
  const original = structuredClone(document);
  const saving = store.save(document, 0);
  document.meetings[0].title = 'Changed by caller before commit';
  document.meetings[0].minutes.length = 0;
  const saved = await saving;
  assert.deepEqual(saved, { revision: 1, document: original });
  saved.document.meetings[0].agenda.length = 0;
  assert.deepEqual(await store.load(), { revision: 1, document: original });
  const loaded = await store.load(); loaded.document.meetings[0].participants[0].name = 'Changed load';
  assert.deepEqual(await store.load(), { revision: 1, document: original });
  store.close();
  assert.deepEqual(await opened(t, indexedDB).load(), { revision: 1, document: original });
});

test('independent connections saving one revision have exactly one committed winner', async (t) => {
  const indexedDB = new IDBFactory();
  const first = opened(t, indexedDB); const second = opened(t, indexedDB);
  const outcomes = await Promise.allSettled([
    first.save(emptyNotebook(), 0), second.save(createExampleNotebook(), 0),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
  const failure = outcomes.find((outcome) => outcome.status === 'rejected').reason;
  assert.ok(failure instanceof StorageError); assert.equal(failure.code, 'conflict');
  const winner = outcomes.find((outcome) => outcome.status === 'fulfilled').value;
  assert.deepEqual(await first.load(), winner); assert.deepEqual(await second.load(), winner);
});

test('stale clears cannot erase a later save', async (t) => {
  const indexedDB = new IDBFactory();
  const first = opened(t, indexedDB); const second = opened(t, indexedDB);
  const saved = await first.save(createExampleNotebook(), 0);
  await assert.rejects(second.clear(0), { code: 'conflict' });
  assert.deepEqual(await second.load(), saved);
});

test('save and clear compete under the same transactional compare-and-swap', async (t) => {
  const indexedDB = new IDBFactory();
  const first = opened(t, indexedDB); const second = opened(t, indexedDB);
  await first.save(emptyNotebook(), 0);
  const outcomes = await Promise.allSettled([first.save(createExampleNotebook(), 1), second.clear(1)]);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find((outcome) => outcome.status === 'rejected').reason.code, 'conflict');
  assert.deepEqual(await first.load(), outcomes.find((outcome) => outcome.status === 'fulfilled').value);
});

test('tombstones survive reopen and prevent stale revision ABA', async (t) => {
  const indexedDB = new IDBFactory(); const store = opened(t, indexedDB);
  await store.save(emptyNotebook(), 0);
  assert.deepEqual(await store.clear(1), { revision: 2, document: null });
  store.close();
  const again = opened(t, indexedDB);
  assert.deepEqual(await again.load(), { revision: 2, document: null });
  await assert.rejects(again.save(emptyNotebook(), 0), { code: 'conflict' });
  assert.equal((await again.save(createExampleNotebook(), 2)).revision, 3);
  assert.deepEqual(await again.clear(3), { revision: 4, document: null });
  assert.deepEqual(await again.clear(4), { revision: 5, document: null });
  assert.deepEqual(await allRecords(indexedDB), [{ revision: 5, document: null }]);
});

test('clearing a previously absent document still increments and retains a revision', async (t) => {
  const store = opened(t);
  assert.deepEqual(await store.clear(0), { revision: 1, document: null });
  await assert.rejects(store.save(emptyNotebook(), 0), { code: 'conflict' });
});

test('clearing affects only the application key and leaves other databases intact', async (t) => {
  const indexedDB = new IDBFactory();
  const own = opened(t, indexedDB); const other = opened(t, indexedDB, 'another-test-app');
  const value = await other.save(createExampleNotebook(), 0);
  await own.save(emptyNotebook(), 0);
  await rawPut(indexedDB, 'unrelated value', 'unrelated-key');
  await own.clear(1);
  assert.deepEqual(await other.load(), value);
  assert.deepEqual(await allRecords(indexedDB), [{ revision: 2, document: null }, 'unrelated value']);
});

test('invalid caller data and revisions are rejected before opening a database', async (t) => {
  let openedCount = 0;
  const store = opened(t, { open() { openedCount += 1; throw new Error('should not open'); } });
  const invalid = createExampleNotebook(); invalid.meetings[0].title = 'private-test-marker';
  invalid.meetings[0].agenda[0].minutes = 481;
  await assert.rejects(store.save(invalid, 0), (error) => error instanceof StorageError
    && error.code === 'storage' && !String(error).includes('private-test-marker') && !Object.hasOwn(error, 'cause'));
  for (const revision of [-1, 0.5, NaN, Infinity, '0', null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(store.save(emptyNotebook(), revision), { code: 'storage' });
    await assert.rejects(store.clear(revision), { code: 'storage' });
  }
  assert.equal(openedCount, 0);
});

test('corrupt persisted documents are rejected by load, save and clear without writes', async (t) => {
  const indexedDB = new IDBFactory(); const store = opened(t, indexedDB);
  await store.save(createExampleNotebook(), 0);
  const invalid = createExampleNotebook(); invalid.meetings[0].title = 'private-test-marker';
  invalid.meetings[0].actions[0].ownerId = 'missing';
  await rawPut(indexedDB, { revision: 1, document: invalid });
  const before = await allRecords(indexedDB);
  for (const operation of [() => store.load(), () => store.save(emptyNotebook(), 1), () => store.clear(1)]) {
    await assert.rejects(operation(), (error) => error instanceof StorageError
      && error.code === 'corrupt' && !String(error).includes('private-test-marker') && !Object.hasOwn(error, 'cause'));
  }
  assert.deepEqual(await allRecords(indexedDB), before);
});

test('corrupt envelopes never become absence or permission to reset the revision', async (t) => {
  const indexedDB = new IDBFactory(); const store = opened(t, indexedDB);
  await store.load();
  for (const invalid of [null, [], { revision: 0, document: null },
    { revision: -1, document: null }, { revision: 1.5, document: null },
    { revision: '1', document: null }, { revision: 1, document: [] },
    { revision: 1, document: null, extra: true }, { revision: 1 }, { document: null }]) {
    await rawPut(indexedDB, invalid);
    await assert.rejects(store.load(), { code: 'corrupt' });
    await assert.rejects(store.clear(0), { code: 'corrupt' });
  }
});

test('an exhausted stored revision cannot wrap around or be overwritten', async (t) => {
  const indexedDB = new IDBFactory(); const store = opened(t, indexedDB);
  await store.load();
  const last = { revision: Number.MAX_SAFE_INTEGER, document: null };
  await rawPut(indexedDB, last);
  await assert.rejects(store.save(emptyNotebook(), Number.MAX_SAFE_INTEGER), { code: 'revision_limit' });
  await assert.rejects(store.clear(Number.MAX_SAFE_INTEGER), { code: 'revision_limit' });
  assert.deepEqual(await store.load(), last);
});

test('request success followed by write transaction abort never reports a committed save', async (t) => {
  const indexedDB = new IDBFactory(); let abortNext = false; let putSucceeded = false;
  const factory = instrumentFactory(indexedDB, (db) => {
    const transact = db.transaction.bind(db);
    db.transaction = (...args) => {
      const transaction = transact(...args);
      if (args[1] !== 'readwrite' || !abortNext) return transaction;
      abortNext = false;
      const objectStore = transaction.objectStore.bind(transaction);
      transaction.objectStore = (name) => {
        const store = objectStore(name); const put = store.put.bind(store);
        store.put = (...putArgs) => {
          const request = put(...putArgs);
          request.addEventListener('success', () => { putSucceeded = true; transaction.abort(); });
          return request;
        };
        return store;
      };
      return transaction;
    };
  });
  const store = opened(t, factory); const original = await store.save(emptyNotebook(), 0);
  abortNext = true;
  await assert.rejects(store.save(createExampleNotebook(), 1), { code: 'storage' });
  assert.equal(putSucceeded, true); assert.deepEqual(await store.load(), original);
});

test('a read transaction aborted after its request succeeds never returns a document', async (t) => {
  const indexedDB = new IDBFactory(); let abortNext = false; let readSucceeded = false;
  const factory = instrumentFactory(indexedDB, (db) => {
    const transact = db.transaction.bind(db);
    db.transaction = (...args) => {
      const transaction = transact(...args);
      if (args[1] !== 'readonly' || !abortNext) return transaction;
      abortNext = false;
      const objectStore = transaction.objectStore.bind(transaction);
      transaction.objectStore = (name) => {
        const store = objectStore(name); const get = store.get.bind(store);
        store.get = (...getArgs) => {
          const request = get(...getArgs);
          request.addEventListener('success', () => { readSucceeded = true; transaction.abort(); });
          return request;
        };
        return store;
      };
      return transaction;
    };
  });
  const store = opened(t, factory); const saved = await store.save(createExampleNotebook(), 0);
  abortNext = true;
  await assert.rejects(store.load(), { code: 'storage' });
  assert.equal(readSucceeded, true); assert.deepEqual(await store.load(), saved);
});

test('quota errors preserve the previous data and do not expose native messages', async (t) => {
  const indexedDB = new IDBFactory(); let failNext = false;
  const factory = instrumentFactory(indexedDB, (db) => {
    const transact = db.transaction.bind(db);
    db.transaction = (...args) => {
      const transaction = transact(...args);
      if (args[1] !== 'readwrite' || !failNext) return transaction;
      failNext = false;
      const objectStore = transaction.objectStore.bind(transaction);
      transaction.objectStore = (name) => {
        const store = objectStore(name);
        store.put = () => { throw new DOMException('private-test-marker', 'QuotaExceededError'); };
        return store;
      };
      return transaction;
    };
  });
  const store = opened(t, factory); const saved = await store.save(emptyNotebook(), 0);
  failNext = true;
  await assert.rejects(store.save(createExampleNotebook(), 1), (error) => error instanceof StorageError
    && error.code === 'storage' && !String(error).includes('private-test-marker') && !Object.hasOwn(error, 'cause'));
  assert.deepEqual(await store.load(), saved);
});

test('a version change closes stale adapters without reopening a downgraded database', async (t) => {
  const indexedDB = new IDBFactory(); const store = opened(t, indexedDB);
  await store.save(emptyNotebook(), 0);
  const upgraded = await openRaw(indexedDB, NAME, 2); t.after(() => upgraded.close());
  await assert.rejects(store.load(), { code: 'storage' });
  await assert.rejects(store.save(emptyNotebook(), 1), { code: 'storage' });
  await assert.rejects(store.clear(1), { code: 'storage' });
  await assert.rejects(opened(t, indexedDB).load(), { code: 'storage' });
});

test('unavailable, closed and failed opens have sanitized explicit errors', async (t) => {
  const missing = opened(t, null);
  await assert.rejects(missing.load(), { code: 'unavailable' });
  const denied = opened(t, { open() { throw new DOMException('private-test-marker', 'SecurityError'); } });
  await assert.rejects(denied.load(), (error) => error.code === 'unavailable'
    && !String(error).includes('private-test-marker') && !Object.hasOwn(error, 'cause'));
  for (const name of ['', null, 99]) assert.throws(() => opened(t, new IDBFactory(), name), { code: 'storage' });
  const closed = opened(t); closed.close(); closed.close();
  await assert.rejects(closed.load(), { code: 'storage' });
  await assert.rejects(closed.save(emptyNotebook(), 0), { code: 'storage' });
  await assert.rejects(closed.clear(0), { code: 'storage' });
});

test('a throwing global IndexedDB getter stays lazy and never exposes native messages', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  let reads = 0;
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true,
    get() { reads += 1; throw new DOMException('private-test-marker', 'SecurityError'); } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
    else delete globalThis.indexedDB;
  });
  const store = createStore(); t.after(() => store.close());
  assert.equal(reads, 0);
  await assert.rejects(store.load(), (error) => error instanceof StorageError
    && error.code === 'unavailable' && !String(error).includes('private-test-marker')
    && !Object.hasOwn(error, 'cause'));
  assert.equal(reads, 1);
});

test('foreign database schema is not migrated or overwritten', async (t) => {
  const indexedDB = new IDBFactory();
  await new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('foreign');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { request.result.close(); resolve(); };
  });
  await assert.rejects(opened(t, indexedDB).load(), { code: 'corrupt' });
  const db = await openRaw(indexedDB); t.after(() => db.close());
  assert.deepEqual([...db.objectStoreNames], ['foreign']); assert.equal(db.version, 1);
});

test('closing while an opening request is pending does not leak a live connection', async (t) => {
  const indexedDB = new IDBFactory(); const store = opened(t, indexedDB);
  const pending = store.load(); store.close();
  await assert.rejects(pending, { code: 'cancelled' });
  // If the abandoned adapter kept a connection, this independent upgrade blocks.
  const db = await openRaw(indexedDB, NAME, 2); t.after(() => db.close());
  assert.equal(db.version, 2);
});

test('constructor and operation options are bounded and invalid options do not open storage', async (t) => {
  for (const options of [null, [], false, { surprise: true }, { timeoutMs: 0 },
    { timeoutMs: 60001 }, { timeoutMs: 1.5 }, { timeoutMs: '8' }, { timeoutMs: NaN },
    { name: 'bad\x00name' }, { name: 'x'.repeat(201) }]) {
    assert.throws(() => createStore(options), { code: 'storage' });
  }
  let calls = 0;
  const store = opened(t, { open() { calls += 1; throw new Error('unexpected open'); } });
  for (const options of [null, [], false, { surprise: true }, { signal: null }, { signal: {} }]) {
    await assert.rejects(store.load(options), { code: 'storage' });
    await assert.rejects(store.save(emptyNotebook(), 0, options), { code: 'storage' });
    await assert.rejects(store.clear(0, options), { code: 'storage' });
  }
  assert.equal(calls, 0);
  let getterReads = 0;
  const accessor = { get signal() { getterReads += 1; return undefined; } };
  await assert.rejects(store.load(accessor), { code: 'storage' });
  assert.throws(() => createStore({ get indexedDB() { getterReads += 1; return null; } }), { code: 'storage' });
  await assert.rejects(store.load({ [Symbol('extra')]: true }), { code: 'storage' });
  assert.equal(getterReads, 0); assert.equal(calls, 0);
});

test('a failing signal adapter is sanitized and leaves no operation waiting', async (t) => {
  let calls = 0;
  const store = opened(t, { open() { calls += 1; throw new Error('unexpected open'); } });
  const signal = { aborted: false,
    addEventListener() { throw new Error('private-test-marker'); },
    removeEventListener() { throw new Error('private-test-marker'); },
  };
  await assert.rejects(store.load({ signal }), (error) => error instanceof StorageError
    && error.code === 'storage' && !String(error).includes('private-test-marker'));
  assert.equal(calls, 0);
});

test('a caller-aborted operation stays lazy and discloses no abort reason', async (t) => {
  let calls = 0;
  const store = opened(t, { open() { calls += 1; throw new Error('unexpected open'); } });
  const controller = new AbortController(); controller.abort('private-test-marker');
  for (const action of [() => store.load({ signal: controller.signal }),
    () => store.save(createExampleNotebook(), 0, { signal: controller.signal }),
    () => store.clear(0, { signal: controller.signal })]) {
    await assert.rejects(action(), (error) => error instanceof StorageError
      && error.code === 'cancelled' && !String(error).includes('private-test-marker'));
  }
  assert.equal(calls, 0);
});

test('an open timeout closes a late connection and never starts a transaction', async (t) => {
  let request; let closed = 0; let transactions = 0;
  const store = createStore({ indexedDB: { open() { request = {}; return request; } }, timeoutMs: 10 });
  t.after(() => store.close());
  await assert.rejects(store.load(), { code: 'timeout' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  request.result = { close() { closed += 1; }, transaction() { transactions += 1; } };
  request.onsuccess();
  assert.equal(closed, 1); assert.equal(transactions, 0);
  await assert.rejects(store.save(emptyNotebook(), 0), { code: 'timeout' });
});

test('a transaction timeout rolls back even after the put request succeeds', async (t) => {
  const indexedDB = new IDBFactory(); let holdNext = false; let putSucceeded = false;
  const factory = instrumentFactory(indexedDB, (db) => {
    const transact = db.transaction.bind(db);
    db.transaction = (...args) => {
      const transaction = transact(...args);
      if (!holdNext || args[1] !== 'readwrite') return transaction;
      holdNext = false;
      const objectStore = transaction.objectStore.bind(transaction);
      const native = objectStore('workspaces'); let active = true;
      transaction.addEventListener('abort', () => { active = false; });
      transaction.addEventListener('complete', () => { active = false; });
      const pulse = () => {
        if (!active) return;
        const request = native.get('keep-alive');
        request.onsuccess = pulse;
      };
      pulse();
      transaction.objectStore = (name) => {
        const store = objectStore(name); const put = store.put.bind(store);
        store.put = (...values) => {
          const request = put(...values);
          request.addEventListener('success', () => { putSucceeded = true; });
          return request;
        };
        return store;
      };
      return transaction;
    };
  });
  const store = createStore({ indexedDB: factory, name: NAME, timeoutMs: 50 }); t.after(() => store.close());
  const before = await store.save(emptyNotebook(), 0);
  holdNext = true;
  await assert.rejects(store.save(createExampleNotebook(), 1), { code: 'timeout' });
  assert.equal(putSucceeded, true);
  assert.deepEqual(await store.load(), before);
});

test('abort signal after request success cancels the transaction and preserves its revision', async (t) => {
  const indexedDB = new IDBFactory(); const controller = new AbortController(); let abortNext = false;
  const factory = instrumentFactory(indexedDB, (db) => {
    const transact = db.transaction.bind(db);
    db.transaction = (...args) => {
      const transaction = transact(...args);
      if (!abortNext || args[1] !== 'readwrite') return transaction;
      abortNext = false;
      const objectStore = transaction.objectStore.bind(transaction);
      transaction.objectStore = (name) => {
        const store = objectStore(name); const put = store.put.bind(store);
        store.put = (...values) => {
          const request = put(...values);
          request.addEventListener('success', () => controller.abort('private-test-marker'));
          return request;
        };
        return store;
      };
      return transaction;
    };
  });
  const store = opened(t, factory); const before = await store.save(emptyNotebook(), 0);
  abortNext = true;
  await assert.rejects(store.save(createExampleNotebook(), 1, { signal: controller.signal }), { code: 'cancelled' });
  assert.deepEqual(await store.load(), before);
  assert.equal((await store.save(createExampleNotebook(), 1)).revision, 2);
});

test('cancellation after the actual commit reports its committed result instead of a fictitious rollback', async (t) => {
  const indexedDB = new IDBFactory(); const controller = new AbortController(); let cancelNext = false;
  const factory = instrumentFactory(indexedDB, (db) => {
    const transact = db.transaction.bind(db);
    db.transaction = (...args) => {
      const transaction = transact(...args);
      if (cancelNext && args[1] === 'readwrite') {
        cancelNext = false;
        transaction.addEventListener('complete', () => controller.abort());
      }
      return transaction;
    };
  });
  const store = opened(t, factory); await store.load(); cancelNext = true;
  const saved = await store.save(createExampleNotebook(), 0, { signal: controller.signal });
  assert.equal(saved.revision, 1); assert.equal(controller.signal.aborted, true);
  assert.deepEqual(await store.load(), saved);
});

test('closing with a pending write aborts it without erasing an earlier save', async (t) => {
  const indexedDB = new IDBFactory(); let closeNext = false; let store;
  const factory = instrumentFactory(indexedDB, (db) => {
    const transact = db.transaction.bind(db);
    db.transaction = (...args) => {
      const transaction = transact(...args);
      if (!closeNext || args[1] !== 'readwrite') return transaction;
      closeNext = false;
      const objectStore = transaction.objectStore.bind(transaction);
      transaction.objectStore = (name) => {
        const handle = objectStore(name); const put = handle.put.bind(handle);
        handle.put = (...values) => {
          const request = put(...values);
          request.addEventListener('success', () => store.close());
          return request;
        };
        return handle;
      };
      return transaction;
    };
  });
  store = opened(t, factory); const before = await store.save(emptyNotebook(), 0);
  closeNext = true;
  await assert.rejects(store.save(createExampleNotebook(), 1), { code: 'cancelled' });
  assert.deepEqual(await opened(t, indexedDB).load(), before);
});

test('unexpected database closure makes the adapter unavailable to later operations', async (t) => {
  const indexedDB = new IDBFactory(); let database;
  const store = opened(t, instrumentFactory(indexedDB, (db) => { database = db; }));
  const before = await store.save(createExampleNotebook(), 0);
  forceCloseDatabase(database);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await assert.rejects(store.load(), { code: 'storage' });
  await assert.rejects(store.clear(1), { code: 'storage' });
  assert.deepEqual(await opened(t, indexedDB).load(), before);
});

test('invalid historical snapshots block persistence without rewriting current or historical data', async (t) => {
  const indexedDB = new IDBFactory(); const store = opened(t, indexedDB);
  const before = await store.save(createExampleNotebook(), 0);
  const invalid = createExampleNotebook();
  invalid.meetings[0].minutes[0].meeting.actions[0].ownerId = 'missing-historical-person';
  await assert.rejects(store.save(invalid, 1), { code: 'storage' });
  assert.deepEqual(await store.load(), before);
  await rawPut(indexedDB, { revision: 2, document: invalid });
  await assert.rejects(store.load(), { code: 'corrupt' });
  await assert.rejects(store.clear(2), { code: 'corrupt' });
});

test('wrong key paths, extra stores and indexes are not treated as an empty notebook', async (t) => {
  for (const shape of ['keypath', 'extra-store', 'index']) {
    const indexedDB = new IDBFactory();
    await new Promise((resolve, reject) => {
      const request = indexedDB.open(NAME, 1);
      request.onupgradeneeded = () => {
        const handle = request.result.createObjectStore('workspaces', shape === 'keypath' ? { keyPath: 'id' } : undefined);
        if (shape === 'extra-store') request.result.createObjectStore('foreign');
        if (shape === 'index') handle.createIndex('foreign-index', 'id');
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { request.result.close(); resolve(); };
    });
    const store = opened(t, indexedDB);
    await assert.rejects(store.load(), { code: 'corrupt' });
    await assert.rejects(store.save(emptyNotebook(), 0), { code: 'corrupt' });
  }
});
