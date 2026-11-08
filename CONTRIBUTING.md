# Contribuir com Pauta Aberta

Contribuições podem melhorar um fluxo de reunião, corrigir uma perda de contexto, tornar a interface mais acessível ou fortalecer os formatos e o salvamento local. Explique o problema com um cenário fictício e mantenha a distinção entre ficha atual e ata preservada.

## Preparar o ambiente

Use Node.js 22 ou superior e npm:

```sh
npm ci
npm run dev
```

A prévia fica em [http://127.0.0.1:4191](http://127.0.0.1:4191). A aplicação começa vazia. Carregue o exemplo fictício por uma ação explícita ou crie registros novos; não use dados de clientes ou de terceiros para testar.

Antes de propor a mudança:

```sh
npm test
npm run check
npm run build
```

O diretório `dist/` é saída de build. Arquivos gerados, dependências e dados pessoais não devem substituir as fontes revisáveis da alteração.

## Regras do produto

- Leia [SPEC.md](SPEC.md) e [PRODUCT.md](PRODUCT.md) antes de mudar o contrato ou o fluxo.
- Valide entradas e a saída inteira. Operações do domínio são puras; não devem usar DOM, rede, armazenamento ou relógio implícito.
- Mantenha os snapshots independentes dos vínculos atuais. Uma edição ou desvinculação atual não pode reescrever a ata anterior.
- Preserve ausências como ausências. Não invente participante, responsável, prazo, presença, decisão ou consenso.
- Uma falha de importação ou salvamento não pode apagar a sessão nem aparecer como gravação concluída. Respeite a revisão esperada entre abas.
- Preserve rascunhos de formulários entre telas internas, sem incluí-los no backup antes de uma gravação na ficha. Exportações e substituições devem exigir que rascunhos pendentes sejam salvos ou descartados. O alerta de saída do navegador não garante a recuperação do texto.
- Texto importado deve continuar texto na interface e nas exportações. Não use HTML de usuário, avaliação de código ou URLs remotas para executar recursos.
- Limites são rejeições explícitas, sem truncamento ou limpeza automática de histórico. Mudanças no esquema precisam de uma decisão e estratégia de compatibilidade claras.

## Testar a alteração

Inclua regressões que reproduzam o comportamento afetado, com fixtures pequenas e originais. Testes de exportação podem usar os parsers independentes de Markdown e CSV; os de persistência precisam considerar o fim da transação, conflitos, falhas e revisões antigas. Não troque uma expectativa de integridade apenas para fazer um teste passar.

Para interface, confira também no navegador: navegação por teclado, rótulos e foco, tela estreita, confirmação de exclusão/desvinculação, versões históricas e importação com prévia. DOM de teste não reproduz todas as diferenças dos navegadores. Registre o que foi efetivamente verificado, sem alegar certificação.

## Enviar uma proposta

Descreva o comportamento anterior e o resultado da mudança. Inclua instruções de reprodução, comandos de validação e limitações relevantes. Atualize a documentação e o changelog quando o uso ou o contrato mudarem.

Não envie `.env`, bancos do navegador, backups reais, capturas privadas, credenciais ou material sem autorização de uso. Relatos sensíveis seguem [SECURITY.md](SECURITY.md).

Contribua com código que você tenha direito de disponibilizar sob a licença MIT deste projeto. Preserve os avisos de autoria e as licenças específicas das fontes e dependências; a MIT do aplicativo não relicencia material de terceiros.
