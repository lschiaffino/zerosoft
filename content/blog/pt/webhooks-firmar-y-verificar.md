---
title: "Webhooks do Zerosoft: o que é assinado, como verificar e o que acontece quando falham"
description: "Cinco eventos, uma assinatura HMAC-SHA256 num header estilo Stripe, novas tentativas com backoff por cerca de 15 horas e uma proteção contra SSRF. Mais um verificador em Node para colar."
date: "2026-08-27"
author: "Zerosoftware"
tags: ["webhooks", "desenvolvedores", "segurança"]
---

Consultar uma API para descobrir se algo aconteceu é como atualizar a caixa de entrada a cada dez segundos. Webhooks invertem a lógica: o Zerosoft chama você. Este post mostra exatamente o que enviamos, como provar que fomos nós e o que acontece quando o seu endpoint está fora do ar — tudo tirado direto de `lib/webhooks.ts` e `lib/safe-fetch.ts`.

## Os eventos

São cinco, e só cinco:

- `booking.created` — alguém agendou pelo Cal.
- `booking.rescheduled` — um agendamento mudou de horário.
- `booking.cancelled` — um agendamento foi cancelado.
- `link.created` — um link curto foi criado (pelo dashboard, pela API ou por uma importação).
- `link.clicked` — alguém clicou num link curto.

Existe também o `ping`, que é o que o botão "Enviar teste" do painel entrega. Seu handler deve aceitá-lo e não fazer nada.

O que não está aqui: eventos do CRM. Contatos, deals e tarefas ainda não emitem esses webhooks. O mais próximo hoje é um workflow do CRM com uma ação de request HTTP — ele dispara com gatilhos como `deal_won` ou `contact_created` e passa pela mesma proteção contra SSRF descrita abaixo, mas não é assinado e não tem novas tentativas. Ou consultar a [API v1](/blog/api-rest-v1-con-claves-personales) periodicamente.

Um aviso sobre `link.clicked`: ele dispara a cada clique. Um link que viraliza vai mandar muitos POSTs para você. O redirect em si nunca espera o seu endpoint — o webhook sai depois da resposta —, mas o seu servidor vai sentir. O payload do clique traz referrer, país, dispositivo, navegador e sistema operacional. Sem endereço IP.

## Como criar um

Webhooks ficam em Dashboard → Settings → Webhooks, e só admins do workspace podem gerenciá-los. Escolha uma URL e os eventos que interessam. Na criação você recebe um secret no formato `whsec_…`, mostrado uma única vez. Nós o guardamos criptografado (AES-256-GCM com a `ENCRYPTION_KEY` da instância), então conseguimos assinar com ele, mas ninguém consegue lê-lo de volta pelo dashboard.

## Como é uma entrega

Cada entrega é um `POST` com body JSON:

```json
{
  "id": "4d1c…",
  "type": "booking.created",
  "createdAt": "2026-11-01T18:00:00.000Z",
  "data": { "id": "…", "status": "confirmed", "startsAt": "…", "invitee": { "name": "Ana", "email": "ana@example.com" }, "eventType": { "slug": "intro", "title": "Intro call" } }
}
```

E estes headers:

```
Content-Type: application/json
User-Agent: Zerosoft-Webhooks/1
Zerosoft-Event: booking.created
Zerosoft-Delivery: <delivery id>
Zerosoft-Signature: t=1793556000,v1=5f2a…
```

`Zerosoft-Delivery` é único por endpoint e continua igual entre as novas tentativas. Use-o como chave de idempotência.

## Como a assinatura funciona

É o padrão do Stripe, de propósito — muita gente já conhece:

```
v1 = hex( HMAC-SHA256( secret, "<t>.<raw body>" ) )
```

`t` é um timestamp Unix em segundos, gerado no momento de cada tentativa. Como ele entra no que é assinado, quem capturar uma request não consegue reenviá-la depois sem que a assinatura fique velha.

Duas armadilhas em que todo mundo cai:

1. **Assine o body cru.** Se o seu framework faz o parse do JSON e você o serializa de novo, a ordem das chaves ou os espaços podem mudar e o HMAC não vai bater. Pegue os bytes exatamente como chegaram.
2. **A chave é o secret inteiro,** com o prefixo `whsec_`. Não remova, não decodifique de base64.

## Um verificador em Node

Um handler completo de Express. Sem dependências além do Express:

```js
import crypto from 'node:crypto';
import express from 'express';

const SECRET = process.env.ZEROSOFT_WEBHOOK_SECRET; // whsec_…
const TOLERANCE_SEC = 300;

function verify(rawBody, header, secret) {
  const parts = Object.fromEntries((header ?? '').split(',').map((p) => p.split('=', 2)));
  const t = Number(parts.t);
  if (!t || !parts.v1) return false;
  // Rejeitar timestamps velhos (ou futuros): bloqueia replays.
  if (Math.abs(Date.now() / 1000 - t) > TOLERANCE_SEC) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  const received = Buffer.from(parts.v1, 'hex');
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

const app = express();
const seen = new Set(); // na vida real, use o seu banco de dados

app.post('/webhooks/zerosoft', express.raw({ type: 'application/json' }), (req, res) => {
  const raw = req.body.toString('utf8');
  if (!verify(raw, req.get('zerosoft-signature'), SECRET)) return res.sendStatus(400);

  const delivery = req.get('zerosoft-delivery');
  if (seen.has(delivery)) return res.sendStatus(200); // nova tentativa de algo já processado
  seen.add(delivery);

  const event = JSON.parse(raw);
  res.sendStatus(200); // responder rápido, trabalhar depois
  handle(event).catch(console.error);
});

async function handle(event) {
  if (event.type === 'ping') return;
  // booking.created, link.clicked, …
}

app.listen(8080);
```

`timingSafeEqual` importa: um `===` comum entre strings pode vazar, pelo tempo de resposta, quantos caracteres iniciais coincidiram.

## Timeouts, falhas e novas tentativas

Cada tentativa tem **timeout de 8 segundos**. Qualquer coisa que não seja 2xx conta como falha — inclusive redirects, porque não os seguimos. Se o seu endpoint mudou de lugar, atualize a URL em vez de redirecionar.

A primeira tentativa acontece assim que o evento ocorre. Se falhar, a entrega é reagendada com backoff: **1 minuto, 5 minutos, 30 minutos, 2 horas, 12 horas**. Depois dessa sexta tentativa, ela é marcada como `failed` e paramos. São umas 15 horas de margem para o seu servidor voltar.

As novas tentativas são executadas pelo job periódico `/api/cron/tick`, que pega até 50 entregas vencidas por rodada. Ou seja, o cronograma real é "esse atraso, ou o próximo tick, o que vier depois". No Zerosoft Cloud isso já está resolvido. Se você faz self-host, precisa chamar o tick por conta própria — o [guia de Docker](/blog/self-hosting-con-docker-paso-a-paso) mostra a linha de crontab.

O painel mostra a última entrega de cada webhook: status, código de resposta e quando.

## SSRF: por que não vamos chamar o seu localhost

A URL de um webhook é uma URL digitada por um usuário que o nosso servidor vai requisitar. Sem proteção, isso é um server-side request forgery de livro: aponte para `http://169.254.169.254/` e você está pedindo credenciais ao serviço de metadados do provedor de nuvem.

Por isso o `safe-fetch.ts` verifica cada URL, na criação do webhook e de novo a cada tentativa:

- Só `https://` em produção (`http` simples é permitido apenas fora de produção, para desenvolvimento).
- Hostnames `localhost`, `*.localhost` e `*.internal` são rejeitados.
- O hostname é resolvido e, se **qualquer** um dos endereços cair num intervalo privado ou reservado, é rejeitado: `10.0.0.0/8`, `127.0.0.0/8`, `0.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, multicast para cima, além de loopback IPv6, unique-local (`fc00::/7`), link-local e endereços IPv4 mapeados.
- Redirects não são seguidos, então uma URL pública não consegue nos rebater para dentro.

Sendo precisos sobre os limites: a verificação resolve o DNS e depois o `fetch` resolve de novo, então um DNS hostil que troque a resposta entre essas duas consultas (DNS rebinding) não fica totalmente fechado. A janela fica bem menor; não é um firewall de rede.

## Self-host numa rede privada

Se você roda o Zerosoft dentro da rede da empresa e quer que ele chame serviços internos — `http://n8n.lan:5678/webhook/…`, por exemplo —, defina:

```bash
ALLOW_PRIVATE_WEBHOOKS=true
```

Isso desliga por completo a exigência de HTTPS e as verificações de endereços privados. É a escolha certa numa máquina em que todos os usuários são colegas. É a escolha errada em qualquer coisa multi-tenant ou pública: qualquer pessoa que consiga criar um webhook poderia fazer o seu servidor enviar requests para tudo o que ele alcança.

## Checklist

- Verifique a assinatura sobre o body cru, com o secret `whsec_` completo.
- Rejeite timestamps com mais de alguns minutos.
- Deduplique por `Zerosoft-Delivery`.
- Responda 2xx em menos de 8 segundos; coloque o trabalho lento numa fila.
- Não redirecione. Não espere eventos do CRM (ainda).
