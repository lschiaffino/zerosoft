---
title: "301 ou 302 num link curto: o que muda de verdade"
description: "O que significam os redirects 301, 302, 307 e 308, o que o Google faz com cada um, por que o cache do navegador pesa mais que o SEO num link curto e o que o Link faz quando você escolhe 301."
date: "2026-10-18"
author: "zerosoft"
tags: ["link", "seo", "redirects"]
---

No formulário de link novo, dentro das opções avançadas, existe um campo que quase ninguém mexe: **Tipo de redirect**, com dois valores, `301 Permanente` e `302 Temporário`. A pergunta de sempre é qual é melhor para SEO. A resposta curta para um link curto: quase nenhuma diferença nos buscadores e uma diferença grande no navegador das pessoas. Este post explica as duas coisas e mostra o que o Link faz com cada opção, lido direto do código do redirect.

## Os quatro códigos numa tabela

Um redirect é uma resposta HTTP que diz "o que você procura está em outra URL". A especificação ([RFC 9110, seção 15.4](https://www.rfc-editor.org/rfc/rfc9110#section-15.4)) define vários. Quatro importam:

| Código | Significado | Pode trocar POST por GET? |
|---|---|---|
| 301 | Movido permanentemente | Sim, por motivos históricos |
| 302 | Encontrado em outro lugar, por enquanto | Sim, por motivos históricos |
| 307 | Temporário, mantendo o método | Não |
| 308 | Permanente, mantendo o método | Não |

A coluna do método importa para formulários e APIs. Um link curto sempre é aberto com GET (alguém clica ou escaneia um QR), então na prática o 307 se comporta como 302 e o 308 como 301. Sobra uma pergunta: permanente ou temporário.

## O que o Google faz com cada um

A documentação do Google sobre [redirecionamentos e a Pesquisa](https://developers.google.com/search/docs/crawling-indexing/301-redirects) é direta. Com um redirect permanente, o Google mostra o destino nos resultados e trata isso como sinal forte de que o destino é a URL canônica. Com um temporário, pode continuar mostrando a URL de origem.

Para uma página que mudou de endereço (seu blog saiu de `/novidades/` para `/blog/`) isso importa muito. Você quer que a URL nova herde o lugar da antiga, e para isso vai um 301 no seu servidor web.

Para um link curto importa pouco. Ninguém quer `go.suaempresa.com/promo` no Google. O que é indexado é a sua página, que o Google encontra pelo seu site, pelo sitemap e pelos links que apontam para ela. O link curto vive num post do LinkedIn, num PDF ou impresso numa caixa.

## O que muda de fato: o cache do navegador

Um 301 sem instruções de cache é cacheável por padrão ([RFC 9111](https://www.rfc-editor.org/rfc/rfc9111#section-4.2.2)). Os navegadores aproveitam: na segunda vez que alguém abre o mesmo link curto, o navegador pode pular direto para o destino sem consultar o servidor.

Num site isso economiza uma ida e volta. Num encurtador quebra quase tudo que torna o encurtador útil:

- **O clique não é contado**, porque o pedido nunca chega.
- **Mudar o destino não vale** para quem já tem o redirect em cache. Você corrige um erro na URL e parte do público continua caindo na página quebrada.
- **Expirar ou arquivar o link também não vale.** O link com data de validade continua redirecionando naquele navegador.
- **Limite de cliques e senha** dependem de o servidor ver cada visita.

Por isso o conselho comum é "use 302 em links curtos". O conselho está certo, mas o motivo real é o cache, e quem decide o cache é um header, `Cache-Control`, mais do que o número do código.

## O que o Link faz

Abrimos o handler do redirect (`app/r/[slug]/route.ts`) para descrever exatamente:

1. **302 é o padrão.** A coluna `redirect_type` de cada link começa em 302.
2. **Toda resposta de redirect leva `Cache-Control: no-store`, inclusive a de 301.** O navegador não guarda o redirect, então cada visita passa de novo pelo servidor: o clique é contado e validade, limite, senha e destino atual são respeitados. Escolher 301 no Link não deixa links travados.
3. **Bots e geradores de prévia recebem sempre 302.** Googlebot, Bingbot, Slack, WhatsApp, LinkedIn e companhia são detectados pelo User-Agent. Não contam como clique e recebem 302 independentemente da sua escolha. Se o link tem título, descrição ou imagem de prévia próprios, recebem uma página com essas tags.
4. **Links com segmentação sempre usam 302.** Se um link manda para destinos diferentes por país, por dispositivo ou num teste A/B, um 301 diria "este é o destino permanente" quando o destino depende de quem pergunta.
5. **A raiz de um domínio próprio usa 302.** `go.suaempresa.com/` sem slug vai para a URL configurada em Domínios, com redirect temporário.

A consequência prática, dita com honestidade: no Link, escolher 301 muda só o código que os navegadores de pessoas veem. Os buscadores recebem 302 de qualquer jeito, e o cache fica desligado nos dois casos. Mantemos a opção porque algumas ferramentas e auditorias pedem um 301 explícito, e porque alguns times preferem para links que nunca vão mudar.

## Como conferir com seus próprios olhos

O `curl` conta como bot para o Link (está na lista de User-Agents que não são visitas), então isto devolve sempre 302 e não soma cliques:

```bash
curl -sI https://go.suaempresa.com/promo
```

Para ver o que um navegador recebe, mande um User-Agent de navegador. Desta vez conta um clique:

```bash
curl -sI -A "Mozilla/5.0" https://go.suaempresa.com/promo
```

Na resposta aparecem `HTTP/2 301` ou `302` conforme a sua escolha, `location:` com o destino e `cache-control: no-store`.

## Um guia para decidir

| Situação | O que usar |
|---|---|
| Link de campanha, newsletter, bio, QR impresso | 302 (o padrão do Link) |
| Link que pode mudar de destino ou expirar | 302 |
| Link com segmentação por país, dispositivo ou A/B | 302 (o Link força) |
| Uma política interna ou auditoria pede 301 | 301 no Link: não vai para o cache, então você não perde nada |
| Você mudou uma página ou um domínio e quer manter o ranking | 301 no seu servidor web, sem encurtador no meio |

O último caso é o que mais se confunde. Se você trocou `suaempresa.com/precos-2025` por `suaempresa.com/precos`, o redirect tem que morar onde a página mora. No nginx, por exemplo:

```nginx
location = /precos-2025 { return 301 /precos; }
```

Um encurtador no meio acrescenta um salto e mais um domínio na cadeia, que é justamente o que você quer evitar numa migração de SEO.

## Resumo

- Para buscadores, permanente contra temporário decide qual URL aparece. Num link curto isso quase nunca importa.
- Para pessoas, o que importa é se o navegador guarda o redirect. Um 301 em cache para de contar cliques e de respeitar mudanças.
- O Link manda `no-store` sempre, usa 302 por padrão e para bots, e força 302 em links segmentados. Se você escolhe 301, muda só o número.
- Mudanças de página se resolvem com um 301 no seu próprio servidor.

Para o resto do formulário avançado, o post sobre [senha, validade e limite de cliques](/blog/links-con-password-vencimiento-y-limite) explica quando usar cada opção.
