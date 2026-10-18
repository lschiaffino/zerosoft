---
title: "Notas de reunião que terminam em tarefas"
description: "Um formato de notas de reunião no Docs com decisões e ações que têm dono e data, uma tabela de acompanhamento entre reuniões, a passagem das ações grandes para o Track e uma página automática para cada reserva do Cal."
date: "2026-10-18"
author: "zerosoft"
tags: ["docs", "reuniões", "templates"]
---

O blog do Notion tem um post muito lido sobre [templates de notas de reunião](https://www.notion.com/blog/meeting-notes-template). Ele divide o trabalho em três momentos (antes, durante e depois), recomenda mandar uma pauta, escolher alguém para anotar e fechar com próximos passos com responsável.

Tudo isso está certo. O problema aparece uma semana depois: as notas existem, mas ninguém sabe se as ações foram feitas. É no acompanhamento que as notas de reunião falham. Este post propõe um formato curto no Docs em que cada ação tem dono e data, um jeito de revisá-las na reunião seguinte e um critério para levar ao Track o que é trabalho de verdade.

## O template de partida

O Docs traz um template **Notas de reunião** com três seções: Pauta, Notas e Ações (esta última com um to-do). Crie a página a partir do início do Docs com **Começar com um modelo** e acrescente o que falta. A nossa fica assim:

```
Data: 2026-10-20 · Participantes: @Ana, @Martín, @Lucía
Notas: @Martín

## Pauta
- Preço do plano anual (Ana, 10 min)
- Bug do CSV de contatos (Lucía, 5 min)

## Decisões
- O plano anual tem 2 meses de desconto. Decidiu: Ana.

## Notas
...

## Ações
[ ] @Lucía: Corrigir a exportação de CSV · vence 22/10
[ ] @Ana: Atualizar a página de preços · vence 24/10

## Pendente da reunião anterior
- [[Produto · 2026-10-13]]
```

Três mudanças em relação ao template incluído:

1. **Uma seção de Decisões separada das Notas.** Daqui a um mês ninguém vai reler as notas, mas alguém vai perguntar "quando decidimos isso, e quem?". Uma linha por decisão, com quem decidiu.
2. **Cada ação com @pessoa e data.** Ao digitar `@` e escolher um colega, o Docs manda uma notificação de que você o mencionou naquela página. É o aviso que substitui o "te mando as notas".
3. **Um link para a reunião anterior** com `[[`, que busca a página pelo título enquanto você digita. Por isso vale dar o mesmo formato de título a todas: `Produto · 2026-10-20`.

O Docs ainda não deixa salvar templates próprios. O contorno que usamos: uma página "Templates" com esta versão dentro, e **Duplicar** sempre que precisar. Duplicar copia a página com todas as subpáginas.

## Antes: a pauta na mesma página

Crie a página da reunião na véspera e escreva a pauta ali, com quem traz cada tema e quantos minutos ele leva. Quem quiser incluir um tema acrescenta na página. Se alguém quiser opinar sobre um item antes da reunião, pode deixar um **comentário naquele bloco**: o comentário fica grudado no item da pauta e é resolvido quando o tema é tratado.

Uma regra que economiza reuniões: se a pauta está vazia na noite anterior, a reunião é cancelada.

## Durante: notas de quem não está falando

Uma pessoa anota, e isso gira toda semana. Enquanto ela escreve, três atalhos ajudam a não perder o fio:

- `/` abre o menu de blocos: títulos, listas, to-dos, citações, código, tabelas.
- `[[` cria link para outra página: um spec, a página de um cliente, a reunião anterior.
- `@` menciona alguém.

O Docs salva sozinho assim que você para de digitar. Se duas pessoas editam a página ao mesmo tempo, o Docs avisa que outra pessoa editou enquanto você escrevia e deixa você ver a versão nova ou sobrescrever com as suas alterações. Edição em tempo real com vários cursores ainda não existe, então na reunião uma pessoa digita e o resto comenta.

## Depois: dez minutos para organizar

Assim que a reunião termina, quem anotou:

1. Transforma as notas soltas em tópicos curtos.
2. Confere se cada ação tem @pessoa e data. Ação sem dono não é ação.
3. Leva para Decisões o que foi decidido no meio de uma discussão.
4. Decide quais ações vão para o Track (veja abaixo).

Se for preciso mandar para fora, para um cliente por exemplo, o menu da página exporta para **Markdown** ou **PDF**. Para alguém do time, basta **Copiar link**.

## O acompanhamento: uma tabela de ações abertas

Este é o passo que quase todo template pula. As ações de cada reunião ficam na página de cada reunião, e ninguém abre cinco páginas para ver o que ficou pendente.

A solução no Docs é uma página fixa, "Ações abertas", com um **bloco de banco de dados** (`/database`): uma tabela com colunas tipadas. A nossa:

| Ação | Responsável | Vence | Status | Reunião |
|---|---|---|---|---|
| Corrigir a exportação de CSV | Lucía | 2026-10-22 | Aberta | Produto · 10-20 |
| Atualizar a página de preços | Ana | 2026-10-24 | Aberta | Produto · 10-20 |

Colunas: Ação (texto), Responsável (select com os nomes do time), Vence (data), Status (select: Aberta, Feita, Descartada), Reunião (texto).

O bloco de banco de dados ainda não filtra, ordena nem agrupa, e não tem relações com outras páginas. Para um time pequeno, dá conta: as linhas feitas são apagadas toda semana e a tabela fica curta.

A reunião seguinte começa com essa tabela, cinco minutos. Cada ação vencida tem três saídas: foi feita, ganha uma data nova ou é descartada em voz alta.

## O que vai para o Track e o que fica no Docs

Nem toda ação é igual. Uma regra simples:

- **Fica no Docs** se leva menos de um dia e não depende de mais ninguém: "mandar o contrato para X", "confirmar a data com o fornecedor".
- **Vai para o Track** se é trabalho de produto, tem subtarefas ou se outra pessoa vai precisar ver em que pé está. No Track ela ganha status, prioridade, ciclo e comentários, e aparece em **Minhas tarefas** da pessoa.

Quando uma ação vai para o Track, troque o texto nas notas pelo identificador do issue (`APP-57`). Hoje essa passagem é manual: você copia o título e cria o issue no Track. Docs e Track ainda não estão conectados por um bloco ou um link automático.

## Reuniões com clientes: uma página por reserva

Se você agenda reuniões pelo Cal, o Flow pode criar a página de notas sozinho. Monte um fluxo com o gatilho **Cal: reserva criada** e o passo **Docs: criar página**, com um título como:

```
{{trigger.eventType.title}} · {{trigger.invitee.name}}
```

e no conteúdo o e-mail do convidado e a data (`{{trigger.invitee.email}}`, `{{trigger.startsAt}}`). Linhas em branco separam parágrafos. O passo cria só parágrafos, então os títulos do template você coloca ao abrir a página. O Flow também traz o template "Nova reserva no Cal → tarefa no Track", que cria um issue para preparar cada reunião.

## O que o Docs não faz (ainda)

O Notion resume notas com IA e gera a lista de ações. O Docs não tem IA dentro do editor. Também não tem edição em tempo real nem um banco de dados com filtros. O que ele tem basta para cada reunião terminar com decisões escritas e ações com dono: template, menções, links entre páginas, comentários por bloco, histórico de versões e exportação. Roda no seu servidor por $0 ou no zerosoft Cloud, e se você quiser ver como isso se encaixa no resto da sua wiki, temos um [guia para montar uma wiki interna com o Docs](/blog/wiki-interna-con-docs).
