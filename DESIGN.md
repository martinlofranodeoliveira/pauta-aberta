---
name: Pauta Aberta
description: Caderno de reunião da família LOFRANO, com ficha editável e atas preservadas em leitura independente.
colors:
  ink: "#19212e"
  muted: "#596474"
  accent: "#ae185c"
  accent-hover: "#8c134a"
  canvas: "#f0f2f6"
  paper: "#fff"
  line: "#d8dde5"
  control: "#b7c1cf"
  frame: "#17202d"
  rose: "#f9edf3"
  danger: "#a51d36"
  focus: "#b23975"
typography:
  headline:
    fontFamily: "Lato, Arial, sans-serif"
    fontSize: "27px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Lato, Arial, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.35
  small-title:
    fontFamily: "Lato, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: "Lato, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  working-text:
    fontFamily: "Lato, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "Lato, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.5
  text-action:
    fontFamily: "Lato, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
  minutes-title:
    fontFamily: "Lato, Arial, sans-serif"
    fontSize: "23px"
    fontWeight: 700
    lineHeight: 1.35
rounded:
  compact: "4px"
  reorder: "5px"
  field: "6px"
  control: "7px"
  feedback: "8px"
  surface: "12px"
spacing:
  tight: "6px"
  inline-small: "8px"
  inline: "12px"
  inset: "16px"
  mobile: "18px"
  section-small: "20px"
  columns: "22px"
  section: "24px"
  workspace: "30px"
  page: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.paper}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
  button-secondary-hover:
    backgroundColor: "{colors.rose}"
    textColor: "{colors.ink}"
  button-text:
    textColor: "{colors.accent}"
    typography: "{typography.text-action}"
    padding: "5px 0"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "10px 12px"
  meeting-navigation:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px"
  meeting-navigation-current:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
  area-navigation:
    textColor: "{colors.muted}"
    padding: "11px 2px"
  notebook-count:
    rounded: "{rounded.compact}"
    padding: "1px 5px"
  surface:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.surface}"
    padding: "24px"
  agenda-point:
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "10px 9px"
  agenda-point-current:
    backgroundColor: "{colors.rose}"
    textColor: "{colors.ink}"
  minutes-paper:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.surface}"
    padding: "30px 32px"
  notice:
    backgroundColor: "{colors.rose}"
    rounded: "{rounded.feedback}"
    padding: "13px 16px"
---

# Design System: Pauta Aberta

## Overview

**Creative North Star: "Caderno de reunião LOFRANO"**

A Pauta Aberta continua a identidade dos aplicativos públicos da LOFRANO TECNOLOGIA: marca geométrica real, Lato local, frame escuro, plano frio e superfícies de papel. O rosa sinaliza ação e localização atual; a maior parte da interface permanece em neutros para sustentar a escrita e a leitura de registros.

O sistema distingue trabalho em edição de cópia preservada. Ordem, títulos, datas, rótulos e divisórias dão estrutura aos assuntos e aos registros; a ata recebe tratamento de documento, sem parecer uma conversa ao vivo. Esta descrição vem do código e das capturas da entrega autônoma dentro da família existente. O nome acima descreve o sistema observado e não atribui uma escolha de metáfora ou aprovação humana.

**Key Characteristics:**

- Lato local em pesos regular e negrito.
- Frame institucional escuro, papel branco e bordas finas, sem sombras.
- Rosa funcional em ações, seleção e avisos de divergência.
- Contexto da reunião junto dos pontos, decisões e encaminhamentos.
- Ficha atual e atas preservadas com identidade textual própria.
- Empilhamento da edição e fichas completas de ações em telas estreitas.

As fontes de verdade são `assets/app.css`, `index.html` e `assets/app.mjs`. As capturas em `.impeccable/review/desktop.jpg`, `mobile.jpg`, `ata-desktop.jpg` e `actions-mobile.jpg` registram as composições observadas. As capturas públicas em `docs/images/pauta-desktop.jpg` e `docs/images/pauta-mobile.jpg` registram a mesma composição após a correção de singular em “1 decisão registrada”. Esta documentação não amplia a verificação dessas evidências para certificação de contraste ou desempenho.

## Colors

A paleta compartilha um acento rosa e neutros frios com a família. Os valores normativos no frontmatter correspondem às propriedades da raiz do CSS. As rampas do sidecar são amostras sintetizadas para a prévia, não novas cores de uso da interface.

### Primary

