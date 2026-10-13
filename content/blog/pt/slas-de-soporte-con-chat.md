---
title: "SLAs de suporte com o Chat: um playbook que cabe numa página"
description: "Como montar metas de tempo de resposta no Chat com políticas de SLA, regras de atribuição, horário de atendimento, prioridades, respostas prontas e CSAT, e como o relógio do SLA funciona de verdade."
date: "2026-08-11"
author: "zerosoft"
tags: ["chat", "suporte", "playbook"]
---

Um SLA é uma promessa com cronômetro. "Respondemos em até uma hora" fica lindo na página de preços e péssimo quando um cliente espera quatro. Configurar isso na ferramenta serve para o time inteiro enxergar, de relance, qual conversa está prestes a quebrar a promessa.

É assim que a gente montaria SLAs de suporte no Chat para um time pequeno: de duas a oito pessoas respondendo um widget de webchat. Vamos peça por peça, na ordem em que vale configurar, e vamos ser precisos sobre como o relógio funciona, porque é aí que a maioria dos SLAs mente para você.

## Como o relógio do SLA funciona

Leia isto primeiro. São três regras, tiradas do código.

1. **Políticas de SLA são por widget e por prioridade.** Cada widget pode ter uma política para cada uma das quatro prioridades: `low`, `medium`, `high`, `urgent`. Uma política tem uma meta de **primeira resposta** em minutos e uma meta opcional de **resolução** em minutos (de 1 minuto até 30 dias).
2. **Sem política, vale um padrão.** Se um widget não tem política para a prioridade de uma conversa, a primeira resposta fica em **60 minutos** e não há meta de resolução.
3. **O relógio começa quando a conversa é criada e corre em tempo de relógio.** A primeira resposta é marcada na primeira vez que um agente responde (mensagem ou anexo). A resolução é marcada quando a conversa vira resolvida. A resposta automática do bot **não** conta como primeira resposta: uma máquina mandando um texto pronto não é a promessa.

Duas consequências que vale saber logo:

- **O horário de atendimento não pausa o relógio.** Se alguém escreve às 23h e sua meta de primeira resposta é 60 minutos, à meia-noite essa conversa aparece como estourada. Mais abaixo a gente resolve isso.
- **O snooze também não pausa.** Adiar esconde uma conversa até o horário que você escolher (depois ela reabre sozinha), mas o SLA continua contando desde a criação.

No inbox, cada conversa aberta tem um selo: "Reply in 23m" enquanto está no prazo, "Breached" quando não está mais, e ele diz se o que estourou foi o SLA de primeira resposta ou o de resolução.

## Passo 1: defina metas por prioridade

Conversas novas começam em **medium**. Os agentes mudam a prioridade na tela da conversa. Na prática, medium é "tudo" e as outras três são exceções que um agente marca. Um ponto de partida razoável para um time pequeno, como exemplo hipotético:

| Prioridade | Primeira resposta | Resolução |
| --- | --- | --- |
| urgent | 15 min | 4 h |
| high | 30 min | 1 dia |
| medium | 2 h | nenhuma |
| low | 1 dia | nenhuma |

Depois configure em **Chat → seu widget → SLA**: uma linha por prioridade, minutos de primeira resposta, minutos de resolução (deixe vazio para não ter meta). Salvar uma política para uma prioridade substitui a anterior.

Seja honesto com esses números. Uma meta que você estoura todo dia ensina o time a ignorar o selo.

## Passo 2: horário de atendimento e um relógio justo

Nas configurações do widget, ative o **Horário de atendimento**: um fuso horário e um horário de início e fim para cada dia da semana. Fora desse horário, o widget mostra ao visitante um aviso de ausência com quando vocês voltam. Isso ajusta a expectativa do cliente.

Como o relógio do SLA não conhece horário de atendimento, você tem duas opções honestas:

- **Manter metas em tempo corrido e aceitar estouros noturnos.** Simples, e o estouro é um fato real: alguém esperou.
- **Dimensionar medium e low para cobrir a noite.** Se vocês ficam fechados 14 horas, uma meta de primeira resposta de, digamos, 16 horas para medium significa "na manhã seguinte" sem mentir. Deixe metas apertadas só para urgent e high, que um agente marca quando está de plantão.

