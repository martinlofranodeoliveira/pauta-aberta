/** Pure meeting notebook domain. No storage, DOM, network or implicit clock. */
export class DomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

export const LIMITS = Object.freeze({
  maxNotebookBytes: 2 * 1024 * 1024,
  maxMeetings: 20,
  maxParticipants: 20,
  maxTopics: 30,
  maxDecisions: 100,
  maxActions: 100,
  maxMinutes: 12,
  maxAgendaMinutes: 1440,
});

const encoder = new TextEncoder();
const meetingKeys = ['id', 'title', 'objective', 'date', 'time', 'location', 'status',
  'participants', 'agenda', 'decisions', 'actions', 'minutes'];
const bodyKeys = meetingKeys.slice(0, -1);
const statuses = ['draft', 'running', 'closed'];
const attendance = ['unspecified', 'present', 'absent'];
const topicStatuses = ['pending', 'discussed', 'deferred'];
const actionStatuses = ['open', 'done', 'cancelled'];

function fail(code, message) { throw new DomainError(code, message); }
function invalidShape() { fail('invalid_shape', 'A estrutura contém campos ausentes, extras ou propriedades não permitidas.'); }
function byteLength(value) { return encoder.encode(value).byteLength; }

// Read descriptors rather than values so rejected inputs never invoke getters,
// setters, toJSON or inherited fields. Proxy trap errors are always sanitized.
function ownData(value, array = false) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value) !== array) invalidShape();
    const prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) invalidShape();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value') ||
          (!descriptor.enumerable && !(array && key === 'length'))) invalidShape();
    }
    return { descriptors, keys };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    invalidShape();
  }
}

function fields(value, allowed, required = allowed) {
  const { descriptors, keys } = ownData(value);
  if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(descriptors, key))) invalidShape();
  const result = Object.create(null);
  for (const key of keys) result[key] = descriptors[key].value;
  return result;
}

// Budget the actual canonical JSON, including indentation, field names, escaped
// characters and every historical snapshot, while constructing the copy.
class Budget {
  constructor() { this.bytes = 1; } // The canonical trailing LF.
  add(bytes) {
    this.bytes += bytes;
    if (this.bytes > LIMITS.maxNotebookBytes) fail('document_too_large', 'O caderno excede o limite total de 2 MiB.');
  }
  scalar(value) { this.add(byteLength(JSON.stringify(value))); }
  object(keys, depth) {
    if (!keys.length) { this.add(2); return; }
    this.add(4 + depth * 2 + (keys.length - 1) * 2 +
      keys.reduce((sum, key) => sum + (depth + 1) * 2 + byteLength(JSON.stringify(key)) + 2, 0));
  }
  array(length, depth) {
    this.add(length ? 4 + depth * 2 + (length - 1) * 2 + length * (depth + 1) * 2 : 2);
  }
}

function record(value, keys, budget, depth) {
  const result = fields(value, keys);
  budget.object(keys, depth);
  return result;
}

function list(value, maximum, budget, depth) {
  const { descriptors, keys } = ownData(value, true);
  const length = descriptors.length?.value;
  if (!Number.isInteger(length) || length < 0 || length > maximum) fail('collection_limit', 'Uma coleção excede o limite permitido.');
  if (keys.length !== length + 1) invalidShape();
  const result = [];
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(descriptors, String(index))) invalidShape();
    result.push(descriptors[index].value);
  }
  budget.array(length, depth);
  return result;
}

function text(value, maximum, required = false, budget) {
  if (typeof value !== 'string') fail('invalid_text', 'O campo de texto deve ser uma string válida.');
  let count = 0;
  for (const character of value) {
    const point = character.codePointAt(0);
    if ((point < 32 && point !== 9 && point !== 10 && point !== 13) || (point >= 0xd800 && point <= 0xdfff)) {
      fail('invalid_text', 'O texto contém controles ou Unicode inválido.');
    }
    count += 1;
    if (count > maximum) fail('text_limit', 'O texto excede o tamanho permitido para o campo.');
  }
  if (required && !value.trim()) fail('empty_text', 'O campo de texto obrigatório não pode ficar vazio.');
  budget?.scalar(value);
  return value;
}

