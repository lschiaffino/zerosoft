---
title: "A API REST v1 na prática: chaves pessoais, curl e erros reais"
description: "Crie uma chave zs_, encurte links, puxe estatísticas de cliques e cadastre contatos e deals a partir de um script. Cada exemplo bate com o código, inclusive quando algo dá errado."
date: "2026-08-13"
author: "zerosoft"
tags: ["api", "desenvolvedores", "tutorial"]
---

Já escrevemos sobre [por que documentamos todas as APIs](/blog/apis-abiertas-por-que-documentamos-todo). Este é o lado prático: um passeio pela API REST v1 do zerosoft com comandos `curl` prontos para copiar e colar, para o Link e para o CRM, mais os erros que você vai encontrar de verdade.

Tudo aqui foi conferido contra os handlers em `app/api/v1`, não só contra a página de docs. A URL base é `https://zerosoft.ai/api/v1` no zerosoft Cloud, ou `https://seu-host/api/v1` se você faz self-host.

## Pegue uma chave

Vá em Dashboard → Settings → API keys, dê um nome à chave ("CI deploy", "substituto-do-zapier", o que for) e crie.

Três coisas para saber:

- **Ela aparece uma única vez.** A chave é `zs_` seguido de 32 caracteres aleatórios. Guardamos só o hash SHA-256 dela e os 10 primeiros caracteres como prefixo visível. Perdeu? Crie outra.
- **Ela age como o workspace.** O que você cria pela API cai no mesmo workspace que você vê no dashboard. Admins veem todas as chaves do workspace; members, só as que eles mesmos criaram. A lista mostra quando cada chave foi usada pela última vez, e revogar vale a partir da próxima request.
- **100 requests por minuto, por chave.** Mais sobre isso abaixo.

Coloque numa variável de ambiente e esqueça:

```bash
export ZS_KEY="zs_..."
export ZS="https://zerosoft.ai/api/v1"
```

## Links

Crie um link curto. Só `url` é obrigatório; `slug` (até 32 caracteres), `title`, `tags` (até 5) e `domain` (um domínio próprio que você verificou) são opcionais.

```bash
curl -X POST "$ZS/links" \
  -H "Authorization: Bearer $ZS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/spring-launch", "slug": "spring", "tags": ["launch"]}'
```

Você recebe um `201` com `id`, `slug`, `domain`, `short_url`, `url`, `title`, `tags` e `created_at`.

Liste, com paginação (`pageSize` vai até 50):

```bash
curl "$ZS/links?page=1&pageSize=50" -H "Authorization: Bearer $ZS_KEY"
```

A resposta é `{ "links": [...], "total": n }`, arquivados incluídos, cada um com sua contagem de cliques.

Cliques por dia nos últimos 30 dias:

```bash
curl "$ZS/links/LINK_ID/stats" -H "Authorization: Bearer $ZS_KEY"
# { "slug": "spring", "total": 312, "byDay": [{ "date": "...", "count": 41 }, ...] }
```

Isso basta para montar um relatório semanal num cron sem nunca abrir o dashboard.

## CRM: contatos

Busque e pagine (`pageSize` até 100):

```bash
curl "$ZS/crm/contacts?q=ana&page=1&pageSize=25" -H "Authorization: Bearer $ZS_KEY"
```

Crie um. Atenção: os bodies das requests usam nomes de campo em **camelCase**, e as respostas devolvem a linha salva com colunas em **snake_case**:

```bash
curl -X POST "$ZS/crm/contacts" \
  -H "Authorization: Bearer $ZS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"firstName": "Ana", "lastName": "Garcia", "email": "ana@example.com", "lifecycleStage": "lead", "source": "event"}'
# 201 → { "id": "...", "first_name": "Ana", "last_name": "Garcia", "lifecycle_stage": "lead", ... }
```

Atualize com `PATCH`: todos os campos são opcionais:

