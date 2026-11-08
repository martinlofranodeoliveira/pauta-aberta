import test from 'node:test';
import assert from 'node:assert/strict';
import * as domain from '../assets/domain.mjs';

const instant = '2026-11-08T12:34:56.789Z';
const nextInstant = '2026-11-09T00:00:00.000Z';
const utf8 = (value) => new TextEncoder().encode(value).byteLength;
const clone = (value) => JSON.parse(JSON.stringify(value));

function meeting(id = 'meeting-1') {
  return { id, title: 'Reunião fictícia', objective: '', date: '', time: '', location: '',
    status: 'draft', participants: [], agenda: [], decisions: [], actions: [], minutes: [] };
}

function point(id = 'point-1', extra = {}) {
  return { id, title: 'Ponto fictício', minutes: 0, status: 'pending', notes: '', ...extra };
}

function fixture() {
  const row = meeting();
  row.participants.push({ id: 'person-1', name: 'Pessoa fictícia', attendance: 'present' });
  row.agenda.push(point(), point('point-2', { minutes: 15, status: 'deferred' }));
  row.decisions.push({ id: 'decision-1', topicId: 'point-1', text: 'Escolha fictícia', reason: 'Motivo fictício' });
  row.actions.push({ id: 'action-1', topicId: 'point-1', text: 'Ação fictícia', ownerId: 'person-1', due: '2026-11-08', status: 'open' });
  return { schemaVersion: 1, meetings: [row] };
}

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

function rejected(operation, code) {
  assert.throws(operation, (error) => error instanceof domain.DomainError && (!code || error.code === code));
}

function closedFixture() {
  return domain.closeMeeting(domain.startMeeting(fixture(), 'meeting-1'), 'meeting-1', instant);
}

function sizedNotebook(bytes) {
  const book = { schemaVersion: 1, meetings: [] };
  for (let index = 0; index < 20; index += 1) {
    const row = meeting(`meeting-${index}`);
    row.agenda = Array.from({ length: 20 }, (_, position) => point(`point-${position}`));
    book.meetings.push(row);
  }
  let remaining = bytes - utf8(`${JSON.stringify(book, null, 2)}\n`);
  assert.ok(remaining >= 0);
  for (const row of book.meetings) for (const entry of row.agenda) {
    const count = Math.min(remaining, 6000);
    entry.notes = 'x'.repeat(count);
    remaining -= count;
  }
  assert.equal(remaining, 0);
  assert.equal(utf8(`${JSON.stringify(book, null, 2)}\n`), bytes);
  return book;
}

test('empty notebooks and canonical serialization have independent stable copies', () => {
  assert.ok(Object.isFrozen(domain.LIMITS));
  assert.equal(domain.LIMITS.maxNotebookBytes, 2 * 1024 * 1024);
  const first = domain.emptyNotebook();
  const second = domain.emptyNotebook();
  first.meetings.push(meeting());
  assert.deepEqual(second, { schemaVersion: 1, meetings: [] });
  const raw = fixture();
  const reversed = { meetings: raw.meetings, schemaVersion: 1 };
  const result = domain.normalizeNotebook(freeze(reversed));
  assert.deepEqual(Object.keys(result), ['schemaVersion', 'meetings']);
  assert.deepEqual(Object.keys(result.meetings[0]), ['id', 'title', 'objective', 'date', 'time', 'location',
    'status', 'participants', 'agenda', 'decisions', 'actions', 'minutes']);
  assert.notEqual(result.meetings, raw.meetings);
  assert.notEqual(result.meetings[0].actions[0], raw.meetings[0].actions[0]);
  assert.equal(domain.serializeNotebook(result), `${JSON.stringify(result, null, 2)}\n`);
  assert.deepEqual(domain.parseNotebook(domain.serializeNotebook(result)), result);
  assert.equal(domain.serializeNotebook(result), domain.serializeNotebook(reversed));
});

test('creation defaults are explicit and inputs and payloads stay unchanged', () => {
  const input = freeze(domain.emptyNotebook());
  const details = freeze({ id: 'new', title: '  Título preservado  ' });
  const output = domain.createMeeting(input, details);
  assert.deepEqual(input, domain.emptyNotebook());
  assert.deepEqual(details, { id: 'new', title: '  Título preservado  ' });
  assert.deepEqual(output.meetings[0], { ...meeting('new'), title: '  Título preservado  ' });
  assert.equal(domain.hasUnpublishedChanges(output.meetings[0]), true);
});