- **Rosa de ação** (`accent`): botões primários, links, item e aba atuais, e texto que informa alterações após a última ata.
- **Rosa profundo** (`accent-hover`): hover dos botões primários e das ações textuais.
- **Rosa de papel** (`rose`): ponto selecionado, avisos e hover dos controles secundários.
- **Rosa de foco** (`focus`): contorno visível dos controles e elementos focalizáveis.
- **Vermelho de remoção** (`danger`): ações destrutivas e texto de atraso. O atraso também aparece escrito; a remoção conserva seu rótulo explícito.

### Neutral

- **Tinta fria** (`ink`): texto principal, títulos e registros.
- **Tinta secundária** (`muted`): ajuda, metadados, situações e durações planejadas.
- **Plano frio** (`canvas`): fundo contínuo do caderno.
- **Papel** (`paper`): superfícies de trabalho, ata e campos; texto invertido no frame e no botão primário.
- **Linha** (`line`): bordas, divisórias e separação de assuntos e registros.
- **Contorno de controle** (`control`): bordas de campos e botões secundários.
- **Frame institucional** (`frame`): cabeçalho da marca.

O CSS também contém tons locais para o contador, hover da navegação, cabeçalho da tabela e bordas de editor e aviso. Erros usam fundo claro avermelhado (`#fff0f1`), tinta escura (`#7e1c2f`) e borda (`#d3a7af`); são estados funcionais, sem formar outra identidade.

**The Estado Escrito Rule.** Seleção, divergência, ausência e atraso mantêm rótulo ou contexto textual; o rosa e o vermelho reforçam o significado existente.

## Typography

**Display Font:** Lato, com Arial e sans-serif como alternativas.
**Body Font:** Lato, com os mesmos fallbacks. Os dois arquivos locais são declarados por `@font-face`, com `font-display: swap` e síntese desativada. A licença SIL OFL 1.1 acompanha os arquivos em `assets/LATO-LICENSE.txt`.

**Character:** uma família compacta e legível organiza a ferramenta por peso e tamanho. Negrito identifica títulos, rótulos e nomes; números de ordem e minutos usam algarismos tabulares. O sistema não introduz fonte monoespaçada nem números decorativos de painel.

### Hierarchy

- **Headline:** título da reunião, reduzido a (24px) no celular. A entrada vazia tem título próprio de (32px), reduzido a (29px), sem criar uma segunda família.
- **Title:** títulos de seção. A identificação da ficha usa (18px), reduzida a (17px) no celular; a coluna da ata usa small-title.
- **Small title:** assunto em edição, seções internas e títulos da ata. Subtítulos de nível seguinte usam (14px).
- **Body:** a base está no frontmatter; a maior parte do conteúdo de trabalho usa working-text. O texto da ata mantém (13px) com entrelinha de (1.8).
- **Label e text-action:** botões sólidos usam negrito; ações sublinhadas mantêm peso regular. Variantes compactas e metadados usam em geral (11px).
- **Minutes title:** número de versão da ata, reduzido a (21px) no celular.
- **Campos:** (14px) no computador e (16px) nos formulários no celular. Ações em tabela e ficha conservam seletores menores, conforme seu contexto.
- **Ajuda:** em geral (12px) com entrelinha de (1.7); metadados e ajuda compacta usam (11px). O rodapé usa (10px), reduzido a (9px).

Textos de registro conservam quebras de linha. Ajuda, objetivo e blocos de leitura limitam a largura em geral a (75ch); estados vazios usam até (65ch). Títulos podem quebrar palavras longas para preservar a largura disponível.

## Layout

O cabeçalho ocupa toda a largura e tem altura de (78px); aplicativo e rodapé têm largura máxima de (1660px). A estrutura principal usa navegação de reuniões com (222px) e área de trabalho flexível. O recuo da área de trabalho é (26px 30px 40px); a lateral usa (29px 19px). Reunião, abas e ficha formam a sequência de leitura antes do conteúdo detalhado.

Na pauta, o espaço de trabalho tem duas colunas: edição com `minmax(0, 1.65fr)` e registro com `minmax(245px, 1fr)`, separadas por (22px). A coluna do registro fica aderente durante a rolagem, a (22px) do topo. O assunto mantém seu lugar na lista; notas e registros vinculados aparecem abaixo da lista na mesma superfície. A navegação externa escolhe a reunião, e a coluna de registro mantém a última ata identificada.

