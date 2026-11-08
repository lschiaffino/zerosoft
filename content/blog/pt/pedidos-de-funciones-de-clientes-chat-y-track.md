---
title: "O que fazer com um pedido de funcionalidade que chega pelo chat"
description: "Um método em quatro passos para responder pedidos de funcionalidade sem prometer demais: etiquetar no Chat, vincular a uma issue do Track, contar clientes distintos e avisar quando sair."
date: "2026-11-08"
author: "zerosoft"
tags: ["chat", "track", "suporte", "playbook"]
---

Um cliente escreve: "Vocês poderiam adicionar exportação para Excel?" Existem três respostas ruins. "Anotado", e esquecer. "Sai este mês", sem saber. Ou um copia e cola manual num Slack que ninguém relê. As três deixam o cliente sem informação e a equipe sem dados.

A Intercom tem um [post sobre como responder a pedidos de funcionalidade](https://www.intercom.com/blog/the-right-way-to-respond-to-feature-requests) que vale a leitura pelo tom da resposta. Aqui cuidamos da outra metade: o que acontece com o pedido depois de respondido, numa equipe de duas a oito pessoas que usa o Chat para suporte e o Track para o produto.

## Passo 1: responda com o que você sabe, não com o que espera

A resposta precisa fazer três coisas: confirmar que você entendeu o problema de fundo, dizer o que existe hoje e dizer o que vai acontecer com o pedido. Se não há data, diga que não há data.

Um modelo para carregar como resposta salva em **Chat → seu widget → Respostas salvas** (atalho `/pedido`):

> Obrigado por escrever. Para ter certeza de que entendi: você quer [problema nas palavras do cliente]. Hoje isso se resolve assim: [alternativa atual, ou "ainda não tem solução dentro do produto"]. Deixei seu pedido registrado junto com o de outras pessoas que pedem a mesma coisa. Não tenho data, e assim que houver eu escrevo por aqui.

Duas observações sobre o modelo. Primeiro, "assim que houver eu escrevo" é uma promessa que depois precisa ser cumprida, e por isso o passo 4 existe. Segundo, a pergunta de fundo importa mais que a funcionalidade: "exportar para Excel" pode significar que alguém precisa passar dados ao contador, e talvez um CSV já resolva.

Uma resposta salva também pode executar ações ao ser inserida: mudar o status, atribuir, adiar ou adicionar etiquetas. Configure `/pedido` para adicionar a etiqueta `pedido-de-funcionalidade` e deixar a conversa como pendente. Assim a classificação não depende de quem responde se lembrar.

## Passo 2: uma nota interna com contexto, não com a citação

No compositor do Chat existe um seletor Resposta / Nota. As notas são mensagens da equipe que o visitante nunca vê, e dá para mencionar alguém com `@` para enviar uma notificação.

Use para deixar o que a issue vai precisar e o cliente não disse:

- O que ele tentava fazer quando esbarrou no limite.
- Se é um cliente pagante ou um prospect (no painel do visitante, o Chat pode criar o contato no CRM se houver e-mail, e registrar a conversa no histórico dele).
- O que ele faz hoje como alternativa.

Com esses três dados, quem prioriza não precisa voltar a perguntar ao cliente.

## Passo 3: vincule a conversa a uma issue do Track

No painel de detalhes da conversa há uma seção **Track** com dois botões: **Criar issue** e **Vincular issue**.

- **Criar issue**: escolha o team, escreva um título e a issue é criada com um trecho das últimas mensagens e o link da conversa.
- **Vincular issue**: digite o identificador de uma existente, como `WEB-12`.

Sempre busque primeiro. Se o pedido já existe, vincule em vez de criar duplicata. Cada vínculo fica guardado como um pedido de cliente da issue, com nome e e-mail do visitante, a última mensagem que ele escreveu e o link de volta para a conversa. Várias conversas podem apontar para a mesma issue, e a conversa recebe uma nota de sistema com o identificador (o visitante não vê). Se o team do Track é privado, você só vê e vincula issues de teams aos quais tem acesso.

Para remover um vínculo há um botão de desvincular ao lado do identificador. Ele apaga o pedido e não mexe na issue.

## Passo 4: conte clientes, não mensagens

Aqui está a vantagem de ter Chat e Track no mesmo produto. No Track, a issue mostra os pedidos de cliente que tem, e a seção **Customers** da barra lateral agrupa os pedidos por cliente. Ao listar issues você pode ordenar por quantidade de clientes. A contagem usa clientes distintos (empresa, senão contato, senão e-mail ou nome), então o mesmo cliente que insiste cinco vezes conta uma vez, e dez pessoas diferentes contam dez. Cada pedido pode ser marcado como importante.

Três regras para decidir com esses dados:

1. **Um cliente distinto, um voto.** Cinco mensagens da mesma conta são um pedido urgente dessa conta e um voto na contagem.
2. **Olhe quem pede, não só quantos.** Se quem pede é um cliente pagante e o resto são visitantes curiosos, a lista ordenada por quantidade mente um pouco. A marca de importante existe para isso.
3. **Pedido sem problema por trás é arquivado.** Se depois de duas conversas você não sabe o que cada cliente tentava fazer, a issue não está pronta para entrar num ciclo.

## Passo 5: feche o ciclo

Quando a issue passa para feito, você tem a lista de conversas que a pediram. Hoje o aviso é você quem envia: abra cada conversa vinculada e escreva. Não há envio automático aos clientes quando a issue fecha, e preferimos dizer isso a deixar você supor o contrário.

Uma rotina semanal de dez minutos basta para não deixar escapar:

1. No Track, veja as issues que passaram para feito na semana e abra as que têm pedidos de clientes.
2. Entre em cada conversa de origem pelo link do pedido.
3. Responda com uma frase concreta: o que mudou e onde está. Depois resolva a conversa.

A resposta de fechamento é o que transforma um pedido em confiança. Um cliente que ficou sabendo que o que pediu já existe é um cliente que volta a pedir.

## O que ainda não existe

Para ser preciso: não há aviso automático aos clientes quando a issue é resolvida, e os vínculos são criados à mão a partir de cada conversa. Para uma equipe pequena, o fluxo deste post cabe numa tarde de configuração, e custa $0 se você roda no seu servidor, ou você usa o plano gratuito do zerosoft Cloud se preferir não manter.