test('every schema field is required and extras are rejected at each depth', () => {
  const base = closedFixture();
  const selectors = [
    (book) => book,
    (book) => book.meetings[0],
    (book) => book.meetings[0].participants[0],
    (book) => book.meetings[0].agenda[0],
    (book) => book.meetings[0].decisions[0],
    (book) => book.meetings[0].actions[0],
    (book) => book.meetings[0].minutes[0],
    (book) => book.meetings[0].minutes[0].meeting,
  ];
  for (const select of selectors) {
    const original = select(base);
    for (const key of Object.keys(original)) {
      const malformed = clone(base);
      delete select(malformed)[key];
      rejected(() => domain.normalizeNotebook(malformed), 'invalid_shape');
    }
    const extra = clone(base);
    select(extra).extra = 'private rejected text';
    rejected(() => domain.normalizeNotebook(extra), 'invalid_shape');
  }
});

test('objects are plain own enumerable data without executing hostile getters', () => {
  let called = 0;
  const getter = { meetings: [] };
  Object.defineProperty(getter, 'schemaVersion', { enumerable: true, get() { called += 1; throw Error('PRIVATE'); } });
  rejected(() => domain.normalizeNotebook(getter), 'invalid_shape');
  assert.equal(called, 0);
  const inherited = Object.create(domain.emptyNotebook());
  rejected(() => domain.normalizeNotebook(inherited), 'invalid_shape');
  const hidden = domain.emptyNotebook();
  Object.defineProperty(hidden, 'private', { value: 'PRIVATE' });
  rejected(() => domain.normalizeNotebook(hidden), 'invalid_shape');
  const symbol = domain.emptyNotebook(); symbol[Symbol('private')] = 1;
  rejected(() => domain.normalizeNotebook(symbol), 'invalid_shape');
  const toJSON = { ...domain.emptyNotebook(), toJSON() { called += 1; return {}; } };
  rejected(() => domain.serializeNotebook(toJSON), 'invalid_shape');
  assert.equal(called, 0);
  for (const value of [null, [], new Date(0), new Map(), () => {}, new (class Notebook {})()]) {
    rejected(() => domain.normalizeNotebook(value), 'invalid_shape');
  }
  assert.deepEqual(domain.normalizeNotebook(Object.assign(Object.create(null), domain.emptyNotebook())), domain.emptyNotebook());
});

test('hostile proxy exceptions and rejected values never leak into errors', () => {
  const proxy = new Proxy({}, { getPrototypeOf() { throw Error('PRIVATE_PROXY_CONTENT'); } });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const value of [proxy, revoked.proxy]) {
    assert.throws(() => domain.normalizeNotebook(value), (error) => {
      assert.ok(error instanceof domain.DomainError);
      assert.equal(error.code, 'invalid_shape');
      assert.doesNotMatch(error.message, /PRIVATE|Proxy|revoked/);
      return true;
    });
  }
  assert.throws(() => domain.createMeeting(domain.emptyNotebook(), { id: 'PRIVATE@ID', title: 'Title' }),
    (error) => error instanceof domain.DomainError && !error.message.includes('PRIVATE'));
});

test('arrays must be dense ordinary arrays without hidden or extra keys', () => {
  const values = [new Array(1), Object.assign([], { extra: 1 })];
  const symbol = []; symbol[Symbol('private')] = true; values.push(symbol);
  const hidden = []; Object.defineProperty(hidden, 'extra', { value: true }); values.push(hidden);
  const custom = []; Object.setPrototypeOf(custom, {}); values.push(custom);
  let called = false;
  const getter = [meeting()];
  Object.defineProperty(getter, '0', { enumerable: true, get() { called = true; return meeting(); } });
  values.push(getter);
  for (const value of values) rejected(() => domain.normalizeNotebook({ schemaVersion: 1, meetings: value }), 'invalid_shape');
  assert.equal(called, false);
});

test('JSON parsing validates both schema and original input byte limit', () => {
  for (const value of [null, {}, 4, undefined]) rejected(() => domain.parseNotebook(value), 'invalid_json');
  for (const value of ['', '{', '{"PRIVATE":', '\ufeff{}']) rejected(() => domain.parseNotebook(value), 'invalid_json');
  rejected(() => domain.parseNotebook('{"schemaVersion":2,"meetings":[]}'), 'schema_version');
  rejected(() => domain.parseNotebook('{"schemaVersion":1,"meetings":[],"__proto__":{}}'), 'invalid_shape');
  rejected(() => domain.parseNotebook(' '.repeat(domain.LIMITS.maxNotebookBytes) + '{}'), 'document_too_large');
});

