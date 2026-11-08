import test from 'node:test';
import assert from 'node:assert/strict';
import { marked } from 'marked';
import { parse } from 'csv-parse/sync';
import { DomainError, normalizeNotebook, serializeNotebook } from '../assets/domain.mjs';
import { minutesMarkdown, workingMarkdown, actionsCsv, notebookSummary } from '../assets/formats.mjs';

function body() {
  return {
    id: 'm1', title: 'Mostra do Bairro Aurora', objective: 'Planejar uma mostra fictícia.',
    date: '2026-11-08', time: '18:30', location: 'Sala fictícia das Oliveiras', status: 'closed',
    participants: [{ id: 'p1', name: 'Pessoa Aurora', attendance: 'present' },
      { id: 'p2', name: 'Pessoa Horizonte', attendance: 'unspecified' }],
    agenda: [{ id: 't1', title: 'Mesas e circulação', minutes: 12, status: 'discussed', notes: 'Priorizar corredores livres.' },
      { id: 't2', title: 'Sinalização', minutes: 0, status: 'deferred', notes: '' }],
    decisions: [{ id: 'd1', topicId: 't1', text: 'Usar mesas reutilizáveis.', reason: 'Reduzir o descarte.' }],
    actions: [{ id: 'a1', topicId: 't2', text: 'Revisar as placas.', ownerId: 'p1', due: '2026-11-07', status: 'open' },
      { id: 'a2', topicId: null, text: 'Revisar a entrada.', ownerId: null, due: '', status: 'open' },
      { id: 'a3', topicId: 't1', text: 'Contar as mesas.', ownerId: 'p2', due: '2026-11-06', status: 'done' },
      { id: 'a4', topicId: null, text: 'Reavaliar outro formato.', ownerId: null, due: '2026-11-06', status: 'cancelled' }],
  };
}

function meeting() {
  const current = body();
  return { ...current, minutes: [{ version: 1, closedAt: '2026-11-08T21:00:00.000Z', meeting: structuredClone(current) }] };
}

