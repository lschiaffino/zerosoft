---
title: "Migrar do Linear para o Track: o que importa e como fazer"
description: "Como levar seus issues do Linear para o Track com uma API key ou o CSV: o que entra (teams, cycles, labels, comentários), o que fica de fora e o que revisar."
date: "2026-10-31"
author: "zerosoft"
tags: ["track", "linear", "migração", "guia"]
---

Sair do Linear assusta por um motivo bem prático: anos de issues, comentários e cycles que ninguém quer digitar de novo. Este guia mostra como funciona a importação do Linear no [Track](/products/track), o que ela traz exatamente (lemos no código do importador), o que fica de fora e o que conferir quando termina.

## Dois caminhos: API key ou CSV

Os dois ficam no Track, em **Configurações › Importar e exportar**, e também no hub de importação do workspace (**Configurações › Importar**, fonte Linear). Só quem administra o workspace pode importar, porque tudo o que entra fica visível para o time inteiro.

**API key do Linear.** É o caminho mais completo.

1. No Linear, abra Settings › Account › Security & access › Personal API keys e crie uma key nova.
2. Dê acesso de leitura. O importador só lê: nada é escrito no Linear.
3. No Track, escolha **Linear (API key)** em *Importar de*, cole a key e escolha o destino em *Em*: uma equipe que já existe ou **Uma equipe nova para cada team do Linear**.
4. Clique em **Prévia**, confira o que aparece e confirme com **Importar N issues**.

A key fica cifrada enquanto seus dados são lidos e é apagada quando a importação termina, falha ou é cancelada.

**CSV do Linear.** Se você prefere não gerar uma key, exporte no Linear em Settings › Workspace › Import and export › Export CSV e escolha **Linear (export CSV)**. O Track reconhece os cabeçalhos do Linear e sugere o mapeamento das colunas, que você pode ajustar (o título é obrigatório). O arquivo pode ter até 4 MB; se for maior, divida. Pelo CSV entra só o que as colunas trazem, então comentários e datas-alvo dos projetos chegam melhor pela API.

Os dois caminhos compartilham os identificadores externos. Se você importou o CSV e depois roda a importação pela API, os issues que já estavam lá não se duplicam.

## Como o Linear vira Track

O Track usa o vocabulário do Linear, então quase tudo cai no lugar certo:

- **Teams viram equipes.** Cada team do Linear vira uma equipe do Track, e a chave do team (por exemplo `ENG`) vira o prefixo dos novos identificadores.
- **Projetos do Linear viram milestones** dentro da equipe, com a data-alvo. O motivo é estrutural: no Linear um projeto pode atravessar vários teams, e aqui ele fica pendurado na equipe de cada issue.
- **Status** são procurados pelo nome dentro da equipe e criados com a categoria quando não existem. Backlog e Triage vão para Backlog, Unstarted para A fazer, Started para Em andamento, Completed para Feito e Canceled para Cancelado.
- **Prioridade.** Urgent, High e Low se mantêm. Medium e *No priority* entram como Média: o Track tem quatro prioridades e nenhum valor separado de "sem prioridade".
- **Cycles**, com data de início e fim.
- **Labels** com a cor, até dez por issue.
- **Estimativa**, **prazo** e a **data de criação** original.
- **Sub-issues.** Uma segunda passada liga cada sub-issue ao pai, mesmo quando o pai chegou depois.
- **Comentários** com a data, até 50 por issue.
- **Responsáveis**, casados por email com os membros do workspace.

## O que não vem junto

Melhor saber antes de começar:

- **Relações** (bloqueia, relacionado, duplicado). Só a relação pai e filho é importada.
- **Anexos, reações e inscritos.**
- **Textos muito longos.** Descrições e comentários são cortados em 5.000 caracteres.
- **O número exato do identificador.** O prefixo vem do team, mas os números são atribuídos no Track conforme os issues são criados, então `ENG-142` pode não continuar `ENG-142`. Se você tem links para issues em outras ferramentas, confira.
- **Mudanças posteriores.** Reimportar pula os issues que já entraram e só soma comentários novos. Se você renomear um issue no Linear depois, essa mudança não vem.
- **Workspaces enormes.** Cada importação traz até 20.000 issues. Se houver mais, a prévia avisa que o resto ficou de fora.

## A prévia é onde tudo se decide

Antes de criar qualquer coisa, o Track mostra quantos issues, comentários, equipes, labels, cycles e milestones vão entrar. Embaixo há três tabelas que valem a leitura:

- **Equipes**, marcadas como novas ou existentes.
- **Status**, com o tipo e se cada um é novo ou reaproveita um que já existe.
- **Responsáveis**, com o membro correspondente. Quem não é membro do workspace fica sem responsável, e a prévia sinaliza isso.

Esse último ponto é o mais importante: **convide o time antes de importar**. Se as pessoas já estão no workspace com o mesmo email que usam no Linear, os issues continuam atribuídos e os comentários mantêm o autor. Se não, o issue entra sem responsável e o comentário é assinado por quem importa, com o nome original em negrito acima do texto.

## Enquanto roda

A importação avança em lotes. O Linear é lido de 50 em 50 issues por página e, se a API do Linear responder com limite de requisições, o importador espera um minuto e segue. Você pode fechar a aba: o cron de cada minuto retoma de onde parou. A importação também não envia notificações nem dispara webhooks, porque é uma mudança de casa e não atividade nova.

## O que conferir depois

Quando termina, o resumo mostra quantos issues e comentários entraram, quantos foram pulados, o que foi criado e quantos issues ficaram sem responsável. Depois:

1. **Abra três ou quatro issues grandes** e compare descrição, labels e comentários com o Linear.
2. **Olhe os status de cada equipe.** Se o Linear tinha status quase iguais ("In Review" e "Review"), talvez valha unificar.
3. **Confira os cycles** da equipe e o cycle ativo.
4. **Revise os issues sem responsável** e atribua.
5. **Passe pelos milestones** de cada equipe e suas datas-alvo.

Se algo saiu errado, corrija no Linear e importe de novo: o que já está lá não se duplica.

## O que ainda falta no Track em relação ao Linear

Está na nossa tabela de paridade, e repetimos aqui:

- **Apps nativos de iOS e Android com push**: ainda não.
- **Modo offline**: ainda não.
- **SSO**: o login é só com Google, sem SAML nem SCIM. Existe audit log com filtros e export.
- **Permissões por equipe**: há equipes privadas e convidados limitados a certas equipes, mas não um papel de dono por equipe.
- **Integrações**: Sentry, Figma, Zendesk e Intercom funcionam em parte. Não há app dentro da barra lateral do Zendesk ou do Intercom.

A lista completa, área por área, está em [/compare/zerosoft-vs-linear](/compare/zerosoft-vs-linear).

## Quanto custa

O Linear Standard custa US$ 8 por usuário por mês: um time de dez paga US$ 960 por ano. O Track no seu servidor custa $0; o core é AGPLv3 com todas as funções. No zerosoft Cloud você começa com um plano gratuito e depois paga pelo uso. Assentos não são cobrados, então colocar mais alguém no time não muda a fatura.

Para comparar no dia a dia, leia [Track vs Linear](/blog/zerosoft-track-vs-linear), e para planejar depois da mudança, [como usar os ciclos no Track](/blog/ciclos-en-track). E se um dia você quiser sair, o Track exporta os issues em CSV na mesma aba onde você importou.
