/*
 * IndexedDB transaction lifecycle adapted from Decisões Abertas,
 * Caderno de Revisões and Garantia Aberta.
 * Copyright (c) 2026 Contribuidores da LOFRANO TECNOLOGIA
 * SPDX-License-Identifier: MIT
 * See LICENSE and THIRD_PARTY_NOTICES.md in this repository.
 */
import { normalizeNotebook } from './domain.mjs';

const MESSAGES = Object.freeze({
  conflict: 'O caderno salvo mudou em outra conexão. Abra a versão salva antes de tentar novamente.',
  unavailable: 'O salvamento neste navegador não está disponível.',
  storage: 'Não foi possível concluir a operação no salvamento local.',
  corrupt: 'O caderno salvo não passou pela validação. Nenhum dado foi sobrescrito.',
  revision_limit: 'O contador de revisões do salvamento local está esgotado.',
  timeout: 'O salvamento local não respondeu no prazo. A operação foi interrompida.',
  cancelled: 'A operação no salvamento local foi cancelada.',
});

export class StorageError extends Error {
  constructor(code = 'storage') {
    const safe = Object.hasOwn(MESSAGES, code) ? code : 'storage';
    super(MESSAGES[safe]);
    this.name = 'StorageError';
    this.code = safe;
  }
}

function safeError(error, fallback = 'storage') {
  if (error instanceof StorageError) return error;
  try {
    if (error?.name === 'SecurityError' || error?.name === 'NotSupportedError') return new StorageError('unavailable');
  } catch { /* Error objects supplied by an adapter are not trusted text. */ }
  return new StorageError(fallback);
}

function checkRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new StorageError('storage');
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function optionRecord(value, allowed) {
  if (!plain(value) || Reflect.ownKeys(value).some((key) => !allowed.includes(key)
      || Object.getOwnPropertyDescriptor(value, key).get
      || Object.getOwnPropertyDescriptor(value, key).set)) throw new StorageError('storage');
}

function readEnvelope(value) {
  if (value === undefined) return { revision: 0, document: null };
  if (!plain(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'revision')
      || !Object.hasOwn(value, 'document') || !Number.isSafeInteger(value.revision)
      || value.revision < 1) throw new StorageError('corrupt');
  try {
    return { revision: value.revision,
      document: value.document === null ? null : normalizeNotebook(value.document) };
  } catch { throw new StorageError('corrupt'); }
}

