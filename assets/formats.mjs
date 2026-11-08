/** Pure exports. Canonical JSON remains the lossless backup format. */
import { DomainError, normalizeNotebook, actionRows } from './domain.mjs';

const meetingStates = Object.freeze({ draft: 'Rascunho', running: 'Em andamento', closed: 'Encerrada' });
const attendanceStates = Object.freeze({ unspecified: 'Não informada', present: 'Presente', absent: 'Ausente' });
const topicStates = Object.freeze({ pending: 'Pendente', discussed: 'Discutido', deferred: 'Adiado' });
const actionStates = Object.freeze({ open: 'Aberto', done: 'Concluído', cancelled: 'Cancelado' });

function normalizedMeeting(meeting) {
  return normalizeNotebook({ schemaVersion: 1, meetings: [meeting] }).meetings[0];
}

/**
 * Entity references cannot introduce CommonMark structural punctuation.
 * Encode spaces/tabs too: an imported indentation must not create a code block.
 * Backslash-newline is generated only here; user backslashes are encoded.
 */
function text(value) {
  return value.replace(/\r\n|\r/g, '\n')
    .replace(/[\t !"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g,
      character => `&#${character.codePointAt(0)};`)
    .replace(/\n/g, '\\\n');
}

function field(label, value) {
  return `**${label}:** ${text(value)}\n\n`;
}

function dateOrMissing(value) {
  return value || 'Não informada';
}

function renderBody(meeting) {
  let result = '## Identificação\n\n';
  result += field('Reunião', meeting.title);
  result += field('Objetivo', meeting.objective || 'Não informado');
  result += field('Data civil', dateOrMissing(meeting.date));
  result += field('Horário', meeting.time || 'Não informado');
  result += field('Local', meeting.location || 'Não informado');
  result += field('Estado', meetingStates[meeting.status]);

  result += '## Participantes\n\n';
  if (!meeting.participants.length) result += 'Nenhum participante registrado.\n\n';
  for (const [index, participant] of meeting.participants.entries()) {
    result += `### Participante ${index + 1}\n\n`;
    result += field('Nome', participant.name);
    result += field('Presença registrada', attendanceStates[participant.attendance]);
  }

  result += '## Pauta\n\n';
  if (!meeting.agenda.length) result += 'Nenhum ponto registrado.\n\n';
  for (const [index, topic] of meeting.agenda.entries()) {
    result += `### Ponto ${index + 1}\n\n`;
    result += field('Ponto', topic.title);
    result += field('Tempo planejado', topic.minutes === 0 ? 'Sem tempo reservado' : `${topic.minutes} min`);
    result += field('Estado', topicStates[topic.status]);
    result += field('Notas', topic.notes || 'Não registradas');
  }

  const topics = new Map(meeting.agenda.map(topic => [topic.id, topic.title]));
  const owners = new Map(meeting.participants.map(participant => [participant.id, participant.name]));
  result += '## Decisões\n\n';
  if (!meeting.decisions.length) result += 'Nenhuma decisão registrada.\n\n';
  for (const [index, decision] of meeting.decisions.entries()) {
    result += `### Decisão ${index + 1}\n\n`;
    result += field('Registro', decision.text);
    result += field('Ponto associado', decision.topicId === null ? 'Sem ponto associado' : topics.get(decision.topicId));
    result += field('Justificativa', decision.reason || 'Não informada');
  }

  result += '## Encaminhamentos\n\n';
  if (!meeting.actions.length) result += 'Nenhum encaminhamento registrado.\n\n';
  for (const [index, action] of meeting.actions.entries()) {
    result += `### Encaminhamento ${index + 1}\n\n`;
    result += field('Ação', action.text);
    result += field('Ponto associado', action.topicId === null ? 'Sem ponto associado' : topics.get(action.topicId));
    result += field('Responsável', action.ownerId === null ? 'Não definido' : owners.get(action.ownerId));
    result += field('Prazo civil', action.due || 'Sem prazo');
    result += field('Estado', actionStates[action.status]);
  }
  return result;
}

/** Export the selected historical body, never the editable current body. */
export function minutesMarkdown(meeting, version) {
  const normalized = normalizedMeeting(meeting);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new DomainError('minutes_version_invalid', 'A versão da ata deve ser um inteiro positivo.');
  }
  const snapshot = normalized.minutes.find(item => item.version === version);
  if (!snapshot) throw new DomainError('minutes_not_found', 'A versão da ata não foi encontrada.');
  let result = `# Ata · versão ${snapshot.version}\n\n`;
  result += field('Encerramento registrado em UTC', snapshot.closedAt);
  result += 'Registro local versionado; não comprova consenso, assinatura ou presença.\n\n';
  return result + renderBody(snapshot.meeting);
}

/** A working record is deliberately labeled independently from its minutes. */
export function workingMarkdown(meeting) {
  const normalized = normalizedMeeting(meeting);
  return '# Ficha de trabalho\n\n'
    + 'Conteúdo atual editável da reunião. Esta exportação não é uma ata; alterações não modificam atas anteriores.\n\n'
    + renderBody(normalized);
}

function csvCell(value) {
  // Prefix, rather than replace, so the original text is recoverable from JSON.
  // Whitespace before a formula must not bypass the spreadsheet guard.
  const protectedValue = /^[\s]*[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  return `"${protectedValue.replace(/"/g, '""')}"`;
}

function csvOptions(options) {
  if (options === null || typeof options !== 'object'
      || ![Object.prototype, null].includes(Object.getPrototypeOf(options))
      || Reflect.ownKeys(options).some(key => key !== 'status')
      || Object.getOwnPropertyDescriptor(options, 'status')?.get
      || Object.getOwnPropertyDescriptor(options, 'status')?.set) {
    throw new DomainError('csv_options_invalid', 'As opções da exportação CSV são inválidas.');
  }
  const status = options.status === undefined ? 'all' : options.status;
  if (!['all', 'open', 'done', 'cancelled'].includes(status)) {
    throw new DomainError('csv_status_invalid', 'O filtro de estado da exportação CSV é inválido.');
  }
  return status;
}

/** RFC 4180, including quoted fields, doubled quotes and CRLF records. */
export function actionsCsv(book, today, options = {}) {
  const normalized = normalizeNotebook(book);
  const status = csvOptions(options);
  const rows = actionRows(normalized, today).filter(action => status === 'all' || action.status === status);
  const records = [[
    'ID da reunião', 'Reunião', 'ID do encaminhamento', 'Encaminhamento',
    'ID do ponto', 'Ponto da pauta', 'ID do responsável', 'Responsável',
    'Prazo civil', 'Estado', 'Em atraso',
  ]];
  for (const action of rows) {
    records.push([
      action.meetingId, action.meetingTitle, action.id, action.text,
      action.topicId ?? '', action.topicTitle, action.ownerId ?? '', action.ownerName,
      action.due, actionStates[action.status], action.overdue ? 'Sim' : 'Não',
    ]);
  }
  return records.map(record => record.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Current collections are counted once; historical bodies are not added. */
export function notebookSummary(book) {
  const normalized = normalizeNotebook(book);
  return normalized.meetings.reduce((summary, meeting) => {
    summary.meetings += 1;
    summary.participants += meeting.participants.length;
    summary.points += meeting.agenda.length;
    summary.decisions += meeting.decisions.length;
    summary.actions += meeting.actions.length;
    summary.minutes += meeting.minutes.length;
    return summary;
  }, { meetings: 0, participants: 0, points: 0, decisions: 0, actions: 0, minutes: 0 });
}