test('Unicode text is preserved, counted by code point, and never silently trimmed', () => {
  const book = domain.createMeeting(domain.emptyNotebook(), { id: 'unicode', title: '😀'.repeat(120),
    objective: '  Café\ttexto\r\nsegunda linha  ', location: 'Sala fictícia' });
  assert.equal(book.meetings[0].title, '😀'.repeat(120));
  assert.equal(book.meetings[0].objective, '  Café\ttexto\r\nsegunda linha  ');
  rejected(() => domain.updateMeeting(book, 'unicode', { title: '😀'.repeat(121) }), 'text_limit');
  for (const value of ['', ' \t\r\n', '\u00a0']) rejected(() => domain.updateMeeting(book, 'unicode', { title: value }), 'empty_text');
  for (const value of [true, 7, null, ['title'], new String('title')]) rejected(() => domain.updateMeeting(book, 'unicode', { title: value }), 'invalid_text');
});

test('all prohibited C0 controls and isolated UTF-16 surrogates are rejected', () => {
  for (let number = 0; number < 32; number += 1) {
    if ([9, 10, 13].includes(number)) continue;
    rejected(() => domain.updateMeeting(fixture(), 'meeting-1', { objective: `before${String.fromCharCode(number)}after` }), 'invalid_text');
  }
  for (const value of ['\ud800', '\udfff', 'x\ud800x', '\udc00\ud800']) {
    rejected(() => domain.updateTopic(fixture(), 'meeting-1', 'point-1', { notes: value }), 'invalid_text');
  }
});

test('text field maxima apply to current fields and historical copies', () => {
  const cases = [
    ['meeting', 'title', 120], ['meeting', 'objective', 1000], ['meeting', 'location', 200],
    ['participants', 'name', 80], ['agenda', 'title', 160], ['agenda', 'notes', 6000],
    ['decisions', 'text', 2000], ['decisions', 'reason', 2000], ['actions', 'text', 500],
  ];
  for (const [collection, field, maximum] of cases) {
    const book = fixture();
    const row = collection === 'meeting' ? book.meetings[0] : book.meetings[0][collection][0];
    row[field] = 'x'.repeat(maximum);
    assert.doesNotThrow(() => domain.normalizeNotebook(book));
    row[field] += 'x';
    rejected(() => domain.normalizeNotebook(book), 'text_limit');
  }
  const historical = closedFixture();
  historical.meetings[0].minutes[0].meeting.agenda[0].notes = 'x'.repeat(6001);
  rejected(() => domain.normalizeNotebook(historical), 'text_limit');
});

test('civil Gregorian dates validate leap years and remain independent of UTC conversion', () => {
  for (const value of ['0001-01-01', '0099-12-31', '1600-02-29', '2000-02-29', '2024-02-29', '9999-12-31', '']) {
    assert.equal(domain.validateDate(value), value);
  }
  for (const value of ['0000-01-01', '1900-02-29', '2100-02-29', '2023-02-29', '2026-04-31',
    '2026-00-01', '2026-13-01', '2026-01-00', '2026-1-01', ' 2026-01-01', '2026-01-01Z', null, 20261108]) {
    rejected(() => domain.validateDate(value), 'invalid_date');
  }
  rejected(() => domain.validateDate('', { optional: false }), 'invalid_date');
  rejected(() => domain.validateDate('', { optional: 1 }), 'invalid_option');
  rejected(() => domain.validateDate('', { extra: true }), 'invalid_shape');
  const book = domain.updateMeeting(fixture(), 'meeting-1', { date: '0099-12-31', time: '23:59' });
  assert.equal(book.meetings[0].date, '0099-12-31');
  for (const value of ['24:00', '12:60', '1:00', '12:00:00', ' 12:00', null]) {
    rejected(() => domain.updateMeeting(book, 'meeting-1', { time: value }), 'invalid_time');
  }
});

test('timestamps require real UTC dates and exactly millisecond canonical spelling', () => {
  for (const value of [instant, '0001-01-01T00:00:00.000Z', '0099-12-31T23:59:59.999Z', '2000-02-29T00:00:00.000Z']) {
    assert.equal(domain.validateTimestamp(value), value);
  }
  for (const value of [undefined, '', '2026-11-08T12:34:56Z', '2026-11-08T12:34:56.78Z',
    '2026-11-08T12:34:56.789+00:00', '0000-01-01T00:00:00.000Z', '1900-02-29T00:00:00.000Z',
    '2026-11-08T24:00:00.000Z', '2026-11-08T00:60:00.000Z', '2026-11-08T00:00:60.000Z']) {
    rejected(() => domain.validateTimestamp(value), 'invalid_timestamp');
  }
});

