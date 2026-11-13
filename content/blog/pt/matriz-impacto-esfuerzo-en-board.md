---
title: "Matriz de impacto e esforço: como decidir o que fazer primeiro com seu time no Board"
description: "Uma matriz de prioridades no Board em 45 minutos: critérios escritos antes de posicionar qualquer coisa, modelo pronto, votação oculta e vitórias rápidas viradas em issues do Track."
date: "2026-11-13"
author: "zerosoft"
tags: ["board", "miro", "priorização"]
---

A Miro explica a [matriz de prioridades](https://miro.com/strategic-planning/what-is-a-priority-matrix/) como uma forma de ordenar iniciativas pelo valor e pelo custo de fazê-las, e oferece vários modelos para montá-la. A ideia é antiga e boa. O problema real de um time pequeno é outro: o backlog tem trinta itens, há tempo para quatro e cada pessoa defende os seus.

Este guia é para conduzir essa conversa no Board, o quadro branco da zerosoft. Há um modelo de matriz incluído, então a parte de desenhar já está resolvida. O que importa é como posicionar os cartões sem que vença quem fala mais alto.

## O que significa cada quadrante

O modelo **Matriz de prioridades** do Board desenha quatro quadrantes. Em cima ficam os itens de maior impacto e à esquerda os de menor esforço:

- **Vitórias rápidas** (muito impacto, pouco esforço): fazem-se primeiro.
- **Grandes apostas** (muito impacto, muito esforço): escolhem-se uma ou duas e planejam-se.
- **Preenchimento** (pouco impacto, pouco esforço): fazem-se quando sobra um tempo.
- **Poços sem fundo** (pouco impacto, muito esforço): descartam-se, e vale anotar o motivo.

Cada quadrante vem com um sticky de exemplo. Apague-os ou troque pelo primeiro item real.

## Passo 1: escreva o que significam impacto e esforço

Antes de posicionar um único cartão, o time combina duas escalas. Sem isso, "muito impacto" quer dizer coisas diferentes para vendas e para desenvolvimento. Escreva as definições numa caixa de texto ao lado da matriz. Um exemplo para um produto SaaS pequeno:

| | Baixo | Alto |
|---|---|---|
| Impacto | Menos de 5 clientes percebem | Move a métrica do trimestre (cadastros, retenção ou receita) |
| Esforço | Uma pessoa, até 2 dias | Mais de uma pessoa ou mais de 2 semanas |

Os números são exemplos: escolha os seus, mas que sejam números e não adjetivos. Se o time não chega a um acordo nesta tabela, você já aprendeu algo que a matriz não ia contar.

## Passo 2: carregue a lista sem debatê-la

Monte a lista de candidatos numa nota ou planilha, um item por linha. No Board abra **Stickies** e use **Colar uma lista**: cria um sticky por linha, até 100 por colagem. Palavras com `#` viram tags, até 8 por sticky. Uma linha como `Importar contatos de CSV #crm` vira um sticky com a tag `crm`.

Cada sticky aceita até 500 caracteres, mas escreva pouco: um verbo e um objeto. "Reescrever o onboarding" não serve. "Tirar a etapa de verificação de domínio do onboarding" dá para estimar.

Se o backlog já está numa planilha ou em outro quadro, o painel de Stickies também importa um CSV com uma coluna de texto, inclusive o que a Miro exporta.

## Passo 3: posicione em silêncio, com votos ocultos

O erro clássico é debater item por item enquanto alguém arrasta. Com dez itens, já se foi uma hora. Faça em duas rodadas.

**Rodada individual (10 minutos).** Ligue o modo privado do Board. Cada pessoa cria seus stickies direto no quadrante onde acha que cada um vai (a lista do passo 2 fica ao lado como referência, e cada um coloca um cartão por item). O que ela escreve nesse modo fica como rascunho próprio: os outros só veem que existem cartões, cobertos, e ninguém se deixa influenciar pelo item que o chefe já posicionou. Quando todos terminam, quem facilita revela e o servidor soma os rascunhos ao quadro de uma vez. Use o timer do **Workshop** para parar aos dez minutos.

**Rodada em grupo (20 minutos).** Com tudo revelado, olhe primeiro os stickies que muita gente colocou no mesmo lugar: ali não há o que discutir. Gaste o tempo nos que caíram em quadrantes diferentes. Essa diferença quase sempre é um dado que alguém tem e os outros não ("isso mexe na cobrança, são duas semanas, não dois dias").

Nesta rodada já há edição ao vivo com cursores, então várias pessoas podem mover cartões ao mesmo tempo. Mesmo assim, funciona melhor quando uma só pessoa conduz o quadro enquanto as outras conversam: a discussão rende mais quando todos olham um único cursor.

## Passo 4: desempate com pontos

Provavelmente sobrarão sete ou oito stickies em **Vitórias rápidas** e não há lugar para todos. No **Workshop**, abra uma **votação por pontos** e defina de 1 a 20 votos por pessoa. Uma regra razoável: metade dos itens do quadrante, com mínimo de três. Os votos ficam ocultos até você fechar a votação, e então aparecem os totais por sticky, do maior para o menor.

Para as Grandes apostas a votação é diferente: escolha só uma. Uma aposta grande por trimestre é o que um time de cinco pessoas consegue sustentar.

## Passo 5: da matriz ao trabalho

Uma matriz que fica no quadro é esquecida. Selecione os stickies vencedores, clique no botão **Track** da barra e escolha o projeto. O Board cria uma issue por sticky, com o texto do cartão e um link de volta ao quadro, e um sticky que já tem issue não é duplicado. Depois, o status e o responsável da issue aparecem sob o sticky: a matriz vira um mapa do que está andando.

Para os descartados, mude a cor para cinza e deixe uma linha com o motivo. Em três meses alguém vai propor o mesmo, e a resposta já estará escrita.

## Um modelo de pauta de 45 minutos

| Minutos | O que acontece |
|---|---|
| 0 a 5 | Leitura das definições de impacto e esforço |
| 5 a 15 | Posicionamento individual em modo privado |
| 15 a 20 | Revelação e olhada onde houve consenso |
| 20 a 35 | Debate só dos itens com posições diferentes |
| 35 a 40 | Votação por pontos em Vitórias rápidas |
| 40 a 45 | Issues no Track e data da próxima revisão |

Repita a matriz a cada trimestre: duplique o quadro, mova o que continua válido e apague o que foi feito.

## Dois avisos

Uma matriz de dois eixos comprime muito. Ela ignora risco, dependências e o fato de que algumas coisas são obrigatórias (a renovação de um certificado nunca vai ganhar por impacto). Se algo é obrigatório, tire da matriz e agende direto.

E estimativas são opiniões. Ao fim de cada trimestre, confira quantas vitórias rápidas acabaram custando mais que o previsto: essa porcentagem, medida no seu time, vale mais que qualquer modelo.

## Quanto custa

O Miro Starter custa [US$ 8 por membro por mês com cobrança anual](https://miro.com/pricing/), e o plano Free inclui [três quadros editáveis](https://miro.com/pricing/). Tem muito mais modelos de priorização que o Board e recursos de IA para resumir.

O Board custa $0 se você rodar no seu servidor, e a zerosoft Cloud não cobra por assento. Traz um único modelo de matriz, com as quatro zonas já desenhadas, o que basta para esta conversa do começo ao fim, com as issues do Track a um botão de distância.
