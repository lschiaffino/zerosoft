---
title: "Como montar sua página de link na bio com o Link (e o que ela ainda não faz)"
description: "Sua página /@handle em cinco minutos: título, bio, avatar, botões ordenados e cliques medidos pelos seus próprios links curtos. Mais a lista honesta do que ela não faz."
date: "2026-08-06"
author: "Zerosoftware"
tags: ["link", "link na bio", "guia"]
---

As redes sociais te dão um link. Um. Então a internet inteira combinou o mesmo remendo: uma paginazinha com uma lista de botões, hospedada por uma empresa que adoraria te cobrar todo mês por uma lista de botões.

O Link já vem com uma. Ela fica em `zerosoft.ai/@seuhandle`, é grátis, e cada botão passa por um dos seus links curtos, então os cliques caem nas mesmas analytics que você já usa. Veja como configurar em cinco minutos, e exatamente onde estão os limites dela.

## O que dá para personalizar

Primeiro vamos alinhar expectativas, porque ferramentas de link na bio adoram prometer demais. A página tem:

- **Um título.** Até 80 caracteres. Se ficar vazio, usa o nome da sua conta e, na falta dele, `@handle`.
- **Uma bio.** Até 300 caracteres de texto puro.
- **Um avatar.** Uma URL de imagem, e precisa ser `https`. Se ficar vazio, a página mostra a primeira letra do título.
- **Botões.** Qualquer um dos seus links, na ordem que você escolher, até 50.
- **Uma chave de publicação.** Páginas não publicadas retornam 404.

Essa é a lista completa. Não há temas, cores, fontes, imagens de fundo, fileiras de ícones sociais, vídeos incorporados nem CSS customizado. A página usa o mesmo estilo minimalista do resto da Zerosoft. Se você precisa de uma página cheia de identidade visual, uma ferramenta dedicada (ou uma página no seu próprio site) vai te atender melhor — e os botões dela ainda podem apontar para os seus links curtos.

## Passo 1: crie os links antes

A página bio não tem links próprios; ela mostra links que você já tem. Então comece no Link e crie um link curto por botão.

O detalhe importante: **o texto do botão é o título do link.** Se o link não tiver título, o botão mostra a URL de destino sem `https://`, o que fica desleixado. Dê um título humano para cada link que for aparecer: "Episódio novo", "Agende uma conversa", "Loja".

Como são links normais, todo o resto vale. Coloque um UTM no destino para as analytics do seu site saberem que a visita veio da bio. Use um [domínio próprio](/blog/dominios-propios-dns-paso-a-paso) se tiver. Marque com a tag `bio` para achar depois.

## Passo 2: preencha a página

Abra a aba **Página bio** no Link. Preencha título, bio e URL do avatar. O avatar não é enviado aqui: hospede a imagem em algum lugar (seu site, um CDN, a URL da sua foto de perfil atual) e cole o link `https`.

## Passo 3: escolha e ordene os botões

Abaixo dos campos do perfil aparecem seus links, cada um com um checkbox. Marque os que você quer na página. Os marcados sobem para o topo e ganham setas de subir/descer: essa ordem é a ordem na página. O editor lista seus 50 links ativos mais recentes, então se faltar um muito antigo, crie um link curto novo para aquele destino.

## Passo 4: publique

Marque **Publicada**, clique em **Salvar** e depois em **Ver página**. Pronto. Cole `zerosoft.ai/@seuhandle` no seu Instagram, TikTok, X ou onde for.

A página também monta o preview social a partir do seu perfil: título, a bio como descrição e o avatar como imagem. Assim ela fica apresentável quando alguém compartilha num chat.

## Seu handle

O handle é gerado a partir do seu email no cadastro. Você pode trocá-lo nas configurações do Cal, em **Seu handle**: de 3 a 32 letras minúsculas, números ou hífens. É o mesmo handle das suas [páginas de agendamento](/blog/calendly-y-el-impuesto-a-agendar) (`/book/<handle>/…`), então trocá-lo muda as duas coisas, e quebra qualquer link para o antigo que você já tenha compartilhado. Escolha uma vez, escolha bem.

## O que se esconde sozinho

A página é gerada a cada requisição, e pula os links que seriam um beco sem saída para o visitante:

- **Links com senha** nunca aparecem. Uma página bio é pública; um link com senha não foi feito para isso.
- **Links arquivados** somem.
- **Links expirados** somem no instante em que passa a data de expiração. Ótimo para ofertas limitadas: você define a expiração e o botão se remove sozinho.

Uma exceção que vale saber: um link que atingiu o **limite de cliques** continua aparecendo, mas leva à página de "Limite de cliques atingido". Se você usa limites para uma oferta do tipo "as primeiras 100 pessoas", desmarque-o da página quando lotar.

## Medição: o que você vê e o que não vê

Cada botão aponta para o link curto, não para o destino, então cada toque é um clique normal: dia, país, dispositivo, navegador e sistema operacional, sem cookies, como qualquer outro link ([aqui explicamos como funciona](/blog/analytics-sin-cookies)).

Duas ressalvas honestas:

- **Visualizações da página não são contadas.** Contamos cliques nos botões, não visitas à página. Você vai saber quantas pessoas tocaram em "Loja", não quantas abriram a página e foram embora.
- **O referrer desses cliques é a própria página bio.** As pessoas vieram do Instagram, mas clicaram a partir de `zerosoft.ai`. Então o referrer por botão não diz qual rede social as mandou.

Uma solução simples para a segunda: crie um link curto por plataforma apontando para sua página bio, como `zerosoft.ai/ig-bio` e `zerosoft.ai/tt-bio`, e use cada um no seu perfil. As analytics desses links dizem quantas pessoas chegaram de cada rede; os botões dizem o que elas fizeram depois.

## Alguns padrões que funcionam

- **Botão da temporada no topo.** Suba o lançamento do momento, deixe o conteúdo permanente embaixo. Reordenar são dois cliques.
- **Promoções que expiram sozinhas.** Crie o link da promoção com data de expiração e marque-o na página. Ele some sozinho.
- **Um link por destino, para sempre.** Se o destino mudar (loja nova, outro host para o podcast), edite a URL do link curto. O botão, a página e qualquer QR que você tenha impresso continuam funcionando.

## O que ainda não existe

Para deixar os limites claros: não há personalização visual além de título, bio e avatar; não dá para fazer upload do avatar; não há analytics de visitas à página; e a página vive só no domínio principal, não no seu domínio próprio. Se algum desses pontos for decisivo para você, conte para a gente — ou, como o código é aberto, mande um pull request.

Uma lista de botões não deveria custar uma assinatura. Agora não custa.