function book(value = meeting()) {
  return { schemaVersion: 1, meetings: [value] };
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function tokens(markdown) {
  const result = [];
  marked.walkTokens(marked.lexer(markdown, { gfm: true }), token => result.push(token));
  return result;
}

function csvRecords(csv) {
  return parse(csv, { columns: true, record_delimiter: '\r\n', relax_quotes: false,
    skip_empty_lines: false, relax_column_count: false });
}

function assertDomainError(operation, code) {
  assert.throws(operation, error => error instanceof DomainError && (!code || error.code === code));
}

test('historical Markdown comes from the exact selected snapshot after current edits and detachments', () => {
  const value = meeting();
  const first = minutesMarkdown(value, 1);
  const oldSnapshot = JSON.stringify(value.minutes[0]);
  value.title = 'Reunião corrente renomeada';
  value.objective = 'Objetivo corrente alterado.';
  value.date = '2027-01-01';
  value.time = '';
  value.location = 'Local corrente';
  value.participants = [];
  value.agenda = [];
  value.decisions = [{ id: 'd1', topicId: null, text: 'Registro atual diferente.', reason: '' }];
  value.actions = [{ id: 'a1', topicId: null, text: 'Ação atual diferente.', ownerId: null, due: '', status: 'done' }];
  assert.equal(minutesMarkdown(value, 1), first);
  assert.equal(JSON.stringify(value.minutes[0]), oldSnapshot);
  const html = marked.parse(first, { gfm: true });
  assert.match(html, /Pessoa(?:&#32;| )Aurora/);
  assert.match(html, /Mesas(?:&#32;| )e(?:&#32;| )circulação/);
  assert.ok(!html.includes('corrente'));
  assert.ok(!html.includes('2027'));
  const work = workingMarkdown(value);
  assert.notEqual(work, first);
  assert.match(work, /^# Ficha de trabalho\n/);
  assert.ok(!/^# Ata/m.test(work));
  assert.ok(!work.includes('versão 1'));
  assert.ok(!work.includes('Pessoa&#32;Aurora'));
});

test('version selection is explicit, deterministic and never silently takes the latest', () => {
  const value = meeting();
  value.title = 'Segundo registro';
  const second = structuredClone(value);
  delete second.minutes;
  value.minutes.push({ version: 2, closedAt: '2026-11-09T21:00:00.000Z', meeting: second });
  assert.match(minutesMarkdown(value, 1), /^# Ata · versão 1\n/);
  assert.match(minutesMarkdown(value, 2), /^# Ata · versão 2\n/);
  assert.notEqual(minutesMarkdown(value, 1), minutesMarkdown(value, 2));
  for (const version of [undefined, null, true, false, '1', 0, -1, 1.5, NaN, Infinity, {}, []]) {
    assertDomainError(() => minutesMarkdown(value, version), 'minutes_version_invalid');
  }
  assertDomainError(() => minutesMarkdown(value, 3), 'minutes_not_found');
  assertDomainError(() => minutesMarkdown({ ...value, minutes: [] }, 1), 'minutes_not_found');
});

test('all format entry points validate the complete canonical document, including unrelated history', () => {
  const invalidCurrent = meeting();
  invalidCurrent.actions[0].ownerId = 'missing';
  const invalidHistory = meeting();
  invalidHistory.minutes[0].meeting.decisions[0].topicId = 'missing';
  const extra = meeting();
  extra.unexpected = true;
  const badUnicode = meeting();
  badUnicode.title = '\ud800';
  for (const invalid of [invalidCurrent, invalidHistory, extra, badUnicode, null, {}]) {
    assertDomainError(() => workingMarkdown(invalid));
    assertDomainError(() => minutesMarkdown(invalid, 1));
    assertDomainError(() => actionsCsv(book(invalid), '2026-11-08'));
    assertDomainError(() => notebookSummary(book(invalid)));
  }
});

test('Markdown user content cannot create HTML, autolinks, references, headings, lists, code or tables', () => {
  const value = meeting();
  const clean = tokens(workingMarkdown(value));
  const payload = '<script>alert("x")</script>\n# Injetado\n\n---\n1. Item\n- Item\n> Quote\n'
    + '[link](javascript:alert(1)) ![image](https://example.invalid/image)\n'
    + '<https://example.invalid/> https://example.invalid/ www.example.invalid a@example.invalid\n'
    + '```js\nthrow 1\n```\n| a | b |\n|---|---|\n| c | d |\n'
    + '[reference]: https://example.invalid/\n[reference]\n'
    + '\tindented\n    indented\n\\*literal* &copy; &#35;header _em_ ~~del~~';
  value.agenda[0].notes = payload;
  value.title = '# [Título](https://example.invalid/) <img src=x> `x`';
  value.participants[0].name = '[Pessoa](https://example.invalid/)';
  value.decisions[0].text = payload;
  value.actions[0].text = payload.slice(0, 490);
  const output = workingMarkdown(value);
  const all = tokens(output);
  const forbidden = new Set(['html', 'link', 'image', 'list', 'list_item', 'code', 'codespan', 'blockquote', 'hr', 'table', 'em', 'del']);
  assert.deepEqual(all.filter(token => forbidden.has(token.type)), []);
  for (const structure of ['strong', 'heading', 'paragraph']) {
    assert.equal(all.filter(token => token.type === structure).length,
      clean.filter(token => token.type === structure).length, structure);
  }
  assert.ok(all.some(token => token.type === 'br'));
  const headings = all.filter(token => token.type === 'heading');
  assert.ok(headings.every(token => !token.text.includes('Injetado') && !token.text.includes('Título')));
  const html = marked.parse(output, { gfm: true });
  assert.ok(!/<(?:script|img|a|table|blockquote|pre|code)\b/i.test(html));
  assert.match(html, /(?:&#60;|&lt;)script(?:&#62;|&gt;)/);
  assert.ok(output.includes('&#38;copy&#59;'));
});

test('internal empty lines, CRLF, CR, tabs and indentation remain safe text with explicit breaks', () => {
  const value = meeting();
  value.objective = '\nLinha 1\r\n\r\nLinha 2\r\t    Linha 3\n';
  const output = workingMarkdown(value);
  assert.ok(!output.includes('\r'));
  assert.ok(output.includes('&#9;'));
  const all = tokens(output);
  assert.ok(all.filter(token => token.type === 'br').length >= 4);
  assert.equal(all.filter(token => token.type === 'code').length, 0);
  assert.equal(all.filter(token => token.type === 'list').length, 0);
});

test('Markdown clearly distinguishes absent values, planned zero time and actual recorded states', () => {
  const value = meeting();
  value.date = '';
  value.time = '';
  value.location = '';
  value.objective = '';
  const output = workingMarkdown(value);
  const rendered = marked.parse(output, { gfm: true });
  for (const expected of ['Não informada', 'Não informado', 'Sem tempo reservado',
    'Não definido', 'Sem prazo', 'Adiado', 'Concluído', 'Cancelado']) {
    assert.ok(rendered.includes(expected), expected);
  }
  assert.ok(!output.includes('Invalid Date'));
  assert.ok(!output.includes('undefined'));
  assert.ok(!output.includes('null'));
});

test('CSV is parsed independently with exact columns, order, associations, missing values and overdue states', () => {
  const value = book();
  const records = csvRecords(actionsCsv(value, '2026-11-08'));
  assert.equal(records.length, 4);
  assert.deepEqual(Object.keys(records[0]), ['ID da reunião', 'Reunião', 'ID do encaminhamento',
    'Encaminhamento', 'ID do ponto', 'Ponto da pauta', 'ID do responsável', 'Responsável',
    'Prazo civil', 'Estado', 'Em atraso']);
  assert.deepEqual(records.map(row => row['ID do encaminhamento']), ['a1', 'a2', 'a3', 'a4']);
  assert.equal(records[0].Responsável, 'Pessoa Aurora');
  assert.equal(records[0]['Ponto da pauta'], 'Sinalização');
  assert.equal(records[0]['Prazo civil'], '2026-11-07');
  assert.equal(records[0]['Em atraso'], 'Sim');
  assert.equal(records[1].Responsável, '');
  assert.equal(records[1]['ID do responsável'], '');
  assert.equal(records[1]['ID do ponto'], '');
  assert.equal(records[1]['Ponto da pauta'], '');
  assert.equal(records[1]['Prazo civil'], '');
  assert.equal(records[1]['Em atraso'], 'Não');
  assert.equal(records[2].Estado, 'Concluído');
  assert.equal(records[2]['Em atraso'], 'Não');
  assert.equal(records[3].Estado, 'Cancelado');
  assert.equal(records[3]['Em atraso'], 'Não');
  assert.ok(actionsCsv(value, '2026-11-08').endsWith('\r\n'));
});

test('CSV quoting preserves commas, double quotes, Unicode and quoted internal newlines', () => {
  const value = meeting();
  value.title = 'Reunião "Azul", fictícia';
  value.agenda[1].title = 'Ponto, "ênfase"';
  value.participants[0].name = 'Pessoa "Árvore", Aurora';
  value.actions[0].text = 'Primeira linha, "texto"\r\nSegunda linha\nTerceira linha';
  const csv = actionsCsv(book(value), '2026-11-08');
  const [row] = csvRecords(csv);
  assert.equal(row.Reunião, value.title);
  assert.equal(row['Ponto da pauta'], value.agenda[1].title);
  assert.equal(row.Responsável, value.participants[0].name);
  assert.equal(row.Encaminhamento, value.actions[0].text);
  assert.ok(csv.includes('""Azul""'));
  assert.ok(csv.includes('""texto""'));
});

test('CSV formula guards protect textual cells after whitespace and never alter JSON or safe values', () => {
  for (const dangerous of ['=1+1', '+SUM(A1:A2)', '-2+3', '@SUM(1)', '\ttext', '\rtext',
    '  =HYPERLINK("https://example.invalid")', ' \ttext', '\n =1', '\u00a0@formula']) {
    const value = meeting();
    value.title = dangerous;
    value.agenda[1].title = dangerous;
    value.participants[0].name = dangerous;
    value.actions[0].text = dangerous;
    const original = serializeNotebook(book(value));
    const [row] = csvRecords(actionsCsv(book(value), '2026-11-08'));
    for (const name of ['Reunião', 'Ponto da pauta', 'Responsável', 'Encaminhamento']) {
      assert.equal(row[name], `'${dangerous}`, `${name}: ${JSON.stringify(dangerous)}`);
    }
    assert.equal(serializeNotebook(book(value)), original);
  }
  for (const safe of ['Texto - seguro', '2+3', 'O endereço a@example.invalid', "'=already", ' Normal']) {
    const value = meeting();
    value.actions[0].text = safe;
    assert.equal(csvRecords(actionsCsv(book(value), '2026-11-08'))[0].Encaminhamento, safe);
  }
});

test('CSV status filtering validates dates and every row uses civil deadline semantics', () => {
  const value = book();
  assert.equal(csvRecords(actionsCsv(value, '2026-11-08', { status: 'open' })).length, 2);
  assert.equal(csvRecords(actionsCsv(value, '2026-11-08', { status: 'done' })).length, 1);
  assert.equal(csvRecords(actionsCsv(value, '2026-11-08', { status: 'cancelled' })).length, 1);
  assert.equal(csvRecords(actionsCsv(value, '2026-11-08', { status: 'all' })).length, 4);
  assert.equal(csvRecords(actionsCsv(value, '2026-11-07'))[0]['Em atraso'], 'Não');
  assert.equal(csvRecords(actionsCsv(value, '2026-11-09'))[0]['Em atraso'], 'Sim');
  for (const date of ['', '2026-02-29', '2026-2-01', null, undefined, 'today']) {
    assertDomainError(() => actionsCsv(value, date, { status: 'done' }));
  }
  for (const options of [null, [], true, 1, 'open', { status: 'pending' }, { status: null },
    { status: true }, { status: 'open', extra: 1 }, { get status() { throw new Error('private'); } }]) {
    assertDomainError(() => actionsCsv(value, '2026-11-08', options));
  }
});

test('summary counts only current collections and snapshots, without summing historical copies', () => {
  const first = meeting();
  const second = meeting();
  second.id = 'm2';
  second.minutes[0].meeting.id = 'm2';
  first.participants = [];
  first.agenda = [];
  first.decisions = [];
  first.actions = [];
  const value = { schemaVersion: 1, meetings: [first, second] };
  assert.deepEqual(notebookSummary(value), { meetings: 2, participants: 2, points: 2,
    decisions: 1, actions: 4, minutes: 2 });
  assert.deepEqual(notebookSummary({ schemaVersion: 1, meetings: [] }), {
    meetings: 0, participants: 0, points: 0, decisions: 0, actions: 0, minutes: 0 });
  assert.equal(csvRecords(actionsCsv({ schemaVersion: 1, meetings: [] }, '2026-11-08')).length, 0);
});

test('formats are deterministic, accept frozen normalized inputs and never mutate their arguments', () => {
  const value = freeze(normalizeNotebook(book()));
  const before = JSON.stringify(value);
  const exports = () => [minutesMarkdown(value.meetings[0], 1), workingMarkdown(value.meetings[0]),
    actionsCsv(value, '2026-11-08'), notebookSummary(value)];
  assert.deepEqual(exports(), exports());
  assert.equal(JSON.stringify(value), before);
});
