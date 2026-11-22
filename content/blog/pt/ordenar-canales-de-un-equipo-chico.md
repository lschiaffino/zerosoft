---
title: "Como organizar os canais de uma equipe pequena: nomes, seções e arquivo"
description: "Uma convenção de nomes de uma página, quais canais criar primeiro, quando arquivar e como montar suas seções na barra lateral do Talk, o chat open source da zerosoft."
date: "2026-11-22"
author: "zerosoft"
tags: ["talk", "slack", "guia"]
---

Um workspace de chat com dez pessoas começa com três canais e, seis meses depois, tem quarenta. Ninguém sabe qual é o certo para perguntar sobre uma fatura, três canais têm quase o mesmo nome e o de "ideias" não recebe uma mensagem desde março. Quase sempre falta a mesma coisa: alguém que escreva como um canal é nomeado, quando é criado e quando é encerrado.

O Slack tem [um guia sobre como organizar canais](https://slack.com/blog/collaboration/how-to-use-slack-channels-to-organize-your-work) que recomenda, entre outras coisas, usar prefixos para que o propósito do canal apareça no nome. É um bom ponto de partida. Aqui vai a nossa versão para equipes de cinco a vinte pessoas, com o que o Talk faz em cada passo. O Talk é o chat da zerosoft: canais públicos e privados, threads, huddles, canvas e listas, com licença AGPL e a opção de rodar no seu próprio servidor.

## Antes de criar qualquer coisa: três perguntas

Sempre que alguém quiser criar um canal, que responda:

1. **Quem precisa ler?** Se a resposta é "todo mundo", provavelmente já existe (`general`).
2. **Quando termina?** Um projeto com data de fim é um canal com data de arquivo. Um tema permanente (vendas, suporte) não.
3. **Dá para dizer em uma frase para que serve?** Se não, ainda não é um canal, é uma conversa.

Só isso já reduz o número de canais pela metade.

## Uma convenção de nomes de uma página

O Talk normaliza os nomes na criação: minúsculas, espaços viram hifens, sem símbolos e até 80 caracteres. Também não deixa repetir um nome no workspace, entre canais públicos e privados. Isso ajuda, mas o prefixo é você quem escolhe. Sugerimos quatro:

| Prefixo | Para quê | Exemplo |
|---|---|---|
| `eq-` | Uma equipe ou função | `eq-vendas`, `eq-suporte` |
| `proj-` | Um projeto com data de fim | `proj-redesign-site`, `proj-lancamento-q1` |
| `cli-` | Um cliente ou conta | `cli-padaria-lopes` |
| `ajuda-` | Pedir ajuda sobre um tema | `ajuda-faturamento`, `ajuda-infra` |

Mais dois canais sem prefixo: `general` (o Talk cria sozinho em cada workspace) e `avisos` para o que todos precisam ler. Se quiser um social, use `social-`.

Duas regras que evitam discussões: o separador é sempre o hífen, e o nome fica no singular e sem datas. `proj-lancamento` envelhece melhor que `proj-lancamento-nov-2026`.

Escreva a convenção em um documento curto e deixe à mão. Se você usa o zerosoft Docs, uma página no workspace basta. Coloque também como favorito do canal `general` (mais abaixo).

## O que escrever no tema e na descrição

Ao criar um canal no Talk, você pode preencher um **tema** (até 250 caracteres) e uma **descrição** (até 1000). Use de formas diferentes:

- **Tema:** uma linha que diz para que serve o canal e o que não entra ali. Exemplo: `Pedidos de suporte de clientes. Bugs são reportados no Track.`
- **Descrição:** quem acompanha, em que horário se responde, links para o que importa.

Dá para mudar o tema a qualquer momento com o comando `/topic` no próprio canal. A busca do diretório de canais olha o nome, o tema e a descrição, então um bom tema também ajuda as pessoas a encontrar o canal sem perguntar.

## Favoritos e mensagens fixadas

Cada canal tem uma barra de favoritos abaixo do cabeçalho. Qualquer membro adiciona, edita ou apaga links (até 50 por canal, só http e https). Usos que funcionam:

- Em `eq-vendas`: o pipeline do CRM, o modelo de proposta, a lista de preços.
- Em `proj-*`: o briefing, o quadro no Board, a pasta de entregas.
- Em `general`: a convenção de nomes e o calendário da equipe.

As **mensagens fixadas** são para decisões, não para conversa: "Escolhemos o fornecedor X, motivo neste thread." O Talk mostra até 100 fixadas por canal, mas um canal com mais de cinco já não está fixando nada.

## Seções próprias na barra lateral

Mesmo com uma boa convenção, cada pessoa olha de um jeito. No Talk cada um monta suas **seções**: cria, renomeia, reordena e move canais e mensagens diretas para dentro pelo menu de cada item. São até 30 por pessoa, e cada seção pode ser ordenada de A a Z ou por atividade recente. Ninguém mais vê as suas seções.

Uma configuração que serve para quase todo mundo:

1. **Favoritos:** os três ou quatro canais que você abre todo dia.
2. **Clientes:** todos os `cli-*`, por atividade.
3. **Projetos:** todos os `proj-*`, de A a Z.
4. **Silêncio:** `social-*` e o que você confere uma vez por dia.

Como as seções são pessoais, a bagunça de um não suja a vista dos outros.

## Quando arquivar

Arquivar é o passo que mais se pula. Uma regra simples: **um canal `proj-*` é arquivado na semana em que o projeto termina**, e um canal sem mensagens há 60 dias vira pergunta em `general` para saber se alguém ainda precisa dele.

No Talk, arquivar não apaga nada: o canal deixa de aceitar mensagens, sai da barra lateral e pode ser restaurado. Os arquivados aparecem no diretório de canais com o filtro de arquivados, então o histórico continua disponível para busca. Quem criou o canal, um admin do canal ou um admin do workspace pode arquivar, renomear, tornar privado ou apagar.

Uma coisa que ainda não fazemos: converter uma mensagem direta em grupo em canal privado. Se uma conversa de quatro pessoas virar permanente, hoje é preciso criar o canal e avisar.

## Uma revisão de 15 minutos por trimestre

Coloquem na agenda a cada três meses:

1. Abra o diretório de canais e ordene por nome. Encontre nomes que fogem da convenção e renomeie.
2. Liste os candidatos a arquivo. Pergunte em `general` com prazo de uma semana.
3. Confira que cada canal ativo tem tema.
4. Apague os favoritos quebrados.

## O que muda quando o chat faz parte de uma suíte

Num chat isolado, o canal de um cliente e o quadro desse cliente são dois mundos. Na zerosoft, os canais convivem com CRM, Track, Board e Docs no mesmo workspace, com as mesmas pessoas e permissões. Um favorito em `cli-padaria-lopes` pode apontar direto para o deal do CRM, e o issue do Track de um pedido fica a um clique do canal onde se conversou.

E como não cobramos por assento, incluir a contadora externa ou um freelancer como convidado em um único canal não muda a conta. Você pode testar no zerosoft Cloud ou rodar o Talk no seu servidor: o core é AGPLv3 com todas as funções, e suas conversas ficam no seu banco de dados.

## Resumo para colar em `general`

```
Canais: eq-, proj-, cli-, ajuda-, social-
Separador: hífen. Singular. Sem datas.
Todo canal tem tema (o que é e o que não é).
Projetos são arquivados na semana em que terminam.
Revisamos o diretório a cada trimestre.
Dúvida? Pergunte em #general antes de criar.
```
