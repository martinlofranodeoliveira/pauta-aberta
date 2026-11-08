# Backup, atas e salvamento local

O backup JSON é o formato completo e restaurável de Pauta Aberta. Ele contém as fichas de trabalho e todas as versões de ata preservadas. Markdown e CSV são exportações para leitura ou uso em outros programas; não são formatos de restauração.

O contrato detalhado está em [SPEC.md](../SPEC.md). Os dados são locais e não são criptografados. Um arquivo de backup pode conter nomes, presenças, notas e decisões; confira seu conteúdo antes de compartilhá-lo.

## Documento JSON

```json
{
  "schemaVersion": 1,
  "meetings": []
}
```

Todos os campos previstos pelo esquema são obrigatórios, inclusive textos vazios e vínculos `null`. Chaves desconhecidas são recusadas. Objetos devem ser simples; números devem ser inteiros seguros nos limites declarados, sem coerção de strings, booleanos, `NaN` ou `Infinity`.

`normalizeNotebook` valida o documento inteiro e devolve uma cópia profunda, com ordem estável de chaves, sem mudar a ordem das listas nem o texto fornecido. `serializeNotebook` produz JSON com indentação de dois espaços e LF final. `parseNotebook` valida o texto importado e o resultado. O texto de importação e o JSON canônico têm limite de **2 MiB em UTF-8**; uma restauração inválida não autoriza substituir o caderno atual.

### Ficha de reunião

Cada entrada de `meetings` contém:

| Campo | Conteúdo |
| --- | --- |
| `id` | Identificador estável da reunião |
| `title` | Título não vazio, até 120 caracteres |
| `objective` | Objetivo, até 1.000 caracteres |
| `date` | Data civil `YYYY-MM-DD`, ou texto vazio |
| `time` | Horário `HH:mm`, ou texto vazio |
| `location` | Local, até 200 caracteres |
| `status` | `draft`, `running` ou `closed` |
| `participants` | Participantes e presença informada |
| `agenda` | Pontos na ordem planejada |
| `decisions` | Decisões e justificativas |
| `actions` | Encaminhamentos, responsáveis e prazos |
| `minutes` | Versões históricas da ata |

IDs têm de 1 a 64 caracteres ASCII, usando letras, números, `_` e `-`. Reuniões têm IDs únicos no caderno; participantes, pontos, decisões e ações têm IDs únicos dentro de sua própria coleção. Tipos diferentes podem usar o mesmo ID.

Textos preservam Unicode e espaços significativos, mas rejeitam controles C0, exceto tabulação, LF e CR, e surrogates isolados. Um título, nome ou texto obrigatório formado apenas por espaços é inválido. O programa não corta textos silenciosamente para fazê-los caber.

### Participantes, pauta, decisões e encaminhamentos

| Coleção | Campos por entrada | Limite por reunião |
| --- | --- | ---: |
| `participants` | `id`, `name`, `attendance` | 20 |
| `agenda` | `id`, `title`, `minutes`, `status`, `notes` | 30 |
| `decisions` | `id`, `topicId`, `text`, `reason` | 100 |
| `actions` | `id`, `topicId`, `text`, `ownerId`, `due`, `status` | 100 |

- `name`: não vazio, até 80 caracteres. `attendance`: `unspecified`, `present` ou `absent`; é um registro informado, sem comprovação de presença.
- Título do ponto: não vazio, até 160 caracteres. `minutes`: inteiro de 0 a 480; zero significa sem tempo reservado. A soma da pauta não pode ultrapassar 1.440 minutos. O estado é `pending`, `discussed` ou `deferred`; `notes` aceita até 6.000 caracteres. Esses tempos são planejados, sem cronômetro.
- Decisão: `text` não vazio até 2.000 caracteres; `reason` até 2.000. `topicId` é `null` ou ID de um ponto da própria ficha.
- Encaminhamento: `text` não vazio até 500 caracteres; `topicId` é `null` ou ponto existente, e `ownerId` é `null` ou participante existente. `due` é data civil ou texto vazio. O estado é `open`, `done` ou `cancelled`.

