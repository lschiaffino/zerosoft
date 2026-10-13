---
title: "Do Bitly para o Link: o que vem com você e o que fica para trás"
description: "Guia prático para importar seus links do Bitly para o Link via token de API ou CSV: o que é importado, o que não é, como os back-halves são mantidos e a ordem certa com domínio próprio."
date: "2026-08-20"
author: "zerosoft"
tags: ["link", "bitly", "migração"]
---

Trocar de encurtador vem com um medo bem específico: em algum lugar existem panfletos impressos, tweets antigos e PDFs com seus links curtos dentro. Quebrou, não tem segunda chance.

Por isso construímos a importação do Bitly no Link em torno de um objetivo: manter os back-halves. `go.suaempresa.com/promo-primavera` precisa continuar sendo `go.suaempresa.com/promo-primavera` depois da mudança. Veja como a importação funciona, exatamente o que ela traz, o que não traz, e a ordem de passos que evita links quebrados.

## Duas portas: token de API ou CSV

As duas ficam nas configurações do Link, em **Importar do Bitly**.

**Token de API.** No Bitly, vá em Settings → API e gere um access token. Cole no Link e clique em **Importar**. O Link usa o token uma única vez para ler seus links pela API do Bitly e não o armazena. Você pode (e deveria) revogá-lo no Bitly depois.

**Arquivo CSV.** Exporte seus links do Bitly (Links → Export) e envie o arquivo. O parser é tolerante: procura uma coluna cujo cabeçalho mencione `long`, `destination`, `original`, `target` ou seja simplesmente `url` para o destino; uma coluna `bitlink`, `short`, `link` ou `custom` para a URL curta; e `title` e `tags`, se existirem. As tags podem vir separadas por `|`, `;` ou `,`. Isso também significa que o CSV de quase qualquer outro encurtador funciona, desde que tenha uma coluna de destino. O limite do arquivo é 5 MB.

## O que é importado

De cada link:

- **A URL de destino.** Incluindo os parâmetros UTM que já estivessem nela.
- **O título.**
- **As tags**, até cinco por link (é o limite do Link; as excedentes são descartadas).
- **O back-half**, quando possível. Detalhes logo abaixo.

Pela API, a importação lê todos os bitlinks do **grupo padrão** da sua conta, ativos e arquivados. Se um link tem um back-half customizado no seu próprio domínio, é essa versão que entra, porque é a que as pessoas realmente têm.

## O que não é importado

Melhor saber antes de começar:

- **O histórico de cliques.** Suas analytics no Link começam do zero no dia da importação. Se você precisa dos números históricos, exporte-os do Bitly e guarde esse arquivo. Não inventamos dados passados.
- **Os domínios próprios.** O domínio em si é adicionado e verificado no Link separadamente (veja abaixo).
- **O status de arquivado.** Bitlinks arquivados entram como links ativos. Arquive-os de novo no Link se devem continuar mortos.
- **Outros grupos.** A via de API só lê o grupo padrão. Se você usa vários grupos no Bitly, exporte cada um em CSV.
- **Designs de QR, campanhas e tudo que é específico dos apps do Bitly.** O Link gera o próprio QR simples (SVG e PNG) para cada link, apontando para a mesma URL curta.

## Como os back-halves são mantidos

Esta é a parte que importa. Para cada link, a importação olha o host e o path da URL curta:

1. **Se o host é um domínio próprio que você já verificou no Link**, o link é criado nesse domínio com o mesmo back-half. `go.suaempresa.com/promo-primavera` fica exatamente assim.
2. **Caso contrário** (incluindo tudo que está em `bit.ly`), o link é criado no domínio padrão com o mesmo back-half, se estiver livre e for válido.
3. **Se o back-half estiver ocupado ou for inválido** (por exemplo, uma palavra reservada como `blog` no domínio padrão, ou mais de 32 caracteres), o Link gera um novo aleatório.

No fim você recebe um relatório: quantos links foram importados, quantos mantiveram o back-half, a lista completa dos que mudaram (antigo → novo) e os que foram pulados com o motivo, normalmente uma URL de destino inválida.

Uma verdade inevitável: **links em `bit.ly` vão continuar dependendo do Bitly.** A importação os recria como `zerosoft.ai/abc123`, mas ninguém consegue mover o DNS do `bit.ly`. O que você imprimiu com `bit.ly` continua funcionando enquanto o Bitly servir. Esse é o melhor argumento para usar seu próprio domínio, seja qual for o encurtador.

## A ordem certa com domínio próprio

Aqui está a armadilha: a importação mantém back-halves num domínio próprio só se esse domínio já estiver verificado no Link, e a verificação checa se o DNS aponta para o Link. Ou seja, seus links do Bitly nesse domínio param de resolver no Bitly no momento em que você troca o DNS.

Então faça nesta ordem:

1. **Exporte o CSV do Bitly** (ou deixe o token de API à mão). Antes de mexer no DNS.
2. **Um dia antes, baixe o TTL** do registro de `go.suaempresa.com` no seu provedor de DNS, para a mudança propagar rápido.
3. **Adicione o domínio no Link** e anote o registro pedido ([detalhes do DNS aqui](/blog/dominios-propios-dns-paso-a-paso)).
4. **Troque o registro DNS** e clique em **Verificar** até ficar verde.
5. **Rode a importação na hora.** Os links caem no seu domínio com seus back-halves.
6. **Teste na mão** algumas URLs antigas, incluindo as mais clicadas.

O intervalo entre os passos 4 e 5 é de minutos. Nesse meio-tempo, os visitantes veem uma página limpa de "Este link se foi" em vez de um erro, e depois tudo volta a funcionar.

## Contas grandes: o limite de 2.000

Cada execução da importação processa até 2.000 links. Se a origem tiver mais, o relatório avisa. Não rode a mesma importação por API de novo sem pensar: ela começa do início, os primeiros 2.000 back-halves já estão ocupados, e você acabaria com duplicatas com slugs aleatórios novos. Para contas grandes, use a via CSV e divida o arquivo em lotes de até 2.000 linhas, importando um de cada vez. As importações também têm rate limit (algumas por IP a cada poucos minutos), então vá com calma.

## Mais duas coisas para checar

- **Webhooks disparam na importação.** Cada link importado é um link novo, então se você configurou um webhook de `link.created`, ele dispara uma vez por link. Milhares de eventos de uma vez podem surpreender quem estiver escutando. Pause o webhook durante a importação se isso importar.
- **O time vê tudo.** As importações caem no seu workspace ativo, então todo mundo nele vê os links. Importe no workspace certo.

## Depois da mudança

Uma vez dentro, todo o kit do Link vale para seus links antigos: editar destinos sem mudar a URL curta, adicionar senha, expiração ou limite de cliques, baixar QR codes e acompanhar analytics sem cookies. Se você quer o panorama completo de como Link e Bitly se comparam além da importação, escrevemos [uma comparação honesta](/blog/zerosoft-link-vs-bitly), incluindo os casos em que vale mais a pena ficar onde está.

E se o Link não for para você, o [export](/blog/exportar-tus-datos-deberia-ser-un-derecho) também está a um clique: todos os links em CSV, ou JSON com cada clique. Entrar nunca deveria ser mais fácil que sair.
