---
title: "Como escrever um issue que alguém consiga terminar"
description: "Regras para títulos, descrições e tamanho de um issue, com três templates de texto para bugs, tarefas e investigações, e como usar sub-issues, relações e estimativas no Track."
date: "2026-10-18"
author: "zerosoft"
tags: ["track", "issues", "templates"]
---

O Linear Method tem um capítulo que vale a leitura: [escreva issues, não user stories](https://linear.app/method/write-issues-not-user-stories). O argumento é que o formato "como usuário, eu quero…" virou um ritual que esconde o trabalho, e que um issue precisa descrever uma tarefa concreta com um resultado claro.

Concordamos. Só que "uma tarefa concreta" é fácil de falar e difícil de escrever numa terça às seis da tarde. Este post transforma a ideia em regras verificáveis e em três templates para colar, pensados para um time pequeno, onde a mesma pessoa escreve o issue, faz e fecha.

## O teste de um issue bem escrito

Antes de salvar um issue, faça três perguntas:

1. **Dá para saber quando está pronto?** Se duas pessoas podem discutir se terminou, falta o critério.
2. **Cabe em dois ou três dias de trabalho?** Se não, são vários issues.
3. **Alguém que não estava na reunião consegue começar?** Se precisa de "pergunta para o Juan", falta contexto.

Um issue que passa nas três quase sempre é concluído. Um que falha em alguma fica semanas em Em andamento.

## Títulos: um verbo e um objeto

O título é lido em listas, no quadro e na caixa de entrada, muitas vezes sem abrir o issue. Ele precisa dizer o que vai ser feito.

| Antes | Depois |
|---|---|
| Login | Mostrar o erro de senha embaixo do campo |
| Bug na exportação | O CSV de contatos sai sem a coluna de e-mail |
| Melhorar onboarding | Pular a etapa de equipe se o usuário está sozinho |
| Ver pagamentos | Investigar se o Mercado Pago permite cobranças recorrentes |

Três regras:

- **Comece tarefas com um verbo** ("Adicionar", "Mover", "Remover"). Para bugs, descreva o sintoma como o usuário vê.
- **Nada de prefixos** como `[BUG]` ou `FRONT:`. Para isso existem as etiquetas. No Track elas são do workspace, valem para todos os projetos, e cada issue pode ter até 10.
- **Menos de dez palavras.** Se não cabe, provavelmente são dois issues.

## Descrições: o suficiente para começar

Uma boa descrição é curta. Tem o contexto que a pessoa precisa para começar e o critério para saber que terminou. O resto (a discussão de produto, as alternativas, o porquê estratégico) vai num documento à parte, com link.

No Track a descrição é texto simples, até 5.000 caracteres. E o Track ainda não tem templates de issue. Nosso contorno: guarde os três templates abaixo numa página do Docs chamada "Templates de issues" e copie quando precisar.

### Template 1: bug

```
O que acontece:
O CSV de contatos é baixado sem a coluna de e-mail.

Como reproduzir:
1. CRM > Contatos > Exportar
2. Abrir o arquivo

O que deveria acontecer:
A primeira coluna é o e-mail, como na visualização da tabela.

Onde:
Chrome 129, workspace de teste. Relatado por um cliente pelo Chat.

O que o cliente disse (literal):
"Exporto e os e-mails não aparecem, tenho que copiar na mão."
```

A última seção importa. Cole as palavras do cliente do jeito que vieram, sem resumir. Quando o issue chega pela triagem a partir do Chat ou do Flow, a descrição traz o que o agente ou o fluxo registrou; se faltar a mensagem literal do cliente, copie da conversa antes de aceitar o issue.

### Template 2: tarefa

```
Por quê:
Usuários sozinhos veem uma etapa "Convide seu time" que não se aplica.

O que fazer:
Se o workspace tem um só membro, pular a etapa 3 do onboarding.

Está pronto quando:
- Um usuário novo sem time vai da etapa 2 para a 4.
- Um usuário com time continua vendo a etapa 3.

Fora do escopo:
Redesenhar a etapa 3.
```

"Está pronto quando" é a seção que mais economiza tempo. "Fora do escopo" é a que impede uma tarefa de um dia de virar uma de uma semana.

### Template 3: investigação

```
Pergunta:
O Mercado Pago permite assinaturas com cobrança automática na Argentina e no México?

Para decidir:
Se colocamos assinaturas no checkout neste trimestre.

Entregável:
Um comentário neste issue com sim/não por país, link para a documentação e uma estimativa do trabalho.

Tempo máximo: 1 dia.
```

Investigações são issues legítimos, desde que tenham uma pergunta, um entregável e um limite de tempo. Sem limite, viram o issue mais antigo do quadro.

## Quem escreve o issue

Quem vai fazer o trabalho é quem melhor descreve, e escrever obriga a pensar. Num time pequeno, a regra prática é:

- **Se é seu, você escreve.**
- **Se você achou um bug de outra pessoa**, descreva o sintoma e atribua a ela. Quem vai corrigir escreve a solução.
- **Se um cliente pediu**, o issue entra com as palavras dele (pela triagem ou à mão) e o responsável transforma em tarefa.

## Tamanho: estimativas e sub-issues

O Track aceita estimativas em números inteiros, sem impor uma escala. Escolha uma e mantenha. Nós usamos 1, 2, 3 e 5, e 5 é o teto: o que passar disso é dividido.

Para dividir, use **sub-issues**. A partir de qualquer issue você cria um filho, que é um issue completo, com status, responsável e estimativa próprios. O pai fica como guarda-chuva e mostra os filhos. Uma regra útil: não estime o pai, estime os filhos.

Exemplo, `APP-40` "Assinaturas no checkout" (sem estimativa):

- `APP-41` Salvar a assinatura do Mercado Pago no pedido (3)
- `APP-42` Mostrar o status da cobrança no detalhe do pedido (2)
- `APP-43` Enviar o e-mail de cobrança recusada (2)

## Dependências: relações, não parágrafos

"Isso depende daquilo de pagamentos" escrito na descrição se perde. O Track tem três relações: **bloqueia**, **relacionado a** e **duplica**. Você adiciona pelo detalhe do issue digitando o identificador do outro, e elas aparecem nos dois lados: se `APP-41` bloqueia `APP-42`, o segundo mostra "bloqueado por". Na visualização **Cronograma** (Gantt) dá para ver se um issue bloqueado está programado antes daquele que o bloqueia.

## Do issue ao código

Se você usa a integração com o GitHub, o detalhe do issue tem **Copiar nome do branch**, que monta `app-41-salvar-a-assinatura-do-mercado-pago-no-pedido` a partir do identificador e do título. O título é cortado em 50 caracteres, mais um motivo para escrever curto: ele vira o nome do branch. Com `fixes APP-41` na descrição do PR, o merge pode mover o issue para Concluído, se você configurou assim.

## Checklist para colar na wiki

- [ ] O título começa com um verbo ou descreve um sintoma, em menos de dez palavras.
- [ ] A descrição diz quando está pronto.
- [ ] Cabe em dois ou três dias; se não, tem sub-issues.
- [ ] As palavras do cliente estão literais.
- [ ] As dependências estão como relações.
- [ ] Tem prioridade, responsável e, se existe uma data real, vencimento.

Se o seu time já usa o Docs, esta lista cabe na mesma página dos templates. Track e Docs rodam no seu servidor por $0 ou no zerosoft Cloud. Quando o Track tiver templates de issue próprios, a página do Docs vai sobrar, e vamos contar no changelog.
