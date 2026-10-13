---
title: "UTMs sem planilha: uma convenção para times pequenos"
description: "Uma convenção de UTMs simples para um time pequeno, e como aplicá-la no Link com o UTM builder, tags, criação em massa, export CSV por link e comparação de 7/30/90 dias."
date: "2026-09-03"
author: "zerosoft"
tags: ["link", "utm", "marketing"]
---

Todo time pequeno tem a mesma planilha. Ela se chama algo como `UTMs FINAL v3`, tem uma aba por trimestre, metade das linhas diz `Facebook` e a outra metade `facebook`, e a única pessoa que entende está de férias.

A planilha existe porque UTMs precisam de duas coisas que ninguém fiscaliza: uma convenção de nomes e um único lugar onde os links são criados. Este post traz uma convenção curta o bastante para caber na memória e mostra como aplicá-la dentro do Link, para que esse "único lugar" seja a ferramenta que você já usa para encurtar links.

## Primeiro: para que servem os UTMs (e para que não servem)

Parâmetros UTM são para **as analytics do seu site**: GA, Plausible, Matomo, qualquer coisa que leia `utm_source`, `utm_medium` e `utm_campaign` da URL de chegada e agrupe as visitas.

As analytics do Link não precisam de UTMs. Cada link curto já conta os cliques por dia, referrer, país, dispositivo, navegador e sistema operacional, [sem cookies](/blog/analytics-sin-cookies). Então você tem duas visões que se complementam: o Link diz quantas pessoas clicaram em cada link; as analytics do seu site dizem o que essas pessoas fizeram depois de chegar. Os UTMs são a cola entre as duas.

## A convenção: três campos, minúsculas, sem exceções

Esta convenção cabe num post-it. Adapte o vocabulário, mas mantenha as regras.

**`utm_source`: quem mandou o tráfego.** A plataforma ou propriedade específica: `newsletter`, `linkedin`, `instagram`, `youtube`, `parceiro-acme`.

**`utm_medium`: que tipo de canal.** Uma lista curta e fechada: `email`, `social`, `paid-social`, `cpc`, `referral`, `print`. Se você está prestes a inventar um medium novo, provavelmente queria um source novo.

**`utm_campaign`: o que você está promovendo, com data.** `2026-09-lancamento`, `2026-10-webinar-precos`. O prefixo de data ordena tudo e acaba com a pergunta "qual lançamento?".

E as regras:

1. **Tudo em minúsculas.** A maioria das ferramentas de analytics trata `LinkedIn` e `linkedin` como dois sources diferentes. O Link guarda exatamente o que você digita, então a disciplina é sua.
2. **Hífens, não espaços.** Espaços viram `%20` ou `+` e ninguém quer ler isso num relatório.
3. **Nada de texto livre.** Se um valor não está na lista, primeiro ele entra na lista. A lista vive no doc que seu time já lê, não numa planilha de links.

Precisa de `utm_content` ou `utm_term` para variantes de teste A/B? O builder do Link só tem campos para source, medium e campaign, mas nada impede você de escrever `?utm_content=variante-b` direto na URL de destino. O builder adiciona os três parâmetros dele por cima, sem mexer nos que já estavam lá.

## Criando um link com o builder

Em **Novo link**, cole o destino e abra o **UTM builder**. Preencha source, medium e campaign; a prévia da **URL final** mostra exatamente como o destino vai ficar. Depois:

- **Título:** algo que um humano consiga ler numa lista. "Lançamento set: post LinkedIn".
- **Tags:** o nome da campanha, por exemplo `2026-09-lancamento`. Até cinco tags por link, então dá para incluir o canal ou o responsável.
- **Slug customizado** se o link vai para algum lugar onde as pessoas vão digitá-lo, como um slide ou um podcast.

Os UTMs ficam incorporados ao destino quando o link é criado. Se precisar mudá-los depois, edite a URL de destino: o link curto continua o mesmo, o que importa se ele já está circulando.

## Em massa: uma campanha, muitos links

Lançamentos quase nunca precisam de um link só. Uma newsletter tem oito, um kit para parceiros tem vinte. A **Criação em massa** aceita até 200 URLs, uma por linha, e aplica uma **tag comum** e um **UTM comum** a todas.

Então, para a newsletter de setembro: cole os oito destinos, tag `2026-09-lancamento`, source `newsletter`, medium `email`, campaign `2026-09-lancamento`. Um clique, oito links com UTMs idênticos e bem escritos. Clique em **Baixar CSV** para ter `original_url,short_url,status` de cada linha, e cole os links curtos na sua ferramenta de email.

Duas coisas para saber sobre a criação em massa: os links saem com slug aleatório e sem título (adicione título depois nos que importam), e são criados no domínio padrão. Se você os quer no seu [domínio próprio](/blog/dominios-propios-dns-paso-a-paso), crie um a um ou pela API, que aceita um campo `domain`.

## Encontrando as coisas: tags são suas pastas de campanha

Na lista de links, clique num chip de tag para filtrar: todos os links de `2026-09-lancamento`, os mais novos primeiro, ou ordenados por **Mais clicados**. A busca casa slug, destino e título, então buscar `utm_source=linkedin` encontra todos os links do LinkedIn, porque os UTMs fazem parte do destino.

Essa é a recompensa da convenção: você nunca mais pergunta "cadê o link de X?". Você filtra.

## Lendo resultados: 7, 30, 90 dias e contra o período anterior

Abra qualquer link e escolha um intervalo: 7 dias, 30 dias ou 90 dias (ou todo o histórico). Ao lado do total do intervalo aparece a comparação com o **período anterior de mesmo tamanho**, com uma porcentagem para cima ou para baixo. "30 dias, ↑ 40% vs anterior" responde "esse link perene ainda funciona?" sem fazer conta.

Uma rotina de dez minutos por semana:

- Filtre pela tag da campanha atual, ordene por **Mais clicados**.
- Abra os três primeiros e os três últimos; veja a comparação de 7 dias.
- Cruze com as analytics do seu site usando o mesmo valor de campaign. Cliques no Link contra sessões no seu site mostram onde as pessoas se perdem entre o clique e a chegada.

## Quando você precisa mesmo dos dados brutos

Às vezes alguém quer números para um relatório. Dois exports resolvem:

- **CSV por link:** no log de cliques de um link, **Exportar CSV** baixa cada clique do intervalo escolhido (com filtro opcional por país) com `timestamp,country,referrer,device,browser,os`. Ótimo para "me mostra exatamente quando isso foi compartilhado".
- **Tudo:** o export de dados nas configurações baixa todos os links em CSV (com tags separadas por `|` e total de cliques) ou em JSON com cada clique. Esse é seu consolidado por campanha se o chefe insistir na tabela dinâmica.

Uma lacuna honesta: não existe um dashboard por campanha que some todos os links de uma tag para você. As analytics são por link, mais os totais e os top links da visão geral. Se você precisa do consolidado por tag, o export (ou `GET /api/v1/links/:id/stats` a partir de um script) resolve em poucas linhas.

## Tudo num cartão

- Source = plataforma, medium = lista fechada, campaign = `aaaa-mm-nome`. Minúsculas, hífens.
- Uma tag por campanha, igual ao valor de campaign.
- Muitos links? Criação em massa com tag e UTM comuns.
- Revisão semanal: filtrar por tag, ordenar por cliques, olhar a seta contra o período anterior.
- Exportar só quando um humano pedir uma planilha.

A planilha pode se aposentar. Ela mereceu.
