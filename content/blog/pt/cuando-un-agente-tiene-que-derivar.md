---
title: "Quando um agente de IA deve passar a conversa para uma pessoa"
description: "Cinco situações em que um agente de suporte ou de vendas precisa transferir, como configurar cada uma no Agents e o que revisar toda semana para ajustar as regras."
date: "2026-10-18"
author: "zerosoft"
tags: ["agents", "ia", "suporte"]
---

Um agente de IA que nunca transfere acaba inventando. Um que transfere tudo é um formulário de contato com mais passos. O trabalho está no meio: decidir em quais casos a conversa precisa ir para uma pessoa, e garantir que essa pessoa a receba com contexto.

O Zapier tem um bom guia sobre [human-in-the-loop](https://zapier.com/blog/human-in-the-loop/) em fluxos de IA em geral: aprovações, roteamento por confiança, escalonamentos e registros. Este post leva essas ideias para um caso concreto, um agente que conversa com seus clientes, e mostra como configurar cada regra no Agents, com o que ele faz e o que ainda não faz.

## As cinco situações que sempre transferem

**1. O visitante pede.** "Quero falar com alguém" não se discute. Insistir com o bot nesse momento é o jeito mais rápido de perder um cliente.

**2. A resposta não está no seu conhecimento.** Se o agente não encontrou nada nos seus docs, qualquer coisa que ele disser é um palpite bem escrito.

**3. Tem dinheiro ou contrato no meio.** Reembolsos, cancelamentos, descontos, notas emitidas errado, cláusulas. O agente pode juntar os dados, mas a decisão é de uma pessoa.

**4. O cliente está irritado ou já tentou duas vezes.** Se alguém repete a mesma pergunta ou escreve em maiúsculas, a próxima mensagem tem que ser humana.

**5. Um lead que vale a pena.** Essa é a mais esquecida. Transferir também serve para o que é bom: um lead que acabou de dizer que tem orçamento e precisa disso neste trimestre não deveria esperar o follow-up de segunda.

## Como configurar cada uma no Agents

No Agents, a transferência é uma ferramenta: "Transferir para uma pessoa". Ela precisa estar ativa na aba Ferramentas para que as regras abaixo valham. Depois, em Instruções, na parte avançada:

**Quando o visitante pede para falar com uma pessoa.** Uma chave, ligada por padrão. Cobre a situação 1.

**Quando o agente não sabe a resposta ou não tem certeza.** Outra chave, também ligada por padrão. Cobre a situação 2. Vale ser preciso: não há um número de confiança por trás. É uma regra que o agente recebe nas instruções, junto com outra fixa: não inventar preços, políticas, datas, links nem funções. Se "Pesquisar conhecimento" também estiver ativa, o agente precisa pesquisar antes de responder sobre o negócio, e a pesquisa vazia fica registrada.

**Sempre transferir com estas palavras.** Uma lista separada por vírgula, até 30. Cobre a situação 3, e é a mais confiável de todas: se a mensagem do visitante contém uma dessas palavras, a conversa é transferida sem passar pelo modelo. Nenhum token é gasto. Um ponto de partida:

```
reembolso, estorno, cancelar, nota fiscal, advogado, reclamação, contrato
```

A comparação ignora maiúsculas e acentos, então "reclamacao" também conta. Cuidado com palavras muito curtas ou muito comuns: "plano" transferiria metade das conversas.

**As situações 4 e 5 vão no brief.** As instruções do agente são escritas como você explicaria o trabalho para alguém novo. Por exemplo:

```
Se o cliente repetir a mesma pergunta ou parecer irritado, não insista:
transfira para uma pessoa e avise que alguém da equipe responde por aqui.

Quando um lead disser que precisa disso neste trimestre e tem orçamento,
registre uma nota no CRM com o resumo e transfira para uma pessoa.
```

O modelo "Qualificador de leads" já traz essa lógica: classifica cada lead como QUENTE, MORNO ou FRIO e transfere os quentes.

## O que acontece quando transfere

Depende do canal:

- **No widget do Chat**, a conversa fica marcada como transferida, uma mensagem de sistema é adicionada, a prioridade sobe para alta e sua equipe recebe um aviso. A partir daí, o agente para de responder. Ele também fica quieto assim que alguém da equipe responde, mesmo que ninguém tenha transferido.
- **Na página pública e pela API**, a equipe recebe uma notificação com link direto para a conversa.

Nos dois casos o visitante lê uma mensagem de transferência. Você pode escrever a sua (até 500 caracteres) ou usar a padrão, que sai em português, espanhol ou inglês conforme o visitante escreveu.

Uma boa mensagem de transferência diz duas coisas: que uma pessoa vai responder, e por onde. "Vou chamar alguém da equipe, a resposta vem por aqui" é melhor que "Sua solicitação é muito importante para nós".

## Ações que não dependem só do bom senso do modelo

O guia do Zapier coloca as aprovações em primeiro lugar, e com razão: algumas ações não deveriam acontecer sem confirmação. O Agents ainda não tem uma fila onde uma pessoa aprova uma ação antes que ela rode. O que ele tem são verificações no código de cada ferramenta que o modelo não consegue pular:

- **Agendar uma reunião** exige um horário que o próprio agente ofereceu numa mensagem anterior, a confirmação explícita do visitante, o nome e o email. O horário é verificado de novo logo antes de reservar.
- **Salvar ou buscar um contato no CRM** só aceita um email que o visitante escreveu na conversa. Ninguém consegue usar o agente para descobrir se um email qualquer está na sua base.
- **Requisição HTTP** só chega aos domínios que você permitir, até 20.
- **Executar flow** só roda os flows que você escolheu.

Para todo o resto a regra é simples: se uma ação não dá para desfazer, não dê essa ferramenta ao agente.

## A revisão semanal

As regras de transferência se ajustam lendo conversas reais. Trinta minutos por semana bastam:

1. **Abra a aba Conversas** e filtre por canal. As transferidas têm marcação.
2. **Leia as transferidas.** Quantas o agente poderia ter resolvido se a resposta estivesse nos seus docs? Cada uma é uma página para escrever.
3. **Leia as que não transferiram.** Procure respostas longas a perguntas sobre dinheiro ou reclamações. Se achar uma, adicione a palavra à lista.
4. **Avalie.** Cada resposta tem polegar para cima e para baixo, com uma nota opcional ("deveria ter transferido"). A lista de agentes mostra a contagem.
5. **Leia o registro de ferramentas.** Cada conversa guarda quais ferramentas o agente usou, com quais dados e o que voltou. Se "Pesquisar conhecimento" voltou vazio e o agente respondeu mesmo assim, você achou um problema concreto.

## Quanto custa transferir

A Intercom cobra [US$ 0,99 por resultado do Fin](https://www.intercom.com/pricing), além dos assentos. Esse modelo empurra você a medir o agente pelo que ele resolve sozinho. No Agents não há preço por resolução: você paga os tokens do modelo que escolher, com sua chave se fizer self-host ou por consumo no zerosoft Cloud. Uma transferência por palavra-chave nem usa o modelo.

Isso muda a conta. Transferir demais custa tempo da equipe. Transferir de menos custa clientes. As regras acima buscam o ponto entre os dois.
