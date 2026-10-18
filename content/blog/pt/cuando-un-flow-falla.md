---
title: "Quando um flow falha: novas tentativas, ramos de erro e reexecução"
description: "Quais erros vale a pena tentar de novo, quando continuar e quando parar, como montar um flow de erro que te avisa e como reexecutar a partir do passo que falhou sem repetir os anteriores."
date: "2026-10-18"
author: "zerosoft"
tags: ["flow", "automação", "erros"]
---

Uma automação que nunca falhou é uma automação que ainda não rodou o suficiente. A API externa cai por dez minutos, alguém apaga o projeto do Track que um flow usava, um formulário chega sem email. A pergunta útil é o que acontece depois: se você fica sabendo, se resolve sozinho e se dá para terminar o trabalho sem repetir o que já deu certo.

O n8n resolveu parte disso com o [error workflow](https://docs.n8n.io/flow-logic/error-handling/): um fluxo separado, com um nó Error Trigger, que roda quando outro falha. É uma boa ideia e o Flow tem algo equivalente. Mas o flow de erro é a última linha de defesa. Antes dele vêm três decisões por nó que evitam a maioria dos alertas.

## Primeiro, separe os erros em dois tipos

**Transitórios.** O serviço não respondeu a tempo, a rede falhou, a API devolveu um 500 ou um 429 (pediu para você esperar). Tentando de novo daqui a pouco, provavelmente funciona.

**Permanentes.** Falta um dado, a credencial venceu, o email não é válido, a API devolveu um 400 ou um 404. Tentar dez vezes dá dez vezes o mesmo erro.

O Flow já faz essa separação. Uma nova tentativa só dispara com timeouts, erros de rede, respostas 5xx, 429 e limites da IA. Um 404 não é repetido mesmo que você configure cinco tentativas, porque não faz sentido.

## Decisão 1: quantas tentativas

Todo nó que fala com o mundo externo tem "Tentativas se falhar" em Avançado, de 0 a 5. A espera dobra a cada tentativa: 15 segundos, 30, 60, e assim por diante, até um teto de uma hora entre tentativas.

Um guia prático:

- **Requisição HTTP para uma API que você não controla:** 2 ou 3.
- **Slack, Sheets, Notion, Discord, Telegram:** vêm com 1 por padrão. Basta.
- **Qualquer coisa que não seja idempotente** (mais abaixo): 0, a não ser que você saiba que o serviço deduplica.

Um detalhe honesto: no zerosoft Cloud o agendador passa uma vez por hora, então cada tentativa é retomada na próxima passada, não em 15 segundos. Com self-host, segue a frequência do seu cron. Dentro de um Loop é diferente: nada é agendado, a tentativa acontece na hora, até 3 vezes com esperas curtas e um orçamento total de 30 segundos.

## Decisão 2: o que o nó faz se falhar mesmo assim

Depois das tentativas, cada nó tem a opção "Se este passo falhar" com três modos:

**Parar o flow.** É o padrão. A execução falha naquele nó. Use quando os passos seguintes dependem dele: se o contato não foi criado, não faz sentido inscrevê-lo numa sequência.

**Continuar.** O passo fica marcado com falha e o flow segue pela saída normal. A saída do nó traz `error` e `failed: true`, para que um passo posterior possa ler. Serve para o acessório: se o aviso no Discord falhar, a issue no Track tem que ser criada mesmo assim.

**Usar o ramo de erro.** O nó ganha uma saída Erro e você conecta ali o que deve acontecer. A mensagem fica em `{{nodes.<id>.output.error}}`. É o modo para um plano B: se a API principal falhar, mande os dados para uma planilha para lançar à mão depois.

Um exemplo com os três:

```
Webhook → CRM: criar contato            (Parar: sem contato não há o que fazer)
        → Requisição HTTP ao faturador  (Ramo de erro → linha no Google Sheets "pendentes")
        → Slack #vendas                 (Continuar: o aviso é o de menos)
```

## Decisão 3: um flow de erro para todo o resto

O que fica sem tratamento termina numa execução com falha. Para ficar sabendo sem abrir o histórico todo dia, configure um flow de erro. No editor, escolha outro flow do seu workspace em "Flow de erro". Quando uma execução falha, esse flow roda com estes dados:

- `{{trigger.flow.name}}`: qual flow falhou.
- `{{trigger.run.error}}`: o erro, com o id do nó na frente.
- `{{trigger.failedNode.id}}` e `{{trigger.failedNode.type}}`: onde.
- `{{trigger.trigger}}`: o que tinha disparado a execução original.

Um flow de erro mínimo tem um único nó de Slack:

```
Falhou "{{trigger.flow.name}}": {{trigger.run.error}}
Nó: {{trigger.failedNode.id}} ({{trigger.failedNode.type}})
```

Um mesmo flow de erro pode servir a todos os seus flows. As credenciais usadas na execução chegam ocultas, então não vão parar num canal do Slack. E um flow de erro que falha não dispara outro flow de erro, então não há cadeias infinitas.

## Reexecutar a partir do passo que falhou

Você recebeu o alerta, achou o problema (o projeto do Track que o nó usava não existe mais) e corrigiu no editor. Falta terminar a execução que parou no meio do caminho.

No histórico de execuções, abra a que falhou e clique em **Reexecutar daqui** no nó que falhou. O Flow cria uma execução nova que:

- reaproveita a saída de todos os passos anteriores, sem executá-los de novo;
- roda esse nó e tudo o que vem depois com a versão salva do flow, incluindo sua correção.

Assim o contato não é criado duas vezes e o email de boas-vindas não sai de novo. Funciona em execuções com falha e com sucesso. Dois limites: não dá para reexecutar a partir do gatilho, e os passos dentro de um Loop são reexecutados a partir do Loop inteiro.

Se a correção ficou pior que o problema, a aba Versões guarda uma versão cada vez que os nós mudam (até 50) e mostra quais nós foram adicionados, removidos ou editados. Restaurar uma versão salva a atual antes, por precaução.

## Idempotência: a pergunta antes de cada nova tentativa

Tentar de novo só é seguro se fazer a mesma coisa duas vezes dá o mesmo resultado. É assim que os nós do Flow se comportam:

- **CRM: criar contato** procura primeiro pelo email. Se já existe, devolve o existente e não cria outro.
- **Stripe** manda uma chave de idempotência por execução e por nó, então uma nova tentativa da mesma execução não cria dois clientes.
- **Requisição HTTP** depende da API do outro lado. Um `POST` que cria uma fatura, repetido depois de um timeout, pode criar duas. Se a API aceita um header de idempotência, mande com `{{run.id}}`. Se não, deixe as tentativas em 0 e use o ramo de erro.
- **Enviar email** não tem como saber se já enviou. Uma nova tentativa é outro email.

## Limites que vale conhecer

Para que um erro não vire outro maior, cada execução tem tetos: 200 passos (até 1.000 com Loops, que reservam o que precisam antes de começar), 100 itens por Loop e 1.000 execuções por hora por workspace. Um Loop que não cabe no teto falha antes de processar o primeiro item, em vez de parar no meio com efeitos parciais.

## Uma rotina de dez minutos por semana

1. Abra a lista de flows, veja o status da última execução de cada um e entre no histórico dos que falharam.
2. Para cada erro permanente, corrija o nó e reexecute a partir dali.
3. Para cada erro transitório que se repete, aumente as tentativas ou passe esse nó para ramo de erro.
4. Se o flow de erro te avisou mais de três vezes pela mesma coisa, esse aviso é uma correção pendente.

Se você ainda está escolhendo o que automatizar, comece por [cinco flows para uma equipe pequena](/blog/que-automatizar-primero).
