---
title: "Domínios próprios para seus links curtos: DNS, passo a passo"
description: "Como servir os links curtos do Link a partir de go.suaempresa.com: qual registro DNS criar, como a verificação funciona no zerosoft Cloud e no seu próprio servidor, e onde costuma travar."
date: "2026-07-21"
author: "zerosoft"
tags: ["link", "dns", "domínios"]
---

Um link curto no domínio dos outros é um pequeno ato de fé que você pede a cada leitor. `go.suaempresa.com/lancamento` diz quem mandou. Um domínio aleatório diz "clica e reza". O Link suporta domínios próprios de fábrica, e configurar um é um registro DNS e um botão. Este post mostra exatamente o que acontece, no zerosoft Cloud e no seu próprio servidor, incluindo as partes que costumam dar errado.

## Antes de começar

- **Use um subdomínio.** `go.`, `l.`, `links.`, o que preferir. Dá para usar um domínio raiz (`suaempresa.link`), mas subdomínios se dão melhor com os provedores de DNS, como você vai ver.
- **Tenha acesso ao DNS.** Cloudflare, Route 53, o painel do seu registrador: onde a zona estiver.
- **Seja admin do workspace.** Adicionar domínio é só para admins. Depois de verificado, ele aparece como opção para qualquer pessoa do workspace que criar um link.

## Passo 1: adicione o domínio

Vá às configurações do Link, abra **Domínios próprios**, digite `go.suaempresa.com` e clique em **Adicionar domínio**. Três coisas são checadas na hora:

- Tem que ser um hostname válido (sem path, sem porta).
- Não pode ser um host que já serve o app (mais sobre isso na parte de self-host).
- Não pode estar em uso por outra conta. Um domínio, um dono.

O domínio fica em **Aguardando DNS**, com uma tabelinha dizendo exatamente qual registro criar.

## Passo 2: crie o registro DNS

O que a tabela mostra depende de onde o Link roda.

### No zerosoft Cloud (e em qualquer deploy na Vercel)

Quando o servidor tem `VERCEL_TOKEN` e `VERCEL_PROJECT_ID` (mais `VERCEL_TEAM_ID` se o projeto estiver em um team), adicionar um domínio também o registra no projeto da Vercel pela API deles. O registro que você cria é:

```
# subdomínio (go.suaempresa.com)
CNAME   go   cname.vercel-dns.com

# domínio raiz (suaempresa.link)
A       @    76.76.21.21
```

A Vercel emite o certificado HTTPS sozinha quando o DNS resolve. Você não encosta em certificado nenhum.

### No seu próprio servidor

Deixe as variáveis `VERCEL_*` vazias. Aí a instrução é um CNAME apontando para o host do seu próprio app, o de `SHORT_DOMAIN`, ou `NEXTAUTH_URL` se aquela não estiver definida:

```
# digamos que sua instância do Link roda em links.exemplo.org
CNAME   go   links.exemplo.org
```

Para um domínio raiz a tabela mostra `CNAME @`, que muitos provedores não permitem. Duas saídas: usar o CNAME flattening / registro ALIAS do seu provedor, ou criar registros A (e AAAA) com os mesmos IPs do host do app. A verificação aceita os dois, como você vai ver.

**Aqui o HTTPS é com você.** Links curtos em domínios próprios são sempre gerados com `https://`, então o que estiver na frente do app (Caddy, nginx com certbot, um load balancer) precisa de um certificado para `go.suaempresa.com`. O Link roteia a requisição; ele não emite certificados.

## Passo 3: verifique

Mudanças de DNS levam de segundos a um bom tempo. Quando achar que o registro já propagou, clique em **Verificar**. Se ainda não estiver, aparece "O DNS ainda não aponta para cá": espere e tente de novo. A verificação tem rate limit por IP, então martelar o botão não ajuda.

O que "verificar" checa de verdade:

