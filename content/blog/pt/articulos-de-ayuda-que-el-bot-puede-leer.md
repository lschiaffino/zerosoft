---
title: "Artigos de ajuda para dois leitores: seu cliente e seu bot"
description: "Como escrever artigos de central de ajuda que respondem nas primeiras linhas, são encontrados com as palavras do cliente e servem ao bot do Chat, com a central de ajuda que sai das páginas publicadas do Docs."
date: "2026-10-18"
author: "zerosoft"
tags: ["chat", "docs", "suporte", "central de ajuda"]
---

Um artigo de ajuda hoje tem dois leitores. Um é a pessoa que chegou frustrada pelo Google ou pelo widget. O outro é o bot, que lê o mesmo texto para responder no chat. Se o artigo serve só para um deles, você fez metade do trabalho.

A Intercom tem um post clássico com [sete passos para escrever conteúdo de ajuda melhor](https://www.intercom.com/blog/creating-better-help-content/): definir para que serve cada artigo, se colocar no lugar de quem chega com um problema, mostrar além de contar, pensar na busca e facilitar a leitura rápida. Tudo isso continua valendo. O que acrescentamos aqui é a parte mecânica: como o bot do Chat lê um artigo, quais partes do texto pesam mais e como isso muda o jeito de escrever.

## Como a central de ajuda é montada

No zerosoft a central de ajuda sai do Docs. Não existe um editor separado.

1. Você escreve uma página no Docs.
2. Em **Compartilhar**, ativa **Publicar na central de ajuda**. A página fica em `/h/<seu-handle>/<slug>`, legível para qualquer pessoa sem conta. O handle é o mesmo das suas páginas de agendamento do Cal; se você não tem um, o Docs pede para configurar.
3. Páginas publicadas cujo pai não está publicado viram coleções; as filhas publicadas são os artigos dessa coleção.
4. No widget do Chat, você ativa **Mostrar aba de ajuda**. O widget ganha uma aba com seus artigos e sugere artigos enquanto o visitante digita a pergunta.

Há um segundo interruptor no mesmo diálogo, dentro de Avançado: **A IA pode usá-la**. Serve para páginas que você quer que o bot conheça sem publicar, como uma política interna de reembolso. O bot lê as páginas publicadas e as que têm esse interruptor ligado. O resto do workspace fica de fora.

## Como o bot lê

Isto sai do código (`lib/chat-bot-ai.ts`, `lib/knowledge-search.ts` e `lib/chat-data.ts`). Na configuração do widget você escolhe de onde o bot responde. Os dois modos que leem o Docs funcionam assim.

**IA (Docs + respostas salvas)**, se você configurou uma chave do AI Gateway: cada página é dividida em trechos de uns 900 caracteres, respeitando as frases. A cada mensagem do visitante, uma busca BM25 escolhe os cinco trechos mais relevantes entre suas páginas e respostas salvas, com o título da página contando em dobro. O modelo tem instruções para responder só com esse material e, se não bastar, transferir para uma pessoa: a conversa sobe para prioridade alta e o time recebe um aviso.

**Páginas de docs**, ou o modo IA quando o modelo falha: o bot compara as palavras do visitante com o título e o texto de cada página (uma palavra no título vale 2 pontos, no corpo vale 1) e responde uma única vez com o título do artigo vencedor seguido dos primeiros 280 caracteres.

Quase todas as regras abaixo saem desses dois parágrafos.

## Seis regras para escrever

### 1. O título é a pergunta que o cliente digita

Ninguém digita "Faturamento" num chat. "Como troco o cartão de pagamento" sim. O título pesa o dobro no bot, na busca da central de ajuda e nas sugestões do widget. Use o verbo e o objeto que o cliente usaria.

### 2. A resposta vai nos primeiros 280 caracteres

É o que o bot manda no modo Páginas de docs, e é o que qualquer pessoa com pressa lê primeiro. Nada de "Neste artigo você vai aprender". Comece pela resposta e depois explique.

> Fraco: "O faturamento é uma parte importante da sua conta. Neste artigo vamos ver..."
> Melhor: "Para trocar o cartão, entre em Configurações, Faturamento, Forma de pagamento e clique em Substituir. A troca vale a partir da próxima cobrança."

### 3. Uma pergunta por artigo

Um artigo de 4.000 caracteres vira cinco trechos, e o bot recebe só os mais parecidos com a pergunta. Se você mistura trocar o cartão, pedir uma nota fiscal e cancelar a conta, cada trecho carrega ruído dos outros temas. Três artigos curtos rendem mais que um longo.

### 4. Cada seção se entende sozinha

Como o bot pode receber o terceiro trecho sem o primeiro, evite "como dissemos acima" ou "isso" apontando para algo de três parágrafos antes. Repita o substantivo: "a forma de pagamento", não "ela".

### 5. Escreva também o que não dá para fazer

O bot não responde o que não está escrito; ele transfere. Se um cliente pergunta "posso pagar por transferência?" e a resposta é não, escreva: "No momento aceitamos cartão de crédito e débito. Não aceitamos transferência bancária." Uma linha assim resolve a dúvida no chat e evita uma transferência para o time.

### 6. Passos numerados com os nomes exatos dos botões

Se o botão diz "Substituir", o artigo diz "Substituir", não "trocar" nem "atualizar". Bate com o que a pessoa vê na tela e com o que ela busca.

## Um modelo

```
Título: Como [verbo] [objeto] (com as palavras do cliente)

[A resposta em uma ou duas frases. Menos de 280 caracteres.]

## Passos
1. Entre em [menu exato].
2. Clique em [botão exato].
3. [O que você vai ver quando funcionar.]

## Se [a opção] não aparece
[A causa mais comum e o que fazer.]

## O que não dá para fazer
[Limites, em frases diretas.]

Outras formas de dizer: [sinônimos que seus clientes usam: nota fiscal, recibo, comprovante]
```

A última linha é para a busca. O modo Páginas de docs procura coincidências de palavras e o modo IA escolhe os trechos com uma busca léxica, então um sinônimo que não aparece no texto não existe para nenhum dos dois.

## Mantendo tudo vivo

Cada artigo publicado termina com "Este artigo ajudou?". A contagem de sim e não aparece no diálogo de Compartilhar da página. Um artigo com muitos "não" muitas vezes falha na regra 2: a resposta está lá, mas enterrada.

A outra fonte é a caixa de entrada. Toda vez que o bot transfere, ele deixa uma mensagem interna na conversa. Uma vez por semana, leia as transferências: se três pessoas perguntaram a mesma coisa e o bot não soube, ali está seu próximo artigo.

## O que ainda não faz

- Não há relatório de buscas sem resultado na central de ajuda.
- A central de ajuda não gerencia traduções: cada artigo fica no idioma em que você escreveu.
- O bot lê até as 200 páginas editadas mais recentemente (100 no modo Páginas de docs). Um workspace com mil páginas publicadas deixa as mais antigas de fora.

A central de ajuda e o bot vêm com o Docs e o Chat, por $0 no seu servidor ou no zerosoft Cloud.