function identifier(value, budget) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) fail('invalid_id', 'O identificador deve conter de 1 a 64 caracteres ASCII permitidos.');
  budget?.scalar(value);
  return value;
}

function enumeration(value, values, budget) {
  if (!values.includes(value)) fail('invalid_status', 'O estado informado não é permitido.');
  budget?.scalar(value);
  return value;
}

function integer(value, minimum, maximum, budget) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    fail('invalid_number', 'O número deve ser inteiro e estar no intervalo permitido.');
  }
  budget?.scalar(value);
  return value;
}

function date(value, optional, budget) {
  if (typeof value !== 'string') fail('invalid_date', 'A data deve usar o formato AAAA-MM-DD.');
  if (value === '' && optional) { budget?.scalar(value); return value; }
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) fail('invalid_date', 'A data deve usar o formato AAAA-MM-DD.');
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) {
    fail('invalid_date', 'A data civil informada não existe.');
  }
  budget?.scalar(value);
  return value;
}

export function validateDate(value, options = {}) {
  const settings = fields(options, ['optional'], []);
  const optional = Object.hasOwn(settings, 'optional') ? settings.optional : true;
  if (typeof optional !== 'boolean') fail('invalid_option', 'A opção de data deve ser booleana.');
  return date(value, optional);
}

export function validateTimestamp(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value)) {
    fail('invalid_timestamp', 'O instante deve ser ISO UTC canônico com milissegundos.');
  }
  try { date(value.slice(0, 10), false); } catch { fail('invalid_timestamp', 'O instante UTC informado não existe.'); }
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) {
    fail('invalid_timestamp', 'O instante UTC informado não existe.');
  }
  return value;
}

function time(value, budget) {
  if (typeof value !== 'string' || (value !== '' && !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value))) {
    fail('invalid_time', 'O horário deve usar o formato HH:mm válido ou ficar vazio.');
  }
  budget.scalar(value);
  return value;
}

function unique(rows) {
  const ids = new Set();
  for (const row of rows) {
    if (ids.has(row.id)) fail('duplicate_id', 'Há identificadores repetidos na mesma coleção.');
    ids.add(row.id);
  }
  return ids;
}

function reference(value, ids, budget) {
  if (value === null) { budget.scalar(null); return null; }
  identifier(value, budget);
  if (!ids.has(value)) fail('invalid_reference', 'O vínculo deve apontar para um registro existente na própria ficha.');
  return value;
}

function participant(value, budget, depth) {
  const data = record(value, ['id', 'name', 'attendance'], budget, depth);
  return { id: identifier(data.id, budget), name: text(data.name, 80, true, budget),
    attendance: enumeration(data.attendance, attendance, budget) };
}

function topic(value, budget, depth) {
  const data = record(value, ['id', 'title', 'minutes', 'status', 'notes'], budget, depth);
  return { id: identifier(data.id, budget), title: text(data.title, 160, true, budget),
    minutes: integer(data.minutes, 0, 480, budget), status: enumeration(data.status, topicStatuses, budget),
    notes: text(data.notes, 6000, false, budget) };
}

function decision(value, topicIds, budget, depth) {
  const data = record(value, ['id', 'topicId', 'text', 'reason'], budget, depth);
  return { id: identifier(data.id, budget), topicId: reference(data.topicId, topicIds, budget),
    text: text(data.text, 2000, true, budget), reason: text(data.reason, 2000, false, budget) };
}

function action(value, topicIds, participantIds, budget, depth) {
  const data = record(value, ['id', 'topicId', 'text', 'ownerId', 'due', 'status'], budget, depth);
  return { id: identifier(data.id, budget), topicId: reference(data.topicId, topicIds, budget),
    text: text(data.text, 500, true, budget), ownerId: reference(data.ownerId, participantIds, budget),
    due: date(data.due, true, budget), status: enumeration(data.status, actionStatuses, budget) };
}