test('IDs are strict ASCII, unique within each collection, and independent between types', () => {
  for (const id of ['', 'a b', 'á', '@id', 'x'.repeat(65), 7, true]) {
    rejected(() => domain.createMeeting(domain.emptyNotebook(), { id, title: 'Title' }), 'invalid_id');
  }
  assert.doesNotThrow(() => domain.createMeeting(domain.emptyNotebook(), { id: 'A_z-019', title: 'Title' }));
  const collections = ['participants', 'agenda', 'decisions', 'actions'];
  for (const collection of collections) {
    const book = fixture(); book.meetings[0][collection].push(clone(book.meetings[0][collection][0]));
    rejected(() => domain.normalizeNotebook(book), 'duplicate_id');
  }
  const duplicate = fixture(); duplicate.meetings.push(clone(duplicate.meetings[0]));
  rejected(() => domain.normalizeNotebook(duplicate), 'duplicate_id');
  let same = domain.createMeeting(domain.emptyNotebook(), { id: 'same', title: 'Title' });
  same = domain.addParticipant(same, 'same', { id: 'same', name: 'Person' });
  same = domain.addTopic(same, 'same', { id: 'same', title: 'Point' });
  same = domain.addDecision(same, 'same', { id: 'same', topicId: 'same', text: 'Decision' });
  same = domain.addAction(same, 'same', { id: 'same', topicId: 'same', ownerId: 'same', text: 'Action' });
  assert.equal(same.meetings[0].actions[0].id, 'same');
});

test('numbers reject coercion and nonintegers and the agenda has a global duration cap', () => {
  for (const value of [true, false, '1', NaN, Infinity, -Infinity, 1.5, -1, 481, null]) {
    rejected(() => domain.updateTopic(fixture(), 'meeting-1', 'point-1', { minutes: value }), 'invalid_number');
  }
  const book = fixture();
  book.meetings[0].agenda = [point('a', { minutes: 480 }), point('b', { minutes: 480 }), point('c', { minutes: 480 })];
  book.meetings[0].decisions = []; book.meetings[0].actions = [];
  assert.equal(domain.agendaSummary(book.meetings[0]).plannedMinutes, 1440);
  rejected(() => domain.addTopic(book, 'meeting-1', { id: 'd', title: 'Point', minutes: 1 }), 'agenda_minutes_limit');
});

test('all collection limits reject the first extra record atomically', () => {
  const cases = [
    ['participants', 20, (id) => ({ id, name: 'Person', attendance: 'unspecified' })],
    ['agenda', 30, (id) => point(id)],
    ['decisions', 100, (id) => ({ id, topicId: null, text: 'Decision', reason: '' })],
    ['actions', 100, (id) => ({ id, topicId: null, text: 'Action', ownerId: null, due: '', status: 'open' })],
  ];
  for (const [collection, maximum, make] of cases) {
    const book = { schemaVersion: 1, meetings: [meeting()] };
    book.meetings[0][collection] = Array.from({ length: maximum }, (_, index) => make(`id-${index}`));
    assert.doesNotThrow(() => domain.normalizeNotebook(book));
    book.meetings[0][collection].push(make('overflow'));
    rejected(() => domain.normalizeNotebook(book), 'collection_limit');
  }
  const book = { schemaVersion: 1, meetings: Array.from({ length: 20 }, (_, index) => meeting(`id-${index}`)) };
  const before = JSON.stringify(book);
  rejected(() => domain.createMeeting(freeze(book), { id: 'overflow', title: 'Meeting' }), 'collection_limit');
  assert.equal(JSON.stringify(book), before);
});

test('canonical byte limit is exact including LF, indentation and non-ASCII UTF-8', () => {
  const atLimit = sizedNotebook(domain.LIMITS.maxNotebookBytes);
  const canonical = domain.serializeNotebook(freeze(atLimit));
  assert.equal(utf8(canonical), domain.LIMITS.maxNotebookBytes);
  assert.deepEqual(domain.parseNotebook(canonical), atLimit);
  rejected(() => domain.parseNotebook(` ${canonical}`), 'document_too_large');
  const tooBig = clone(atLimit);
  const note = tooBig.meetings.flatMap((row) => row.agenda).find((row) => row.notes.length > 0);
  note.notes = `ç${note.notes.slice(1)}`; // Same character count, one additional UTF-8 byte.
  assert.equal(utf8(`${JSON.stringify(tooBig, null, 2)}\n`), domain.LIMITS.maxNotebookBytes + 1);
  rejected(() => domain.normalizeNotebook(tooBig), 'document_too_large');
  assert.ok(utf8(JSON.stringify(tooBig)) < domain.LIMITS.maxNotebookBytes);
  rejected(() => domain.parseNotebook(JSON.stringify(tooBig)), 'document_too_large');
});

