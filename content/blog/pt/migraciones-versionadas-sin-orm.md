---
title: "Migrações versionadas sem ORM: um baseline, uma lista e uma tabela"
description: "Como o Zerosoft evolui seu esquema SQLite/libSQL com migrações numeradas em TypeScript, por que cada uma precisa aguentar rodar duas vezes ao mesmo tempo, e a armadilha que apaga dados."
date: "2026-09-25"
author: "Zerosoftware"
tags: ["engenharia", "sqlite", "arquitetura"]
---

Todo app com banco de dados, cedo ou tarde, precisa mudar o esquema com dados reais lá dentro. ORMs resolvem isso com arquivos de migração gerados, um CLI e um monte de convenções. O Zerosoft não usa ORM — fala com o libSQL em SQL puro através de um wrapper fininho —, então tivemos que resolver por conta própria.

O resultado cabe num arquivo, `lib/schema/migrations.ts`, e umas 30 linhas de runner. Veja como funciona e as regras que impedem que ele machuque alguém.

## De onde viemos

Por muito tempo o esquema foi um blocão de `CREATE TABLE IF NOT EXISTS` mais uma lista de `ALTER TABLE ... ADD COLUMN` que rodavam a cada inicialização, ignorando os erros de "duplicate column". Idempotente, simples e suficiente — até você precisar de algo que não seja "adicionar uma coluna": preencher dados, mudar uma restrição de unicidade, corrigir um bug na atribuição de linhas. Isso precisa rodar **exatamente uma vez**, em ordem, em todo banco que existir: o nosso no Turso e cada arquivo SQLite de cada self-host.

## Passo um: congelar o passado

Pegamos todo aquele bloco — DDL, ALTERs históricos, algumas reconstruções antigas de tabelas — e transformamos na migração número um:

```ts
export const MIGRATIONS: Migration[] = [
  { id: '001_baseline', up: baseline },
  { id: '002_track_project_owner', async up(client) { /* ... */ } },
  { id: '003_rate_limits', async up(client) { /* ... */ } },
  // ...
  { id: '012_crm_task_due_fired', async up(client) { /* ... */ } },
];
```

O `baseline.ts` tem um comentário em maiúsculas: não editar. Como tudo nele é idempotente, rodá-lo num banco que já existia antes das migrações é seguro. Uma instalação nova e uma instância de dois anos atrás convergem para o mesmo esquema.

## Passo dois: uma tabela que lembra

```ts
export async function runMigrations(client: Client, migrations = MIGRATIONS) {
  await client.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const done = new Set((await client.execute('SELECT id FROM schema_migrations')).rows.map((r) => String(r.id)));
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    await m.up(client);
    await client.execute({ sql: 'INSERT OR IGNORE INTO schema_migrations (id) VALUES (?)', args: [m.id] });
  }
}
```

Esse é o runner. Cada migração é um `id` e uma função async `up(client)` — TypeScript comum, então pode rodar SQL, ler linhas, calcular coisas em JS e gravar de volta. Não há migrações para baixo: só andamos para frente. Voltar atrás significa restaurar um backup, e é por isso que o [guia de self-hosting](/blog/self-hosting-con-docker-paso-a-paso) manda fazer backup antes de atualizar.

## Quando roda: sob demanda, antes da primeira query

Não existe um comando `migrate` para lembrar de rodar. Em `lib/db.ts`, `ensureMigrated()` cria uma única promise por processo que executa as migrações pendentes. Toda query do app espera essa promise antes de executar, então nenhuma query consegue bater numa tabela que ainda não existe. Se a migração falhar, a promise é zerada e a próxima request tenta de novo.

É isso que permite ao mesmo código funcionar num contêiner de self-host (um processo, sobe uma vez) e em serverless (muitas instâncias, com cold start quando bem entendem).

## Regra 1: nunca edite nem reordene uma migração publicada

Depois que uma migração foi publicada, algum banco em algum lugar já registrou o id dela como feito. Se você mudar o corpo, esse banco nunca vai rodar a versão nova. Precisa corrigir algo? Crie a migração 013.

## Regra 2: toda migração precisa sobreviver a rodar duas vezes, ao mesmo tempo