```bash
curl -X PATCH "$ZS/crm/contacts/CONTACT_ID" \
  -H "Authorization: Bearer $ZS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jobTitle": "Head of Ops", "city": "Montevideo"}'
```

Empresas funcionam do mesmo jeito em `/crm/companies` e `/crm/companies/:id`.

## CRM: deals e tarefas

Um deal precisa de pipeline e etapa, então peça isso primeiro:

```bash
curl "$ZS/crm/pipelines" -H "Authorization: Bearer $ZS_KEY"
```

Cada pipeline vem com suas etapas (`id`, `name`, `probability`, `isWon`, `isLost`). Depois:

```bash
curl -X POST "$ZS/crm/deals" \
  -H "Authorization: Bearer $ZS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pipelineId": "PIPELINE_ID", "stageId": "STAGE_ID", "name": "Acme renewal", "amount": 4800, "currency": "USD", "contactIds": ["CONTACT_ID"]}'
```

`GET /crm/deals` lista os deals de `?pipelineId=…`, ou do seu primeiro pipeline se você omitir.

Tarefas ficam penduradas em contatos, empresas ou deals:

```bash
curl -X POST "$ZS/crm/tasks" \
  -H "Authorization: Bearer $ZS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"subject": "Send renewal proposal", "dueAt": "2026-08-20 15:00", "dealId": "DEAL_ID"}'

curl "$ZS/crm/tasks?bucket=overdue" -H "Authorization: Bearer $ZS_KEY"
```

`bucket` aceita `overdue`, `today`, `upcoming` ou `done`. Datas vão como `YYYY-MM-DD`, opcionalmente com horário.

Também há endpoints do Cal (tipos de evento, agendamentos, cancelamento) em `/calendar`: estão nas [docs](/docs).

## Erros: um formato para tudo

Todo erro da v1 tem o mesmo body:

```json
{ "error": { "code": "slug_taken", "message": "That slug is already taken." } }
```

Decida com base no `code`, mostre a `message` para humanos. Os que você vai encontrar:

| Status | Code | Quando |
| --- | --- | --- |
| 401 | `invalid_key` | Falta o header `Authorization: Bearer …`, ou a chave está errada ou revogada. |
| 429 | `rate_limited` | Mais de 100 requests no minuto atual para essa chave. |
| 400 | `invalid_url`, `invalid_slug`, `slug_taken`, `invalid_domain` | Problemas ao criar o link. |
| 400 | `invalid_input`, `invalid_email`, `missing_name` | O body do CRM não passou na validação. |
| 400 | `invalid_pipeline`, `invalid_stage` | O pipeline não existe, ou a etapa não é dele. |
| 404 | `not_found` | O registro não existe no seu workspace. |

## Sobre esse rate limit

O limite é uma janela fixa de um minuto por chave, contada no banco de dados (escrevemos [um post inteiro sobre isso](/blog/rate-limiting-en-la-base-de-datos)). Dois detalhes que valem saber:

- **A contagem acontece antes de validar a chave.** Testar chaves na força bruta gasta o mesmo orçamento. Além disso, chaves inválidas têm um teto de 20 tentativas por minuto por IP.
- **O 429 não traz header `Retry-After`.** As janelas se alinham ao minuto do relógio, então o cliente correto mais simples dorme até o próximo minuto começar e tenta de novo.

```bash
# ingênuo, mas correto
until curl -fsS "$ZS/links" -H "Authorization: Bearer $ZS_KEY"; do sleep 15; done
```

Para importações em massa, fique bem abaixo de 100 por minuto e você nunca verá um 429.

## O que (ainda) não existe

Sendo honestos sobre as bordas: ainda não há API para Track, Chat ou Docs, o CRM não emite eventos de webhook, e não há OAuth para apps de terceiros, as chaves são pessoais. Se o dashboard faz algo que a API não faz, isso é uma lacuna, não uma decisão de design. Abra uma issue.