test('escaped text and historical snapshots share the same real 2 MiB budget', () => {
  const row = meeting();
  row.status = 'closed';
  row.agenda = Array.from({ length: 30 }, (_, index) => point(`point-${index}`, { notes: '\t'.repeat(6000) }));
  const body = clone(row); delete body.minutes;
  row.minutes = Array.from({ length: 5 }, (_, index) => ({ version: index + 1, closedAt: instant, meeting: clone(body) }));
  const book = { schemaVersion: 1, meetings: [row] };
  assert.ok(utf8(`${JSON.stringify(book, null, 2)}\n`) > domain.LIMITS.maxNotebookBytes);
  assert.ok(row.agenda.reduce((sum, entry) => sum + entry.notes.length, 0) < domain.LIMITS.maxNotebookBytes);
  rejected(() => domain.normalizeNotebook(book), 'document_too_large');
});

test('updates accept only documented fields and cannot mutate identifiers or lifecycle', () => {
  const base = freeze(fixture());
  const changes = [
    () => domain.updateMeeting(base, 'meeting-1', { id: 'other' }),
    () => domain.updateMeeting(base, 'meeting-1', { status: 'closed' }),
    () => domain.updateParticipant(base, 'meeting-1', 'person-1', { id: 'other' }),
    () => domain.updateTopic(base, 'meeting-1', 'point-1', { id: 'other' }),
    () => domain.updateDecision(base, 'meeting-1', 'decision-1', { id: 'other' }),
    () => domain.updateAction(base, 'meeting-1', 'action-1', { id: 'other' }),
  ];
  for (const operation of changes) rejected(operation, 'invalid_shape');
  const patch = {};
  Object.defineProperty(patch, 'title', { enumerable: true, get() { assert.fail('Getter executed'); } });
  rejected(() => domain.updateMeeting(base, 'meeting-1', patch), 'invalid_shape');
  assert.deepEqual(domain.updateMeeting(base, 'meeting-1', {}), base);
});

test('participant, topic, decision and action operations preserve explicit defaults', () => {
  let book = domain.createMeeting(domain.emptyNotebook(), { id: 'm', title: 'Meeting' });
  book = domain.addParticipant(book, 'm', { id: 'p', name: 'Person' });
  book = domain.addTopic(book, 'm', { id: 't', title: 'Point' });
  book = domain.addDecision(book, 'm', { id: 'd', text: 'Decision' });
  book = domain.addAction(book, 'm', { id: 'a', text: 'Action' });
  assert.deepEqual(book.meetings[0].participants[0], { id: 'p', name: 'Person', attendance: 'unspecified' });
  assert.deepEqual(book.meetings[0].agenda[0], point('t', { title: 'Point' }));
  assert.deepEqual(book.meetings[0].decisions[0], { id: 'd', topicId: null, text: 'Decision', reason: '' });
  assert.deepEqual(book.meetings[0].actions[0], { id: 'a', topicId: null, text: 'Action', ownerId: null, due: '', status: 'open' });
  book = domain.updateParticipant(book, 'm', 'p', { attendance: 'absent', name: 'Updated' });
  book = domain.updateTopic(book, 'm', 't', { status: 'discussed', notes: 'Notes', minutes: 20 });
  book = domain.updateDecision(book, 'm', 'd', { topicId: 't', reason: 'Reason', text: 'Updated decision' });
  book = domain.updateAction(book, 'm', 'a', { ownerId: 'p', topicId: 't', due: '2026-12-31', status: 'done', text: 'Updated action' });
  assert.equal(book.meetings[0].actions[0].status, 'done');
  book = domain.deleteAction(book, 'm', 'a');
  book = domain.deleteDecision(book, 'm', 'd');
  book = domain.deleteTopic(book, 'm', 't');
  book = domain.deleteParticipant(book, 'm', 'p');
  assert.deepEqual(domain.deleteMeeting(book, 'm'), domain.emptyNotebook());
});