/** No database or global IndexedDB getter is opened before an explicit operation. */
export function createStore(options = {}) {
  let indexedDB; let name; let suppliedFactory; let timeoutMs;
  try {
    optionRecord(options, ['indexedDB', 'name', 'timeoutMs']);
    suppliedFactory = Object.hasOwn(options, 'indexedDB');
    indexedDB = suppliedFactory ? options.indexedDB : undefined;
    name = Object.hasOwn(options, 'name') ? options.name : 'lofrano-pauta-aberta-v1';
    timeoutMs = Object.hasOwn(options, 'timeoutMs') ? options.timeoutMs : 8000;
    if (typeof name !== 'string' || !name.trim() || name.length > 200 || /[\u0000-\u001f]/u.test(name)
        || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new StorageError('storage');
  } catch (error) { throw safeError(error); }
  let state = 'idle'; let connection = null; let opening = null; let cancelOpening = null;
  const operations = new Set();

  function ensureAvailable() {
    try {
      if (state === 'closed' || state === 'changed') throw new StorageError('storage');
      if (!suppliedFactory) {
        try { indexedDB = globalThis.indexedDB; suppliedFactory = true; }
        catch { throw new StorageError('unavailable'); }
      }
      if (!indexedDB || typeof indexedDB.open !== 'function') throw new StorageError('unavailable');
    } catch (error) { throw safeError(error); }
  }

  function cancelOperations(error) {
    for (const cancel of [...operations]) cancel(error);
  }

  function open() {
    ensureAvailable();
    if (connection) return Promise.resolve(connection);
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      let request; let settled = false;
      const timer = setTimeout(() => fail(new StorageError('timeout')), timeoutMs);
      const fail = (error) => {
        if (settled) return;
        settled = true; clearTimeout(timer); cancelOpening = null;
        reject(safeError(error));
      };
      cancelOpening = fail;
      try {
        request = indexedDB.open(name, 1);
        request.onupgradeneeded = (event) => {
          try {
            if (settled || state === 'closed') { request.transaction.abort(); return; }
            if (event.oldVersion !== 0) {
              fail(new StorageError('corrupt')); request.transaction.abort(); return;
            }
            request.result.createObjectStore('workspaces');
          } catch (error) {
            fail(error);
            try { request.transaction.abort(); } catch { /* Already inactive. */ }
          }
        };
        request.onerror = () => fail(request.error);
        request.onblocked = () => fail(new StorageError('storage'));
        request.onsuccess = () => {
          const db = request.result;
          if (settled || state === 'closed') { db.close(); fail(new StorageError('storage')); return; }
          if (db.objectStoreNames.length !== 1 || !db.objectStoreNames.contains('workspaces')) {
            db.close(); fail(new StorageError('corrupt')); return;
          }
          state = 'open'; connection = db;
          db.onversionchange = () => {
            state = 'changed'; cancelOperations(new StorageError('storage')); db.close(); connection = null;
          };
          db.onclose = () => {
            if (state === 'open') state = 'changed';
            connection = null; cancelOperations(new StorageError('storage'));
          };
          settled = true; clearTimeout(timer); cancelOpening = null; resolve(db);
        };
      } catch (error) { fail(error); }
    });
    return opening;
  }

  function operationOptions(options) {
    try {
      optionRecord(options, ['signal']);
      const signal = options.signal;
      if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean'
          || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) throw new StorageError('storage');
      return signal;
    } catch (error) { throw safeError(error); }
  }

  function transact(mode, modify, options) {
    const signal = operationOptions(options);
    ensureAvailable();
    if (signal?.aborted) return Promise.reject(new StorageError('cancelled'));
    return new Promise((resolve, reject) => {
      let transaction; let result; let failure; let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true; clearTimeout(timer); operations.delete(cancel);
        try { signal?.removeEventListener('abort', onAbort); } catch { /* Cleanup must not leak an adapter error. */ }
        if (error) reject(safeError(error)); else resolve(result);
      };
      const cancel = (error) => {
        if (settled) return;
        if (transaction) {
          try { transaction.abort(); }
          catch (nativeError) {
            // A committed transaction can precede delivery of oncomplete.
            // Report its actual result rather than pretend a rollback occurred.
            if (nativeError?.name === 'InvalidStateError') return;
          }
        }
        failure = error; finish(error);
      };
      const onAbort = () => cancel(new StorageError('cancelled'));
      const timer = setTimeout(() => cancel(new StorageError('timeout')), timeoutMs);
      operations.add(cancel);
      try { signal?.addEventListener('abort', onAbort, { once: true }); }
      catch (error) { finish(error); return; }
      let request;
      try { request = open(); }
      catch (error) { finish(error); return; }
      request.then((db) => {
        if (settled) return;
        try {
          ensureAvailable();
          transaction = db.transaction('workspaces', mode);
          transaction.oncomplete = () => finish();
          transaction.onabort = () => finish(failure || new StorageError('storage'));
          transaction.onerror = (event) => { failure ||= safeError(event.target?.error || transaction.error); };
          const store = transaction.objectStore('workspaces');
          if (store.keyPath !== null || store.autoIncrement || store.indexNames.length !== 0) throw new StorageError('corrupt');
          const get = store.get('default');
          get.onerror = () => { failure = safeError(get.error); };
          get.onsuccess = () => {
            if (settled) return;
            try {
              const current = readEnvelope(get.result);
              result = modify ? modify(current, store) : current;
            } catch (error) {
              failure = safeError(error);
              try { transaction.abort(); } catch { finish(failure); }
            }
          };
        } catch (error) {
          failure = safeError(error);
          if (transaction) {
            try { transaction.abort(); } catch { finish(failure); }
          } else finish(failure);
        }
      }, finish);
    });
  }

  function write(document, expectedRevision, options) {
    return transact('readwrite', (current, store) => {
      if (current.revision !== expectedRevision) throw new StorageError('conflict');
      if (current.revision === Number.MAX_SAFE_INTEGER) throw new StorageError('revision_limit');
      const next = { revision: current.revision + 1, document };
      store.put(next, 'default');
      return next;
    }, options);
  }

  return Object.freeze({
    async load(options = {}) { return transact('readonly', null, options); },
    async save(document, expectedRevision, options = {}) {
      ensureAvailable(); checkRevision(expectedRevision);
      let validated;
      try { validated = normalizeNotebook(document); } catch { throw new StorageError('storage'); }
      // A detached, validated snapshot is captured before open() can yield.
      return write(validated, expectedRevision, options);
    },
    async clear(expectedRevision, options = {}) {
      ensureAvailable(); checkRevision(expectedRevision);
      return write(null, expectedRevision, options);
    },
    close() {
      if (state === 'closed') return;
      state = 'closed'; cancelOperations(new StorageError('cancelled'));
      cancelOpening?.(new StorageError('cancelled'));
      if (connection) connection.close();
      connection = null;
    },
  });
}