function normalizeMeeting(value, budget, depth, historical = false) {
  const data = record(value, historical ? bodyKeys : meetingKeys, budget, depth);
  const result = {
    id: identifier(data.id, budget), title: text(data.title, 120, true, budget),
    objective: text(data.objective, 1000, false, budget), date: date(data.date, true, budget),
    time: time(data.time, budget), location: text(data.location, 200, false, budget),
    status: enumeration(data.status, historical ? ['closed'] : statuses, budget),
  };
  result.participants = list(data.participants, LIMITS.maxParticipants, budget, depth + 1)
    .map((row) => participant(row, budget, depth + 2));
  const participantIds = unique(result.participants);
  result.agenda = list(data.agenda, LIMITS.maxTopics, budget, depth + 1)
    .map((row) => topic(row, budget, depth + 2));
  const topicIds = unique(result.agenda);
  if (result.agenda.reduce((sum, row) => sum + row.minutes, 0) > LIMITS.maxAgendaMinutes) {
    fail('agenda_minutes_limit', 'A soma dos tempos planejados excede 1440 minutos.');
  }
  result.decisions = list(data.decisions, LIMITS.maxDecisions, budget, depth + 1)
    .map((row) => decision(row, topicIds, budget, depth + 2));
  unique(result.decisions);
  result.actions = list(data.actions, LIMITS.maxActions, budget, depth + 1)
    .map((row) => action(row, topicIds, participantIds, budget, depth + 2));
  unique(result.actions);
  if (!historical) {
    result.minutes = list(data.minutes, LIMITS.maxMinutes, budget, depth + 1).map((snapshot, index) => {
      const previous = record(snapshot, ['version', 'closedAt', 'meeting'], budget, depth + 2);
      const version = integer(previous.version, 1, LIMITS.maxMinutes, budget);
      if (version !== index + 1) fail('invalid_version', 'As versões da ata devem ser sequenciais a partir de 1.');
      const closedAt = validateTimestamp(previous.closedAt);
      budget.scalar(closedAt);
      const meeting = normalizeMeeting(previous.meeting, budget, depth + 3, true);
      if (meeting.id !== result.id) fail('invalid_snapshot', 'A ata histórica deve pertencer à mesma reunião.');
      return { version, closedAt, meeting };
    });
  }
  return result;
}

export function emptyNotebook() { return { schemaVersion: 1, meetings: [] }; }

export function normalizeNotebook(value) {
  const budget = new Budget();
  const data = record(value, ['schemaVersion', 'meetings'], budget, 0);
  if (data.schemaVersion !== 1) fail('schema_version', 'A versão do caderno não é suportada.');
  budget.scalar(1);
  const meetings = list(data.meetings, LIMITS.maxMeetings, budget, 1)
    .map((meeting) => normalizeMeeting(meeting, budget, 2));
  unique(meetings);
  return { schemaVersion: 1, meetings };
}

export function parseNotebook(jsonText) {
  if (typeof jsonText !== 'string') fail('invalid_json', 'O backup deve ser um texto JSON.');
  if (jsonText.length > LIMITS.maxNotebookBytes || byteLength(jsonText) > LIMITS.maxNotebookBytes) {
    fail('document_too_large', 'O backup excede o limite total de 2 MiB.');
  }
  let value;
  try { value = JSON.parse(jsonText); } catch { fail('invalid_json', 'O backup não contém JSON válido.'); }
  return normalizeNotebook(value);
}

export function serializeNotebook(book) { return `${JSON.stringify(normalizeNotebook(book), null, 2)}\n`; }

function locate(book, meetingId) {
  identifier(meetingId);
  const meeting = book.meetings.find((row) => row.id === meetingId);
  if (!meeting) fail('meeting_not_found', 'A reunião selecionada não existe.');
  return meeting;
}

function item(meeting, collection, id) {
  identifier(id);
  const row = meeting[collection].find((entry) => entry.id === id);
  if (!row) fail('record_not_found', 'O registro selecionado não existe nesta reunião.');
  return row;
}

function change(book, meetingId, operation) {
  const result = normalizeNotebook(book);
  operation(locate(result, meetingId));
  return normalizeNotebook(result);
}

function patchFields(row, patch, allowed) {
  const changes = fields(patch, allowed, []);
  for (const key of Object.keys(changes)) row[key] = changes[key];
}

function payload(data, allowed, required, defaults) {
  return { ...defaults, ...fields(data, allowed, required) };
}

