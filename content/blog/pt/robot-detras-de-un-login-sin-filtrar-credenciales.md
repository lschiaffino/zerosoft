---
title: "Um robô atrás de um login, sem deixar sua senha à vista"
description: "Como fazer um robô entrar num site com usuário, senha e 2FA, guardar a sessão entre execuções e não expor dados privados. Passos e limites reais do Robots da zerosoft."
date: "2026-11-14"
author: "zerosoft"
tags: ["robots", "seguranca", "browse-ai"]
---

A ajuda do Browse AI explica [como extrair e monitorar dados atrás de um login](https://help.browse.ai/en/articles/10518514-how-to-scrape-and-monitor-data-behind-a-login). Ela recomenda cookies de sessão para logins comuns sem 2FA e sugere renová-los de vez em quando, uma vez por mês como referência. É um bom ponto de partida, porque quase tudo o que vale automatizar (um painel de fornecedor, um portal de notas, uma listagem interna) fica atrás de uma senha.

Este post resolve o mesmo problema com o Robots, a automação de navegador da zerosoft, e se concentra no que mais importa quando um robô lida com credenciais: onde o segredo é guardado, em que site ele pode ser digitado e quem vê o que o robô traz.

## Antes de começar

Use um robô com login apenas em contas suas ou que você tenha autorização para automatizar. Leia os termos do site: muitos proíbem o acesso automático mesmo com uma conta válida. Se existir uma API ou uma exportação oficial, é um caminho melhor que um navegador.

## Passo 1: guardar a credencial uma única vez

As credenciais ficam no workspace, não dentro do robô. Crie uma do tipo "basic" com três campos:

- **Usuário.**
- **Senha.** Fica guardada criptografada.
- **Segredo TOTP.** Opcional, para sites com verificação em duas etapas. É o texto que o site mostra ao configurar o app autenticador (algo como `JBSW Y3DP EHPK 3PXP`). O Robots valida ao salvar.

Um único nome, por exemplo `PORTAL_FORNECEDOR`, serve para todos os robôs que entram nesse site. Se você trocar a senha, troca em um lugar só.

## Passo 2: escrever o login nos passos

Na aba Passos, o login é montado com passos comuns. O modelo "Fazer login e extrair" já traz a estrutura e serve de molde:

1. **Ir para URL** com a página de login.
2. **Se existir** o campo de usuário. Se ele não estiver lá, o robô pula o login. Isso resolve o caso da sessão guardada, que vemos no passo 4.
3. **Preencher** o campo de usuário com `{{credentials.PORTAL_FORNECEDOR.username}}`.
4. **Preencher** o campo de senha com `{{credentials.PORTAL_FORNECEDOR.password}}`.
5. **Clicar** no botão de entrar e **Esperar** um elemento que só aparece logado.
6. **Extrair lista** com o que você veio buscar.

Se o site pedir 2FA, adicione outro passo Preencher com `{{credentials.PORTAL_FORNECEDOR.totp}}`. O Robots calcula o código do momento (RFC 6238) a cada tentativa, então uma nova tentativa 30 segundos depois não usa um código vencido.

## Passo 3: as regras que o Robots impõe

Estas restrições existem para que uma credencial nunca acabe num lugar onde possa ser lida. O editor as verifica ao salvar:

- **Somente no valor de um passo Preencher.** Se você colocar `{{credentials...}}` num seletor, numa URL, num texto ou num script, o Robots rejeita o robô e diz qual é o passo.
- **Site do login.** Cada passo Preencher com credencial tem um campo "Site do login". O segredo só é digitado se a página estiver nesse site (um domínio e seu `www.` contam como o mesmo). Se o campo terminar em outro lugar, por um redirecionamento ou um iframe, o passo falha sem digitar nada. Deixar o campo vazio usa o site do último passo Ir para URL com endereço fixo, mas convém preencher à mão.
- **Sem ler o que foi digitado.** Um robô com credencial não pode ter um passo de script nem extrair o atributo `value`, porque alguns sites copiam ali o que você digitou. Os seletores alternativos também ficam desativados nos passos com login, para o robô não digitar a senha num elemento parecido, mas errado.

É mais restritivo que um navegador comum de propósito. No dia em que alguém editar um robô e colar uma URL de phishing num passo, o segredo não sai.

## Passo 4: guardar a sessão e não logar a cada execução

Nos ajustes do robô, ative "Guardar sessão entre execuções". O Robots conserva cookies e localStorage, criptografados, e a próxima execução já começa dentro. Graças ao passo "Se existir" do passo 2, o robô percebe que não há formulário e vai direto para a extração.

Três detalhes práticos:

- Se a sessão guardada passar de 1.000.000 de caracteres, ela não é salva e a execução seguinte volta a logar.
- "Apagar sessão" a elimina quando algo ficou estranho: troca de senha, conta bloqueada, um site que deixou você no meio do caminho.
- Desativar a opção também apaga o que estava guardado.

Uma sessão guardada é cômoda, mas também é uma chave. Trate-a como tal: um robô por conta, e a conta com o mínimo de permissões necessário para ler.

## Passo 5: decidir quem vê os dados

Um robô com login traz dados privados, e o Robots parte disso. As execuções feitas com um login ficam marcadas com quem as capturou, e só essa pessoa e os admins veem as linhas. No workspace, os members podem criar robôs e rodar os que não usam login, sessão guardada nem credencial. Os que usam ficam para admins e owners.

Quando você conecta o robô a um destino (o CRM, um flow, uma planilha), o Robots mostra um aviso: as linhas podem incluir dados privados, então envie só para onde for permitido. Leve a sério. Uma lista de clientes de um portal não deveria parar num canal de chat aberto.

## Passo 6: evitar que quebre em silêncio

Logins falham mais que páginas públicas: expiram, pedem um captcha novo, mudam o formulário. Dois ajustes ajudam:

- **Pausa automática.** Por padrão o agendamento pausa depois de 3 falhas seguidas (dá para subir até 20). Importa mais com login: um robô que continua tentando com uma senha antiga pode bloquear a conta.
- **Captura da falha.** Na aba Execuções você vê a captura, a URL e um trecho do DOM do passo que falhou, sem a credencial.

## O que o Robots ainda não faz

- Não resolve captchas nem verificações por SMS ou chave de hardware. Se o login exigir, o robô não avança.
- O código TOTP funciona com apps autenticadores padrão. Um 2FA enviado por email não tem passo próprio.
- A sessão guardada é uma por robô, não compartilhada entre robôs.
- A extensão do Chrome para gravar os passos se instala à mão com o modo desenvolvedor e não se atualiza sozinha.

## O que muda em comparação com a nuvem de outra empresa

Quando o robô de um terceiro entra no seu portal, sua senha e os cookies da sessão ficam nos servidores dele. Com a zerosoft no seu próprio servidor, a credencial criptografada, a sessão e as linhas ficam no seu banco, e o navegador é o seu Chromium. Na zerosoft Cloud o código é o mesmo e você paga o uso ao custo vezes três. Para equipes que automatizam acessos a sistemas de clientes, saber onde está cada segredo vale mais que qualquer limite de execuções.