Até (1250px), a lateral passa a (195px), a área de trabalho usa recuo de (24px), as superfícies usam (20px) e o registro ocupa (245px), com vão de (18px). Até (1050px), edição e registro se empilham, e o registro deixa de aderir ao topo. O ciclo da reunião e as ferramentas do título passam a linhas próprias. A regra é da composição da pauta, não uma exigência de duas colunas para toda tela futura.

Até (760px), o frame usa (70px), a lateral vira faixa superior e a área de trabalho usa recuo de (18px). As reuniões formam uma faixa horizontal rolável, com apenas o título visível; abas mantêm os quatro nomes. Campos e painéis se empilham. Superfícies usam recuo de (20px 17px); a coluna do registro permanece abaixo da edição, com o mesmo conteúdo e ações.

Na leitura de atas, a navegação de versões ocupa (200px), depois (155px) na faixa intermediária, ao lado do documento flexível. No celular, vira faixa horizontal acima do papel. Os encaminhamentos usam tabela no computador; até (760px), cada ação recebe ficha com reunião, ponto, responsável, prazo e seletor de estado. As fichas usam pares de rótulo e valor, com coluna de rótulo de (88px), sem depender de uma tabela arrastada.

O ritmo combina intervalos pequenos entre rótulo e campo, vãos de coluna e recuos de superfície registrados no frontmatter. As separações maiores de assunto usam margem de (30px) e recuo de (22px) após a linha. A impressão oculta frame, navegação e ferramentas e apresenta a ata em fluxo de documento, sem borda ou recuo do papel.

**The Contexto Completo Rule.** A adaptação para fichas conserva reunião, ponto, responsável, prazo, estado e acesso à origem; ausência de informação permanece explícita.

## Elevation & Depth

O sistema não usa sombras. Frame escuro, papel sobre plano frio, linhas e espaço constroem a profundidade. A superfície da pauta e a coluna de registro têm o mesmo material; número de versão, data e textos de contexto fazem a distinção. Editores e confirmações continuam no fluxo, com contorno levemente rosado, sem modal ou fundo escurecido.

Botões e links transitam cor de fundo, texto e borda por (0.16s), com `ease-out`. O sistema não define animação de entrada, de geração de ata ou de reordenação. A preferência `prefers-reduced-motion: reduce` remove transições e animações e mantém a rolagem automática sem suavização.

## Shapes

Superfícies grandes e papel da ata têm cantos suaves; controles, campos e avisos usam os raios menores do frontmatter. Bordas de (1px) definem material e separação. A lista de assuntos e as linhas de registro usam divisórias, sem embrulhar cada texto em outro cartão.

O contador é uma pequena etiqueta neutra. A marca usa o SVG geométrico do cabeçalho, e as setas de reordenação são SVG de traço: símbolo de (16px), sem preenchimento e com espessura de (1.6). Não há ilustrações de ambientação no espaço de trabalho.

## Components

### Buttons

Controles compactos com verbo e destino explícitos. Primário é rosa com texto de papel; secundário é papel com borda de controle. Ambos têm altura mínima de (41px). A variante compacta usa recuo de (7px 11px), texto de (11px) e altura mínima de (36px). O hover primário aprofunda o rosa; o secundário recebe papel rosa e borda rosada (`#ad8b9c`).

Ação textual é sublinhada e tem altura mínima de (32px). Remoções usam vermelho e mantêm o rótulo. Controles desabilitados recebem opacidade de (0.5) e cursor de indisponibilidade. O sistema não estabelece transformação no clique.

O foco visível usa contorno de (3px) e afastamento de (3px), incluindo links, campos e elementos com `tabindex`. O link “Pular para o conteúdo” aparece ao receber foco. A edição leva o foco ao primeiro campo; a confirmação leva ao botão Confirmar. Após reconstruir a tela, o aplicativo procura o identificador `data-focus`; quando não consegue restaurá-lo, dirige o foco ao título do editor, da ata, da reunião ou à área principal. Estes são comportamentos implementados, sem declaração de certificação geral de acessibilidade.

### Inputs / Fields

Papel, borda de controle e raio pequeno. O campo tem altura mínima de (43px); rótulo acima, com intervalo de (6px). Área de texto permite redimensionamento vertical e usa entrelinha de (1.6). O cursor de texto usa rosa. Os formulários gerais começam em duas colunas e se tornam uma no celular; campos amplos ocupam toda a linha no computador.