function detaching(options) {
  const settings = fields(options, ['detach'], []);
  const detach = Object.hasOwn(settings, 'detach') ? settings.detach : false;
  if (typeof detach !== 'boolean') fail('invalid_option', 'A opção de desvinculação deve ser booleana.');
  return detach;
}

export function createMeeting(book, data) {
  const result = normalizeNotebook(book);
  const input = payload(data, ['id', 'title', 'date', 'time', 'objective', 'location'], ['id', 'title'],
    { date: '', time: '', objective: '', location: '' });
  result.meetings.push({ id: input.id, title: input.title, objective: input.objective,
    date: input.date, time: input.time, location: input.location, status: 'draft',
    participants: [], agenda: [], decisions: [], actions: [], minutes: [] });
  return normalizeNotebook(result);
}

export function updateMeeting(book, meetingId, patch) {
  return change(book, meetingId, (meeting) => patchFields(meeting, patch, ['title', 'objective', 'date', 'time', 'location']));
}

export function deleteMeeting(book, meetingId) {
  const result = normalizeNotebook(book);
  locate(result, meetingId);
  result.meetings = result.meetings.filter((row) => row.id !== meetingId);
  return normalizeNotebook(result);
}

export function addParticipant(book, meetingId, data) {
  return change(book, meetingId, (meeting) => meeting.participants.push(payload(data,
    ['id', 'name', 'attendance'], ['id', 'name'], { attendance: 'unspecified' })));
}

export function updateParticipant(book, meetingId, participantId, patch) {
  return change(book, meetingId, (meeting) => patchFields(item(meeting, 'participants', participantId), patch, ['name', 'attendance']));
}

export function deleteParticipant(book, meetingId, participantId, options = {}) {
  const detach = detaching(options);
  return change(book, meetingId, (meeting) => {
    item(meeting, 'participants', participantId);
    if (meeting.actions.some((row) => row.ownerId === participantId) && !detach) {
      fail('linked_participant', 'O participante possui encaminhamentos vinculados. Escolha a desvinculação explicitamente.');
    }
    if (detach) for (const row of meeting.actions) if (row.ownerId === participantId) row.ownerId = null;
    meeting.participants = meeting.participants.filter((row) => row.id !== participantId);
  });
}

export function addTopic(book, meetingId, data) {
  return change(book, meetingId, (meeting) => meeting.agenda.push(payload(data,
    ['id', 'title', 'minutes', 'status', 'notes'], ['id', 'title'], { minutes: 0, status: 'pending', notes: '' })));
}

export function updateTopic(book, meetingId, topicId, patch) {
  return change(book, meetingId, (meeting) => patchFields(item(meeting, 'agenda', topicId), patch, ['title', 'minutes', 'status', 'notes']));
}

export function moveTopic(book, meetingId, topicId, offset) {
  if (offset !== -1 && offset !== 1) fail('invalid_offset', 'O deslocamento deve ser -1 ou 1.');
  return change(book, meetingId, (meeting) => {
    const row = item(meeting, 'agenda', topicId);
    const index = meeting.agenda.indexOf(row);
    const target = index + offset;
    if (target >= 0 && target < meeting.agenda.length) {
      [meeting.agenda[index], meeting.agenda[target]] = [meeting.agenda[target], meeting.agenda[index]];
    }
  });
}

export function deleteTopic(book, meetingId, topicId, options = {}) {
  const detach = detaching(options);
  return change(book, meetingId, (meeting) => {
    item(meeting, 'agenda', topicId);
    if ([...meeting.decisions, ...meeting.actions].some((row) => row.topicId === topicId) && !detach) {
      fail('linked_topic', 'O ponto possui decisões ou encaminhamentos vinculados. Escolha a desvinculação explicitamente.');
    }
    if (detach) for (const row of [...meeting.decisions, ...meeting.actions]) if (row.topicId === topicId) row.topicId = null;
    meeting.agenda = meeting.agenda.filter((row) => row.id !== topicId);
  });
}

export function addDecision(book, meetingId, data) {
  return change(book, meetingId, (meeting) => meeting.decisions.push(payload(data,
    ['id', 'topicId', 'text', 'reason'], ['id', 'text'], { topicId: null, reason: '' })));
}