test('operations reject absent records, invalid references and unknown payload fields atomically', () => {
  const book = freeze(fixture());
  const before = JSON.stringify(book);
  const operations = [
    [() => domain.updateMeeting(book, 'missing', { title: 'Other' }), 'meeting_not_found'],
    [() => domain.deleteMeeting(book, 'missing'), 'meeting_not_found'],
    [() => domain.updateTopic(book, 'meeting-1', 'missing', { title: 'Other' }), 'record_not_found'],
    [() => domain.deleteDecision(book, 'meeting-1', 'missing'), 'record_not_found'],
    [() => domain.addDecision(book, 'meeting-1', { id: 'new', topicId: 'missing', text: 'Decision' }), 'invalid_reference'],
    [() => domain.updateAction(book, 'meeting-1', 'action-1', { ownerId: 'missing' }), 'invalid_reference'],
    [() => domain.addParticipant(book, 'meeting-1', { id: 'p', name: 'Person', extra: true }), 'invalid_shape'],
    [() => domain.createMeeting(book, { id: 'new', title: 'New', minutes: [] }), 'invalid_shape'],
  ];
  for (const [operation, code] of operations) {
    rejected(operation, code);
    assert.equal(JSON.stringify(book), before);
  }
});

test('moving topics preserves order and edge operations are independent no-ops', () => {
  const book = freeze(fixture());
  const moved = domain.moveTopic(book, 'meeting-1', 'point-1', 1);
  assert.deepEqual(moved.meetings[0].agenda.map((row) => row.id), ['point-2', 'point-1']);
  assert.deepEqual(domain.moveTopic(moved, 'meeting-1', 'point-1', -1), book);
  const edge = domain.moveTopic(book, 'meeting-1', 'point-1', -1);
  assert.deepEqual(edge, book);
  assert.notEqual(edge, book);
  for (const offset of [0, 2, '1', true, NaN]) rejected(() => domain.moveTopic(book, 'meeting-1', 'point-1', offset), 'invalid_offset');
});

test('links are never silently repaired during normalization or queries', () => {
  for (const mutate of [
    (row) => { row.decisions[0].topicId = 'missing'; },
    (row) => { row.actions[0].topicId = 'missing'; },
    (row) => { row.actions[0].ownerId = 'missing'; },
    (row) => { row.actions[0].ownerId = ''; },
  ]) {
    const book = fixture(); mutate(book.meetings[0]);
    rejected(() => domain.normalizeNotebook(book));
    rejected(() => domain.actionRows(book, '2026-11-08'));
    rejected(() => domain.meetingBody(book.meetings[0]));
    rejected(() => domain.hasUnpublishedChanges(book.meetings[0]));
    rejected(() => domain.agendaSummary(book.meetings[0]));
  }
});

test('explicit detach preserves all texts and leaves historical snapshots byte-for-byte intact', () => {
  const book = freeze(closedFixture());
  const historicalBytes = JSON.stringify(book.meetings[0].minutes[0]);
  rejected(() => domain.deleteTopic(book, 'meeting-1', 'point-1'), 'linked_topic');
  rejected(() => domain.deleteParticipant(book, 'meeting-1', 'person-1'), 'linked_participant');
  let changed = domain.deleteTopic(book, 'meeting-1', 'point-1', { detach: true });
  changed = domain.deleteParticipant(changed, 'meeting-1', 'person-1', { detach: true });
  assert.equal(changed.meetings[0].decisions[0].topicId, null);
  assert.equal(changed.meetings[0].actions[0].topicId, null);
  assert.equal(changed.meetings[0].actions[0].ownerId, null);
  assert.equal(changed.meetings[0].decisions[0].text, book.meetings[0].decisions[0].text);
  assert.equal(changed.meetings[0].actions[0].text, book.meetings[0].actions[0].text);
  assert.equal(JSON.stringify(changed.meetings[0].minutes[0]), historicalBytes);
  assert.equal(JSON.stringify(book.meetings[0].minutes[0]), historicalBytes);
  assert.equal(domain.hasUnpublishedChanges(changed.meetings[0]), true);
  assert.doesNotThrow(() => domain.normalizeNotebook(changed));
  for (const options of [{ detach: 1 }, { detach: 'yes' }, { detach: null }]) {
    rejected(() => domain.deleteTopic(book, 'meeting-1', 'point-1', options), 'invalid_option');
  }
  rejected(() => domain.deleteParticipant(book, 'meeting-1', 'person-1', { force: true }), 'invalid_shape');
});

