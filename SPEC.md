# Contrato da Pauta Aberta 1.0.0

Aplicativo estático e módulos ES para pauta → condução → ata versionada. Cada operação do domínio é pura: valida a entrada, constrói nova cópia, valida a saída inteira e não altera argumentos. A biblioteca de execução não usa rede, relógio implícito ou DOM.

## Documento canônico

`{schemaVersion:1,meetings:[Meeting]}`. Todos os campos abaixo são obrigatórios, inclusive strings vazias e vínculos `null`. Chaves extras são recusadas; objetos devem ser simples; não aceitar NaN, Infinity, booleans no lugar de números, strings numéricas ou truncamento de texto. JSON de importação e JSON canônico estão limitados a 2 MiB de UTF-8. IDs ASCII de 1–64 caracteres correspondem a `[A-Za-z0-9_-]+`.

Meeting: `{id,title,objective,date,time,location,status,participants,agenda,decisions,actions,minutes}`.

- `title`: texto não vazio até 120 caracteres; `objective` até 1000; `location` até 200. Texto preserva espaços significativos e Unicode, mas não controles C0 exceto tab/LF/CR; não aceitar surrogate isolado. Nomes/títulos que só têm espaços não são conteúdo.
- `date`: string vazia ou data civil gregoriana `YYYY-MM-DD`, anos 0001–9999. `time`: vazia ou `HH:mm`. Não converter datas civis para UTC.
- `status`: `draft`, `running`, `closed`.
- `participants`: até 20 `{id,name,attendance}`; nome não vazio até 80, attendance `unspecified`, `present`, `absent`.
- `agenda`: até 30 `{id,title,minutes,status,notes}`; título não vazio até 160, minutes inteiro 0–480 (zero: sem tempo reservado), soma até 1440, status `pending`, `discussed`, `deferred`, notes até 6000.
- `decisions`: até 100 `{id,topicId,text,reason}`; topicId `null` ou ponto existente, text não vazio até 2000, reason até 2000.
- `actions`: até 100 `{id,topicId,text,ownerId,due,status}`; topicId `null` ou ponto existente; ownerId `null` ou participante existente; text não vazio até 500, due data civil ou vazia, status `open`, `done`, `cancelled`.
- IDs são únicos em cada coleção; meeting IDs são únicos no caderno. Não é necessário deduplicar IDs entre tipos diferentes.

Snapshot de ata: `{version,closedAt,meeting}`. `version` é inteiro, sequencial começando em 1 na lista minutes; `closedAt` é ISO UTC canônico de 24 caracteres `YYYY-MM-DDTHH:mm:ss.sssZ`, com data real e anos 0001–9999. `meeting` é cópia completa da ficha sem a chave `minutes`, com status `closed`. Seus vínculos são validados contra o próprio snapshot, nunca contra a ficha atual.

## Estados e histórico

- Reunião nova: draft, todas as coleções vazias.
- Iniciar (`startMeeting`) exige ao menos um ponto e permite draft ou closed → running.
- Encerrar (`closeMeeting`) exige running, torna closed e acrescenta um snapshot. Em caso de limite, nenhuma alteração é aplicada.
- Ficha closed permanece editável para acompanhamento; isso nunca altera atas existentes. `hasUnpublishedChanges` compara o corpo atual com o último snapshot. A interface mostra claramente quando existe diferença.
- Gerar nova versão (`snapshotMinutes`) exige closed e mudança desde a última ata; snapshot idêntico é recusado. O instante é argumento obrigatório, não relógio interno.
- Exclusão de ponto/participante com vínculos é recusada por padrão. Flag explícita `detach=true` desvincula decisões/ações da ficha atual; snapshots anteriores permanecem idênticos. Nenhum texto é apagado por essa desvinculação.
- Não há afirmação de consenso, assinatura, auditoria inviolável ou presença comprovada.

## API do domínio · assets/domain.mjs

Exportar `DomainError` com `code`, `LIMITS`, `emptyNotebook()`, `normalizeNotebook(value)`, `parseNotebook(jsonText)`, `serializeNotebook(book)`, `validateDate(value,{optional=true}={})`, `validateTimestamp(value)`.

`normalizeNotebook` devolve cópia profunda em ordem estável de chaves, preservando ordem de listas e texto. `serializeNotebook` usa JSON com 2 espaços e LF final; é determinístico. Validação falha com mensagens em português, sem repetir o conteúdo bruto rejeitado.

Operações devolvem Notebook completo:

```
createMeeting(book,{id,title,date='',time='',objective='',location=''})
updateMeeting(book,meetingId,patch) // somente title,objective,date,time,location
deleteMeeting(book,meetingId)
addParticipant(book,meetingId,{id,name,attendance='unspecified'})
updateParticipant(book,meetingId,participantId,patch) // name,attendance
deleteParticipant(book,meetingId,participantId,{detach=false}={})
addTopic(book,meetingId,{id,title,minutes=0,status='pending',notes=''})
updateTopic(book,meetingId,topicId,patch) // title,minutes,status,notes
moveTopic(book,meetingId,topicId,offset) // offset somente -1 ou 1; borda é no-op
deleteTopic(book,meetingId,topicId,{detach=false}={})
addDecision(book,meetingId,{id,topicId=null,text,reason=''})
updateDecision(book,meetingId,decisionId,patch) // topicId,text,reason
deleteDecision(book,meetingId,decisionId)
addAction(book,meetingId,{id,topicId=null,text,ownerId=null,due='',status='open'})
updateAction(book,meetingId,actionId,patch) // topicId,text,ownerId,due,status
deleteAction(book,meetingId,actionId)
startMeeting(book,meetingId)
closeMeeting(book,meetingId,closedAt)
snapshotMinutes(book,meetingId,closedAt)
```

Consultas: `meetingBody(meeting)` cópia sem minutes; `hasUnpublishedChanges(meeting)` boolean (true sem ata); `agendaSummary(meeting)` retorna `{points,plannedMinutes,discussed,pending,deferred}`; `actionRows(book,today)` retorna lista na ordem de reunião/ação com `{meetingId,meetingTitle,...Action,topicTitle,ownerName,overdue}`. topicTitle/ownerName vazios quando ausentes; overdue true só para open com prazo não vazio anterior a today, que é data civil válida obrigatória. Consultas não alteram argumentos. Vínculo inválido nunca é convertido silenciosamente para ausência.

## Formatos · assets/formats.mjs

Exportar `minutesMarkdown(meeting,version)` para snapshot histórico específico; versão inexistente falha. Exportar `workingMarkdown(meeting)` para ficha atual, rotulada explicitamente como ficha de trabalho, sem número de ata. `actionsCsv(book,today,{status='all'}={})` aceita all/open/done/cancelled, produz RFC 4180 com CRLF, cabeçalho português, responsável/prazo/associação/estado/vencimento explícitos. `notebookSummary(book)` retorna `{meetings,participants,points,decisions,actions,minutes}` contando fichas atuais e número de snapshots, sem duplicar conteúdo histórico.

Markdown: texto de usuário permanece texto, sem criar HTML, links ou novas estruturas. Preservar quebras como quebras seguras e neutralizar backticks, colchetes, sinais de títulos/listas, HTML e separadores. Não inventar rótulos, nomes ou prazos. CSV: citar campos e escapar aspas; neutralizar fórmulas de planilha nas células textuais começando (após espaço) por =,+,-,@,TAB ou CR. Documentar esse apóstrofo, sem alterar o backup JSON.

## Persistência · assets/store.mjs

Reutilizar o mecanismo IndexedDB transacional dos apps LOFRANO com nome próprio `lofrano-pauta-aberta-v1`. Sem salvamento antes de opção explícita na UI. API final e comportamento serão registrados pelo agente de persistência antes da integração; requisitos: load devolve notebook/revision, save com revisão esperada (CAS), clear com revisão esperada, revisão monotônica durável sem reset/ABA, estados indisponíveis/fechamento/timeout tratados, validação em todos os limites. Nenhuma transação incompleta aparece como salva. Incluir testes com IndexedDB de teste como dependência apenas dev. Toda gravação deve preservar snapshot de input e rejeitar conflito entre abas sem sobrescrever o caderno persistido.

## Interface e publicação

Primeiro uso vazio. Exemplo fictício carregado por ação explícita, com prévia antes de substituir caderno existente. Áreas Pauta, Atas, Encaminhamentos, Backup. Formulários com rótulos, foco visível e mensagens específicas. Seleção de versão histórica não acompanha edições da ficha. Importação integral via prévia com verificação de revisão da sessão. Exportações para arquivo local. Links LOFRANO/GitHub reais; sem telemetria ou recursos remotos de execução.

Não afirmar cobertura diária, clientes, sincronização ou integrações não implementadas. Versionar fontes, MIT, README em português, exemplos, testes, CI Node 22/24 e demo GitHub Pages. Conferir arquivos públicos e fluxos reais no navegador antes de reportar entrega.