Essa é a parte que todo mundo esquece. Instâncias serverless sobem em paralelo. Duas podem ler `schema_migrations`, ver que a `005` está pendente e rodá-la as duas. Não há lock — de propósito, porque uma tabela de locks num banco remoto traz seus próprios modos de falha (quem libera o lock de uma instância que foi derrubada?).

Em vez disso, toda migração é idempotente:

- `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`.
- Colunas passam por um helper `addColumn` que engole erros de "duplicate column".
- Preenchimentos só mexem nas linhas que ainda precisam: `UPDATE ... WHERE handle IS NULL`, não um `UPDATE` em tudo.
- O registro é um `INSERT OR IGNORE`.

E tem teste. `tests/unit/migrations.test.ts` roda todas as migrações num banco vazio (e verifica que uma segunda rodada não aplica nada), e roda duas chamadas de `runMigrations` em paralelo contra o mesmo banco para garantir que ambas terminam e o resultado está correto.

## Regra 3: reconstrua tabelas com as foreign keys desligadas

O `ALTER TABLE` do SQLite consegue adicionar e renomear colunas, mas não consegue mudar uma restrição `UNIQUE` ou `CHECK`. A receita oficial é: criar uma tabela nova, copiar as linhas, apagar a antiga, renomear a nova.

A armadilha: com `PRAGMA foreign_keys = ON` (que usamos), `DROP TABLE links` se comporta como um `DELETE` de todas as linhas — e toda tabela filha com `ON DELETE CASCADE` perde as linhas dela também. Reconstrua a tabela de links desse jeito e todo clique já registrado some.

A migração `009_link_domains` é exatamente esse caso: os slugs de links deixaram de ser únicos globalmente para ser únicos por domínio próprio. Ela usa o `client.migrate([...])` do libSQL, que roda o lote com as foreign keys desligadas:

```ts
await client.migrate([
  `CREATE TABLE links_new ( ... domain_id TEXT REFERENCES link_domains(id), slug TEXT NOT NULL, ... )`,
  `INSERT INTO links_new (${cols}) SELECT ${cols} FROM links`,
  'DROP TABLE links',
  'ALTER TABLE links_new RENAME TO links',
]);
```

E por causa da regra 2, ela só reconstrói se a tabela ainda tiver o formato antigo — lê o SQL da tabela em `sqlite_master` e pula a reconstrução se `domain_id` já estiver lá.

## Migrações que pensam nos dados

Algumas das migrações mais úteis nem são sobre esquema:

- `002_track_project_owner` adicionou dono aos projetos do Track e preencheu: projetos de team ficam com o dono do team, os pessoais com o criador da primeira issue, e o que não dá para atribuir fica oculto em vez de visível para todo mundo.
- `005_user_handles` gerou um handle público único para cada usuário existente, em JS, evitando colisões.
- `012_crm_task_due_fired` levou o gatilho de workflow "tarefa vencida" para o cron — e marcou como disparadas todas as tarefas que já estavam vencidas, para que o primeiro tick depois do deploy não soltasse uma avalanche de automações.

Essa última é o argumento de verdade a favor de migrações em código. Pensar no que a primeira execução vai fazer com os dados existentes é o trabalho.

## Do que abrimos mão

Sendo honestos sobre os custos:

- **Sem diff de esquema.** Nada gera migrações a partir de um modelo. Você escreve o SQL.
- **Tipos escritos à mão.** Os tipos das linhas ficam em `lib/schema/types.ts` e se mantêm sincronizados por disciplina e revisão, não por geração de código.
- **Sem transação em volta de uma migração.** Se uma falhar no meio, o que já foi feito fica feito — mais um motivo para cada passo ser idempotente e a nova tentativa terminar o serviço.
- **A primeira request paga a conta.** Uma migração lenta roda no cold start que a dispara.

Para um código que quer rodar igual num arquivo SQLite e num [banco remoto no Turso](/blog/un-codigo-sqlite-local-o-turso), aceitamos a troca. O sistema de migrações inteiro é uma lista, uma tabela e um loop — e dá para ler tudo antes de o café esfriar.
