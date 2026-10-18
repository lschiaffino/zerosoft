---
title: "Como organizar suas notas: quatro cadernos, poucas etiquetas e uma busca que encontra"
description: "Um sistema de notas que se monta em uma tarde: quatro cadernos no estilo PARA, uma lista curta de etiquetas, notas fixadas para o dia a dia e busca em todo o texto. Com os passos no Notes e o que ainda falta nele."
date: "2026-10-18"
author: "zerosoft"
tags: ["notes", "evernote", "produtividade"]
---

Quase todo guia sobre organizar notas começa pela estrutura: cadernos, pilhas de cadernos, etiquetas aninhadas, convenções de nomes. O Evernote tem um guia inteiro sobre [como organizar notas](https://evernote.com/learn/how-to-organize-notes) e outro sobre o [método PARA](https://evernote.com/learn/what-is-the-para-method). São bons pontos de partida. O problema é que a estrutura vira o trabalho, e um mês depois ninguém sabe se a receita vai em "Casa" ou em "Recursos".

Este post propõe o contrário: o mínimo de estrutura possível, porque a busca faz a maior parte do trabalho. Quatro cadernos, uma lista curta de etiquetas e alguns hábitos. Mostramos como montar isso no Notes, o app de notas da zerosoft, e o que o Evernote faz que nós ainda não fazemos.

## A regra de partida: anote rápido, organize depois

Uma nota que você não escreveu porque "não sabia onde colocar" é a única nota perdida de verdade. Por isso o sistema tem uma regra só para a hora de anotar: escreva e pronto. Se não sabe onde vai, deixe solta. Organizar fica para a revisão semanal.

No Notes, aperte `N` em qualquer ponto da lista e abre uma nota nova. Aperte `/` e o cursor vai para a busca. Com esses dois atalhos, anotar custa quase nada.

## Quatro cadernos, no estilo PARA

O PARA, de Tiago Forte, divide tudo em Projetos, Áreas, Recursos e Arquivo. Usamos do jeito que é porque ele responde a uma pergunta só: isso tem data para acabar?

1. **Projetos.** Algo com fim: "Mudança do escritório", "Lançamento de outubro", "Viagem a Lisboa". Quando termina, as notas vão para o Arquivo.
2. **Áreas.** Responsabilidades que não acabam: finanças, saúde, o time, os clientes.
3. **Recursos.** Temas que interessam e você quer por perto: receitas, artigos salvos, referências de design.
4. **Arquivo.** Tudo o que não está mais ativo. Não se apaga: se guarda de lado.

Repare que os projetos não ganham cadernos próprios. Cada projeto é uma etiqueta dentro do caderno Projetos. Assim você não acaba com quarenta cadernos, e encerrar um projeto é mover as notas dele, uma a uma ou na revisão.

No Notes você cria os quatro pela barra lateral. Cada nota fica em um caderno (ou em nenhum). Se você apagar um caderno, as notas dele vão para a lixeira e podem ser restauradas de lá.

Um dado sobre o ponto de partida: o plano Free do Evernote permite [um caderno e 50 notas](https://evernote.com/compare-plans), então esse sistema já exige um plano pago por lá. No Notes não há limite de cadernos nem de notas por plano.

## Etiquetas: uma lista curta e fechada

Etiquetas servem para o que atravessa cadernos. Uma nota fiscal do fornecedor pode ficar em Áreas e levar a etiqueta do cliente. O erro clássico é criar uma etiqueta para cada assunto novo. Três meses depois são duzentas, metade com uma nota só.

Uma lista que cabe em um cartão:

- **Uma por projeto ativo**, com o mesmo nome em todo lugar: `mudanca`, `lancamento-out`.
- **Uma por pessoa ou cliente** com quem você trabalha sempre: `acme`, `lucia`.
- **Três de status**, no máximo: `pendente`, `referencia`, `ideia`.

O Notes coloca cada etiqueta em minúsculas e troca espaços por hífens, então `Lancamento Out` e `lancamento-out` viram a mesma etiqueta. A regra que fica com você: se uma etiqueta não está na lista, primeiro ela entra na lista. O Notes aceita até 20 etiquetas por nota, mas se uma nota precisa de mais de três, provavelmente são duas notas.

Para etiquetar, abra a nota e digite no campo de etiquetas: Enter ou vírgula adicionam uma, Backspace no campo vazio remove a última. A barra lateral mostra cada etiqueta com a quantidade de notas, e um clique filtra a lista.

## Fixadas: o que você abre todo dia

Existem cinco ou seis notas que você usa diariamente: a lista do mercado, o checklist de abertura da loja, a agenda da semana. Não procure por elas. Fixe. No Notes, as fixadas aparecem primeiro na lista e têm uma visão própria.

Se você fixou mais de dez, elas deixaram de ser especiais. Revise na revisão semanal.

## A busca faz o resto

É por isso que dá para ter tão pouca estrutura. A busca do Notes olha o título e todo o texto de cada nota. Se o seu banco suporta (SQLite e Turso com FTS5), ela funciona assim:

- **Busca por prefixo.** `orça` encontra "orçamento" e "orçamentos".
- **Exige todas as palavras.** `acme fatura` traz só as notas que têm as duas.
- **Ordena por relevância**, com o título pesando mais que o corpo.
- **Mostra um trecho** em volta da ocorrência, para você saber qual é antes de abrir.

Combine com os filtros: escolha o caderno Áreas, a etiqueta `acme` e digite `contrato`. Três cliques, uma nota.

Um hábito que vale mais que qualquer etiqueta: escreva o título que você vai buscar. "Reunião" ninguém encontra. "Acme: preços 2027, reunião com Lúcia" se encontra sozinha.

## Salvar da web sem copiar e colar

O Notes traz um clipper em forma de bookmarklet: você arrasta para a barra de favoritos e, de qualquer página, ele salva uma nota com o título da página, o link de origem e o texto que estava selecionado, em blocos de citação. A nota chega com a etiqueta `clip`, então na revisão semanal você filtra por ela e decide em qual caderno cada uma fica.

Uma diferença honesta em relação ao Web Clipper do Evernote: o nosso salva a sua seleção e o link. Ele não copia a página inteira nem as imagens. Para um artigo longo, selecione os parágrafos que importam; costuma render uma nota melhor que a página completa.

## Perguntar às suas notas

Quando você não lembra onde algo foi parar, a busca exige que você lembre uma palavra. "Pergunte às suas notas" aceita uma pergunta normal: "quanto cobramos da Acme no ano passado?". O Notes encontra as notas mais relevantes por palavra-chave, passa para um modelo com a instrução de responder só com elas e mostra quais notas usou. Se nenhuma fala do assunto, ele avisa.

Precisa da IA configurada na sua instalação. Na zerosoft Cloud, a cobrança é por tokens. Se você não ativar, a busca continua funcionando igual.

## A revisão semanal, em quinze minutos

1. Filtre por `clip` e pelas notas sem caderno. Mova ou apague.
2. Abra o caderno Projetos. Se um projeto terminou, mova as notas para o Arquivo.
3. Olhe as fixadas. Desafixe o que você não abre mais.
4. Revise a lista de etiquetas na barra lateral. As que têm uma nota só: apague ou junte à mão.
5. Esvazie a lixeira se precisar.

## O que o Notes ainda não faz

Para você decidir com tudo na mesa:

- **Não há importador do Evernote.** Hoje a migração é colando conteúdo ou usando o clipper.
- **Não há exportação de notas.** Se você hospeda a zerosoft, as notas ficam no seu próprio banco, mas ainda falta um botão para baixá-las.
- **Não há lembretes, pilhas de cadernos nem etiquetas aninhadas.** Os cadernos têm um nível só.
- **Não dá para anexar PDFs ou arquivos, e não há OCR** em imagens, um dos recursos mais úteis do Evernote.
- **As notas são pessoais.** Você compartilha uma com um link somente leitura, que pode cortar quando quiser, mas não há cadernos compartilhados para editar em equipe. Para isso existe o [Docs](/blog/wiki-interna-con-docs).

## O cartão para colar no monitor

- Anote com `N`, busque com `/`. Organize depois.
- Quatro cadernos: Projetos, Áreas, Recursos, Arquivo.
- Etiquetas: uma por projeto, uma por cliente, três de status. Minúsculas.
- Fixe o que é diário, nunca mais de dez.
- Títulos que dá para buscar.
- Quinze minutos por semana: clips, projetos encerrados, fixadas, etiquetas soltas.
