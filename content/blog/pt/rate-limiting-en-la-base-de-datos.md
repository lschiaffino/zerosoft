---
title: "Rate limiting sem Redis: uma tabela e um UPSERT"
description: "Como o Zerosoft limita a API e os endpoints públicos com um contador de janela fixa guardado no mesmo banco SQLite/libSQL, e quando isso deixa de ser uma boa ideia."
date: "2026-09-10"
author: "Zerosoftware"
tags: ["engenharia", "arquitetura", "sqlite"]
---

Pergunte à internet como colocar rate limiting num app web e a resposta chega em menos de um segundo: Redis. `INCR`, `EXPIRE`, pronto. É uma boa resposta. Também é mais um serviço para rodar, proteger, monitorar e pagar — e para um projeto cujo self-host é "um contêiner, um arquivo", mais um serviço é um custo de verdade.

Então o Zerosoft faz rate limiting no banco que já tem. Veja como funciona, por que é correto e onde fica devendo.

## O problema: os contadores precisam ser compartilhados

A primeira versão óbvia é um `Map` em memória: chave → contador. Funciona perfeitamente no seu notebook e não serve para nada em produção.

O Zerosoft Cloud roda em funções serverless. Cada instância tem sua própria memória, instâncias vêm e vão, e um pico de tráfego pode se espalhar por uma dúzia delas. Um limite em memória de 100 por minuto vira "100 por minuto por instância, vezes quantas instâncias existirem agora". Isso não é um limite, é uma sugestão.

O contador precisa morar num lugar que todas as instâncias enxerguem. O Redis é um desses lugares. O banco de dados é outro — e por esse a gente já paga.

## A implementação inteira

Está em `lib/rate-limit.ts` e é curta. A tabela:

```sql
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at);
```

E a verificação, uma instrução por request:

```ts
const windowStart = Math.floor(now / windowMs) * windowMs;
const row = await db.prepare(
  `INSERT INTO rate_limits (key, window_start, count, expires_at) VALUES (?, ?, 1, ?)
   ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1
   RETURNING count`,
).get(key, windowStart, windowStart + windowMs);

return { ok: count <= limit, remaining: Math.max(0, limit - count), resetAt: windowStart + windowMs };
```

Isso é uma **janela fixa**. O tempo é cortado em baldes alinhados ao relógio (cada minuto começa em :00), e cada chave tem um contador por balde.

O importante é que o incremento e a leitura são a mesma instrução. Não existe "ler o contador, somar um, gravar de volta" no código da aplicação — o padrão que quebra com concorrência porque duas requests leem 99, as duas gravam 100 e as duas passam. O SQLite executa o UPSERT de forma atômica, e o `RETURNING` devolve o valor que acabou de gravar. Duas requests simultâneas recebem 100 e 101, não 100 e 100.

## A limpeza

Cada janela deixa uma linha para trás. Em vez de um job separado, a limpeza é preguiçosa: no máximo uma vez por minuto por instância, uma request dispara um `DELETE FROM rate_limits WHERE expires_at < ?` e não espera o resultado. O índice em `expires_at` deixa isso barato. A tabela continua pequena sem que ninguém pense nela.

## Onde é usado

Há duas camadas em cima de `rateLimit()`.

**A API.** Toda request para `/api/v1` é limitada a **100 por minuto por chave**. O balde é o SHA-256 da chave, e a verificação roda *antes* de validá-la — então chutar chaves gasta o mesmo orçamento. Requests com chaves inválidas têm um segundo limite: 20 por minuto por IP. (O [guia da API](/blog/api-rest-v1-con-claves-personales) mostra o que o cliente vê.)

**Endpoints públicos.** `limitByIp()` monta a chave com um nome de balde mais o IP do cliente, e devolve um `429` pronto com header `Retry-After`. Alguns valores reais do código:

- Agendar um horário no Cal: 10 a cada 10 minutos.
- Buscar horários disponíveis: 120 por minuto.
- Porta de link protegido por senha: 30 por minuto por IP, mais 5 por minuto por IP *e* por link.
- Enviar mensagem pelo widget de chat: 30 por minuto.
- Importar links (do Bitly ou de um CSV): 5 a cada 10 minutos.

Para testes de carga locais, `RATE_LIMIT_DISABLED=true` desliga os limites por IP.

## O problema do IP

Um limite por IP vale o que vale o IP que você lê. `clientIp()` usa `x-vercel-forwarded-for`, depois a primeira entrada de `x-forwarded-for`, depois `x-real-ip`. Na Vercel, esses headers são definidos pelo edge, não pelo cliente. No self-host, quem define é o seu reverse proxy — então configure-o para sobrescrever o `X-Forwarded-For` em vez de anexar, ou um cliente pode simplesmente mandar o dele. O [guia de Docker](/blog/self-hosting-con-docker-paso-a-paso) tem a linha para Nginx.

## Os tradeoffs, sem maquiagem

Esse design é uma escolha, não almoço grátis.

**Cada request limitada é uma escrita.** Num arquivo SQLite local são microssegundos, mas o SQLite tem um único escritor, então as escritas do rate limit entram na fila com todas as outras. No Turso, é uma ida e volta pela rede. O Redis faz um `INCR` em memória em bem menos de um milissegundo. Se você está limitando dezenas de milhares de requests por segundo, o banco é o lugar errado para isso.

**Janelas fixas permitem rajadas nas bordas.** Um cliente pode mandar 100 requests às 12:00:59 e outras 100 às 12:01:00. Nesses dois segundos passaram 200. Janelas deslizantes ou token buckets resolvem; no Redis são fáceis com um script Lua, em SQL são desajeitados. Para limites de "barrar abuso", janela fixa basta. Para cotas de cobrança rigorosas, não.

**Requests rejeitadas também contam.** O UPSERT sempre incrementa, então um cliente que continua martelando depois do limite faz o contador crescer. Inofensivo — zera na próxima janela —, mas não use `count` como métrica de tráfego legítimo.

**Destino compartilhado.** Se o banco cai, o rate limiting cai junto. Consideramos isso uma vantagem: se o banco está fora, nada mais funciona mesmo, e uma dependência falha de forma mais simples que duas.

## Quando partir para o Redis

Tire os contadores do banco quando alguma destas for verdade:

- As escritas do rate limit são uma fatia relevante do total de escritas do banco.
- A latência extra por request aparece no seu p99.
- Você precisa de janelas deslizantes, token buckets ou precisão por segundo.
- Você já roda Redis para outra coisa, então o argumento da infraestrutura extra some.

Até lá, uma tabela, um índice e um UPSERT dão conta — e quem faz self-host ganha rate limiting com zero contêineres extras.