Ausência não é um nome, um prazo ou um vínculo presumido. Uma referência inválida é recusada, sem ser convertida silenciosamente para `null`. Remover um ponto ou participante ainda vinculado exige uma desvinculação explícita: as decisões e ações permanecem, com o vínculo da ficha atual removido. Atas anteriores mantêm seus próprios dados.

O caderno admite até **20 reuniões e 12 atas por reunião**, sempre sujeito também ao limite global de 2 MiB.

## Datas e atas históricas

Datas de reunião e prazos são datas civis gregorianas, com anos de `0001` a `9999`. Não são convertidas em UTC. O horário da reunião é apenas o valor civil informado; não representa um evento com fuso, convite ou agendamento externo.

Uma ata tem a estrutura:

```json
{
  "version": 1,
  "closedAt": "2026-11-08T15:00:00.000Z",
  "meeting": {}
}
```

No exemplo estrutural, `meeting` deve ser substituído pelo corpo completo da ficha, **sem a chave `minutes`**, com `status: "closed"`. Um objeto vazio não é uma ata válida. `version` é sequencial, começando em 1. `closedAt` exige instante ISO UTC canônico de 24 caracteres, com data real e milissegundos. O domínio recebe esse instante como argumento, sem relógio implícito.

Iniciar uma reunião exige ao menos um ponto. Encerrar exige estado `running`, muda a ficha para `closed` e acrescenta sua cópia histórica. A ficha encerrada permanece editável. Gerar outra versão exige mudança desde a última ata; um snapshot idêntico é recusado. Se a validação ou um limite falhar, a operação inteira é recusada.

Os vínculos dentro de uma ata são conferidos contra seus próprios participantes e pontos. Renomear, desvincular ou remover algo na ficha atual não reescreve a versão histórica. `hasUnpublishedChanges` indica diferenças entre a ficha e a última ata; sem ata, retorna verdadeiro.

As versões são cópias locais, sem assinatura digital ou proteção contra alteração do backup. A numeração e a validação estrutural não comprovam autoria, consenso, presença ou o momento real da reunião.

## Exportações Markdown e CSV

`minutesMarkdown(meeting, version)` exige uma versão histórica existente e exporta essa cópia específica. Não usa os nomes, prazos ou decisões atuais no lugar dos históricos. `workingMarkdown(meeting)` exporta a ficha atual com o título **Ficha de trabalho**, sem apresentá-la como ata.

O Markdown mantém texto fornecido como texto: sinais estruturais, espaços, tabulações, HTML e pontuação de links são representados por referências numéricas, e quebras de linha são emitidas de forma controlada. Um título ou uma nota contendo HTML, backticks ou links não cria HTML ativo, títulos, listas ou links no relatório gerado. Revisões do exportador devem preservar essa propriedade.

`actionsCsv(book, today, {status: 'all'})` exporta encaminhamentos das fichas atuais, na ordem de reunião e ação. O filtro aceita `all`, `open`, `done` ou `cancelled`. O arquivo segue RFC 4180, com vírgulas, campos entre aspas, aspas internas duplicadas, registros CRLF e cabeçalho em português:

`ID da reunião`, `Reunião`, `ID do encaminhamento`, `Encaminhamento`, `ID do ponto`, `Ponto da pauta`, `ID do responsável`, `Responsável`, `Prazo civil`, `Estado`, `Em atraso`.

Uma célula textual que poderia ser interpretada como fórmula de planilha recebe um apóstrofo inicial: o exportador verifica `=`, `+`, `-`, `@`, TAB e CR, inclusive com espaço antes deles. A proteção altera somente a apresentação CSV; o texto original permanece no backup JSON. O CSV não possui importação nesta versão.

`today` é uma data civil válida obrigatória. Ação atrasada é somente uma ação `open` com prazo não vazio anterior a esse dia; prazo igual a hoje, ausência de prazo, ação concluída e ação cancelada não estão atrasados. A interface calcula hoje em `America/Sao_Paulo`. Não há envio de lembretes.

`notebookSummary` conta coleções das fichas atuais e a quantidade de atas, sem somar novamente os participantes, decisões ou ações existentes nas cópias históricas.

## Persistência IndexedDB

O módulo não abre o banco nem acessa o getter global IndexedDB ao construir o adaptador. A interface deve chamar suas operações de persistência somente após uma escolha explícita de abrir ou salvar dados. A sessão em memória e o backup funcionam sem ativar esse salvamento.

