# Autoria, reutilização e componentes

## Código e conteúdo próprios

Pauta Aberta é uma aplicação da LOFRANO TECNOLOGIA. Código, documentação e exemplos próprios são disponibilizados sob a [licença MIT](LICENSE), com copyright de 2026 dos Contribuidores da LOFRANO TECNOLOGIA.

A base visual e padrões de interface continuam o trabalho dos aplicativos próprios Orçamento Aberto, Garantia Aberta, Caderno de Revisões e Decisões Abertas. O ciclo de transações IndexedDB foi adaptado dos módulos próprios de Decisões Abertas, Caderno de Revisões e Garantia Aberta; `assets/store.mjs` conserva esse aviso. A implementação de pauta, vínculos, estados, snapshots e exportações é específica deste projeto. Esses avisos não atribuem à LOFRANO a autoria de fontes ou bibliotecas de terceiros.

Os registros de **Mostra do Bairro Aurora**, o backup JSON e os relatórios de exemplo são cenários fictícios originais gerados pelas APIs do projeto. Não reproduzem uma reunião ou cadastro real.

## Fonte Lato

Os arquivos `assets/lato-regular.ttf` e `assets/lato-bold.ttf` são distribuídos localmente, sem carregamento por CDN. Seus metadados registram:

> Copyright (c) 2011-2015 by tyPoland Lukasz Dziedzic. Reserved Font Name: Lato.

A fonte usa **SIL Open Font License 1.1**, preservada em [assets/LATO-LICENSE.txt](assets/LATO-LICENSE.txt). A licença MIT do aplicativo não se aplica à fonte. Preserve seus avisos e observe a reserva do nome Lato ao distribuir versões modificadas. A autoria e o nome não representam endosso a esta aplicação.

Referências: [Lato](https://www.latofonts.com/) e [SIL Open Font License](https://openfontlicense.org/).

## Ferramentas de desenvolvimento

Estas bibliotecas são instaladas por `npm ci` para testes e verificação. Não são importadas pelos módulos entregues em `dist/` nem necessárias para operar o aplicativo no navegador.

| Dependência direta | Versão fixada | Licença | Uso |
| --- | --- | --- | --- |
| [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB) | 6.2.7 | Apache-2.0 | Testes de transações e conflitos IndexedDB |
| [linkedom](https://github.com/WebReflection/linkedom) | 0.18.15 | ISC | Testes da interface com DOM independente |
| [marked](https://github.com/markedjs/marked) | 18.1.3 | MIT | Análise independente de estrutura e renderização Markdown nos testes |
| [csv-parse](https://github.com/adaltas/node-csv) | 7.0.3 | MIT | Leitura independente das exportações CSV nos testes |

Autoria e textos de licença completos acompanham os respectivos pacotes em `node_modules/` após a instalação. `package-lock.json` registra também as dependências transitivas; elas mantêm suas próprias licenças e não são relicenciadas por este projeto. `node_modules/` não integra a distribuição estática do aplicativo.