test('starting and closing enforce the lifecycle and caller-supplied timestamp', () => {
  const empty = domain.createMeeting(domain.emptyNotebook(), { id: 'm', title: 'Meeting' });
  rejected(() => domain.startMeeting(empty, 'm'), 'empty_agenda');
  rejected(() => domain.closeMeeting(fixture(), 'meeting-1', instant), 'invalid_state');
  rejected(() => domain.snapshotMinutes(fixture(), 'meeting-1', instant), 'invalid_state');
  const running = freeze(domain.startMeeting(fixture(), 'meeting-1'));
  assert.equal(running.meetings[0].status, 'running');
  rejected(() => domain.startMeeting(running, 'meeting-1'), 'invalid_state');
  rejected(() => domain.snapshotMinutes(running, 'meeting-1', instant), 'invalid_state');
  rejected(() => domain.closeMeeting(running, 'meeting-1'), 'invalid_timestamp');
  assert.equal(running.meetings[0].minutes.length, 0);
  const closed = domain.closeMeeting(running, 'meeting-1', instant);
  assert.equal(closed.meetings[0].status, 'closed');
  assert.equal(closed.meetings[0].minutes[0].version, 1);
  assert.equal(closed.meetings[0].minutes[0].closedAt, instant);
  assert.equal(closed.meetings[0].minutes[0].meeting.status, 'closed');
  assert.equal(Object.hasOwn(closed.meetings[0].minutes[0].meeting, 'minutes'), false);
  assert.equal(domain.hasUnpublishedChanges(closed.meetings[0]), false);
});

test('closed records remain editable while new minutes require actual body changes', () => {
  const original = freeze(closedFixture());
  const previousBytes = JSON.stringify(original.meetings[0].minutes);
  rejected(() => domain.snapshotMinutes(original, 'meeting-1', nextInstant), 'no_changes');
  let updated = domain.updateMeeting(original, 'meeting-1', { title: 'Título corrigido' });
  updated = domain.updateParticipant(updated, 'meeting-1', 'person-1', { attendance: 'absent' });
  updated = domain.updateAction(updated, 'meeting-1', 'action-1', { status: 'done' });
  assert.equal(updated.meetings[0].status, 'closed');
  assert.equal(domain.hasUnpublishedChanges(updated.meetings[0]), true);
  assert.equal(JSON.stringify(updated.meetings[0].minutes), previousBytes);
  const versioned = domain.snapshotMinutes(updated, 'meeting-1', nextInstant);
  assert.equal(versioned.meetings[0].minutes.length, 2);
  assert.equal(versioned.meetings[0].minutes[1].version, 2);
  assert.equal(versioned.meetings[0].minutes[1].meeting.title, 'Título corrigido');
  assert.equal(JSON.stringify(versioned.meetings[0].minutes[0]), JSON.stringify(original.meetings[0].minutes[0]));
  assert.equal(domain.hasUnpublishedChanges(versioned.meetings[0]), false);
  updated.meetings[0].actions[0].text = 'Another mutable session edit';
  assert.equal(versioned.meetings[0].minutes[1].meeting.actions[0].text, 'Ação fictícia');
});

test('reopening and closing creates a new snapshot without mutating the previous version', () => {
  const original = freeze(closedFixture());
  const historical = JSON.stringify(original.meetings[0].minutes[0]);
  const running = domain.startMeeting(original, 'meeting-1');
  assert.equal(domain.hasUnpublishedChanges(running.meetings[0]), true);
  const closed = domain.closeMeeting(running, 'meeting-1', nextInstant);
  assert.equal(closed.meetings[0].minutes.length, 2);
  assert.equal(JSON.stringify(closed.meetings[0].minutes[0]), historical);
  assert.equal(domain.hasUnpublishedChanges(closed.meetings[0]), false);
});

test('snapshot version, identity, own links and closed state are strictly validated', () => {
  const cases = [
    ['invalid_version', (snapshot) => { snapshot.version = 2; }],
    ['invalid_number', (snapshot) => { snapshot.version = true; }],
    ['invalid_snapshot', (snapshot) => { snapshot.meeting.id = 'different'; }],
    ['invalid_status', (snapshot) => { snapshot.meeting.status = 'running'; }],
    ['invalid_reference', (snapshot) => { snapshot.meeting.participants = []; }],
    ['invalid_shape', (snapshot) => { snapshot.meeting.minutes = []; }],
    ['invalid_timestamp', (snapshot) => { snapshot.closedAt = '2026-02-30T00:00:00.000Z'; }],
  ];
  for (const [code, mutate] of cases) {
    const book = closedFixture(); mutate(book.meetings[0].minutes[0]);
    rejected(() => domain.normalizeNotebook(book), code);
  }
  const independent = domain.deleteParticipant(closedFixture(), 'meeting-1', 'person-1', { detach: true });
  assert.doesNotThrow(() => domain.normalizeNotebook(independent));
});

