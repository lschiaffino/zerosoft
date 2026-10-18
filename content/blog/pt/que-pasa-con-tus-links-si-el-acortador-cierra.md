---
title: "O que acontece com seus links curtos se o encurtador fechar"
description: "O que o fim do goo.gl e do Firebase Dynamic Links deixou para trás, e um plano em quatro passos para seus links curtos sobreviverem a qualquer fornecedor: domínio próprio, exportação, reimportação e self-host."
date: "2026-10-18"
author: "zerosoft"
tags: ["link", "domínios", "migração", "open source"]
---

Em 2024 o Google [anunciou](https://developers.googleblog.com/en/google-url-shortener-links-will-no-longer-be-available/) que os links `goo.gl` deixariam de funcionar em 25 de agosto de 2025. Depois das reclamações, [voltou atrás em parte](https://ppc.land/google-changes-course-on-goo-gl-shutdown-preserves-actively-used-links/): manteve os links com atividade recente e desligou os que o próprio critério dele marcou como inativos, um critério que nunca foi publicado. No mesmo dia também acabou o [Firebase Dynamic Links](https://firebase.google.com/support/dynamic-links-faq), o produto que o Google tinha indicado como substituto.

Repare no que os donos desses links podiam fazer: nada. Um PDF de 2017, a descrição de um vídeo no YouTube, um folheto impresso. O destino continuava existindo, a página continuava no ar, e mesmo assim o link quebrou porque o domínio do meio era de outra empresa.

Este post é um plano para isso não acontecer com você, com qualquer encurtador. No fim contamos como o Link cumpre esse plano e que parte ainda não cumpre.

## O problema real: de quem é o domínio

Um link curto tem duas partes: o domínio (`goo.gl`, `bit.ly`, `go.suaempresa.com`) e o slug (`/promo`). Quem controla o DNS do domínio decide para onde vai cada visita. Se o domínio é do fornecedor, o link é do fornecedor, mesmo que você tenha criado e mesmo que pague todo mês.

Com um domínio próprio a situação se inverte. Se amanhã você trocar de ferramenta, aponta o DNS para a nova, carrega os mesmos slugs e `go.suaempresa.com/promo` continua funcionando. Quem tem o link impresso nem percebe.

## O plano em quatro passos

### 1. Todo link que vai durar fica no seu domínio

Use o domínio do fornecedor para o descartável: um link que você manda num chat hoje e ninguém vai abrir daqui a um ano. Todo o resto (impressos, QR codes, documentos, assinatura de email, descrição de vídeo, a bio do Instagram) vai num subdomínio seu, como `go.` ou `l.`.

No Link isso fica em **Domínios**: você adiciona o host, cria o registro DNS e o Link verifica. Cada domínio tem seus próprios slugs, então `go.suaempresa.com/promo` e `go.outramarca.com/promo` podem ir para lugares diferentes. O passo a passo de DNS está [neste post](/blog/dominios-propios-dns-paso-a-paso).

Um detalhe que costuma ficar de fora: a raiz. `go.suaempresa.com/` sem slug também recebe visitas (gente que apaga o final do link para "ver o que tem"). Em Domínios você define para onde vai esse redirect da raiz. Sem configuração, vai para a home do zerosoft.

### 2. Uma lista que você possa levar

Se o fornecedor fechar, você precisa de duas colunas por link: a URL curta e o destino. Sem isso, reconstruir centenas de links vira arqueologia.

O teste é simples: dá para baixar essa lista hoje, completa, num arquivo que uma planilha abre? No Link ela fica em **Configurações**, na seção **Exportar links**:

- **CSV de links:** `short_url, slug, domain, url, title, tags, clicks, archived, expires_at, max_clicks, created_at`. Uma linha por link, todos os links do workspace.
- **JSON com cliques:** os links mais cada clique com data, referrer, país, dispositivo, navegador e sistema operacional, até os 100.000 cliques mais recentes.

Baixe uma vez por mês e guarde junto com o resto dos seus backups. É um arquivo pequeno.

### 3. Um lugar para onde se mudar

A lista só serve se outra ferramenta conseguir ler. O importador do Link (em **Importar**) aceita o CSV do Bitly, a API do Bitly com um token, ou o CSV de qualquer encurtador: procura uma coluna de destino (`long`, `destination`, `original`, `target` ou `url`), uma de URL curta (`short`, `bitlink`, `link`) e, se houver, título e tags.

O que importa é que ele mantém o slug. Se a URL curta era de um domínio que você já verificou no Link, o link fica nesse domínio com o mesmo slug, então continua funcionando quando você muda o DNS. Se o slug já estiver em uso, o relatório mostra quais foram renomeados. O limite é de 2.000 links e 5 MB por envio; para mais, divida o arquivo.

O CSV que o Link exporta tem `short_url` e `url`, então o mesmo arquivo pode ser importado em outra instância do Link.

### 4. Um plano B que não dependa de ninguém

O último cenário é o mais desconfortável: e se quem fechar formos nós? É para isso que existe a licença. O código do Link é AGPLv3 e está no [GitHub](https://github.com/lschiaffino/zerosoft). Você pode rodar num VPS com Docker ([guia](/blog/self-hosting-con-docker-paso-a-paso)), importar seu CSV e apontar seu domínio. O resultado é o mesmo produto com o seu banco de dados.

## O que não viaja numa mudança

Melhor saber antes. O import cria links novos com destino, slug, título e tags. Isto fica para trás:

- **O histórico de cliques.** O JSON tem, mas o importador não carrega. Guarde como arquivo se precisar para relatórios.
- **Senhas, datas de validade e limites de cliques.** É preciso configurar de novo nos links que usavam. O CSV exportado traz `expires_at` e `max_clicks` para você saber quais são; as senhas não são exportadas.
- **Segmentação e tipo de redirect.** Destinos por país ou dispositivo, testes A/B e o 301 são configurados de novo.
- **Os links no domínio do fornecedor.** Um `bit.ly/xyz` continua sendo do Bitly. Você pode importar o destino e criar um link novo no seu domínio, mas o link antigo vai continuar apontando para onde o Bitly decidir.

## Um checklist de dez minutos

Faça com a ferramenta que você usa hoje, seja a nossa ou não:

1. Quantos dos seus links impressos ou em documentos usam o domínio do fornecedor? Esse é o seu risco.
2. Você tem um subdomínio próprio configurado? Se não, é o primeiro passo, e leva uma tarde.
3. Dá para exportar todos os links com URL curta e destino? Teste agora e abra o arquivo.
4. Existe pelo menos outra ferramenta que importe esse arquivo mantendo os slugs?
5. O QR code que você imprimiu aponta para o seu domínio? No Link, o QR codifica a URL curta do link (com `?qr=1` para contar os escaneamentos à parte), então se o link está no seu domínio, o QR também está.

Se a resposta for sim para as cinco, o fechamento de um fornecedor vira tarefa de uma tarde. O post sobre [como passar do Bitly para o Link](/blog/migrar-de-bitly-a-link) tem os detalhes do importador se você quiser começar por aí.
