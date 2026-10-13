---
title: "Uma wiki interna com o Docs, passo a passo"
description: "Como montar com o Docs uma wiki da empresa que as pessoas usam de verdade: árvore de páginas, links com [[, templates, comentários e lixeira, e os limites que vale conhecer antes."
date: "2026-08-25"
author: "zerosoft"
tags: ["docs", "wiki", "playbook"]
---

Toda empresa tem uma wiki. A maioria é um cemitério: uma página de onboarding de três anos atrás, uma pasta "Processos (WIP)" e um link para um Google Doc que ninguém consegue abrir. O problema quase nunca é a ferramenta. É a estrutura.

Este é um guia passo a passo para montar uma wiki interna com o Docs que continue viva. O Docs te dá um conjunto bem pequeno de peças: páginas aninhadas, links com `[[`, templates, comentários, compartilhamento, lixeira, e a graça é justamente essa: menos peças, menos jeitos de fazer bagunça.

## Passo 0: um workspace para o time

Se você usa o Docs dentro de um workspace de time, todos os membros trabalham na mesma árvore de páginas. Essa é a sua wiki. Você não precisa de um "modo wiki"; precisa combinar o primeiro nível da árvore.

O que nos leva à decisão mais importante.

## Passo 1: desenhe o primeiro nível (e mantenha curto)

As páginas do Docs se aninham o quanto você quiser. Cada página pode ter subpáginas, e a barra lateral mostra a árvore inteira. Isso vira armadilha se você começa com quinze páginas no primeiro nível. Comece com cinco ou seis, no máximo:

- **Comece aqui**: o que a empresa faz, quem é quem, onde fica cada coisa.
- **Como trabalhamos**: processos, rituais, políticas.
- **Times**: uma subpágina por time, e cada time é dono da sua subárvore.
- **Clientes**: playbooks, perguntas frequentes, caminhos de escalonamento.
- **Decisões**: uma página por decisão, as mais novas primeiro.
- **Arquivo**: para onde vai o que é velho, em vez de ser apagado.

Crie uma página pela barra lateral com **Nova página**, e uma subpágina com a setinha ao lado de qualquer página da árvore. Reorganizar é arrastar e soltar: arraste uma página sobre outra para aninhá-la dentro, ou sobre a área de primeiro nível para trazê-la de volta. Mover uma página move toda a subárvore junto.

Dê um ícone a cada página de primeiro nível (tem seletor de emoji) e, se quiser, uma capa. Parece cosmético; é como as pessoas acham as coisas de relance na barra lateral.

## Passo 2: escreva páginas fáceis de escanear

O editor é por blocos: digite `/` para abrir o menu de comandos. Você tem parágrafos, três níveis de título, listas com marcadores e numeradas, to-dos, citações, blocos de código com linguagem, divisores, tabelas simples e um bloco de **banco de dados**: uma tabela pequena com colunas tipadas (texto, número, seleção, data) que também pode ser vista como galeria. A formatação inline cobre o de sempre: negrito, itálico, links e afins.

Para páginas de wiki, a regra é simples: primeiro títulos, depois texto corrido. Quem cai em "Política de despesas" quer a resposta em cinco segundos, não uma história. Uma tabela ou um bloco de banco de dados pequeno costuma render mais que três parágrafos: por exemplo, a lista de ferramentas com responsável e data de renovação.

## Passo 3: ligue tudo com `[[`

A diferença entre uma wiki e uma pasta de documentos são os links. Em qualquer página, digite `[[` e comece a escrever o título de uma página; o Docs busca por título enquanto você digita e insere um link para a que você escolher.

Use sem medo:

- Toda página de processo linka para a página do time dono.
- Toda página de decisão linka para as páginas que ela mudou.
- A página **Comece aqui** é quase só links com `[[`.

Precisa que alguém específico olhe algo? Digite `@` e escolha um colega. Ele recebe uma notificação de que foi mencionado naquela página.

A busca do Docs é por título: é ela que faz o `[[` funcionar. Ela não procura dentro do conteúdo das páginas. Mais um motivo para títulos descritivos: "Política de despesas" ganha de "Coisas de dinheiro v2".

## Passo 4: templates, prontos e caseiros

Quando você cria uma página na home do Docs, pode começar de um template: **Notas de reunião** (pauta, notas, ações), **Spec de projeto** (problema, objetivos, não-objetivos, plano, perguntas em aberto), **Retro semanal** ou uma página em branco.

Ainda não dá para salvar templates próprios, mas existe um bom workaround: crie uma página **Templates** no primeiro nível, coloque embaixo os formatos da casa (um "Postmortem de incidente", um "Registro de decisão", um "Checklist de admissão") e use **Duplicar** nas opções da página quando precisar de um. Duplicar copia a página e todas as subpáginas, então um template pode ser até uma pequena árvore: digamos, uma página de projeto com "Spec", "Checklist de lançamento" e "Retro" já aninhadas. Depois é só arrastar a cópia para o lugar certo.

## Passo 5: comentários em vez de conversas paralelas

Cada página tem um painel de comentários. Dá para comentar a página inteira ou um bloco específico, então o feedback fica ao lado do parágrafo a que se refere, e não num fio de chat que ninguém vai achar depois.

Resolva um comentário quando ele for atendido; dá para reabrir se não foi. Um bom hábito para os donos da wiki: uma vez por mês, abra suas páginas e limpe os comentários pendentes. Comentário aberto em página de wiki costuma significar que a página está errada.

## Passo 6: compartilhamento

Cada página tem um painel **Compartilhar** com três tipos: público, com um time ou com um usuário específico. Para uma wiki interna, o workspace do time já dá ao seu time a árvore completa, então a maioria das páginas não precisa de mais nada.

Duas observações honestas. Primeiro, o Docs não é um construtor de sites públicos: se o que você quer é uma central de ajuda para clientes com domínio próprio e SEO, isso é outra ferramenta. Segundo, a edição segue o workspace: não existe "somente leitura" por página para membros do mesmo time.

## Passo 7: a lixeira e o hábito do arquivo

Apague uma página e ela vai para a **Lixeira** na home do Docs, onde dá para restaurar ou excluir de vez. Excluir de vez também remove as subpáginas, e isso não tem volta.

Nossa recomendação: use a lixeira para erros e a página **Arquivo** para a história. Processos antigos são arrastados para baixo de Arquivo com uma linha no topo dizendo o que os substituiu e um link com `[[`. História é útil; confusão, não.

## Bônus: deixe sua wiki responder clientes

Se você também usa o Chat, o bot de resposta automática pode usar suas páginas do Docs como fonte. Ele busca as páginas mais relevantes para a pergunta do visitante (com IA, se estiver configurada, ou por palavras-chave), então funciona melhor com páginas curtas e bem tituladas. Ou seja, o que uma boa wiki já tem.

## Os limites que vale conhecer antes

O Docs não tem coedição em tempo real: se duas pessoas editam a mesma página ao mesmo tempo, vale o último salvamento. Pense em donos de página, não em multidões. Também não há busca de texto completo, nem exportação para JSON ou Markdown por enquanto, nem importação do Notion. Se o seu time vive numa página gigante editada por dez pessoas ao mesmo tempo, ou você precisa trazer anos de conteúdo do Notion, essas lacunas pesam.

Para um time que quer uma wiki organizada, conectada e sua, no seu próprio servidor (de graça se você hospedar, ou no zerosoft Cloud com um plano gratuito), as peças acima bastam. O resto é disciplina, e isso nenhuma ferramenta vende.