test('twelfth snapshot is allowed and both forms of thirteenth version fail atomically', () => {
  let book = closedFixture();
  for (let version = 2; version <= 12; version += 1) {
    book = domain.updateMeeting(book, 'meeting-1', { title: `Versão ${version}` });
    book = domain.snapshotMinutes(book, 'meeting-1', instant);
  }
  assert.equal(book.meetings[0].minutes.length, 12);
  const changed = freeze(domain.updateMeeting(book, 'meeting-1', { title: 'Version overflow' }));
  const previous = JSON.stringify(changed);
  rejected(() => domain.snapshotMinutes(changed, 'meeting-1', nextInstant), 'collection_limit');
  assert.equal(JSON.stringify(changed), previous);
  const running = freeze(domain.startMeeting(changed, 'meeting-1'));
  rejected(() => domain.closeMeeting(running, 'meeting-1', nextInstant), 'collection_limit');
  assert.equal(running.meetings[0].status, 'running');
  assert.equal(running.meetings[0].minutes.length, 12);
});

test('snapshot creation at global byte capacity fails without closing or altering history', () => {
  const book = sizedNotebook(domain.LIMITS.maxNotebookBytes);
  book.meetings[0].status = 'running'; // Two bytes longer than draft; reserve them below.
  book.meetings[0].agenda[0].notes = book.meetings[0].agenda[0].notes.slice(2);
  const before = JSON.stringify(book);
  rejected(() => domain.closeMeeting(freeze(book), 'meeting-0', instant), 'document_too_large');
  assert.equal(JSON.stringify(book), before);
  assert.equal(book.meetings[0].status, 'running');
  assert.deepEqual(book.meetings[0].minutes, []);
});

test('meeting body and summary return detached accurate data without historical duplication', () => {
  const book = freeze(closedFixture());
  const body = domain.meetingBody(book.meetings[0]);
  assert.equal(Object.hasOwn(body, 'minutes'), false);
  body.actions[0].text = 'Modified returned copy';
  assert.equal(book.meetings[0].actions[0].text, 'Ação fictícia');
  assert.deepEqual(domain.agendaSummary(book.meetings[0]), { points: 2, plannedMinutes: 15, discussed: 0, pending: 1, deferred: 1 });
});

test('action rows preserve meeting/action order and resolve only explicit associations', () => {
  const book = fixture();
  book.meetings[0].actions.push(
    { id: 'none', topicId: null, text: 'Unassigned', ownerId: null, due: '', status: 'open' },
    { id: 'yesterday', topicId: null, text: 'Overdue', ownerId: null, due: '2026-11-07', status: 'open' },
    { id: 'done', topicId: null, text: 'Done', ownerId: null, due: '2026-11-07', status: 'done' },
    { id: 'cancelled', topicId: null, text: 'Cancelled', ownerId: null, due: '2026-11-07', status: 'cancelled' },
    { id: 'future', topicId: null, text: 'Future', ownerId: null, due: '2026-11-09', status: 'open' },
  );
  const other = meeting('other'); other.title = 'Other meeting';
  other.actions.push({ id: 'action-1', topicId: null, text: 'Other action', ownerId: null, due: '0001-01-01', status: 'open' });
  book.meetings.push(other);
  const before = JSON.stringify(book);
  const rows = domain.actionRows(freeze(book), '2026-11-08');
  assert.deepEqual(rows.map((row) => row.id), ['action-1', 'none', 'yesterday', 'done', 'cancelled', 'future', 'action-1']);
  assert.deepEqual(rows.map((row) => row.overdue), [false, false, true, false, false, false, true]);
  assert.equal(rows[0].ownerName, 'Pessoa fictícia');
  assert.equal(rows[0].topicTitle, 'Ponto fictício');
  assert.equal(rows[1].ownerName, ''); assert.equal(rows[1].topicTitle, '');
  assert.equal(rows.at(-1).meetingId, 'other'); assert.equal(rows.at(-1).meetingTitle, 'Other meeting');
  rows[0].text = 'Detached row';
  assert.equal(JSON.stringify(book), before);
  rejected(() => domain.actionRows(book, ''), 'invalid_date');
  rejected(() => domain.actionRows(book, '2026-02-29'), 'invalid_date');
});
