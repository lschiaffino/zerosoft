---
title: "Uma central de ajuda para seus clientes com o Docs"
description: "Como montar com o Docs uma central de ajuda pública: coleções, artigos que a busca encontra, o voto de Este artigo ajudou?, a aba Ajuda do widget do Chat e as respostas da IA. Com os limites à vista."
date: "2026-10-18"
author: "zerosoft"
tags: ["docs", "chat", "playbook"]
---

O Notion tem um guia para [montar uma central de ajuda no Notion](https://www.notion.com/help/guides/how-to-build-a-help-center-in-notion): você parte de um template, adiciona artigos como subpáginas, formata com callouts e publica a página na web. Funciona, e o resultado é uma página pública do Notion.

Só que uma central de ajuda precisa de mais do que páginas públicas. O cliente tem que achar a resposta antes de escrever para o suporte, o time precisa saber quais artigos não funcionam e a mesma informação tem que chegar ao chat. O Docs tem uma central de ajuda própria que faz essas três coisas, e este post mostra como montar.

## O que é a central de ajuda do Docs

Cada workspace tem uma central de ajuda em `zerosoft.ai/h/<seu-handle>`, ou no domínio da sua instalação se você hospeda. Lá aparecem só as páginas do Docs que você publicou. O resto continua interno.

O que ela traz:

- **Página inicial** com uma busca ("Como podemos ajudar?") e suas coleções com a quantidade de artigos.
- **Artigos** somente leitura, com o caminho da coleção, a data da última atualização, um índice "Nesta página" montado com os títulos do artigo e anterior e próximo dentro da coleção.
- **"Este artigo ajudou?"** no rodapé, com um voto por visitante e por artigo.
- **Metadados** para buscadores e redes: o título do artigo com o nome do workspace e o texto de abertura como descrição.
- A **cor do seu widget do Chat** como destaque, para a central de ajuda e o chat parecerem da mesma marca.

## Passo 0: o handle

A central de ajuda usa o mesmo handle das suas páginas de agendamento do Cal. Se você ainda não configurou, o painel Compartilhar avisa: "Configure seu handle no Calendário para ter central de ajuda." Escolha um curto e com o nome da empresa, porque ele vai estar em todos os links que você mandar para clientes.

## Passo 1: as coleções

O Docs monta a estrutura a partir da árvore de páginas, com uma regra: **uma página publicada cujo pai não está publicado é uma coleção**, e as páginas publicadas abaixo dela são os artigos.

Na prática, a árvore fica assim:

- **Central de ajuda** (não publicada: é só uma pasta interna)
  - **Primeiros passos** (publicada: coleção)
    - Criar sua conta
    - Convidar seu time
  - **Faturamento** (publicada: coleção)
    - Trocar a forma de pagamento
    - Baixar uma nota fiscal
  - **Problemas frequentes** (publicada: coleção)

Cinco ou seis coleções bastam para começar. A primeira linha de cada coleção vira a descrição dela na página inicial, então escreva uma frase dizendo o que tem dentro: "Como pagar, trocar de plano e pedir notas fiscais."

Os artigos aparecem na ordem da árvore, então crie na ordem em que você quer que sejam lidos.

## Passo 2: artigos que a busca encontra

A busca da central de ajuda olha o título e todo o texto de cada artigo publicado, e tolera variações de uma palavra: "reembolso" encontra "reembolsos" e "fatura" encontra "faturamento". Mesmo assim, vale ajudar:

- **Use a pergunta do cliente como título.** "Trocar a forma de pagamento" ganha de "Gestão de cobranças".
- **Responda antes do primeiro título.** O texto que vem antes do primeiro título é o resumo que aparece na busca, na coleção e no Google (cortado em 160 caracteres).
- **Use títulos dentro do artigo.** Com dois ou mais, o artigo mostra o índice "Nesta página".
- **Um artigo, uma tarefa.** Se um artigo responde três perguntas, são três artigos.

Um template que serve para quase tudo:

```
[A resposta em uma ou duas frases.]

## Passo a passo
1. ...
2. ...

## Se não funcionar
- Causa comum e como resolver.

## Relacionado
- Link público para outro artigo
```

O que o editor do Docs tem hoje: títulos, listas, to-dos, citações, blocos de código, tabelas e divisores. O que falta para uma central de ajuda: imagens no meio do texto, callouts e vídeos incorporados. Se um passo precisa de uma captura de tela, por enquanto descreva com as palavras exatas da interface ("clique em **Compartilhar**, depois em **Publicar na central de ajuda**").

## Passo 3: publicar

Abra a página, clique em **Compartilhar** e ative **Publicar na central de ajuda**. É ali também que você copia o link público. Cada página é publicada separadamente: publicar uma coleção não publica as filhas, então dá para manter rascunhos dentro de uma coleção pública.

O link de cada artigo é montado com o título na primeira vez que você publica e depois não muda, mesmo se você editar o título. Os links que você já mandou para clientes continuam funcionando.

## Passo 4: o chat usa a central

Aqui está a diferença para uma página pública solta. Se você usa o Chat:

- **Aba Ajuda do widget.** Nas configurações do widget, ative **Mostrar aba de ajuda**. O widget ganha uma aba com os artigos publicados e os sugere enquanto o visitante digita a pergunta. Se o artigo responde, a conversa nem é necessária.
- **Respostas do bot.** O bot de resposta automática e os agentes do Chat usam suas páginas publicadas para responder. Você também pode dar a eles páginas internas sem publicar: em Compartilhar, ative **A IA pode usá-la**. Serve para respostas que o time quer usar no chat sem mostrar na central de ajuda.

Com IA configurada, o modelo lê as páginas que encontra. Sem IA, o bot responde com um trecho da página que mais combina. Nos dois casos, os artigos curtos e bem titulados do passo 2 rendem respostas melhores.

Escrevemos à parte sobre [como montar SLAs de suporte com o Chat](/blog/slas-de-soporte-con-chat), e uma coisa complementa a outra: cada pergunta que a central de ajuda responde é uma conversa a menos na fila.

## Passo 5: manter viva

Uma central de ajuda envelhece rápido. Três hábitos:

1. **Olhe os votos.** No painel Compartilhar de cada artigo publicado você vê quantas pessoas acharam útil e quantas não. Um artigo com mais "não" do que "sim" é reescrito naquela semana.
2. **Escreva a partir do chat.** Quando a mesma pergunta chega três vezes pelo Chat, ela vira artigo. Use as palavras do cliente no título.
3. **Revise a cada mudança de produto.** O Docs guarda o histórico de versões de cada página (uma automática no máximo a cada 5 minutos enquanto você edita, mais as que você salva à mão, até 50), então dá para reescrever sem medo e voltar atrás se precisar.

## O que ainda não faz

Para você decidir com tudo à vista:

- **Domínio próprio.** No zerosoft Cloud a central de ajuda fica em `zerosoft.ai/h/`. Ainda não existe `ajuda.suaempresa.com`.
- **Imagens, callouts e vídeos** dentro dos artigos.
- **Vários idiomas** para o mesmo artigo. Dá para ter coleções separadas por idioma, mas sem seletor.
- **Análise de buscas**: você não vê o que os visitantes buscaram sem encontrar.

Se você precisa de um site de documentação com design próprio, um site publicado no Notion ou uma ferramenta dedicada de docs vai dar mais controle. Se o que você precisa é que seus clientes achem respostas e que o chat responda com a mesma informação, a central de ajuda do Docs já faz isso, no seu servidor por $0 ou no zerosoft Cloud.
