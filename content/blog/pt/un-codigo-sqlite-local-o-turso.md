---
title: "Um código, dois bancos: um arquivo SQLite local ou Turso remoto"
description: "O Zerosoft roda sobre um arquivo SQLite no seu disco ou sobre um banco Turso do outro lado da rede, e quem decide é uma variável de ambiente. Como funciona no código, o que muda e como escolher."
date: "2026-10-10"
author: "Zerosoftware"
tags: ["engenharia", "sqlite", "self-hosting"]
---

Já defendemos que [SQLite é suficiente](/blog/sqlite-es-suficiente) para apps como o nosso. Este post é sobre algo mais específico e mais prático: o mesmo código do Zerosoft roda sobre um arquivo SQLite ao lado do app *e* sobre um banco remoto no [Turso](https://turso.tech), e a única coisa que muda é uma variável de ambiente.

O Zerosoft Cloud roda em Vercel + Turso. Um contêiner de self-host roda sobre um arquivo. Mesmas queries, mesmas migrações, mesmos testes. Veja como, e entre o que você está escolhendo de verdade.

## O interruptor são quatro linhas

De `lib/db.ts`:

```ts
const DB_PATH = path.join(process.cwd(), 'data', 'zerosoftware.db');
const DB_URL = process.env.TURSO_DATABASE_URL ?? `file:${DB_PATH}`;
const IS_REMOTE = !DB_URL.startsWith('file:');

createClient({ url: DB_URL, authToken: IS_REMOTE ? process.env.TURSO_AUTH_TOKEN : undefined });
```

Funciona por causa do cliente por baixo: `@libsql/client`. O libSQL é o fork open source do SQLite mantido pelo Turso, e o cliente dele fala tanto com um arquivo local (URLs `file:`) quanto com um servidor remoto (URLs `libsql://`) usando a mesma API. O dialeto SQL é o do SQLite nos dois casos, então não há nada para traduzir.

Ou seja:

```bash
# Arquivo local (o padrão): deixe vazio
TURSO_DATABASE_URL=

# Turso remoto
TURSO_DATABASE_URL=libsql://zerosoft-yourorg.turso.io
TURSO_AUTH_TOKEN=...   # turso db tokens create <db>
```

Um detalhe curioso: o `Dockerfile` usa esse mesmo interruptor no build. O Next.js pré-renderiza algumas páginas durante o `npm run build`, e isso precisa de um banco, então o build roda com `TURSO_DATABASE_URL=file:/tmp/build.db` — um arquivo descartável que nunca chega à imagem final.

## O que o código faz de diferente

Quase nada, e essa é a ideia. As diferenças que existem são propositais:

- **PRAGMAs só rodam localmente.** Num arquivo, o app liga `foreign_keys`, define `busy_timeout = 5000` (esperar até 5 segundos por um lock em vez de falhar) e muda para `journal_mode = WAL`. Num banco remoto essas configurações são do servidor, então o app não as envia.
- **O diretório de dados só é criado localmente.** `data/` ganha um `mkdir -p` quando a URL é um arquivo.

Todo o resto passa por um wrapper pequeno. O app foi escrito originalmente sobre o `better-sqlite3`, que é síncrono. O cliente do libSQL é assíncrono — precisa ser, já que o caso remoto é uma chamada de rede. Em vez de reescrever cada query, `getDb()` devolve um shim com o mesmo formato (`prepare(sql).get/all/run`) em que cada método devolve uma promise. Ele também copia os objetos de linha do libSQL para objetos JS simples, para que possam passar de React Server Components para componentes cliente sem surpresas. Para trabalho com várias instruções que precisa ser atômico, o código abre uma transação interativa com `getClient().transaction()` e a envolve com `txDb(tx)`, mesma interface.

As migrações rodam igual nos dois casos — sob demanda, antes da primeira query, uma única lista para todos os bancos. ([Mais sobre isso](/blog/migraciones-versionadas-sin-orm).)

## A diferença de verdade: onde os bytes moram

Mesmo código não quer dizer mesmo comportamento. Os tradeoffs são físicos.

**Latência por query.** Um arquivo local é in-process: uma query é uma chamada de função, sem rede. Uma query no Turso é uma ida e volta. Para uma query, tudo bem, mas isso se multiplica. Algumas telas rodam várias queries em sequência, e umas poucas fazem uma query por linha (listar os webhooks busca a última entrega de cada um separadamente, por exemplo). Num arquivo ninguém percebe. Pela rede, soma. Se for para o remoto, coloque o app e o banco na mesma região — isso pesa mais que qualquer otimização de query.

**Onde o app pode rodar.** Um arquivo precisa de disco persistente e, sendo realista, de um único processo escrevendo nele. Isso é um VPS ou um contêiner com volume. Plataformas serverless como a Vercel não dão nem sistema de arquivos durável nem instância única, então lá o banco *precisa* ser remoto. É por isso que o Zerosoft Cloud usa Turso.

**Escritas concorrentes.** O SQLite tem um escritor por vez. Localmente, o `busy_timeout` faz escritores concorrentes esperarem a vez em vez de dar erro, e o WAL deixa as leituras seguirem durante as escritas. Com o Turso, o servidor serializa as escritas para você, e muitas instâncias do app podem se conectar ao mesmo tempo.

**Backups e operação.** O backup do arquivo é com você — o [guia de Docker](/blog/self-hosting-con-docker-paso-a-paso) mostra como fazer com segurança com o app rodando. O Turso é um serviço gerenciado: backups e restauração fazem parte da plataforma (confira na documentação deles o que o seu plano inclui). Você troca um cron por um fornecedor.

**Custo.** Um arquivo custa o que custar o seu disco. O Turso tem um plano gratuito e planos pagos acima dele — confira a página de preços atual em vez de confiar num número de post de blog.

## Como migrar de um para o outro

Como os dois lados são compatíveis com SQLite, mudar é copiar dados, não um projeto de migração.

De arquivo local para Turso: pare o app (para o WAL ser descarregado no arquivo principal) e deixe o CLI do Turso criar um banco a partir do arquivo:

```bash
sqlite3 data/zerosoftware.db "PRAGMA wal_checkpoint(TRUNCATE);"
turso db create zerosoft --from-file data/zerosoftware.db
```

Do Turso de volta para um arquivo, dump e carga:

```bash
turso db shell zerosoft .dump > zerosoft.sql
sqlite3 data/zerosoftware.db < zerosoft.sql
```

As flags mudam entre versões do CLI, então rode `turso db create --help` antes de confiar nas nossas. De qualquer forma, aponte as variáveis de ambiente para o novo lugar, suba o app, e o runner de migrações vê a tabela `schema_migrations` existente e não faz nada.

Essa também é a resposta honesta para "e se o Turso sumir?": seus dados são um banco SQLite. Faça o dump e você volta para um arquivo.

## Como escolher

Use um **arquivo local** se:

- Você faz self-host num VPS ou numa única máquina.
- Quer zero dependências externas e a menor latência possível.
- Não se importa em cuidar dos backups (um comando por noite, testado de vez em quando).
- Precisa que funcione offline ou numa rede isolada.

Use **Turso** se:

- Você faz deploy em serverless (Vercel e afins) ou roda mais de uma instância do app.
- Prefere backups e restauração gerenciados a rodá-los você mesmo.
- O app e o banco podem ficar na mesma região.

O que (ainda) não fazemos: o libSQL também suporta réplicas embutidas (uma cópia local que sincroniza a partir de um primário remoto), que poderiam combinar leituras locais rápidas com uma fonte da verdade remota. O Zerosoft não as usa hoje. E não há opção de Postgres; o código inteiro fala SQLite.

Um código, uma variável de ambiente, e seus dados num formato que você sempre pode levar embora. Comece com o arquivo. Mude quando tiver um motivo.