O banco próprio é `lofrano-pauta-aberta-v1`, versão 1, object store `workspaces`, chave `default`. O registro interno é `{revision, document}`; **não é o esquema do backup**. O objeto `document` contém um Notebook validado, ou `null` quando os dados foram limpos.

Em um módulo servido pela raiz da aplicação, com IndexedDB disponível:

```js
import { emptyNotebook } from './assets/domain.mjs';
import { createStore } from './assets/store.mjs';

const store = createStore();
const { revision, document } = await store.load();
const notebook = document ?? emptyNotebook();
const saved = await store.save(notebook, revision);
console.log(saved.revision);
store.close();
```

API:

| Operação | Resultado |
| --- | --- |
| `createStore(options = {})` | Adaptador; opções `indexedDB`, `name` e `timeoutMs` são opcionais |
| `load({signal} = {})` | Promise de `{revision, document}`, com cópia validada |
| `save(document, expectedRevision, {signal} = {})` | Promise do novo registro, após commit |
| `clear(expectedRevision, {signal} = {})` | Promise do tombstone, após commit |
| `close()` | Cancela operações ainda abortáveis, fecha a conexão e inutiliza o adaptador |

`indexedDB` e `name` permitem injeção explícita para testes ou integração; a interface usa o banco padrão. `timeoutMs` é inteiro seguro entre 1 e 60.000, com padrão de 8.000 ms. `signal` é um AbortSignal opcional. Sinais já cancelados recusam a operação antes de abrir o banco.

`save` captura e valida uma cópia completa do argumento antes de ceder a execução. Carregamentos validam o envelope e o caderno, inclusive os vínculos próprios de cada ata. Documento persistido inválido não vira ausência nem autoriza limpar ou reiniciar revisões. Mensagens de erro não repetem conteúdo rejeitado, razões de cancelamento ou mensagens nativas do navegador.

Leitura, comparação da revisão esperada e escrita ocorrem na mesma transação. Entre duas abas com a mesma revisão, apenas uma alteração pode ser confirmada; a outra recebe `conflict`. Sucesso de um request `put` ainda não é sucesso da gravação: o resultado é entregue somente depois de `transaction.oncomplete`.

A revisão é um inteiro seguro não negativo na API. Ausência inicial corresponde a revisão 0 e não grava registro. Cada `save` ou `clear` confirmado incrementa o contador, até `Number.MAX_SAFE_INTEGER`. Limpar retém `{revision: anterior + 1, document: null}`, inclusive se já estiver vazio. Esse tombstone evita que uma aba antiga volte a gravar com revisão 0 após uma limpeza. Apagar os dados do site pelo navegador continua fora desse mecanismo e pode remover o próprio contador.

Timeout, cancelamento e fechamento abortam transações ainda abortáveis; uma escrita abortada não avança a revisão. Se o commit já tiver ocorrido e apenas seu evento de conclusão estiver pendente, a operação informa o resultado real, em vez de afirmar um rollback impossível. Uma conexão aberta após o timeout de abertura é fechada. Mudança de versão e fechamento inesperado tornam o adaptador obsoleto; crie outro após tratar a falha.

`StorageError` tem `code` estável:

| Código | Situação |
| --- | --- |
| `conflict` | Revisão salva diferente da revisão esperada |
| `unavailable` | IndexedDB ausente ou indisponível pela política do navegador |
| `storage` | Falha nativa sanitizada, argumentos inválidos ou adaptador fechado/obsoleto |
| `corrupt` | Esquema, envelope ou caderno persistido inválido |
| `revision_limit` | Contador no maior inteiro seguro; não há wrap/reset |
| `timeout` | Prazo de abertura ou de operação excedido |
| `cancelled` | Sinal de cancelamento ou fechamento durante operação abortável |

O salvamento pertence à origem e ao perfil do navegador. Não sincroniza pessoas, abas ou dispositivos e pode ser removido pelas configurações do navegador. Aplicativos em caminhos diferentes do mesmo domínio compartilham a origem: outro código nessa origem pode acessar o IndexedDB. Use origem exclusiva para isolamento e preserve backups fora do navegador.
