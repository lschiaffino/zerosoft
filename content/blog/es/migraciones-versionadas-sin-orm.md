---
title: "Migraciones versionadas sin ORM: un baseline, una lista y una tabla"
description: "Cómo zerosoft cambia su esquema SQLite/libSQL con migraciones numeradas en TypeScript, por qué cada una tiene que aguantar correr dos veces a la vez y la trampa que borra datos."
date: "2026-09-25"
author: "zerosoft"
tags: ["ingeniería", "sqlite", "arquitectura"]
---

Toda app con base de datos tarde o temprano necesita cambiar su esquema con datos reales adentro. Los ORMs lo resuelven con archivos de migración generados, un CLI y un montón de convenciones. zerosoft no usa ORM: le habla a libSQL con SQL plano a través de un wrapper fino, así que lo resolvimos nosotros.

El resultado entra en un archivo, `lib/schema/migrations.ts`, y unas 30 líneas de runner. Acá va cómo funciona y las reglas que evitan que lastime a alguien.

## De dónde veníamos

Durante mucho tiempo el esquema fue un bloque grande de `CREATE TABLE IF NOT EXISTS` más una lista de `ALTER TABLE ... ADD COLUMN` que corrían en cada arranque, ignorando los errores de "duplicate column". Idempotente, simple y suficiente, hasta que necesitás algo que no sea "agregar una columna": rellenar datos, cambiar una restricción de unicidad, corregir un bug en cómo se atribuían filas. Eso tiene que correr **exactamente una vez**, en orden, en cada base que exista: la nuestra en Turso y cada archivo SQLite de cada self-host.

## Paso uno: congelar el pasado

Agarramos todo ese bloque, DDL, ALTERs históricos, un par de reconstrucciones viejas de tablas, y lo convertimos en la migración número uno:

```ts
export const MIGRATIONS: Migration[] = [
  { id: '001_baseline', up: baseline },
  { id: '002_track_project_owner', async up(client) { /* ... */ } },
  { id: '003_rate_limits', async up(client) { /* ... */ } },
  // ...
  { id: '012_crm_task_due_fired', async up(client) { /* ... */ } },
];
```

`baseline.ts` tiene un comentario en mayúsculas: no editar. Como todo lo que contiene es idempotente, correrlo sobre una base que ya existía antes de las migraciones es seguro. Una instalación nueva y una instancia de hace dos años terminan en el mismo esquema.

## Paso dos: una tabla que se acuerda

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

Ese es el runner. Cada migración es un `id` y una función async `up(client)`: TypeScript común, así que puede correr SQL, leer filas, calcular cosas en JS y escribirlas de vuelta. No hay migraciones hacia abajo: solo vamos para adelante. Volver atrás significa restaurar un backup, y por eso la [guía de self-hosting](/blog/self-hosting-con-docker-paso-a-paso) dice que hagas backup antes de actualizar.

## Cuándo corre: de forma perezosa, antes de la primera query

No hay un comando `migrate` que acordarse de correr. En `lib/db.ts`, `ensureMigrated()` crea una única promesa por proceso que corre las migraciones pendientes. Cada query que hace la app espera esa promesa antes de ejecutarse, así que ninguna query puede pegarle a una tabla que todavía no existe. Si la migración falla, la promesa se resetea y la próxima request lo vuelve a intentar.

Eso es lo que permite que el mismo código funcione en un contenedor de self-host (un proceso, arranca una vez) y en serverless (muchas instancias, arrancando en frío cuando se les canta).

## Regla 1: nunca edites ni reordenes una migración publicada

Una vez que una migración salió, alguna base en algún lado ya registró su id como hecha. Si cambiás el cuerpo, esa base nunca va a correr la versión nueva. ¿Hay que arreglar algo? Agregá la migración 013.

## Regla 2: toda migración tiene que sobrevivir a correr dos veces, al mismo tiempo

