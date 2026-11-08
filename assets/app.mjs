import * as D from './domain.mjs';
import { minutesMarkdown, workingMarkdown, actionsCsv, notebookSummary } from './formats.mjs';
import { createStore, StorageError } from './store.mjs';
import { createExampleNotebook } from './example.mjs';

const TABS = [['agenda', 'Pauta'], ['minutes', 'Atas'], ['actions', 'Encaminhamentos'], ['files', 'Backup']];
const STATUS = { draft: 'Em preparação', running: 'Em andamento', closed: 'Encerrada' };
const TOPIC = { pending: 'Pendente', discussed: 'Tratado', deferred: 'Adiado' };
const ACTION = { open: 'Aberto', done: 'Concluído', cancelled: 'Cancelado' };
const ATTENDANCE = { unspecified: 'Presença não informada', present: 'Presente', absent: 'Ausente' };
const civil = value => value ? value.slice(8) + '/' + value.slice(5, 7) + '/' + value.slice(0, 4) : 'Sem data';
const instant = value => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value));
export function todayInSaoPaulo(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Sao_Paulo' }).formatToParts(value);
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function mountApp(host, dependencies = {}) {
  const document = host.ownerDocument;
  const store = dependencies.store || createStore();
  const newId = dependencies.id || (() => globalThis.crypto.randomUUID());
  const now = dependencies.now || (() => new Date().toISOString());
  const today = dependencies.today || (() => todayInSaoPaulo());
  const state = { book: D.emptyNotebook(), selected: null, topic: null, tab: 'agenda', editor: null,
    confirmation: null, preview: null, version: null, filter: 'open', error: '', notice: '',
    enabled: false, storageBusy: false, revision: 0, saveState: 'off', epoch: 0, dirty: false };
  const drafts = new Map();
  let alive = true, importGeneration = 0, saveTask = Promise.resolve(), pendingSave = null, saving = false;
  const selected = () => state.book.meetings.find(item => item.id === state.selected) || null;
  const selectedTopic = meeting => meeting.agenda.find(item => item.id === state.topic) || meeting.agenda[0] || null;

  function h(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === 'class') node.className = value;
      else if (key === 'value') node.value = value;
      else if (['checked', 'disabled', 'required', 'selected'].includes(key)) {
        if (value) { node[key] = true; node.setAttribute(key, ''); }
      } else if (value !== null && value !== undefined) node.setAttribute(key, String(value));
    }
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }
  function trackForm(form, key) {
    form.setAttribute('data-draft-key', key);
    const mark = () => { form.setAttribute('data-dirty', 'true'); feedback(); };
    form.addEventListener('input', mark); form.addEventListener('change', mark);
    return form;
  }
  function pruneDrafts() {
    for (const key of drafts.keys()) {
      const [kind, meetingId, type, id] = JSON.parse(key);
      const meeting = state.book.meetings.find(item => item.id === meetingId);
      if (kind === 'topic' && !meeting?.agenda.some(item => item.id === type)) drafts.delete(key);
      if (kind === 'editor' && meetingId !== null) {
        const collection = ({ topic: 'agenda', participant: 'participants', decision: 'decisions', action: 'actions' })[type];
        if (!meeting || (id !== null && collection && !meeting[collection].some(item => item.id === id))) drafts.delete(key);
      }
    }
  }
  function captureDrafts() {
    for (const form of host.querySelectorAll('form[data-dirty=true]')) {
      const key = form.getAttribute('data-draft-key');
      if (key) drafts.set(key, [...form.querySelectorAll('[name]')].map(node => [node.name, node.value]));
    }
    pruneDrafts();
  }
  function hasDrafts() { return drafts.size > 0 || !!host.querySelector('form[data-dirty=true]'); }
  function completeForm(form) {
    const key = form.getAttribute('data-draft-key'); drafts.delete(key); form.removeAttribute('data-dirty');
    for (const current of host.querySelectorAll('form[data-draft-key]')) if (current.getAttribute('data-draft-key') === key) current.removeAttribute('data-dirty');
    feedback();
  }
  function ensureSavedForms() {
    if (hasDrafts()) throw new D.DomainError('unsaved_form', 'Há texto ainda não salvo em um formulário. Volte a ele e use Salvar ou Cancelar antes de continuar.');
  }
  const beforeUnload = event => {
    if (alive && (hasDrafts() || (state.book.meetings.length && (!state.enabled || state.dirty || saving)))) {
      event.preventDefault(); event.returnValue = '';
    }
  };
  document.defaultView?.addEventListener('beforeunload', beforeUnload);
  function fail(error) {
    if (!alive) return;
    state.error = error instanceof D.DomainError || error instanceof StorageError ? error.message
      : 'Não foi possível concluir. Seu caderno continua na sessão; baixe um backup e tente novamente.';
    feedback();
  }
  function run(fn) { try { const result = fn(); if (result?.catch) result.catch(fail); } catch (error) { fail(error); } }
  function button(label, fn, options = {}) {
    return h('button', { type: 'button', 'data-focus': options.id || options['data-focus'] || 'action-' + (options['aria-label'] || label), ...options, onclick: () => run(fn) }, label);
  }
  function feedback() {
    if (!alive) return;
    host.querySelector('#feedback')?.replaceChildren(...[
      state.error ? h('div', { class: 'notice error', role: 'alert' }, h('p', {}, state.error), button('Fechar aviso', () => { state.error = ''; feedback(); }, { class: 'text-button' })) : null,
      state.notice ? h('p', { class: 'notice', role: 'status' }, state.notice) : null,
    ].filter(Boolean));
    const draftStatus = host.querySelector('#draft-status');
    if (draftStatus) { draftStatus.textContent = hasDrafts() ? 'Há texto ainda não salvo em um formulário. Ele será preservado nesta sessão; volte ao formulário para salvar.' : ''; draftStatus.hidden = !hasDrafts(); }
    const status = host.querySelector('#storage-status');
    if (status) status.textContent = ({ off: 'Sessão temporária', busy: 'Salvando…', ready: 'Salvo neste navegador', conflict: 'Conflito: preserve esta sessão com um backup', error: 'Falha ao salvar: sessão preservada' })[state.saveState];
    for (const control of host.querySelectorAll('[data-storage-action]')) {
      const action = control.getAttribute('data-storage-action');
      control.disabled = state.storageBusy || (action === 'enable' && state.enabled) || (action === 'clear' && !state.enabled);
      if (action === 'enable') control.textContent = state.enabled ? 'Salvamento ativo' : 'Ativar salvamento';
    }
  }
  async function drainSaves() {
    saving = true; state.saveState = 'busy'; feedback();
    try {
      while (pendingSave && state.enabled) {
        const item = pendingSave; pendingSave = null;
        const receipt = await store.save(item.book, state.revision);
        if (!alive) return;
        state.revision = receipt.revision;
        if (item.epoch === state.epoch) state.dirty = false;
      }
      state.saveState = state.enabled ? 'ready' : 'off';
    } catch (error) {
      pendingSave = null; state.enabled = false;
      state.saveState = error.code === 'conflict' ? 'conflict' : 'error'; fail(error);
    } finally { saving = false; feedback(); }
  }
  function scheduleSave() {
    if (!state.enabled) return;
    pendingSave = { book: D.normalizeNotebook(state.book), epoch: state.epoch };
    if (!saving) saveTask = drainSaves();
  }
  function accept(next, selection = state.selected) {
    const previousSelection = state.selected;
    state.book = D.normalizeNotebook(next);
    state.selected = state.book.meetings.some(item => item.id === selection) ? selection : state.book.meetings[0]?.id || null;
    if (previousSelection !== state.selected) state.version = null;
    if (!selected()?.agenda.some(item => item.id === state.topic)) state.topic = selected()?.agenda[0]?.id || null;
    state.epoch++; importGeneration++; state.dirty = true; state.editor = null; state.confirmation = null; state.preview = null;
    state.error = ''; state.notice = ''; scheduleSave(); render();
  }
  function mutate(fn, selection) { accept(fn(state.book), selection); }
  function notice(text) { state.notice = text; feedback(); }
  function confirm(message, action) {
    state.confirmation = { message, action }; state.editor = null; render(); host.querySelector('#confirm-action')?.focus();
  }
  function edit(type, id = null) {
    state.editor = { type, id }; state.confirmation = null; state.error = ''; render(); host.querySelector('#editor-form input, #editor-form textarea')?.focus();
  }
  function openEnvelope(envelope) {
    if (!alive) return;
    ensureSavedForms(); drafts.clear();
    state.book = D.normalizeNotebook(envelope.document); state.selected = state.book.meetings[0]?.id || null;
    state.topic = selected()?.agenda[0]?.id || null; state.version = null; state.revision = envelope.revision;
    state.enabled = true; state.saveState = 'ready'; state.epoch++; importGeneration++; state.dirty = false;
    state.editor = null; state.preview = null; state.confirmation = null; state.error = '';
    state.notice = 'Caderno salvo aberto. As próximas alterações serão salvas neste navegador.'; render();
  }
  async function storageAction(mode) {
    if (!alive || state.storageBusy) return;
    state.storageBusy = true; const before = state.epoch; render();
    try {
      await saveTask; if (!alive) return;
      const envelope = await store.load(); if (!alive) return;
      if (before !== state.epoch) throw new D.DomainError('changed', 'A sessão mudou durante a leitura. Tente abrir o salvo novamente.');
      if (envelope.document) confirm('Abrir o caderno salvo substitui esta sessão. Baixe o backup da sessão atual se quiser preservá-la.', () => openEnvelope(envelope));
      else if (mode === 'open') notice('Ainda não há um caderno salvo neste navegador.');
      else { state.revision = envelope.revision; state.enabled = true; scheduleSave(); notice('Salvamento ativado para esta sessão.'); }
    } finally { state.storageBusy = false; render(); }
  }
  async function clearSaved() {
    if (!alive || state.storageBusy) return;
    state.storageBusy = true;
    try {
      await saveTask; if (!alive) return;
      if (!state.enabled) throw new D.DomainError('storage', 'O salvamento está interrompido. Faça backup e abra o salvo para conferir a revisão.');
      state.enabled = false; pendingSave = null; state.saveState = 'off';
      const envelope = await store.clear(state.revision); if (!alive) return;
      state.revision = envelope.revision; state.confirmation = null;
      state.notice = 'O salvamento foi apagado. A sessão atual continua aberta e pode ser exportada.';
    } catch (error) { state.saveState = error.code === 'conflict' ? 'conflict' : 'error'; throw error; }
    finally { state.storageBusy = false; render(); }
  }
  function download(name, text, mime) {
    if (dependencies.download) return dependencies.download(name, text, mime);
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const anchor = h('a', { href: url, download: name }); document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const backup = () => { ensureSavedForms(); download('pauta-aberta.json', D.serializeNotebook(state.book), 'application/json;charset=utf-8'); };
  const exportWorking = meeting => { ensureSavedForms(); download('ficha-de-trabalho.md', workingMarkdown(meeting), 'text/markdown;charset=utf-8'); };
  const exportMinutes = (meeting, version) => download(`ata-versao-${version}.md`, minutesMarkdown(meeting, version), 'text/markdown;charset=utf-8');
  async function importFile(file) {
    if (!file) return;
    const generation = ++importGeneration, epoch = state.epoch;
    state.preview = null; state.error = ''; state.notice = ''; render();
    if (file.size > D.LIMITS.maxNotebookBytes) throw new D.DomainError('limit', 'O arquivo excede 2 MiB. Escolha um backup menor.');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
    catch { if (generation !== importGeneration || !alive) return; throw new D.DomainError('encoding', 'Escolha um backup JSON com texto UTF-8 válido.'); }
    if (generation !== importGeneration || epoch !== state.epoch || !alive) return;
    state.preview = { book: D.parseNotebook(text), epoch, example: false }; state.tab = 'files'; render(); host.querySelector('#import-confirm')?.focus();
  }
  function example() {
    ensureSavedForms();
    importGeneration++;
    const book = createExampleNotebook();
    if (!state.book.meetings.length) { accept(book); state.tab = 'agenda'; render(); notice('Exemplo inteiramente fictício. A ata 1 foi preservada antes de concluir um encaminhamento.'); }
    else { state.preview = { book, epoch: state.epoch, example: true }; state.tab = 'files'; state.editor = null; render(); }
  }
  function applyPreview() {
    ensureSavedForms();
    const preview = state.preview;
    if (!preview || preview.epoch !== state.epoch) throw new D.DomainError('changed', 'A sessão mudou. Abra o arquivo novamente para revisar a prévia.');
    drafts.clear(); state.version = null; state.topic = null; accept(preview.book); notice(preview.example ? 'Exemplo fictício aberto.' : 'Backup aberto integralmente.');
  }
  function field(name, label, value = '', options = {}) {
    const { multiline, choices, hint, class: className, ...attrs } = options;
    const id = 'field-' + name;
    const control = choices ? h('select', { id, name, 'data-focus': id, ...attrs }, choices.map(([key, text]) => h('option', { value: key, selected: key === value }, text)))
      : h(multiline ? 'textarea' : 'input', { id, name, value, 'data-focus': id, ...(multiline ? { rows: 4 } : { type: 'text' }), ...attrs });
    return h('label', { class: 'field' + (className ? ' ' + className : ''), for: id }, h('span', {}, label), control, hint ? h('span', { class: 'help' }, hint) : null);
  }
  const value = (form, name) => form.querySelector(`[name="${name}"]`).value;
  function editorPanel(meeting) {
    if (!state.editor) return null;
    const { type, id } = state.editor;
    const titles = { meeting: id ? 'Editar reunião' : 'Nova reunião', topic: id ? 'Editar ponto' : 'Novo ponto da pauta', participant: id ? 'Editar participante' : 'Adicionar participante', decision: id ? 'Editar decisão' : 'Registrar decisão', action: id ? 'Editar encaminhamento' : 'Novo encaminhamento' };
    const form = trackForm(h('form', { id: 'editor-form', class: 'editor' }, h('h2', { tabindex: -1 }, titles[type])), JSON.stringify(['editor', type === 'meeting' && !id ? null : meeting?.id || null, type, id]));
    let save;
    if (type === 'meeting') {
      const record = id ? meeting : {};
      form.append(h('div', { class: 'form-grid' }, field('title', 'Nome da reunião', record.title || '', { required: true, maxlength: 120, class: 'wide' }), field('date', 'Data', record.date || '', { type: 'date' }), field('time', 'Horário', record.time || '', { type: 'time' }), field('location', 'Local ou contexto', record.location || '', { maxlength: 200, class: 'wide' }), field('objective', 'Objetivo da conversa', record.objective || '', { multiline: true, maxlength: 1000, rows: 3, class: 'wide' })));
      save = () => {
        const patch = Object.fromEntries(['title', 'date', 'time', 'location', 'objective'].map(key => [key, value(form, key)]));
        const target = id || newId();
        mutate(book => id ? D.updateMeeting(book, id, patch) : D.createMeeting(book, { id: target, ...patch }), target); state.tab = 'agenda'; render();
      };
    } else if (type === 'participant') {
      const record = meeting.participants.find(item => item.id === id);
      form.append(field('name', 'Nome ou identificação', record?.name || '', { required: true, maxlength: 80 }), field('attendance', 'Presença informada', record?.attendance || 'unspecified', { choices: Object.entries(ATTENDANCE) }));
      save = () => mutate(book => id ? D.updateParticipant(book, meeting.id, id, { name: value(form, 'name'), attendance: value(form, 'attendance') }) : D.addParticipant(book, meeting.id, { id: newId(), name: value(form, 'name'), attendance: value(form, 'attendance') }));
    } else if (type === 'topic') {
      const record = meeting.agenda.find(item => item.id === id);
      form.append(field('title', 'Título do ponto', record?.title || '', { required: true, maxlength: 160 }), field('minutes', 'Minutos planejados', String(record?.minutes || 0), { type: 'number', min: 0, max: 480, step: 1, required: true, hint: 'Zero significa sem tempo reservado. Não há cronômetro.' }));
      save = () => { const target = id || newId(); mutate(book => id ? D.updateTopic(book, meeting.id, id, { title: value(form, 'title'), minutes: Number(value(form, 'minutes')) }) : D.addTopic(book, meeting.id, { id: target, title: value(form, 'title'), minutes: Number(value(form, 'minutes')) })); state.topic = target; render(); };
    } else if (type === 'decision') {
      const record = meeting.decisions.find(item => item.id === id);
      form.append(field('topicId', 'Ponto da pauta', record ? record.topicId || '' : state.topic || '', { choices: [['', 'Sem vínculo com um ponto'], ...meeting.agenda.map(item => [item.id, item.title])] }), field('text', 'O que foi decidido', record?.text || '', { multiline: true, rows: 4, maxlength: 2000, required: true }), field('reason', 'Motivo ou contexto', record?.reason || '', { multiline: true, rows: 3, maxlength: 2000 }));
      save = () => { const patch = { topicId: value(form, 'topicId') || null, text: value(form, 'text'), reason: value(form, 'reason') }; mutate(book => id ? D.updateDecision(book, meeting.id, id, patch) : D.addDecision(book, meeting.id, { id: newId(), ...patch })); };
    } else if (type === 'action') {
      const record = meeting.actions.find(item => item.id === id);
      form.append(field('text', 'O que precisa ser feito', record?.text || '', { multiline: true, maxlength: 500, required: true, rows: 3 }), h('div', { class: 'form-grid' }, field('ownerId', 'Responsável', record?.ownerId || '', { choices: [['', 'Ainda sem responsável'], ...meeting.participants.map(item => [item.id, item.name])] }), field('due', 'Prazo', record?.due || '', { type: 'date' }), field('topicId', 'Ponto da pauta', record ? record.topicId || '' : state.topic || '', { choices: [['', 'Sem vínculo com um ponto'], ...meeting.agenda.map(item => [item.id, item.title])] }), field('status', 'Estado', record?.status || 'open', { choices: Object.entries(ACTION) })));
      save = () => { const patch = { text: value(form, 'text'), ownerId: value(form, 'ownerId') || null, due: value(form, 'due'), topicId: value(form, 'topicId') || null, status: value(form, 'status') }; mutate(book => id ? D.updateAction(book, meeting.id, id, patch) : D.addAction(book, meeting.id, { id: newId(), ...patch })); };
    }
    form.append(h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'primary', 'data-focus': 'save-editor' }, 'Salvar na ficha'), button('Cancelar', () => { completeForm(form); state.editor = null; render(); }, { class: 'secondary' })));
    form.addEventListener('submit', event => { event.preventDefault(); run(() => { save(); completeForm(form); }); });
    return form;
  }
  function arrow(direction, label, fn, disabled) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); path.setAttribute('viewBox', '0 0 20 20'); path.setAttribute('aria-hidden', 'true');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path'); line.setAttribute('d', direction === 'up' ? 'm5 12 5-5 5 5' : 'm5 8 5 5 5-5'); path.append(line);
    const node = button('', fn, { 'aria-label': label, title: label, disabled }); node.append(path); return node;
  }
  function lifecycle(meeting) {
    return h('div', { class: 'lifecycle' }, h('span', { class: 'status-text' }, STATUS[meeting.status]),
      meeting.status !== 'running' ? button(meeting.status === 'closed' ? 'Reabrir reunião' : 'Iniciar reunião', () => mutate(book => D.startMeeting(book, meeting.id)), { class: 'secondary compact', disabled: !meeting.agenda.length }) : button('Encerrar e gerar ata', () => { ensureSavedForms(); confirm('Encerrar a reunião e preservar uma ata com a ficha atual? Pontos pendentes e dados ausentes serão registrados como estão.', () => { ensureSavedForms(); mutate(book => D.closeMeeting(book, meeting.id, now())); notice('Ata preservada. A ficha de trabalho continua editável.'); }); }, { class: 'primary compact', disabled: meeting.minutes.length >= D.LIMITS.maxMinutes }),
      meeting.status === 'closed' ? button('Gerar nova versão', () => { ensureSavedForms(); confirm('Gerar outra versão da ata com as alterações da ficha atual? As versões anteriores continuarão preservadas.', () => { ensureSavedForms(); mutate(book => D.snapshotMinutes(book, meeting.id, now())); notice('Nova versão da ata preservada.'); }); }, { class: 'primary compact', disabled: !D.hasUnpublishedChanges(meeting) || meeting.minutes.length >= D.LIMITS.maxMinutes }) : null);
  }
  function recordRail(meeting) {
    const last = meeting.minutes.at(-1), dirty = D.hasUnpublishedChanges(meeting);
    return h('aside', { class: 'record-rail surface', 'aria-label': 'Ata preservada' }, h('h2', {}, 'O que fica registrado'), h('p', { class: 'help' }, 'A ficha ao lado pode mudar. Cada ata guarda uma cópia independente.'), h('div', { class: 'record-rule' }),
      last ? [h('p', { class: 'record-title' }, `Ata · versão ${last.version}`), h('p', { class: 'record-date' }, instant(last.closedAt), ' · São Paulo'), h('ul', {}, h('li', {}, `${last.meeting.agenda.length} pontos na pauta`), h('li', {}, `${last.meeting.decisions.length} ${last.meeting.decisions.length === 1 ? 'decisão registrada' : 'decisões registradas'}`), h('li', {}, `${last.meeting.actions.length} encaminhamentos`)), dirty ? h('p', { class: 'record-change' }, 'Há alterações na ficha após esta ata.') : h('p', { class: 'help' }, 'A ficha corresponde à última ata.'), h('div', { class: 'rail-footer button-row' }, button('Ler ata preservada', () => { state.tab = 'minutes'; state.version = last.version; state.editor = null; render(); }, { class: 'text-button' }), button('Baixar Markdown', () => exportMinutes(meeting, last.version), { class: 'text-button' }))]
        : [h('p', { class: 'record-title' }, 'Ainda sem ata'), h('p', { class: 'help' }, 'Inicie a reunião, registre o que ocorreu e use Encerrar e gerar ata para preservar a primeira versão.')],
      h('div', { class: 'record-rule' }), h('p', { class: 'help' }, 'Durações são planejadas. Presença e decisões são informadas por você. O registro local não é uma assinatura.'));
  }
  function decisionRow(meeting, entry) {
    return h('article', { class: 'entry-row' }, h('p', {}, entry.text), entry.reason ? h('p', { class: 'help' }, entry.reason) : null,
      h('div', { class: 'button-row' }, button('Editar decisão', () => edit('decision', entry.id), { class: 'text-button', 'data-focus': 'decision-' + entry.id }), button('Remover', () => confirm('Remover esta decisão da ficha? Atas anteriores permanecem iguais.', () => mutate(book => D.deleteDecision(book, meeting.id, entry.id))), { class: 'text-button danger', 'aria-label': 'Remover decisão ' + entry.text })));
  }
  function actionSelect(meeting, entry, context = '') {
    const id = `action-status-${context}-${meeting.id}-${entry.id}`;
    return h('label', {}, h('span', { class: 'sr-only' }, 'Estado do encaminhamento: ' + entry.text), h('select', { id, 'data-focus': id, 'aria-label': 'Estado do encaminhamento: ' + entry.text, onchange: event => run(() => mutate(book => D.updateAction(book, meeting.id, entry.id, { status: event.target.value }))) }, Object.entries(ACTION).map(([key, label]) => h('option', { value: key, selected: key === entry.status }, label))));
  }
  function actionRow(meeting, entry) {
    const owner = meeting.participants.find(item => item.id === entry.ownerId)?.name || 'Sem responsável';
    return h('article', { class: 'entry-row' }, h('p', {}, entry.text), h('p', { class: 'help' }, owner, ' · ', entry.due ? 'Prazo ' + civil(entry.due) : 'Sem prazo'), h('div', { class: 'entry-controls' }, actionSelect(meeting, entry, 'topic'), h('div', { class: 'button-row' }, button('Editar', () => edit('action', entry.id), { class: 'text-button', 'aria-label': 'Editar encaminhamento ' + entry.text }), button('Remover', () => confirm('Remover este encaminhamento da ficha? Atas anteriores permanecem iguais.', () => mutate(book => D.deleteAction(book, meeting.id, entry.id))), { class: 'text-button danger', 'aria-label': 'Remover encaminhamento ' + entry.text }))));
  }
  function participantPanel(meeting) {
    return h('section', { class: 'participants' }, h('details', {}, h('summary', {}, `Participantes · ${meeting.participants.length}`),
      meeting.participants.map(entry => h('div', { class: 'participant-row' }, h('div', {}, entry.name, h('br'), h('span', {}, ATTENDANCE[entry.attendance])), h('div', { class: 'button-row' }, button('Editar', () => edit('participant', entry.id), { class: 'text-button', 'aria-label': 'Editar participante ' + entry.name }), button('Remover', () => { const count = meeting.actions.filter(item => item.ownerId === entry.id).length; confirm(`Remover este participante da ficha? ${count ? count + ' encaminhamento(s) ficarão sem responsável.' : 'Não há encaminhamentos vinculados.'} Atas anteriores permanecem iguais.`, () => mutate(book => D.deleteParticipant(book, meeting.id, entry.id, { detach: true }))); }, { class: 'text-button danger', 'aria-label': 'Remover participante ' + entry.name })))),
      h('div', { class: 'button-row' }, button('Adicionar participante', () => edit('participant'), { class: 'text-button', disabled: meeting.participants.length >= D.LIMITS.maxParticipants }))));
  }
  function agendaView(meeting) {
    const topic = selectedTopic(meeting), summary = D.agendaSummary(meeting);
    const work = h('section', { class: 'surface work-column' }, h('div', { class: 'agenda-bar' }, h('div', {}, h('h2', {}, 'Pauta da conversa'), h('p', {}, `${summary.points} pontos · ${summary.plannedMinutes} min planejados · ${summary.discussed} tratados`)), button('Adicionar ponto', () => edit('topic'), { class: 'secondary compact', disabled: meeting.agenda.length >= D.LIMITS.maxTopics })));
    work.append(h('ol', { class: 'topic-list', 'aria-label': 'Pontos da pauta' }, meeting.agenda.map((entry, index) => h('li', { class: 'topic-row' }, button('', () => { state.topic = entry.id; state.editor = null; render(); }, { class: 'topic-select', 'aria-current': topic?.id === entry.id ? 'true' : null, 'aria-label': 'Abrir ponto ' + entry.title, 'data-focus': 'topic-' + entry.id }), h('div', { class: 'move-topic' }, arrow('up', 'Mover ponto para cima: ' + entry.title, () => mutate(book => D.moveTopic(book, meeting.id, entry.id, -1)), index === 0), arrow('down', 'Mover ponto para baixo: ' + entry.title, () => mutate(book => D.moveTopic(book, meeting.id, entry.id, 1)), index === meeting.agenda.length - 1))))));
    // The button remains semantic; the structured title and duration are text nodes.
    [...work.querySelectorAll('.topic-select')].forEach((node, index) => { const entry = meeting.agenda[index]; node.append(h('span', { class: 'topic-number' }, String(index + 1).padStart(2, '0')), h('span', {}, h('strong', {}, entry.title), h('small', {}, TOPIC[entry.status])), h('span', { class: 'topic-duration' }, entry.minutes ? entry.minutes + ' min' : 'Sem tempo')); });
    if (!topic) work.append(h('div', { class: 'plain-empty' }, h('h3', {}, 'Comece pelo primeiro ponto'), h('p', {}, 'Divida a conversa em assuntos e reserve um tempo para cada um. A pauta pode mudar durante a reunião.')));
    if (topic) {
      const form = trackForm(h('form', { class: 'topic-editor', id: 'topic-notes' }, h('div', { class: 'section-heading' }, h('h3', {}, topic.title), button('Editar título e tempo', () => edit('topic', topic.id), { class: 'text-button', 'data-focus': 'edit-topic-' + topic.id })), field('topicStatus', 'Situação deste ponto', topic.status, { choices: Object.entries(TOPIC) }), field('notes', 'Notas da conversa', topic.notes, { multiline: true, rows: 5, maxlength: 6000, hint: 'Registre decisões e ações nos campos próprios abaixo para mantê-las fáceis de encontrar.' }), h('div', { class: 'button-row' }, h('button', { type: 'submit', class: 'secondary', 'data-focus': 'save-topic-' + topic.id }, 'Salvar notas e situação'), button('Descartar rascunho', () => { completeForm(form); render(); }, { class: 'text-button' }))), JSON.stringify(['topic', meeting.id, topic.id]));
      form.addEventListener('submit', event => { event.preventDefault(); run(() => { mutate(book => D.updateTopic(book, meeting.id, topic.id, { status: value(form, 'topicStatus'), notes: value(form, 'notes') })); completeForm(form); notice('Notas e situação salvas na ficha. As atas existentes permanecem iguais.'); }); });
      work.append(form, h('section', { class: 'topic-section' }, h('div', { class: 'section-heading' }, h('h3', {}, 'Decisões deste ponto'), button('Registrar decisão', () => { state.topic = topic.id; edit('decision'); }, { class: 'text-button', disabled: meeting.decisions.length >= D.LIMITS.maxDecisions })), meeting.decisions.filter(entry => entry.topicId === topic.id).map(entry => decisionRow(meeting, entry)), !meeting.decisions.some(entry => entry.topicId === topic.id) ? h('p', { class: 'help' }, 'Ainda não há uma decisão registrada neste ponto.') : null),
      h('section', { class: 'topic-section' }, h('div', { class: 'section-heading' }, h('h3', {}, 'Encaminhamentos deste ponto'), button('Adicionar ação', () => { state.topic = topic.id; edit('action'); }, { class: 'text-button', disabled: meeting.actions.length >= D.LIMITS.maxActions })), meeting.actions.filter(entry => entry.topicId === topic.id).map(entry => actionRow(meeting, entry)), !meeting.actions.some(entry => entry.topicId === topic.id) ? h('p', { class: 'help' }, 'Transforme os próximos passos em ações com responsável e prazo, quando conhecidos.') : null),
      h('div', { class: 'topic-section' }, button('Remover ponto da ficha', () => { const linked = meeting.decisions.filter(item => item.topicId === topic.id).length + meeting.actions.filter(item => item.topicId === topic.id).length; confirm(`Remover este ponto? ${linked ? linked + ' decisão(ões)/ação(ões) serão desvinculadas e seus textos serão preservados.' : 'Não há decisões ou ações vinculadas.'} Atas anteriores permanecerão iguais.`, () => mutate(book => D.deleteTopic(book, meeting.id, topic.id, { detach: true }))); }, { class: 'text-button danger' })));
    }
    const looseDecisions = meeting.decisions.filter(entry => entry.topicId === null), looseActions = meeting.actions.filter(entry => entry.topicId === null);
    if (looseDecisions.length || looseActions.length) work.append(h('section', { class: 'topic-section' }, h('h3', {}, 'Registros sem ponto vinculado'), h('p', { class: 'help' }, 'Estes registros continuam na ficha. Você pode associá-los a outro ponto ao editar.'), looseDecisions.map(entry => decisionRow(meeting, entry)), looseActions.map(entry => actionRow(meeting, entry))));
    work.append(participantPanel(meeting));
    return h('div', { class: 'editor-layout' }, work, recordRail(meeting));
  }
  function minutesPaper(body, snapshot) {
    return h('article', { class: 'minutes-paper' }, h('h2', {}, snapshot ? `Ata · versão ${snapshot.version}` : 'Ficha de trabalho'), h('p', { class: 'help' }, snapshot ? instant(snapshot.closedAt) + ' · America/Sao_Paulo · cópia preservada' : 'Conteúdo atual, ainda sem número de ata.'), h('h3', {}, body.title), h('p', {}, [civil(body.date), body.time, body.location].filter(Boolean).join(' · ')), body.objective ? h('p', {}, body.objective) : null,
      h('h3', {}, 'Participantes'), !body.participants.length ? h('p', {}, 'Nenhum participante informado.') : h('ul', {}, body.participants.map(entry => h('li', {}, entry.name, ' · ', ATTENDANCE[entry.attendance]))),
      h('h3', {}, 'Pauta e notas'), !body.agenda.length ? h('p', {}, 'Nenhum ponto informado.') : body.agenda.map((entry, index) => h('section', {}, h('h4', {}, `${index + 1}. ${entry.title}`), h('p', { class: 'help' }, TOPIC[entry.status], ' · ', entry.minutes ? entry.minutes + ' min planejados' : 'Sem tempo reservado'), h('p', {}, entry.notes || 'Sem notas registradas.'))),
      h('h3', {}, 'Decisões'), !body.decisions.length ? h('p', {}, 'Nenhuma decisão registrada.') : body.decisions.map(entry => h('section', {}, h('p', {}, entry.text), h('p', { class: 'help' }, 'Ponto: ', body.agenda.find(item => item.id === entry.topicId)?.title || 'Sem vínculo'), entry.reason ? h('p', {}, 'Contexto: ', entry.reason) : null)),
      h('h3', {}, 'Encaminhamentos'), !body.actions.length ? h('p', {}, 'Nenhum encaminhamento registrado.') : body.actions.map(entry => h('section', {}, h('p', {}, entry.text), h('p', { class: 'help' }, body.participants.find(item => item.id === entry.ownerId)?.name || 'Sem responsável', ' · ', entry.due ? 'Prazo ' + civil(entry.due) : 'Sem prazo', ' · ', ACTION[entry.status]), h('p', { class: 'help' }, 'Ponto: ', body.agenda.find(item => item.id === entry.topicId)?.title || 'Sem vínculo'))));
  }
  function minutesView(meeting) {
    const version = state.version === 'working' ? null : meeting.minutes.find(item => item.version === state.version) || meeting.minutes.at(-1) || null;
    const working = !version;
    return h('section', {}, h('div', { class: 'section-heading' }, h('h2', {}, 'Leia uma versão preservada'), button(working ? 'Baixar ficha Markdown' : `Baixar ata ${version.version} · Markdown`, () => working ? exportWorking(meeting) : exportMinutes(meeting, version.version), { class: 'secondary' })), h('p', { class: 'help' }, 'Atas anteriores preservam nomes, responsáveis, prazos e estados daquele registro. O histórico local não é uma assinatura ou ata oficial.'),
      h('div', { class: 'minutes-layout' }, h('nav', { class: 'version-list', 'aria-label': 'Versões da ata' }, button('', () => { state.version = 'working'; render(); }, { class: 'version-link', 'aria-label': 'Ler ficha de trabalho', 'aria-current': working ? 'true' : null }), [...meeting.minutes].reverse().map(item => { const node = button('', () => { state.version = item.version; render(); }, { class: 'version-link', 'aria-label': 'Ler ata versão ' + item.version, 'aria-current': item.version === version?.version ? 'true' : null }); node.append(h('strong', {}, 'Ata · versão ' + item.version), h('small', {}, instant(item.closedAt))); return node; })), minutesPaper(working ? D.meetingBody(meeting) : version.meeting, version)));
  }
  function actionsView() {
    const date = today(), all = D.actionRows(state.book, date);
    const rows = all.filter(entry => state.filter === 'all' || entry.status === state.filter);
    const rowMeeting = entry => state.book.meetings.find(item => item.id === entry.meetingId);
    const jump = entry => { state.selected = entry.meetingId; state.topic = entry.topicId; state.tab = 'agenda'; state.editor = null; render(); };
    const tableRows = rows.map(entry => h('tr', {},
      h('td', {}, h('p', {}, entry.text), h('p', { class: 'help' }, entry.topicTitle || 'Sem ponto vinculado')),
      h('td', {}, entry.ownerName || 'Sem responsável'),
      h('td', {}, entry.due ? civil(entry.due) : 'Sem prazo', entry.overdue ? h('p', { class: 'overdue' }, 'Em atraso') : null),
      h('td', {}, actionSelect(rowMeeting(entry), entry, 'table')),
      h('td', {}, button(entry.meetingTitle, () => jump(entry), { class: 'text-button', 'data-focus': 'action-meeting-' + entry.id }))));
    const cards = rows.map(entry => h('article', { class: 'action-card' },
      h('p', {}, entry.text),
      h('dl', {}, h('dt', {}, 'Reunião'), h('dd', {}, button(entry.meetingTitle, () => jump(entry), { class: 'text-button', 'data-focus': 'mobile-action-meeting-' + entry.id })),
        h('dt', {}, 'Ponto'), h('dd', {}, entry.topicTitle || 'Sem vínculo'),
        h('dt', {}, 'Responsável'), h('dd', {}, entry.ownerName || 'Sem responsável'),
        h('dt', {}, 'Prazo'), h('dd', {}, entry.due ? civil(entry.due) : 'Sem prazo', entry.overdue ? h('span', { class: 'overdue' }, ' · Em atraso') : null)),
      actionSelect(rowMeeting(entry), entry, 'card')));
    return h('section', { class: 'surface' },
      h('h2', {}, 'Os próximos passos, reunidos'),
      h('p', { class: 'help' }, `Acompanhamento das fichas atuais. Hoje: ${civil(date)} em America/Sao_Paulo. Atas já geradas mantêm os estados anteriores.`),
      h('div', { class: 'filter-row' }, h('label', {}, 'Mostrar',
        h('select', { 'aria-label': 'Filtrar encaminhamentos', 'data-focus': 'action-filter', onchange: event => { state.filter = event.target.value; render(); } },
          [['open', 'Abertos'], ['done', 'Concluídos'], ['cancelled', 'Cancelados'], ['all', 'Todos']].map(([key, label]) => h('option', { value: key, selected: key === state.filter }, label)))),
        button('Baixar estes encaminhamentos · CSV', () => download('encaminhamentos.csv', actionsCsv(state.book, date, { status: state.filter }), 'text/csv;charset=utf-8'), { class: 'secondary compact' })),
      !rows.length ? h('div', { class: 'plain-empty' }, h('h3', {}, 'Nenhum encaminhamento neste filtro'), h('p', {}, 'Adicione ações a um ponto da pauta. O responsável e o prazo podem ser informados depois.')) : [
        h('table', { class: 'action-table' }, h('thead', {}, h('tr', {}, ['Encaminhamento', 'Responsável', 'Prazo', 'Estado', 'Reunião'].map(label => h('th', { scope: 'col' }, label)))), h('tbody', {}, tableRows)),
        h('div', { class: 'action-cards' }, cards)]);
  }
  function filesView(meeting) {
    const preview = state.preview, summary = preview ? notebookSummary(preview.book) : null;
    return h('section', { class: 'files-layout' }, h('div', { class: 'surface file-section' }, h('h2', {}, 'Guarde o caderno completo'), h('p', {}, 'O backup JSON preserva reuniões, participantes, pautas, decisões, ações e todas as versões da ata. Abra-o novamente aqui para continuar.'), button('Baixar backup JSON', backup, { class: 'primary' }), h('h3', {}, 'Compartilhar um registro'), h('p', { class: 'help' }, 'A ficha atual e cada ata podem ser exportadas em Markdown. O CSV reúne encaminhamentos atuais; células com início de fórmula recebem apóstrofo. Esses relatórios não substituem o backup.'), h('div', { class: 'button-row' }, button('Baixar ficha atual', () => exportWorking(meeting), { class: 'secondary', disabled: !meeting }), button('Ler atas', () => { state.tab = 'minutes'; render(); }, { class: 'secondary', disabled: !meeting }))),
      h('div', { class: 'surface file-section' }, h('h2', {}, 'Abrir um backup'), h('p', {}, 'Escolha um JSON UTF-8 de até 2 MiB. Confira a prévia antes de substituir a sessão. Uma validação inválida não altera seu caderno.'), h('label', { class: 'field', for: 'backup-file' }, h('span', {}, 'Arquivo JSON'), h('input', { id: 'backup-file', type: 'file', accept: '.json,application/json', onchange: event => run(() => importFile(event.target.files[0])) })), preview ? h('div', { class: 'import-preview' }, h('h3', {}, preview.example ? 'Exemplo fictício validado' : 'Backup validado'), h('p', {}, `${summary.meetings} reuniões · ${summary.points} pontos · ${summary.decisions} decisões · ${summary.actions} ações · ${summary.minutes} atas`), h('p', { class: 'help' }, 'Confirmar substitui o caderno inteiro da sessão e, se ativo, o salvamento local.'), h('div', { class: 'button-row' }, button('Substituir pelo backup', applyPreview, { class: 'primary', id: 'import-confirm' }), button('Cancelar importação', () => { state.preview = null; importGeneration++; render(); }, { class: 'secondary' }))) : null),
      h('div', { class: 'surface file-section storage-section' }, h('h2', {}, 'Salvar neste navegador'), h('p', {}, 'O salvamento é opcional, pertence a esta origem e ao perfil do navegador e não sincroniza dispositivos. Na próxima visita, use Abrir salvo. O caderno é local e não é criptografado pelo aplicativo.'), h('div', { class: 'button-row' }, button('Ativar salvamento', () => storageAction('enable'), { class: 'secondary', 'data-storage-action': 'enable' }), button('Abrir salvo', () => storageAction('open'), { class: 'secondary', 'data-storage-action': 'open' }), button('Desativar e apagar salvamento', () => confirm('Apagar o caderno salvo deste navegador? A sessão atual continuará em memória. Baixe um backup antes de fechar.', clearSaved), { class: 'text-button danger', 'data-storage-action': 'clear' })), h('p', { class: 'help' }, 'Se outra aba alterar a revisão, as gravações são interrompidas e esta sessão é preservada para backup.')),
      h('div', { class: 'surface file-section' }, h('h2', {}, 'Conheça o fluxo'), h('p', {}, 'O cenário Mostra do Bairro Aurora contém pessoas, local e registros inteiramente fictícios. A primeira ata foi preservada antes de uma ação ser concluída.'), button('Explorar exemplo fictício', example, { class: 'secondary' })));
  }
  function welcome() {
    return h('section', { class: 'welcome' }, h('div', {}, h('h1', {}, 'Uma boa conversa merece um registro claro.'), h('p', {}, 'Prepare a pauta, anote o que foi decidido e acompanhe os próximos passos. Guarde cada versão da ata sem perder o contexto da reunião.'), h('div', { class: 'button-row' }, button('Criar minha primeira reunião', () => edit('meeting'), { class: 'primary' }), button('Explorar exemplo fictício', example, { class: 'secondary' })), h('p', { class: 'help' }, 'Comece sem conta. Os dados ficam nesta sessão até você escolher salvar ou baixar o backup.')),
      h('div', { class: 'welcome-method' }, h('h2', {}, 'Da pauta ao que vem depois'), h('ol', {}, h('li', {}, h('strong', {}, 'Prepare o encontro'), h('span', {}, 'Dê nome aos assuntos e reserve tempo para cada ponto.')), h('li', {}, h('strong', {}, 'Registre decisões e ações'), h('span', {}, 'Associe cada registro à conversa que lhe deu origem.')), h('li', {}, h('strong', {}, 'Preserve a ata'), h('span', {}, 'Continue acompanhando a ficha; as versões anteriores ficam como foram registradas.')))));
  }
  function render() {
    if (!alive) return;
    captureDrafts();
    const focused = document.activeElement?.getAttribute('data-focus'), wasWithin = host.contains(document.activeElement);
    const meeting = selected();
    const sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Caderno de reuniões' }, h('div', { class: 'sidebar-heading' }, h('h2', {}, 'Meu caderno'), h('span', { class: 'count' }, state.book.meetings.length)), button('Nova reunião', () => edit('meeting'), { class: 'primary', disabled: state.book.meetings.length >= D.LIMITS.maxMeetings }),
      h('nav', { class: 'meeting-list', 'aria-label': 'Escolher reunião' }, state.book.meetings.map(entry => { const node = button('', () => { state.selected = entry.id; state.topic = entry.agenda[0]?.id || null; state.version = null; state.editor = null; state.confirmation = null; state.preview = null; state.tab = 'agenda'; render(); }, { class: 'meeting-link', 'aria-current': entry.id === state.selected ? 'page' : null, 'aria-label': 'Abrir reunião ' + entry.title, 'data-focus': 'meeting-' + entry.id }); node.append(h('strong', {}, entry.title), h('small', {}, civil(entry.date), ' · ', STATUS[entry.status])); return node; })),
      h('div', { class: 'sidebar-tools' }, button('Backup e salvamento', () => { state.tab = 'files'; state.editor = null; render(); }, { class: 'text-button' }), button('Abrir salvo', () => storageAction('open'), { class: 'text-button', disabled: state.storageBusy }), h('p', { class: 'session-note' }, 'O caderno é local. Baixe um backup para levar suas reuniões a outro dispositivo.')));
    const main = h('main', { id: 'workspace', class: 'workspace', tabindex: -1 }, h('div', { class: 'context-bar' }, h('span', { id: 'storage-status', role: 'status' }), meeting ? button('Backup JSON', backup, { class: 'text-button' }) : null), h('div', { id: 'feedback' }), h('p', { id: 'draft-status', class: 'notice', role: 'status', hidden: '' }));
    if (meeting) main.append(h('div', { class: 'workspace-heading' }, h('div', {}, h('h1', {}, meeting.title), h('p', {}, meeting.objective || 'Adicione o objetivo para orientar esta conversa.')), h('div', { class: 'heading-tools' }, button('Editar reunião', () => edit('meeting', meeting.id), { class: 'secondary compact' }))));
    if (meeting || ['actions', 'files'].includes(state.tab)) main.append(h('nav', { class: 'tabs', 'aria-label': 'Áreas do caderno' }, TABS.map(([key, label]) => button(label, () => { state.tab = key; state.editor = null; state.confirmation = null; render(); }, { class: 'tab', 'aria-current': state.tab === key ? 'page' : null, disabled: !meeting && ['agenda', 'minutes'].includes(key) }))));
    if (state.confirmation) main.append(h('section', { class: 'confirmation', 'aria-labelledby': 'confirm-title' }, h('h2', { id: 'confirm-title', tabindex: -1 }, 'Confirme para continuar'), h('p', {}, state.confirmation.message), h('div', { class: 'button-row' }, button('Confirmar', state.confirmation.action, { id: 'confirm-action', class: 'primary' }), button('Cancelar', () => { state.confirmation = null; render(); }, { class: 'secondary' }))));
    const editor = editorPanel(meeting); if (editor) main.append(editor);
    if (state.tab === 'files') main.append(filesView(meeting));
    else if (state.tab === 'actions') main.append(actionsView());
    else if (!meeting) { if (!editor) main.append(welcome()); }
    else if (state.tab === 'minutes') main.append(minutesView(meeting));
    else {
      main.append(h('section', { class: 'meeting-info' }, h('div', {}, h('h2', {}, 'Ficha de trabalho'), h('p', {}, 'Edite a conversa atual. Para preservar uma cópia, gere uma ata.'), h('div', { class: 'meeting-meta' }, h('span', {}, civil(meeting.date)), meeting.time ? h('span', {}, meeting.time) : null, meeting.location ? h('span', {}, meeting.location) : null)), lifecycle(meeting)), agendaView(meeting));
    }
    if (meeting) main.append(h('div', { class: 'topic-section' }, button('Remover reunião', () => confirm('Remover esta reunião e todas as suas atas do caderno? Baixe um backup para preservá-las.', () => mutate(book => D.deleteMeeting(book, meeting.id))), { class: 'text-button danger' })));
    host.replaceChildren(h('div', { class: 'app-shell' }, sidebar, main));
    for (const form of host.querySelectorAll('form[data-draft-key]')) {
      const draft = drafts.get(form.getAttribute('data-draft-key'));
      if (draft) {
        for (const [name, stored] of draft) for (const control of form.querySelectorAll('[name]')) if (control.name === name) control.value = stored;
        form.setAttribute('data-dirty', 'true');
      }
    }
    const workingLink = host.querySelector('.version-link[aria-label="Ler ficha de trabalho"]');
    if (workingLink) workingLink.append(h('strong', {}, 'Ficha atual'), h('small', {}, 'Conteúdo em edição'));
    feedback();
    let restored = false;
    if (focused) for (const node of host.querySelectorAll('[data-focus]')) if (node.getAttribute('data-focus') === focused && node.offsetParent !== null && !node.disabled) { node.focus(); restored = true; break; }
    if (!restored && wasWithin) {
      const target = host.querySelector('#editor-form h2') || host.querySelector('.minutes-paper h2') || host.querySelector('main h1') || main;
      target.setAttribute('tabindex', '-1'); target.focus();
    }
  }
  render();
  return { getDocument: () => D.normalizeNotebook(state.book), importFile, flush: () => saveTask,
    destroy() { alive = false; importGeneration++; pendingSave = null; state.enabled = false; store.close(); drafts.clear(); document.defaultView?.removeEventListener('beforeunload', beforeUnload); host.replaceChildren(); } };
}

if (globalThis.document?.querySelector('#app')) mountApp(globalThis.document.querySelector('#app'));
