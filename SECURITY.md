# Segurança e privacidade

Pauta Aberta organiza registros no navegador. O conteúdo digitado, importado ou salvo não é enviado pelo aplicativo para um backend, serviço de IA ou telemetria. HTML, scripts, estilos e fontes são arquivos locais da aplicação; em uma hospedagem remota, o servidor ainda recebe os acessos HTTP normais necessários para entregar esses arquivos. Links externos são abertos por escolha da pessoa.

## Onde os dados ficam

- A sessão temporária fica em memória até a página ser fechada ou substituída.
- Rascunhos de formulário ficam apenas na memória da sessão. Só entram no documento, no backup e no salvamento local depois de serem salvos na ficha. O alerta de saída depende do navegador e não garante preservação após fechar ou recarregar.
- O salvamento só começa após uma ação explícita. IndexedDB pertence à origem e ao perfil do navegador, com o nome `lofrano-pauta-aberta-v1`.
- O backup JSON é um arquivo local completo, com nomes, notas e todas as versões de ata. CSV e Markdown também podem conter informações pessoais da reunião.

O aplicativo não criptografa esses dados, não define uma senha e não impede acesso por quem controla o navegador ou dispositivo. Proteja e compartilhe os arquivos conforme a sensibilidade do conteúdo. Mudar a porta, o domínio ou o perfil pode levar a outro armazenamento local; isso não significa que o caderno anterior foi apagado.

**Desativar e apagar salvamento** remove o documento persistido desta aplicação. Um contador de revisão sem o conteúdo é mantido para rejeitar gravações antigas. A sessão que já está aberta continua disponível até ser fechada; backups baixados e outras cópias precisam ser administrados separadamente.

## Controles implementados e seus limites

O domínio valida o caderno inteiro, inclusive snapshots e seus vínculos, antes de aceitar importações, operações ou persistência. O tamanho e as coleções têm limites explícitos. A interface insere texto como texto, sem executar o HTML digitado. Markdown neutraliza estruturas adicionais; CSV cita os campos e protege inícios de fórmula com apóstrofo. Essas transformações não alteram o backup JSON original.

O salvamento usa transações com revisão esperada. Duas abas não devem sobrescrever silenciosamente o mesmo caderno; um conflito interrompe a gravação e mantém a sessão para backup. Falhas, indisponibilidade ou esgotamento de armazenamento não são apresentados como salvamento concluído. Isso não substitui cópias de segurança nem protege contra extensões, código de mesma origem, ferramentas do navegador ou um dispositivo comprometido.

Atas são cópias históricas no documento, não assinaturas ou registros invioláveis. Quem modifica um backup pode modificar seu histórico. Presença, decisões e datas são informadas localmente; o aplicativo não comprova identidade, consenso, participação, validade jurídica ou horário certificado.

## Relatar um problema

Para problemas sem dados sensíveis, abra uma issue com versão, navegador, resultado esperado e um exemplo mínimo **inteiramente fictício**. Não publique cadernos reais, nomes de participantes, capturas privadas, senhas ou credenciais.

Se houver uma vulnerabilidade que deva ser discutida de forma reservada, use o relato privado na área **Security** do GitHub quando disponível. Caso essa opção não esteja habilitada, procure um canal de contato na [LOFRANO TECNOLOGIA](https://lofranotecnologia.com.br) para combinar o envio privado antes de compartilhar detalhes. Não há promessa de prazo de resposta, recompensa ou serviço de monitoramento.