Esta es la parte que se le escapa a todo el mundo. Las instancias serverless arrancan en paralelo. Dos pueden leer `schema_migrations`, ver las dos que la `005` está pendiente y correrla las dos. No hay lock: a propósito, porque una tabla de locks en una base remota trae sus propios modos de falla (¿quién suelta el lock de una instancia a la que mataron?).

En cambio, cada migración es idempotente:

- `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`.
- Las columnas pasan por un helper `addColumn` que se traga los errores de "duplicate column".
- Los rellenos solo tocan las filas que todavía lo necesitan: `UPDATE ... WHERE handle IS NULL`, no un `UPDATE` a todo.
- El registro es un `INSERT OR IGNORE`.

Y está testeado. `tests/unit/migrations.test.ts` corre todas las migraciones sobre una base vacía (y verifica que una segunda pasada no aplique nada), y corre dos `runMigrations` en paralelo contra la misma base para asegurarse de que las dos terminen y el resultado sea correcto.

## Regla 3: reconstruí tablas con las foreign keys apagadas

El `ALTER TABLE` de SQLite puede agregar y renombrar columnas, pero no puede cambiar una restricción `UNIQUE` o `CHECK`. La receta oficial es: crear una tabla nueva, copiar las filas, borrar la vieja, renombrar la nueva.

La trampa: con `PRAGMA foreign_keys = ON` (que usamos), `DROP TABLE links` se comporta como un `DELETE` de todas las filas, y cada tabla hija con `ON DELETE CASCADE` pierde sus filas también. Reconstruí la tabla de links así y desaparece cada click registrado en la historia.

La migración `009_link_domains` es exactamente este caso: los slugs de links pasaron de ser únicos globalmente a ser únicos por dominio propio. Usa `client.migrate([...])` de libSQL, que corre el batch con las foreign keys apagadas:

```ts
await client.migrate([
  `CREATE TABLE links_new ( ... domain_id TEXT REFERENCES link_domains(id), slug TEXT NOT NULL, ... )`,
  `INSERT INTO links_new (${cols}) SELECT ${cols} FROM links`,
  'DROP TABLE links',
  'ALTER TABLE links_new RENAME TO links',
]);
```

Y por la regla 2, solo reconstruye si la tabla todavía tiene la forma vieja: lee el SQL de la tabla desde `sqlite_master` y se saltea la reconstrucción si `domain_id` ya está.

## Migraciones que piensan en los datos

Algunas de las migraciones más útiles no tienen que ver con el esquema:

- `002_track_project_owner` le agregó dueño a los proyectos de Track y lo rellenó: los proyectos de team quedan con el dueño del team, los personales con el creador del primer issue, y lo que no se puede atribuir queda oculto en vez de quedar visible para todos.
- `005_user_handles` generó un handle público único para cada usuario existente, en JS, evitando colisiones.
- `012_crm_task_due_fired` movió el trigger de workflow "tarea vencida" al cron, y marcó como disparadas todas las tareas que ya estaban vencidas, para que el primer tick después del deploy no desatara una avalancha de automatizaciones.

Esa última es el verdadero argumento a favor de las migraciones en código. Pensar qué va a hacer la primera corrida con los datos que ya existen es el trabajo.

## A qué renunciamos

Siendo honestos con los costos:

- **No hay diff de esquema.** Nada genera migraciones a partir de un modelo. El SQL lo escribís vos.
- **Tipos escritos a mano.** Los tipos de las filas viven en `lib/schema/types.ts` y se mantienen sincronizados por disciplina y revisión, no por generación de código.
- **No hay transacción alrededor de una migración.** Si una falla a la mitad, lo que ya se hizo queda hecho: otra razón más para que cada paso sea idempotente y el reintento termine el trabajo.
- **La primera request paga.** Una migración lenta corre en el arranque en frío que la dispara.

Para un código que quiere correr igual sobre un archivo SQLite y sobre [una base remota en Turso](/blog/un-codigo-sqlite-local-o-turso), aceptamos el trato. Todo el sistema de migraciones es una lista, una tabla y un loop, y lo podés leer entero antes de que se te enfríe el café.
