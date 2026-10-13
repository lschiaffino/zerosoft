---
title: "Workflows de CRM que criam as tarefas de follow-up por você"
description: "Como usar os workflows do zerosoft CRM para criar tarefas de follow-up automáticas: triggers e ações reais, cinco receitas para times pequenos e os limites que você precisa conhecer antes de depender deles."
date: "2026-08-08"
author: "zerosoft"
tags: ["crm", "workflows", "automação"]
---

Deals quase nunca morrem porque alguém disse não. Morrem porque ninguém fez o follow-up. A proposta saiu numa terça, a semana apertou e, quando alguém lembrou, o prospect já tinha fechado com quem lembrou antes.

A solução não é disciplina. É fazer o follow-up existir antes de alguém precisar pensar nele. É para isso que servem os workflows do zerosoft CRM, e a coisa mais útil que eles fazem é chata: criar uma tarefa, com data, ligada ao registro certo.

## As peças

Um workflow fica em `/app/crm/workflows` e tem três partes: um nome, um ou mais **triggers** e uma ou mais **ações**. Criar, editar, ativar, rodar e apagar workflows é **só para admins**: é configuração compartilhada do workspace inteiro, e você não quer cada membro montando automações por conta própria.

Os triggers que existem hoje:

- **Contato criado**, **Contato atualizado**
- **Negócio criado**, **Negócio atualizado**
- **Etapa alterada** (opcionalmente só a partir de uma etapa e/ou para uma etapa)
- **Negócio ganho**, **Negócio perdido**
- **Tarefa vencida**
- **E-mail recebido**
- **Manual**

E as ações:

- **Criar tarefa**
- **Criar atividade** (uma nota, ligação, reunião ou email na timeline)
- **Enviar e-mail**
- **Atualizar campo** (padrão ou custom)
- **Adicionar à lista** (listas estáticas)
- **Webhook**
- **Notificar usuário** (uma notificação dentro do app)

Um workflow pode ter até 10 triggers (qualquer um deles dispara) e até 20 ações, que rodam em ordem. Cada execução fica registrada no histórico do workflow com o seu status, então quando algo não aconteceu, você vê o motivo em vez de adivinhar.

## Como "Criar tarefa" se comporta

É a ação que você mais vai usar, então vale saber exatamente o que ela faz:

- **Assunto**: o título da tarefa. É texto literal; placeholders não são preenchidos no assunto das tarefas.
- **Vence em dias**: quantos dias a partir de agora. Se ficar vazio, o padrão é 1.
- **Owner ID**: opcional. Se ficar vazio, a tarefa é criada sem owner.
- **As associações vêm de graça.** Se o trigger foi um deal, a tarefa fica ligada a esse deal, ao primeiro contato do deal e à empresa desse contato. Se foi um contato, fica ligada ao contato e à empresa dele. A tarefa aparece na timeline do registro, no banner de "próxima tarefa" da página de detalhe e em `/app/crm/tasks`, em Atrasadas, Hoje ou Próximas.

## Cinco receitas para um time pequeno

### 1. Todo lead novo ganha um primeiro contato

- Trigger: **Contato criado**
- Ação: **Criar tarefa**, assunto "Primeira ligação", vence em 1 dia

A mais simples e a que se paga mais rápido. Todo contato novo, venha da API ou de alguém digitando, ganha uma tarefa com data. Atenção: importações por CSV também criam contatos. Desligue esta antes de importar alguns milhares de linhas, a não ser que você queira alguns milhares de tarefas.

### 2. Proposta enviada → cobre em três dias

- Trigger: **Etapa alterada**, para a etapa "Proposta enviada"
- Ação: **Criar tarefa**, assunto "Follow-up da proposta", vence em 3 dias

O filtro de etapa pede o ID da etapa, não o nome. O jeito mais rápido de pegar é `GET /api/v1/crm/pipelines` com a sua chave de API, que lista cada pipeline com as etapas. Sim, colar um ID é tosco; está na nossa lista.

### 3. Perdido pode voltar

- Trigger: **Negócio perdido**
- Ação: **Criar tarefa**, assunto "Retomar contato", vence em 90 dias

Perder por timing ou orçamento é diferente de perder por fit. Uma tarefa daqui a três meses não custa nada e transforma alguns "não" em "ainda não". O zerosoft já pede um motivo de perda quando um deal é fechado como perdido, então quem recebe a tarefa tem o contexto.

### 4. Ganho → comece o onboarding

- Trigger: **Negócio ganho**
- Ações: **Criar tarefa** "Enviar kickoff de onboarding", vence em 1 dia, e depois **Notificar usuário** com uma mensagem como `Fechamos {{deal.name}} por {{deal.amount}} {{deal.currency}}`

Mensagens de notificação e emails suportam placeholders: `{{contact.firstName}}`, `{{contact.fullName}}`, `{{contact.email}}`, `{{company.name}}`, `{{deal.name}}`, `{{deal.amount}}`, `{{deal.currency}}` e campos custom como `{{contact.custom.sua_chave}}`.

### 5. Uma tarefa venceu → faça barulho

- Trigger: **Tarefa vencida**
- Ação: **Notificar usuário**, mensagem `Tarefa vencida de {{contact.fullName}}`

**Tarefa vencida** dispara uma vez por tarefa, quando a data passa e ela continua aberta. Mudou a data, ela é rearmada. Quem move isso é o endpoint agendado `/api/cron/tick`: na Vercel, o `vercel.json` do repositório roda ele a cada hora; se você hospeda por conta própria, aponte qualquer cron para ele com o seu `CRON_SECRET` como Bearer token, ou esse trigger nunca dispara.

## Os limites, com franqueza

Os workflows são simples de propósito. Antes de montar o seu processo em cima deles, saiba o que eles não fazem:

- **Sem condições nem ramificações.** Não existe "só se o valor > 10.000" nem "só se o lifecycle for SQL". Um trigger dispara para cada evento que bate. O filtro de etapa em "Etapa alterada" é o único recorte nativo.
- **"Atualizado" é qualquer atualização.** "Negócio atualizado" e "Contato atualizado" disparam a cada edição, até as mínimas. Combinar isso com "Criar tarefa" é um ótimo jeito de soterrar o seu time. Prefira triggers específicos (mudança de etapa, ganho, perdido).
- **"E-mail recebido" depende do sync do Gmail,** que é manual e somente leitura: os emails entram quando alguém clica em sincronizar, não em segundo plano.
- **Sem esperas ou delays.** "Vence em N dias" define a data da tarefa; o workflow roda na hora.
- **Execuções manuais não têm registro associado.** "Executar agora" serve para testar um email ou um webhook; uma tarefa criada assim não fica ligada a nada.
- **Proteção contra loops.** Uma ação como "Atualizar campo" pode disparar outros workflows, mas um workflow nunca roda de novo dentro da mesma cadeia e as cadeias param em três níveis. Você não consegue criar um loop infinito; também não consegue uma cascata de 10 passos.

## Um conjunto inicial sensato

Se você vai configurar isso hoje, comece pelas receitas 2 e 3. Elas cobrem os dois momentos em que mais vazam deals: o silêncio depois de uma proposta e a calmaria depois de uma perda. Adicione a 1 se os leads chegam mais rápido do que você consegue triar. Adicione a 5 quando as pessoas realmente trabalharem a partir da lista de tarefas.

Depois deixe quieto por um mês e olhe o histórico de execuções. Se um workflow continua criando tarefas que ninguém conclui, é ruído. Desligue. O objetivo não é ter mais tarefas. É que o follow-up certo já exista quando alguém abrir o CRM na segunda-feira.