- **Modo Vercel:** pergunta à Vercel a configuração do domínio e passa quando a Vercel informa que ele não está mais mal configurado.
- **Modo self-host:** resolve o CNAME do seu domínio. Se aponta para o host do app, pronto. Se não, compara IPs: todos os endereços para os quais seu domínio resolve precisam estar entre os do host do app. Por isso registros A e CNAMEs "achatados" funcionam para domínios raiz.

Depois de verificado, o badge fica verde e o domínio aparece no seletor **Domínio** ao criar um link (e pela API, passando `"domain": "go.suaempresa.com"` para `POST /api/v1/links`).

## O que muda num domínio próprio

Esta é a parte que ninguém espera, para o bem.

**Não existem palavras reservadas.** No domínio padrão, um slug não pode ser `blog`, `docs`, `app`, `api`, `status`, `login` nem algumas dezenas de outras palavras reservadas, porque esses paths pertencem ao site. No seu domínio, todo `/<qualquer-coisa>` é um link curto. Então `go.suaempresa.com/blog` ou `go.suaempresa.com/app` são perfeitamente válidos. As únicas exceções são `en`, `es` e `pt` (é ali que ficam a página de senha e a de "link fora do ar") e o interno `__root`.

**Slugs são por domínio.** `zerosoft.ai/promo` e `go.suaempresa.com/promo` são links diferentes e podem apontar para lugares diferentes. O mesmo slug pode existir uma vez por domínio.

**A raiz pode redirecionar.** Por padrão, quem abre `go.suaempresa.com/` sem slug cai na home da zerosoft. Depois de verificar, configure um **Redirect da raiz** (sua home, por exemplo) e o domínio "pelado" vai para lá.

**O resto funciona igual.** Senhas, expiração, limite de cliques, QR codes (gerados com o seu domínio dentro), analytics e o webhook `link.clicked`, cujo payload inclui o domínio.

## APP_HOSTS: a pegadinha do self-host

O middleware precisa decidir, a cada requisição, se o host é "o app" ou "um domínio próprio de links". Num domínio próprio, todo path de um único segmento é tratado como slug, o que quebraria o dashboard se o host do app fosse classificado errado.

O app reconhece os próprios hosts a partir de `NEXTAUTH_URL`, `SHORT_DOMAIN`, das URLs da Vercel, `localhost` e de tudo que termina em `.vercel.app`. Se você serve o app a partir de hostnames **extras** (um nome interno, um segundo domínio público) liste-os:

```
APP_HOSTS=links.exemplo.org,links.interno.lan
```

Separados por vírgula, sem paths. Hosts dessa lista não podem ser adicionados como domínios próprios, e as requisições para eles se comportam como o app normal.

## Remover um domínio

Não dá para remover um domínio que ainda tem links. É de propósito: apagá-lo quebraria cada QR impresso e cada link que já está circulando. Mova ou apague esses links primeiro, depois remova o domínio. No modo Vercel, a remoção também o desvincula do projeto.

## Vindo de outro encurtador

Se seus links já vivem em `go.suaempresa.com` no Bitly, a ordem importa. A [importação do Bitly](/blog/migrar-de-bitly-a-link) mantém os back-halves num domínio próprio só se esse domínio **já estiver verificado** aqui, e verificar significa que o DNS já aponta para cá. Então: baixe o TTL do registro um dia antes, troque o DNS, verifique e rode a importação na hora. As URLs antigas continuam funcionando, com um intervalo de minutos em vez de um fim de semana quebrado.

## Checklist

1. Adicione `go.suaempresa.com` em Domínios próprios (admin).
2. Crie o registro da tabela: CNAME para `cname.vercel-dns.com` no Cloud, CNAME para o host do seu app no self-host.
3. Self-host: garanta que seu proxy tenha certificado para o host novo, e configure `APP_HOSTS` se servir o app a partir de hostnames extras.
4. Clique em **Verificar** até ficar verde.
5. Opcional: configure o redirect da raiz.
6. Crie links e escolha o domínio.

Um registro DNS, nenhum plano premium. Seu domínio sempre foi seu; agora seus links também.