Para a maioria dos times pequenos, a gente escolheria a segunda. Um cálculo de SLA que respeite horário comercial é algo que queremos adicionar; hoje não existe.

## Passo 3: regras de atribuição, para ninguém encarar uma fila sem dono

Conversas sem responsável são onde os SLAs morrem. Em **Chat → seu widget → Regras**, adicione regras que rodam em ordem, de cima para baixo. A primeira que bater atribui a conversa. São quatro tipos:

- **Palavra-chave**: a mensagem do visitante contém uma palavra, sem diferenciar maiúsculas. Exemplo: `reembolso` vai para quem cuida de cobrança.
- **Faixa de horário**: a hora atual cai numa janela como `09:00-13:00`. Útil para turnos. Atenção: usa o relógio do servidor, não o fuso do horário de atendimento do widget, então confira em que fuso seu servidor roda.
- **Round-robin**: atribui ao membro do time com menos conversas atribuídas naquele widget.
- **Catch-all**: sempre bate; coloque por último como rede de segurança.

As regras só mexem em conversas sem dono: nunca sobrescrevem uma atribuição manual. Uma pilha padrão sólida: algumas regras de palavra-chave para especialistas, depois round-robin, depois catch-all para um líder.

## Passo 4: respostas prontas para ganhar tempo na primeira resposta

A maioria das primeiras respostas é alguma versão de "recebido, estou olhando" ou uma resposta padrão para uma pergunta padrão. Cadastre essas em **Chat → seu widget → Respostas prontas**, cada uma com um atalho, um título e um corpo.

Na caixa de resposta, digite `/` seguido de parte do atalho ou do título (`/reembolso`, por exemplo) e escolha na lista. O texto entra no editor e dá para ajustar antes de enviar. Uma primeira resposta de verdade em dez segundos é a melhoria de SLA mais barata que existe.

Uma regra: respostas prontas confirmam o recebimento, não empurram com a barriga. Um "já te retornamos" enviado para parar o relógio e depois esquecido é pior que um estouro.

## Passo 5: o bot, com cuidado

O Chat tem um bot de resposta automática. Com IA configurada, ele responde usando suas respostas prontas e páginas do Docs enquanto nenhum humano entrou na conversa, e passa para o time com prioridade alta quando não sabe ou o visitante pede uma pessoa. Sem IA, ele compara as palavras do visitante com respostas prontas e páginas do Docs e responde uma única vez por conversa.

Serve para desviar perguntas do tipo "qual o horário de atendimento?". Como não conta como primeira resposta, não maquia seus números, que é exatamente como deveria ser.

## Passo 6: CSAT, a outra metade do SLA

Rápido e errado continua sendo errado. Quando uma conversa é resolvida, o widget pede ao visitante uma nota de 1 a 5, com comentário opcional. A nota aparece na conversa.

## Passo 7: leia os números toda semana

**Chat → Configurações** mostra, somando seus widgets: tempo médio de primeira resposta, porcentagem de conversas dentro do SLA de primeira resposta, tempo médio de resolução, número de conversas resolvidas e média de CSAT com número de respostas (sobre as 1.000 conversas mais recentes).

Uma revisão semanal de quinze minutos basta: se a porcentagem dentro do SLA cair, veja qual prioridade e quais horários. Se o CSAT cair enquanto os SLAs se mantêm, seu problema não é velocidade.

## O que ainda não existe

Para o playbook ser honesto: não há relógio de SLA que respeite horário comercial, não há escalonamento automático nem alerta por email quando um SLA está para estourar (o selo e o inbox são o alerta), não há agente de IA e não há exportação de conversas. Se sua operação de suporte depende disso, hoje um help desk maduro é a melhor escolha. Para um time pequeno que quer promessas claras e uma visão compartilhada de quem está atrasado, é suficiente: de graça se você hospedar, ou no zerosoft Cloud com um plano gratuito.
