/* DOM harness adapted from Decisões Abertas, MIT, Copyright (c) 2026 Contribuidores da LOFRANO TECNOLOGIA. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {parseHTML} from 'linkedom';
import {IDBFactory} from 'fake-indexeddb';
import {mountApp, todayInSaoPaulo} from '../assets/app.mjs';
import * as D from '../assets/domain.mjs';
import {createExampleNotebook} from '../assets/example.mjs';
import {minutesMarkdown, workingMarkdown, actionsCsv} from '../assets/formats.mjs';
import {createStore, StorageError} from '../assets/store.mjs';

const markup = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const fixedDate = '2026-11-08T15:30:00.000Z';
const clone = value => structuredClone(value);

// Linkedom 0.18.15 parses select controls but omits the standard value setter.
// Supply only that missing DOM behavior, rather than changing application code
// to fit the test renderer. These tests do not simulate browser layout.
const selectPrototype = Object.getPrototypeOf(parseHTML('<select></select>').document.querySelector('select'));
Object.defineProperty(selectPrototype, 'value', {
  configurable: true,
  get() { return this.querySelector('option[selected]')?.value ?? ''; },
  set(value) {
    let selected = false;
    for (const option of this.querySelectorAll('option')) {
      const matches = !selected && option.value === String(value);
      option.toggleAttribute('selected', matches);
      if (matches) selected = true;
    }
  },
});

function memoryStore(initial = {revision: 0, document: null}) {
  let envelope = clone(initial);
  const calls = {load: [], save: [], clear: [], close: []};
  return {
    calls,
    async load() { calls.load.push(true); return clone(envelope); },
    async save(document, revision) {
      calls.save.push({document: clone(document), revision});
      if (revision !== envelope.revision) throw new StorageError('conflict');
      envelope = {revision: revision + 1, document: D.normalizeNotebook(document)};
      return clone(envelope);
    },
    async clear(revision) {
      calls.clear.push(revision);
      if (revision !== envelope.revision) throw new StorageError('conflict');
      envelope = {revision: revision + 1, document: null};
      return clone(envelope);
    },
    close() { calls.close.push(true); },
    read: () => clone(envelope),
    external(document) { envelope = {revision: envelope.revision + 1, document: D.normalizeNotebook(document)}; },
  };
}

function fixture(options = {}) {
  const {window, document} = parseHTML(markup);
  const host = document.querySelector('#app');
  const downloads = [];
  const store = options.store ?? memoryStore(options.envelope);
  let id = 0;
  const app = mountApp(host, {store, id: () => 'ui-' + ++id,
    now: options.now ?? (() => fixedDate), today: () => '2026-11-08', download: (filename, text, type) => downloads.push({filename, text, type})});
  const findButton = (label, scope = host) => {
    const result = [...scope.querySelectorAll('button')].find(button => button.textContent.trim() === label || button.getAttribute('aria-label') === label);
    assert.ok(result, 'Button not found: ' + label);
    return result;
  };
  const settle = async () => { await nextTurn(); await app.flush(); await nextTurn(); };
  const dispatch = async (element, type, wait = true) => {
    assert.ok(element, 'Missing event target');
    element.dispatchEvent(new window.Event(type, {bubbles: true, cancelable: true}));
    if (wait) await settle();
  };
  const click = async (label, scope = host, wait = true) => {
    const button = findButton(label, scope);
    assert.equal(button.hasAttribute('disabled'), false, 'Button unexpectedly disabled: ' + label);
    await dispatch(button, 'click', wait);
  };
  const fill = (name, value, scope = host) => {
    const field = scope.querySelector(`[name="${name}"]`);
    assert.ok(field, 'Field not found: ' + name);
    field.value = value;
    field.dispatchEvent(new window.Event('input', {bubbles: true, cancelable: true}));
  };
  const submit = async (form = host.querySelector('#editor-form'), wait = true) => dispatch(form, 'submit', wait);
  const file = async (candidate, wait = true) => {
    const input = host.querySelector('#backup-file');
    assert.ok(input);
    Object.defineProperty(input, 'files', {configurable: true, value: [candidate]});
    await dispatch(input, 'change', wait);
  };
  return {window, document, host, app, downloads, store, findButton, settle, dispatch, click, fill, submit, file};
}

function fileOf(text) {
  const bytes = new TextEncoder().encode(text);
  return {name: 'caderno-sintetico.json', size: bytes.byteLength,
    arrayBuffer: async () => bytes.slice().buffer};
}

async function waitFor(predicate, message = 'The expected asynchronous state did not arrive') {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await nextTurn();
  }
  assert.ok(predicate(), message);
}

async function example(f) {
  await f.click('Explorar exemplo fictício');
  assert.equal(f.app.getDocument().meetings.length, 1);
  return f.app.getDocument().meetings[0];
}

async function files(f) { await f.click('Backup e salvamento'); }

async function changeTitle(f, title, wait = true) {
  await f.click('Editar reunião', f.host, wait);
  f.fill('title', title); await f.submit(undefined, wait);
}

async function loadBook(f, book) {
  await files(f);
  await f.file(fileOf(D.serializeNotebook(book)));
  await f.click('Substituir pelo backup');
}

test('initial mount is empty, temporary and touches no optional persistence', t => {
  const f = fixture(); t.after(() => f.app.destroy());
  assert.deepEqual(f.app.getDocument(), D.emptyNotebook());
  assert.deepEqual(f.store.calls.load, []);
  assert.deepEqual(f.store.calls.save, []);
  assert.deepEqual(f.store.calls.clear, []);
  assert.match(f.host.querySelector('#storage-status').textContent, /Sessão temporária/);
  assert.ok(f.findButton('Criar minha primeira reunião'));
  assert.ok(!f.host.querySelector('[role="alert"]'));
});

test('meeting, participant, topic, decision and action forms create valid linked records', async t => {
  const f = fixture(); t.after(() => f.app.destroy());
  await f.click('Criar minha primeira reunião');
  f.fill('title', ''); f.fill('objective', 'Contexto ainda em edição'); await f.submit();
  assert.equal(f.app.getDocument().meetings.length, 0);
  assert.equal(f.host.querySelector('[name="objective"]').value, 'Contexto ainda em edição');
  assert.ok(f.host.querySelector('[role="alert"]'));
  f.fill('title', 'Encontro sintético'); f.fill('date', '2026-11-08'); f.fill('time', '14:00');
  f.fill('location', 'Sala imaginária'); await f.submit();
  let meeting = f.app.getDocument().meetings[0];
  assert.equal(meeting.title, 'Encontro sintético'); assert.equal(meeting.status, 'draft');
  assert.equal(f.findButton('Iniciar reunião').hasAttribute('disabled'), true);
  await f.click('Adicionar participante'); f.fill('name', 'Pessoa fictícia'); f.fill('attendance', 'present'); await f.submit();
  await f.click('Adicionar ponto'); f.fill('title', 'Organização do espaço'); f.fill('minutes', '12'); await f.submit();
  await f.click('Editar título e tempo'); f.fill('minutes', '480.5'); await f.submit();
  assert.equal(f.app.getDocument().meetings[0].agenda[0].minutes, 12);
  assert.equal(f.host.querySelector('#editor-form [name="minutes"]').value, '480.5');
  f.fill('minutes', '15'); f.fill('title', 'Espaço compartilhado'); await f.submit();
  f.fill('notes', 'Manter a circulação livre.', f.host.querySelector('#topic-notes'));
  f.fill('topicStatus', 'discussed', f.host.querySelector('#topic-notes'));
  await f.submit(f.host.querySelector('#topic-notes'));
  await f.click('Registrar decisão'); f.fill('text', 'Usar o material do acervo.'); f.fill('reason', 'Evitar uma compra nova.'); await f.submit();
  meeting = f.app.getDocument().meetings[0];
  await f.click('Adicionar ação'); f.fill('text', 'Revisar a sinalização.'); f.fill('ownerId', meeting.participants[0].id);
  f.fill('due', '2026-11-09'); await f.submit();
  meeting = f.app.getDocument().meetings[0];
  assert.equal(meeting.agenda[0].title, 'Espaço compartilhado');
  assert.equal(meeting.agenda[0].notes, 'Manter a circulação livre.');
  assert.equal(meeting.agenda[0].status, 'discussed');
  assert.equal(meeting.decisions[0].topicId, meeting.agenda[0].id);
  assert.equal(meeting.actions[0].topicId, meeting.agenda[0].id);
  assert.equal(meeting.actions[0].ownerId, meeting.participants[0].id);
  assert.equal(meeting.actions[0].due, '2026-11-09');
  assert.match(f.host.querySelector('.agenda-bar').textContent, /15 min planejados/);
  assert.deepEqual(D.normalizeNotebook(f.app.getDocument()), f.app.getDocument());
  assert.equal(f.store.calls.save.length, 0);
});

test('closing and revising minutes preserves version one independently of later working edits', async t => {
  const f = fixture(); t.after(() => f.app.destroy());
  await f.click('Criar minha primeira reunião'); f.fill('title', 'Reunião de teste'); await f.submit();
  await f.click('Adicionar ponto'); f.fill('title', 'Abertura'); f.fill('minutes', '5'); await f.submit();
  await f.click('Iniciar reunião'); assert.equal(f.app.getDocument().meetings[0].status, 'running');
  await f.click('Encerrar e gerar ata'); assert.equal(f.app.getDocument().meetings[0].minutes.length, 0);
  await f.click('Cancelar', f.host.querySelector('.confirmation'));
  assert.equal(f.app.getDocument().meetings[0].status, 'running');
  await f.click('Encerrar e gerar ata'); await f.click('Confirmar');
  const first = clone(f.app.getDocument().meetings[0].minutes[0]);
  assert.equal(first.version, 1); assert.equal(first.closedAt, fixedDate); assert.equal(first.meeting.status, 'closed');
  assert.equal(f.findButton('Gerar nova versão').hasAttribute('disabled'), true);
  await changeTitle(f, 'Reunião acompanhada');
  assert.match(f.host.querySelector('.record-change').textContent, /alterações na ficha/);
  await f.click('Gerar nova versão'); await f.click('Confirmar');
  const meeting = f.app.getDocument().meetings[0];
  assert.deepEqual(meeting.minutes[0], first); assert.equal(meeting.minutes[1].version, 2);
  assert.equal(meeting.minutes[1].meeting.title, 'Reunião acompanhada');
  assert.equal(D.hasUnpublishedChanges(meeting), false);
  await f.click('Atas'); await f.click('Ler ata versão 1');
  assert.equal(f.host.querySelector('.minutes-paper h3').textContent, 'Reunião de teste');
  await f.click('Pauta'); await changeTitle(f, 'Edição posterior à segunda ata'); await f.click('Atas');
  assert.equal(f.host.querySelector('.minutes-paper h2').textContent, 'Ata · versão 1');
  assert.equal(f.host.querySelector('.minutes-paper h3').textContent, 'Reunião de teste');
  await f.click('Ler ficha de trabalho');
  assert.equal(f.host.querySelector('.minutes-paper h3').textContent, 'Edição posterior à segunda ata');
});

test('topic ordering and linked removals require confirmation and preserve historical associations', async t => {
  const f = fixture(); t.after(() => f.app.destroy()); const original = await example(f);
  await f.click('Mover ponto para baixo: Abrir a conversa');
  assert.deepEqual(f.app.getDocument().meetings[0].agenda.map(item => item.id), ['espacos', 'abertura', 'proximos']);
  await f.click('Abrir ponto Organização dos espaços'); await f.click('Remover ponto da ficha');
  assert.equal(f.app.getDocument().meetings[0].agenda.length, 3);
  assert.match(f.host.querySelector('.confirmation').textContent, /desvinculadas/);
  await f.click('Confirmar');
  let meeting = f.app.getDocument().meetings[0];
  assert.equal(meeting.agenda.length, 2); assert.equal(meeting.decisions[0].topicId, null);
  assert.equal(meeting.actions.find(item => item.id === 'lista').topicId, null);
  assert.deepEqual(meeting.minutes, original.minutes);
  await f.click('Remover participante Pessoa A'); await f.click('Confirmar');
  meeting = f.app.getDocument().meetings[0];
  assert.equal(meeting.actions.find(item => item.id === 'sinais').ownerId, null);
  assert.deepEqual(meeting.minutes, original.minutes);
  await f.click('Remover reunião'); await f.click('Cancelar', f.host.querySelector('.confirmation'));
  assert.equal(f.app.getDocument().meetings.length, 1);
  await f.click('Remover reunião'); await f.click('Confirmar');
  assert.equal(f.app.getDocument().meetings.length, 0);
});

test('backup, historical Markdown, working Markdown and filtered CSV are the real helpers', async t => {
  const f = fixture(); t.after(() => f.app.destroy()); await example(f);
  const current = f.app.getDocument();
  await files(f); await f.click('Baixar backup JSON'); await f.click('Baixar ficha atual');
  assert.equal(f.downloads[0].filename, 'pauta-aberta.json');
  assert.deepEqual(D.parseNotebook(f.downloads[0].text), current);
  assert.equal(f.downloads[1].text, workingMarkdown(current.meetings[0]));
  await f.click('Atas'); await f.click('Ler ata versão 1'); await f.click('Baixar ata 1 · Markdown');
  assert.equal(f.downloads[2].text, minutesMarkdown(current.meetings[0], 1));
  assert.notEqual(f.downloads[2].text, f.downloads[1].text);
  await f.click('Encaminhamentos'); await f.click('Baixar estes encaminhamentos · CSV');
  assert.equal(f.downloads[3].text, actionsCsv(current, '2026-11-08', {status: 'open'}));
  const filter = f.host.querySelector('[aria-label="Filtrar encaminhamentos"]'); filter.value = 'all';
  await f.dispatch(filter, 'change'); await f.click('Baixar estes encaminhamentos · CSV');
  assert.equal(f.downloads[4].text, actionsCsv(current, '2026-11-08', {status: 'all'}));
  assert.equal(f.host.querySelectorAll('.action-table tbody tr').length, 2);
  assert.equal(f.host.querySelectorAll('.action-cards .action-card').length, 2);
});

test('action status updates the current sheet while its preserved minutes remain unchanged', async t => {
  const f = fixture(); t.after(() => f.app.destroy()); const original = await example(f);
  await f.click('Encaminhamentos');
  const control = f.host.querySelector('.action-table select');
  assert.ok(control.getAttribute('aria-label')); control.value = 'done'; await f.dispatch(control, 'change');
  const current = f.app.getDocument().meetings[0];
  assert.equal(current.actions.find(item => item.id === 'sinais').status, 'done');
  assert.deepEqual(current.minutes, original.minutes);
  assert.equal(f.host.querySelectorAll('.action-table tbody tr').length, 0);
});

test('valid imports remain a stable preview until explicit replacement and can be cancelled', async t => {
  const f = fixture(); t.after(() => f.app.destroy()); await example(f); await files(f);
  const before = f.app.getDocument();
  const replacement = D.updateMeeting(createExampleNotebook(), 'mostra-aurora', {title: 'Backup importado'});
  await f.file(fileOf(D.serializeNotebook(replacement)));
  assert.deepEqual(f.app.getDocument(), before);
  assert.match(f.host.querySelector('.import-preview').textContent, /1 reuniões.*3 pontos.*1 atas/s);
  await f.click('Cancelar importação');
  assert.ok(!f.host.querySelector('.import-preview')); assert.deepEqual(f.app.getDocument(), before);
  await f.file(fileOf(D.serializeNotebook(replacement))); await f.click('Substituir pelo backup');
  assert.deepEqual(f.app.getDocument(), replacement); assert.ok(!f.host.querySelector('.import-preview'));
  assert.equal(f.store.calls.save.length, 0);
});

test('invalid UTF-8, JSON, schema, read errors and oversized bytes remove old previews without replacing the session', async t => {
  const f = fixture(); t.after(() => f.app.destroy()); await example(f); await files(f);
  const before = f.app.getDocument();
  for (const candidate of [
    {size: 2, arrayBuffer: async () => Uint8Array.of(0xc3, 0x28).buffer},
    fileOf('{invalid JSON PRIVATE_SYNTHETIC}'), fileOf('{"schemaVersion":2,"meetings":[]}'),
    {size: 5, arrayBuffer: async () => { throw new Error('PRIVATE_SYNTHETIC'); }},
    {size: D.LIMITS.maxNotebookBytes + 1, arrayBuffer: async () => { throw new Error('Must not read oversized input'); }},
    {size: 1, arrayBuffer: async () => new TextEncoder().encode(' '.repeat(D.LIMITS.maxNotebookBytes + 1)).buffer},
  ]) {
    await f.file(fileOf(D.serializeNotebook(createExampleNotebook()))); assert.ok(f.host.querySelector('.import-preview'));
    await f.file(candidate);
    assert.ok(!f.host.querySelector('.import-preview')); assert.ok(!f.host.querySelector('#import-confirm'));
    assert.deepEqual(f.app.getDocument(), before);
    assert.ok(f.host.querySelector('[role="alert"]'));
    assert.ok(!f.host.querySelector('[role="alert"]').textContent.includes('PRIVATE_SYNTHETIC'));
  }
  await f.click('Baixar backup JSON'); assert.deepEqual(D.parseNotebook(f.downloads.at(-1).text), before);
});

test('out-of-order reads cannot replace newer import previews and committed edits invalidate pending imports', async t => {
  const f = fixture(); t.after(() => f.app.destroy()); await example(f); await files(f);
  let release;
  const bytes = new TextEncoder().encode(D.serializeNotebook(createExampleNotebook()));
  const delayed = {size: bytes.length, arrayBuffer: () => new Promise(resolve => { release = () => resolve(bytes.buffer); })};
  const older = f.app.importFile(delayed);
  const newer = D.updateMeeting(createExampleNotebook(), 'mostra-aurora', {title: 'Importação mais recente'});
  await f.app.importFile(fileOf(D.serializeNotebook(newer))); release(); await older;
  await f.click('Substituir pelo backup'); assert.equal(f.app.getDocument().meetings[0].title, 'Importação mais recente');
  const pending = f.app.importFile(delayed); await f.click('Pauta'); await changeTitle(f, 'Edição própria posterior');
  release(); await pending; await files(f);
  assert.ok(!f.host.querySelector('.import-preview'));
  assert.equal(f.app.getDocument().meetings[0].title, 'Edição própria posterior');
});

test('example replacement requires an explicit preview when existing meetings contain user changes', async t => {
  const f = fixture(); t.after(() => f.app.destroy()); await example(f); await changeTitle(f, 'Conteúdo próprio'); await files(f);
  await f.click('Explorar exemplo fictício'); assert.equal(f.app.getDocument().meetings[0].title, 'Conteúdo próprio');
  assert.match(f.host.querySelector('.import-preview').textContent, /Exemplo fictício validado/);
  await f.click('Cancelar importação'); assert.equal(f.app.getDocument().meetings[0].title, 'Conteúdo próprio');
  await f.click('Explorar exemplo fictício'); await f.click('Substituir pelo backup');
  assert.equal(f.app.getDocument().meetings[0].title, 'Mostra do Bairro Aurora');
});

test('optional persistence saves only after activation and clearing retains the current session plus revision tombstone', async t => {
  const f = fixture(); t.after(() => f.app.destroy()); await example(f); await files(f);
  assert.equal(f.store.calls.save.length, 0);
  await f.click('Ativar salvamento', f.host.querySelector('.storage-section'));
  assert.equal(f.store.calls.save.length, 1); assert.equal(f.store.calls.save[0].revision, 0);
  await f.click('Pauta'); await changeTitle(f, 'Ficha acompanhada');
  assert.equal(f.store.calls.save.length, 2); assert.equal(f.store.calls.save[1].revision, 1);
  const before = f.app.getDocument(); await files(f);
  await f.click('Desativar e apagar salvamento'); await f.click('Cancelar', f.host.querySelector('.confirmation'));
  assert.equal(f.store.calls.clear.length, 0);
  await f.click('Desativar e apagar salvamento'); await f.click('Confirmar');
  assert.deepEqual(f.store.read(), {revision: 3, document: null}); assert.deepEqual(f.app.getDocument(), before);
  assert.match(f.host.querySelector('#storage-status').textContent, /Sessão temporária/);
  await f.click('Baixar backup JSON'); assert.deepEqual(D.parseNotebook(f.downloads.at(-1).text), before);
});

test('enabling storage never silently replaces an existing saved notebook', async t => {
  const saved = D.updateMeeting(createExampleNotebook(), 'mostra-aurora', {title: 'Caderno salvo'});
  const f = fixture({envelope: {revision: 7, document: saved}}); t.after(() => f.app.destroy());
  await example(f); await files(f); await f.click('Ativar salvamento', f.host.querySelector('.storage-section'));
  assert.equal(f.store.calls.save.length, 0); assert.equal(f.app.getDocument().meetings[0].title, 'Mostra do Bairro Aurora');
  await f.click('Cancelar', f.host.querySelector('.confirmation')); assert.equal(f.store.calls.save.length, 0);
  await f.click('Ativar salvamento', f.host.querySelector('.storage-section')); await f.click('Confirmar');
  assert.deepEqual(f.app.getDocument(), saved);
  await f.click('Pauta'); await changeTitle(f, 'Novo acompanhamento');
  assert.equal(f.store.calls.save[0].revision, 7);
});

test('a competing real IndexedDB revision prevents overwrite and allows explicit recovery', async t => {
  const indexedDB = new IDBFactory(); const name = 'pauta-ui-real-conflict';
  const store = createStore({indexedDB, name}); const other = createStore({indexedDB, name});
  const f = fixture({store}); t.after(() => { f.app.destroy(); other.close(); });
  assert.deepEqual(await indexedDB.databases(), []); await example(f); await files(f);
  await f.click('Ativar salvamento', f.host.querySelector('.storage-section'), false);
  await waitFor(() => f.host.querySelector('#storage-status').textContent === 'Salvo neste navegador');
  const original = await other.load();
  const remote = D.updateMeeting(original.document, 'mostra-aurora', {title: 'Outra aba'});
  await other.save(remote, original.revision);
  await f.click('Pauta'); await changeTitle(f, 'Minha edição mantida em memória');
  assert.match(f.host.querySelector('#storage-status').textContent, /Conflito/);
  assert.equal((await other.load()).document.meetings[0].title, 'Outra aba');
  assert.equal(f.app.getDocument().meetings[0].title, 'Minha edição mantida em memória');
  await files(f); await f.click('Baixar backup JSON');
  assert.deepEqual(D.parseNotebook(f.downloads.at(-1).text), f.app.getDocument());
  await f.click('Abrir salvo', f.host.querySelector('.storage-section'), false);
  await waitFor(() => f.host.querySelector('.confirmation')); await f.click('Confirmar');
  assert.deepEqual(f.app.getDocument(), remote);
});

test('an external clear leaves a real tombstone that an old tab cannot reset to revision zero', async t => {
  const indexedDB = new IDBFactory(); const name = 'pauta-ui-real-tombstone';
  const store = createStore({indexedDB, name}); const other = createStore({indexedDB, name});
  const f = fixture({store}); t.after(() => { f.app.destroy(); other.close(); });
  await example(f); await files(f); await f.click('Ativar salvamento', f.host.querySelector('.storage-section'), false);
  await waitFor(() => f.host.querySelector('#storage-status').textContent === 'Salvo neste navegador');
  assert.deepEqual(await other.clear(1), {revision: 2, document: null});
  await f.click('Pauta'); await changeTitle(f, 'Sessão antiga preservada');
  assert.match(f.host.querySelector('#storage-status').textContent, /Conflito/);
  assert.deepEqual(await other.load(), {revision: 2, document: null});
  await assert.rejects(other.save(D.emptyNotebook(), 0), {code: 'conflict'});
  await files(f); await f.click('Ativar salvamento', f.host.querySelector('.storage-section'), false);
  await waitFor(() => f.host.querySelector('#storage-status').textContent === 'Salvo neste navegador');
  const reopened = await other.load(); assert.equal(reopened.revision, 3);
  assert.equal(reopened.document.meetings[0].title, 'Sessão antiga preservada');
});

test('edits queued during an outstanding save coalesce and use its committed revision', async t => {
  const store = memoryStore(); const received = []; let release;
  const save = store.save.bind(store);
  store.save = async (document, revision) => {
    received.push({document: clone(document), revision});
    if (received.length === 1) await new Promise(resolve => { release = resolve; });
    return save(document, revision);
  };
  const f = fixture({store}); t.after(() => f.app.destroy()); await example(f); await files(f);
  await f.click('Ativar salvamento', f.host.querySelector('.storage-section'), false);
  await waitFor(() => received.length === 1); await f.click('Pauta', f.host, false);
  for (const title of ['Primeira edição', 'Segunda edição', 'Terceira edição']) await changeTitle(f, title, false);
  assert.equal(received.length, 1); release(); await f.app.flush(); await f.settle();
  assert.deepEqual(received.map(item => item.revision), [0, 1]);
  assert.equal(received[0].document.meetings[0].title, 'Mostra do Bairro Aurora');
  assert.equal(received[1].document.meetings[0].title, 'Terceira edição');
  assert.equal(store.read().document.meetings[0].title, 'Terceira edição');
});

test('save failure preserves both committed session data and a form draft typed while waiting', async t => {
  const store = memoryStore(); let rejectSave;
  store.save = () => new Promise((resolve, reject) => { rejectSave = reject; });
  const f = fixture({store}); t.after(() => f.app.destroy()); await example(f); await files(f);
  await f.click('Ativar salvamento', f.host.querySelector('.storage-section'), false);
  await waitFor(() => rejectSave); await f.click('Pauta', f.host, false); await f.click('Editar reunião', f.host, false);
  f.fill('title', 'Rascunho ainda não submetido'); rejectSave(new StorageError('storage'));
  await f.app.flush(); await f.settle();
  assert.equal(f.host.querySelector('#editor-form [name="title"]').value, 'Rascunho ainda não submetido');
  assert.equal(f.app.getDocument().meetings[0].title, 'Mostra do Bairro Aurora');
  assert.match(f.host.querySelector('#storage-status').textContent, /Falha ao salvar/);
  assert.ok(f.host.querySelector('[role="alert"]'));
  await f.click('Cancelar', f.host.querySelector('#editor-form')); await files(f); await f.click('Baixar backup JSON');
  assert.deepEqual(D.parseNotebook(f.downloads.at(-1).text), f.app.getDocument());
});

test('committed edits during a saved read prevent replacement by stale loaded information', async t => {
  const store = memoryStore(); let release;
  store.load = () => new Promise(resolve => { release = resolve; });
  const f = fixture({store}); t.after(() => f.app.destroy()); await example(f); await files(f);
  await f.click('Abrir salvo', f.host.querySelector('.storage-section'), false);
  await waitFor(() => release); await f.click('Pauta', f.host, false); await changeTitle(f, 'Edição posterior à leitura', false);
  release({revision: 9, document: createExampleNotebook()}); await f.settle();
  assert.equal(f.app.getDocument().meetings[0].title, 'Edição posterior à leitura');
  assert.ok(!f.host.querySelector('.confirmation'));
  assert.match(f.host.querySelector('[role="alert"]').textContent, /sessão mudou/);
  assert.equal(store.calls.save.length, 0);
});

test('working edits during clear remain temporary and cannot recreate the erased saved document', async t => {
  const store = memoryStore(); const clear = store.clear.bind(store); let release;
  store.clear = async revision => { await new Promise(resolve => { release = resolve; }); return clear(revision); };
  const f = fixture({store}); t.after(() => f.app.destroy()); await example(f); await files(f);
  await f.click('Ativar salvamento', f.host.querySelector('.storage-section'));
  await f.click('Desativar e apagar salvamento'); await f.click('Confirmar', f.host, false);
  await waitFor(() => release); await f.click('Pauta', f.host, false); await changeTitle(f, 'Edição temporária durante limpeza', false);
  assert.equal(store.calls.save.length, 1); release(); await waitFor(() => store.read().document === null); await f.settle();
  assert.deepEqual(store.read(), {revision: 2, document: null}); assert.equal(store.calls.save.length, 1);
  assert.equal(f.app.getDocument().meetings[0].title, 'Edição temporária durante limpeza');
  assert.match(f.host.querySelector('#storage-status').textContent, /Sessão temporária/);
});

test('destroy during an import or saved read leaves the disposed host empty without later saves', async () => {
  const f = fixture(); await example(f); let releaseImport;
  const bytes = new TextEncoder().encode(D.serializeNotebook(createExampleNotebook()));
  const pending = f.app.importFile({size: bytes.length, arrayBuffer: () => new Promise(resolve => { releaseImport = () => resolve(bytes.buffer); })});
  f.app.destroy(); releaseImport(); await pending; await f.settle();
  assert.equal(f.host.childNodes.length, 0); assert.equal(f.store.calls.close.length, 1); assert.equal(f.store.calls.save.length, 0);
  const store = memoryStore(); let releaseLoad; store.load = () => new Promise(resolve => { releaseLoad = resolve; });
  const g = fixture({store}); await files(g); await g.click('Abrir salvo', g.host.querySelector('.storage-section'), false);
  await waitFor(() => releaseLoad); g.app.destroy(); releaseLoad({revision: 1, document: createExampleNotebook()}); await g.settle();
  assert.equal(g.host.childNodes.length, 0); assert.equal(store.calls.close.length, 1); assert.equal(store.calls.save.length, 0);
});

test('imported titles, notes, names and links remain text nodes in working and historical views', async t => {
  const f = fixture(); t.after(() => f.app.destroy());
  const payload = '<img src=x onerror=alert(1)><script>alert(1)</script>[link](javascript:evil)';
  let book = D.updateMeeting(createExampleNotebook(), 'mostra-aurora', {title: payload});
  book = D.updateTopic(book, 'mostra-aurora', 'abertura', {title: payload, notes: payload});
  book = D.updateParticipant(book, 'mostra-aurora', 'pessoa-a', {name: payload.slice(0, 80)});
  book = D.updateDecision(book, 'mostra-aurora', 'mesas', {text: payload, reason: payload});
  book = D.snapshotMinutes(book, 'mostra-aurora', fixedDate);
  await loadBook(f, book); await f.click('Pauta');
  assert.equal(f.host.querySelector('h1').textContent, payload);
  assert.equal(f.host.querySelector('#topic-notes [name="notes"]').value, payload);
  assert.equal(f.host.querySelectorAll('img,script,iframe,[onerror],[onload],a[href^="javascript:"]').length, 0);
  await f.click('Atas'); await f.click('Ler ata versão 2');
  assert.ok(f.host.querySelector('.minutes-paper').textContent.includes(payload));
  assert.equal(f.host.querySelectorAll('img,script,iframe,[onerror],[onload],a[href^="javascript:"]').length, 0);
});

test('the application day uses São Paulo civil time across UTC midnight', () => {
  assert.equal(todayInSaoPaulo(new Date('2026-11-09T01:00:00.000Z')), '2026-11-08');
  assert.equal(todayInSaoPaulo(new Date('2026-11-09T03:00:00.000Z')), '2026-11-09');
});

test('a saved read completing after note entry preserves the unsubmitted topic draft', async t => {
  const store = memoryStore(); let release;
  store.load = () => new Promise(resolve => { release = resolve; });
  const f = fixture({store}); t.after(() => f.app.destroy()); await example(f); await files(f);
  const original = f.app.getDocument();
  await f.click('Abrir salvo', f.host.querySelector('.storage-section'), false);
  await waitFor(() => release); await f.click('Pauta', f.host, false);
  f.fill('notes', 'Texto ainda não submetido após iniciar a leitura.', f.host.querySelector('#topic-notes'));
  release({revision: 0, document: null}); await f.settle();
  assert.equal(f.host.querySelector('#topic-notes [name="notes"]').value, 'Texto ainda não submetido após iniciar a leitura.');
  assert.deepEqual(f.app.getDocument(), original);
  assert.match(f.host.textContent, /ainda não salvo|rascunho/i);
  await f.submit(f.host.querySelector('#topic-notes'));
  assert.equal(f.app.getDocument().meetings[0].agenda[0].notes, 'Texto ainda não submetido após iniciar a leitura.');
});

test('unsubmitted notes survive switching topics and tabs while committed data stays unchanged', async t => {
  const f = fixture(); t.after(() => f.app.destroy()); await example(f);
  const original = f.app.getDocument();
  f.fill('notes', 'Rascunho do primeiro ponto.', f.host.querySelector('#topic-notes'));
  await f.click('Abrir ponto Organização dos espaços');
  f.fill('notes', 'Rascunho do segundo ponto.', f.host.querySelector('#topic-notes'));
  await f.click('Atas'); await f.click('Pauta');
  assert.equal(f.host.querySelector('#topic-notes [name="notes"]').value, 'Rascunho do segundo ponto.');
  await f.click('Abrir ponto Abrir a conversa');
  assert.equal(f.host.querySelector('#topic-notes [name="notes"]').value, 'Rascunho do primeiro ponto.');
  assert.deepEqual(f.app.getDocument(), original);
  await f.submit(f.host.querySelector('#topic-notes'));
  assert.equal(f.app.getDocument().meetings[0].agenda[0].notes, 'Rascunho do primeiro ponto.');
  assert.deepEqual(f.app.getDocument().meetings[0].minutes, original.meetings[0].minutes);
  await f.click('Abrir ponto Organização dos espaços');
  assert.equal(f.host.querySelector('#topic-notes [name="notes"]').value, 'Rascunho do segundo ponto.');
});

test('editor drafts are associated with the correct meeting across navigation', async t => {
  const f = fixture(); t.after(() => f.app.destroy()); await example(f);
  await f.click('Nova reunião'); f.fill('title', 'Segunda reunião fictícia'); await f.submit();
  await f.click('Abrir reunião Mostra do Bairro Aurora'); await f.click('Editar reunião');
  f.fill('objective', 'Objetivo em edição apenas para a primeira reunião.');
  await f.click('Abrir reunião Segunda reunião fictícia'); await f.click('Editar reunião');
  assert.equal(f.host.querySelector('#editor-form [name="objective"]').value, '');
  await f.click('Cancelar', f.host.querySelector('#editor-form'));
  await f.click('Abrir reunião Mostra do Bairro Aurora'); await f.click('Editar reunião');
  assert.equal(f.host.querySelector('#editor-form [name="objective"]').value, 'Objetivo em edição apenas para a primeira reunião.');
  assert.notEqual(f.app.getDocument().meetings[0].objective, 'Objetivo em edição apenas para a primeira reunião.');
  await f.submit();
  assert.equal(f.app.getDocument().meetings[0].objective, 'Objetivo em edição apenas para a primeira reunião.');
  assert.equal(f.app.getDocument().meetings[1].objective, '');
});

test('backup, minutes and replacement cannot silently omit dirty text still held in a form', async t => {
  const f = fixture(); t.after(() => f.app.destroy()); await example(f);
  const original = f.app.getDocument();
  f.fill('notes', 'Rascunho que precisa ser incluído antes de exportar.', f.host.querySelector('#topic-notes'));
  await f.click('Backup JSON'); assert.equal(f.downloads.length, 0);
  assert.ok(f.host.querySelector('[role="alert"]'));
  await f.click('Gerar nova versão');
  assert.ok(!f.host.querySelector('.confirmation'));
  assert.equal(f.app.getDocument().meetings[0].minutes.length, original.meetings[0].minutes.length);
  await files(f); await f.file(fileOf(D.serializeNotebook(D.emptyNotebook())));
  assert.ok(f.host.querySelector('.import-preview'));
  await f.click('Substituir pelo backup');
  assert.ok(f.host.querySelector('[role="alert"]'));
  assert.deepEqual(f.app.getDocument(), original);
  await f.click('Cancelar importação');
  await f.click('Pauta');
  assert.equal(f.host.querySelector('#topic-notes [name="notes"]').value, 'Rascunho que precisa ser incluído antes de exportar.');
  await f.submit(f.host.querySelector('#topic-notes')); await f.click('Backup JSON');
  assert.equal(D.parseNotebook(f.downloads.at(-1).text).meetings[0].agenda[0].notes,
    'Rascunho que precisa ser incluído antes de exportar.');
});

test('notes typed after the closing confirmation block closing until the form is saved', async t => {
  const f = fixture(); t.after(() => f.app.destroy());
  await f.click('Criar minha primeira reunião'); f.fill('title', 'Reunião em andamento'); await f.submit();
  await f.click('Adicionar ponto'); f.fill('title', 'Ponto em discussão'); await f.submit();
  await f.click('Iniciar reunião');
  const before = f.app.getDocument().meetings[0];
  await f.click('Encerrar e gerar ata');
  const note = 'Nota digitada depois de abrir a confirmação de encerramento.';
  f.fill('notes', note, f.host.querySelector('#topic-notes'));
  await f.click('Confirmar');
  let meeting = f.app.getDocument().meetings[0];
  assert.equal(meeting.status, 'running');
  assert.equal(meeting.minutes.length, before.minutes.length);
  assert.equal(meeting.agenda[0].notes, before.agenda[0].notes);
  assert.equal(f.host.querySelector('#topic-notes [name="notes"]').value, note);
  assert.match(f.host.querySelector('[role="alert"]').textContent, /ainda não salvo/);
  await f.submit(f.host.querySelector('#topic-notes'));
  await f.click('Encerrar e gerar ata'); await f.click('Confirmar');
  meeting = f.app.getDocument().meetings[0];
  assert.equal(meeting.status, 'closed');
  assert.equal(meeting.minutes.length, before.minutes.length + 1);
  assert.equal(meeting.minutes.at(-1).meeting.agenda[0].notes, note);
});

test('notes typed after the new version confirmation block a snapshot until the form is saved', async t => {
  const f = fixture(); t.after(() => f.app.destroy());
  const before = await example(f);
  await f.click('Gerar nova versão');
  const note = 'Nota digitada depois de abrir a confirmação de nova versão.';
  f.fill('notes', note, f.host.querySelector('#topic-notes'));
  await f.click('Confirmar');
  let meeting = f.app.getDocument().meetings[0];
  assert.equal(meeting.status, 'closed');
  assert.equal(meeting.minutes.length, before.minutes.length);
  assert.deepEqual(meeting.minutes, before.minutes);
  assert.equal(meeting.agenda[0].notes, before.agenda[0].notes);
  assert.equal(f.host.querySelector('#topic-notes [name="notes"]').value, note);
  assert.match(f.host.querySelector('[role="alert"]').textContent, /ainda não salvo/);
  await f.submit(f.host.querySelector('#topic-notes'));
  await f.click('Gerar nova versão'); await f.click('Confirmar');
  meeting = f.app.getDocument().meetings[0];
  assert.equal(meeting.minutes.length, before.minutes.length + 1);
  assert.deepEqual(meeting.minutes[0], before.minutes[0]);
  assert.equal(meeting.minutes.at(-1).meeting.agenda[0].notes, note);
});

test('an older pending file cannot replace a newer explicit example preview', async t => {
  const f = fixture(); t.after(() => f.app.destroy());
  await example(f); await changeTitle(f, 'Sessão própria antes da prévia'); await files(f);
  const olderBook = D.updateMeeting(createExampleNotebook(), 'mostra-aurora', {title: 'Arquivo anterior pendente'});
  const bytes = new TextEncoder().encode(D.serializeNotebook(olderBook));
  let release;
  const pending = f.app.importFile({size: bytes.byteLength,
    arrayBuffer: () => new Promise(resolve => { release = () => resolve(bytes.buffer); })});
  await f.click('Explorar exemplo fictício');
  assert.equal(f.host.querySelector('.import-preview h3').textContent, 'Exemplo fictício validado');
  release(); await pending; await f.settle();
  assert.equal(f.host.querySelector('.import-preview h3').textContent, 'Exemplo fictício validado');
  assert.equal(f.app.getDocument().meetings[0].title, 'Sessão própria antes da prévia');
  await f.click('Substituir pelo backup');
  assert.equal(f.app.getDocument().meetings[0].title, 'Mostra do Bairro Aurora');
  assert.deepEqual(f.app.getDocument(), createExampleNotebook());
});