Seletores mantêm estado por escrito. A situação do assunto oferece Pendente, Tratado e Adiado; a ação oferece Aberto, Concluído e Cancelado. Rascunhos ainda não salvos recebem aviso textual e são preservados na sessão entre reconstruções. Mensagens de falha aparecem com `role="alert"`; avisos e estado de armazenamento usam `role="status"`. A implementação não define uma aparência de campo inválido individual.

### Navigation

A reunião atual combina papel, borda, título rosa e `aria-current="page"`. As demais recebem fundo tonal em hover; data e situação ficam abaixo do título no computador. O celular conserva o título em faixa horizontal e omite esses metadados somente nessa navegação.

As abas usam texto sobre divisória comum; a atual reúne rosa, negrito e borda inferior de (2px), também com `aria-current="page"`. O nome de versão usa título e data em duas linhas; a versão atual combina papel, borda, rosa e `aria-current="true"`. A navegação oferece “Ficha atual · Conteúdo em edição” separada das versões numeradas. O link de código aberto fica no frame do computador e é oculto no celular.

### Chips

O contador do caderno usa fundo neutro (`#e0e5ed`), tinta (`#495367`), texto de (11px), largura mínima de (22px) e cantos compactos. Ele informa quantidade; não atua como filtro.

### Cards / Containers

Papel com borda de linha e raio de superfície. Avisos usam papel rosa, contorno rosado e raio de feedback. Erros mantêm texto explícito e ação de fechar. Editores e confirmações têm largura máxima de (850px), recuo de (24px), reduzido a (20px) no celular, e ficam antes do conteúdo que modificam.

### Ponto da pauta

A linha conserva número, nome, situação e duração planejada. A seleção combina fundo rosa e `aria-current="true"`. Número usa dois dígitos; duração fica à direita com largura própria. Hover usa neutro muito claro (`#f5f6f9`). “Sem tempo” permanece escrito quando não há minutos reservados; o elemento não representa cronômetro.

As setas de mover são botões com nomes acessíveis completos, e a primeira ou última posição desabilita o movimento impossível. No computador, ficam lado a lado; no celular, ficam uma acima da outra. A operação não exige arrastar. As notas e a situação têm ação própria de salvar; decisões e encaminhamentos aparecem em seções identificadas abaixo.

### Coluna da ata e papel de leitura

A coluna conserva título, número, data, quantidades e ação para ler ou baixar a última ata. Quando a ficha diverge, a mensagem rosa informa “Há alterações na ficha após esta ata.” Sem ata, explica como gerar a primeira. A leitura ampla traz versão e instante antes dos títulos, participantes, pauta e notas, decisões e encaminhamentos, com divisórias entre as seções.

**The Ficha e Ata Rule.** A ficha atual permanece identificada como conteúdo em edição; a ata preservada conserva número, data e linguagem de cópia independente. Uma alteração na ficha não muda o conteúdo apresentado como versão anterior.

### Encaminhamentos

Tabela de leitura no computador, com cabeçalho tonal leve e linhas separadas. Ficha vertical no celular com o mesmo contexto. O nome da reunião é uma ação textual que volta ao ponto de origem. “Sem responsável”, “Sem prazo” e ausência de vínculo permanecem escritos. Atraso acrescenta “Em atraso” em vermelho e negrito. O filtro e o botão CSV ficam juntos e podem ocupar linhas distintas.

## Do's and Don'ts

### Do:

- **Do** preservar Lato local, marca geométrica, frame escuro e plano frio como continuidade da família LOFRANO.
- **Do** manter ficha atual e ata preservada identificadas por texto, versão e contexto.
- **Do** conservar o contexto completo dos encaminhamentos na passagem da tabela para fichas.
- **Do** usar divisórias, tonalidade e espaçamento para organizar a leitura, como nas superfícies existentes.
- **Do** preservar foco visível, nomes acessíveis das setas e restauração do foco após reconstruções.
- **Do** manter ausências e rascunhos escritos, com ações explícitas para salvar e preservar versões.

### Don't:

- **Don't** transformar cores de erro e atraso em outra identidade de marca.
- **Don't** apresentar minutos planejados como contagem regressiva ou cronômetro.
- **Don't** depender de cor ou arraste para indicar estado, seleção ou ordem.
- **Don't** fundir conteúdo em edição com uma versão identificada como preservada.
- **Don't** acrescentar sombras ou movimento de entrada ao material plano descrito aqui.
- **Don't** atribuir aprovação humana, usuários reais ou certificações às escolhas autônomas e capturas desta entrega.
