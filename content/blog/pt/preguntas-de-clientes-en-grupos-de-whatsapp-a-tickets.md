---
title: "Perguntas de clientes em grupos de WhatsApp: como transformá-las em tickets com SLA"
description: "Um sistema de quatro regras para nenhuma pergunta se perder num grupo de WhatsApp com clientes: ticket por emoji ou palavra-chave, prazos de resposta, marca de sem resposta e aviso por email. Com os valores do Lines, a caixa de WhatsApp open source da zerosoft."
date: "2026-11-28"
author: "zerosoft"
tags: ["lines", "periskope", "whatsapp", "suporte"]
---

Muitas equipes pequenas atendem clientes em grupos de WhatsApp: um grupo por conta, com o cliente dentro e duas ou três pessoas suas. Funciona até o grupo ter quarenta mensagens por dia e uma pergunta de terça às onze ficar enterrada embaixo de um áudio, três fotos e um "obrigado". Ninguém ignorou de propósito. Ninguém era o dono.

O Periskope, que vende uma caixa de entrada para WhatsApp, tem [um post sobre como gerenciar consultas de clientes em grupos de WhatsApp](https://periskope.app/blog/manage-customer-queries-on-whatsapp-groups) que sugere marcar as consultas importantes e transformá-las em tickets e tarefas. Boa ideia. Aqui vai a nossa versão: quatro regras que você aplica numa tarde, com os valores concretos que o Lines traz. O Lines é a caixa de WhatsApp da zerosoft (licença AGPL, self-host por $0 ou zerosoft Cloud).

## Regra 1: toda pergunta tem um ticket e um responsável

A unidade de trabalho é o ticket. Um ticket tem status (aberto, em andamento, resolvido, fechado), prioridade (baixa, média, alta, urgente), responsável e vencimento. Se uma consulta não tem ticket, ela depende da memória de alguém.

No Lines há três jeitos de criar um:

- **Pela mensagem.** No menu de qualquer mensagem da conversa.
- **Com uma reação.** Reagir com 🎫 a uma mensagem cria um ticket, um ticket por mensagem. Funciona pelo Lines e também pelo celular, então quem atende pelo telefone não precisa abrir mais nada. Dá para trocar o emoji nas configurações, ou deixar vazio para desligar a função.
- **Por palavra-chave.** Se você cadastra palavras como "fatura", "erro" ou "não funciona", uma mensagem recebida que as contenha abre um ticket sozinha.

Comece com o emoji e sem palavras-chave. As palavras-chave geram tickets demais até você ajustá-las, e uma equipe com a lista cheia de ruído para de olhar para ela.

## Regra 2: um prazo para cada prioridade

Um ticket sem prazo é uma anotação. O Lines vem com estes valores iniciais, todos editáveis nas configurações do Lines:

| O quê | Prazo padrão |
|---|---|
| Primeira resposta | 60 minutos |
| Resolução, urgente | 4 horas (240 min) |
| Resolução, alta | 8 horas (480 min) |
| Resolução, média | 24 horas (1440 min) |
| Resolução, baixa | 3 dias (4320 min) |

A prioridade padrão de um ticket novo é média. Antes de aceitar esses números, faça uma pergunta incômoda: sua equipe consegue cumpri-los de verdade? Um SLA de primeira resposta de 15 minutos que estoura todo dia ensina todo mundo a ignorar os avisos. Comece com 60 minutos, cumpra por um mês e reduza depois.

## Regra 3: o que não tem ticket também não pode ficar sem resposta

Nem toda pergunta ganha o emoji. Para isso existe a marca de **sem resposta**: se a última mensagem do cliente espera há mais de certo tempo (30 minutos por padrão), a conversa fica marcada na caixa e você pode filtrar por "sem resposta".

Há dois modos:

1. **Por tempo.** Toda mensagem do cliente espera resposta. É simples, mas um "ok, obrigado" ativa a marca também.
2. **Com IA.** Separa perguntas e pedidos de comentários soltos. Você pode escrever regras em texto, por exemplo: "agradecimentos não são perguntas, tudo sobre cobrança é".

Dois detalhes que importam na prática. Primeiro, o que você responde pelo celular conta como resposta: se alguém responde pelo WhatsApp do telefone, a marca some. Segundo, criar um ticket a partir da mensagem tira a conversa da lista de sem resposta (dá para desativar), porque dali em diante a pergunta já tem dono e prazo.

Um exemplo de regra de IA para um escritório contábil: "Mensagens com foto de comprovante são pedidos. Respostas de uma palavra (ok, feito, beleza) não são. Qualquer menção a um vencimento é urgente". A IA só marca, não responde por você, e vale revisar a lista na primeira semana para ajustar o texto.

## Regra 4: avisar quando o prazo estoura

Um prazo que ninguém vê vencer não serve. O Lines pode mandar um email quando um ticket passa do tempo de primeira resposta ou de resolução. Você ativa nas configurações e escolhe quem recebe: a pessoa responsável, os admins do workspace e até 10 endereços extras, separados por vírgula. Cada vencimento avisa uma só vez, mesmo que o processo que o detecta rode duas vezes. Além do email, o vencimento dispara webhooks e pode ser gatilho no Flow, por exemplo para escrever num canal do Talk.

Uma configuração razoável para cinco pessoas: aviso para o responsável e para um endereço de plantão compartilhado. Os admins só recebem se você ativar, para não encher caixas de entrada.

## Como fica numa semana real

Segunda: você conecta a linha por QR e define o emoji 🎫, primeira resposta em 60 minutos e a marca de sem resposta em 30. Durante a semana, quem lê um grupo reage com 🎫 a cada pedido real. Sexta: você abre a lista de tickets, filtra os vencidos e olha as métricas de tickets e de resolução. Com isso você sabe quais grupos concentram os pedidos e quem está sobrecarregado, e pode ajustar a atribuição automática (rotativa entre quem está online) antes de incluir mais alguém.

## O que ainda não existe

Vale dizer com clareza. A conexão por QR usa a Evolution API (no nosso servidor, ou no seu próprio gateway WAHA ou Evolution API), e várias funções da caixa foram testadas contra um provedor simulado e ainda não com WhatsApp real. O status de cada função está na [lista pública de paridade](/pt/products/lines) do app. As linhas da API oficial (Cloud API) estão na mesma situação. E, como qualquer ferramenta que usa o WhatsApp por QR, depende de como o WhatsApp trata essa conexão. Avalie esse risco antes de colocar no centro do seu suporte um número que você não consegue substituir.

## O que a suíte acrescenta

Os tickets do Lines não vivem isolados. As tarefas criadas a partir de uma conversa são tarefas do CRM, com link de volta para a conversa, e os campos próprios de um ticket servem para filtros e para exportar em CSV. Se você já usa o CRM, o cliente do grupo e seus negócios estão a um clique. E, se você hospeda a zerosoft, as mensagens dos seus clientes ficam no seu banco de dados, não no de um fornecedor.

## Para começar hoje

1. Escolha um único grupo piloto, o mais barulhento.
2. Deixe 🎫 como emoji e a primeira resposta em 60 minutos.
3. Ative a marca de sem resposta, no modo por tempo.
4. Ative o email de SLA só para o responsável.
5. Depois de sete dias, veja quantos tickets estouraram e por quê. Só então mexa nos prazos ou ligue a IA.