export function updateDecision(book, meetingId, decisionId, patch) {
  return change(book, meetingId, (meeting) => patchFields(item(meeting, 'decisions', decisionId), patch, ['topicId', 'text', 'reason']));
}

export function deleteDecision(book, meetingId, decisionId) {
  return change(book, meetingId, (meeting) => {
    item(meeting, 'decisions', decisionId);
    meeting.decisions = meeting.decisions.filter((row) => row.id !== decisionId);
  });
}

export function addAction(book, meetingId, data) {
  return change(book, meetingId, (meeting) => meeting.actions.push(payload(data,
    ['id', 'topicId', 'text', 'ownerId', 'due', 'status'], ['id', 'text'],
    { topicId: null, ownerId: null, due: '', status: 'open' })));
}

export function updateAction(book, meetingId, actionId, patch) {
  return change(book, meetingId, (meeting) => patchFields(item(meeting, 'actions', actionId), patch,
    ['topicId', 'text', 'ownerId', 'due', 'status']));
}

export function deleteAction(book, meetingId, actionId) {
  return change(book, meetingId, (meeting) => {
    item(meeting, 'actions', actionId);
    meeting.actions = meeting.actions.filter((row) => row.id !== actionId);
  });
}

function copyBody(meeting) {
  const body = {};
  for (const key of bodyKeys) body[key] = meeting[key];
  return JSON.parse(JSON.stringify(body));
}

function changed(meeting) {
  return !meeting.minutes.length || JSON.stringify(copyBody(meeting)) !== JSON.stringify(meeting.minutes.at(-1).meeting);
}

function appendMinutes(meeting, closedAt) {
  meeting.minutes.push({ version: meeting.minutes.length + 1, closedAt, meeting: copyBody(meeting) });
}

export function startMeeting(book, meetingId) {
  return change(book, meetingId, (meeting) => {
    if (!['draft', 'closed'].includes(meeting.status)) fail('invalid_state', 'Somente uma reunião em rascunho ou encerrada pode ser iniciada.');
    if (!meeting.agenda.length) fail('empty_agenda', 'Inclua ao menos um ponto antes de iniciar a reunião.');
    meeting.status = 'running';
  });
}

export function closeMeeting(book, meetingId, closedAt) {
  validateTimestamp(closedAt);
  return change(book, meetingId, (meeting) => {
    if (meeting.status !== 'running') fail('invalid_state', 'Somente uma reunião em andamento pode ser encerrada.');
    meeting.status = 'closed';
    appendMinutes(meeting, closedAt);
  });
}

export function snapshotMinutes(book, meetingId, closedAt) {
  validateTimestamp(closedAt);
  return change(book, meetingId, (meeting) => {
    if (meeting.status !== 'closed') fail('invalid_state', 'Encerre a reunião antes de gerar uma nova versão da ata.');
    if (!changed(meeting)) fail('no_changes', 'A ficha atual não possui mudanças em relação à última ata.');
    appendMinutes(meeting, closedAt);
  });
}

function checkedMeeting(meeting) {
  return normalizeNotebook({ schemaVersion: 1, meetings: [meeting] }).meetings[0];
}

export function meetingBody(meeting) { return copyBody(checkedMeeting(meeting)); }
export function hasUnpublishedChanges(meeting) { return changed(checkedMeeting(meeting)); }

export function agendaSummary(meeting) {
  const { agenda } = checkedMeeting(meeting);
  return { points: agenda.length, plannedMinutes: agenda.reduce((sum, row) => sum + row.minutes, 0),
    discussed: agenda.filter((row) => row.status === 'discussed').length,
    pending: agenda.filter((row) => row.status === 'pending').length,
    deferred: agenda.filter((row) => row.status === 'deferred').length };
}

export function actionRows(book, today) {
  date(today, false);
  const normalized = normalizeNotebook(book);
  return normalized.meetings.flatMap((meeting) => meeting.actions.map((row) => ({
    meetingId: meeting.id, meetingTitle: meeting.title, ...row,
    topicTitle: row.topicId === null ? '' : meeting.agenda.find((point) => point.id === row.topicId).title,
    ownerName: row.ownerId === null ? '' : meeting.participants.find((person) => person.id === row.ownerId).name,
    overdue: row.status === 'open' && row.due !== '' && row.due < today,
  })));
}
