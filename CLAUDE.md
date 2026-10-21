# zerosoft: cómo trabajar en este repo

Lo leen las personas y los agentes (sesiones locales, subagentes y las rutinas
diarias en la nube). Si algo de acá choca con un prompt, gana esto.

## Stack

- Next.js 15 App Router, next-intl (en/es/pt), CSS plano con tokens en
  `styles/themes/default.css` (claro) y `styles/themes/dark.css` (oscuro).
- SQLite/libsql (`lib/db.ts`, Turso en producción). Migraciones en
  `lib/schema/migrations.ts`, con id string correlativo (`NNN_nombre`), siempre
  al final de la lista.
- Textos en `messages/<locale>/<app>.json`, los tres idiomas a la vez.
- Crons: `/api/cron/minute` (cada minuto), `/api/cron/tick` (cada hora),
  `/api/cron/robots` (cada 5 min). Todo lo que corre ahí reclama cada fila
  (compare-and-set) para que dos corridas no hagan lo mismo dos veces.

## Qué es "terminado"

Una función está terminada cuando una persona la puede usar de punta a punta,
no cuando pasan sus tests. Antes de dar algo por hecho:

1. **Probado en el navegador.** `npx next build`, levantar la app y recorrer
   el flujo como usuario (Playwright o Chrome). Si no se pudo probar, decirlo
   en el informe: no se mergea sin esa pasada.
2. **Cumple la lista común de toda app** (ver abajo), no solo lo pedido.
3. **Tests:** unitarios en `tests/unit` para la lógica y, si cambia lo que ve
   el usuario, e2e en `tests/e2e`. Si agregás pestañas, columnas o eventos,
   actualizá los tests que los cuentan. `tests/e2e/app-smoke.spec.ts` corre la
   lista común en todas las apps: mantenela al día.
4. **Checks:** `npx tsc --noEmit`, `npm run lint`, `npx vitest run`,
   `npx next build && CI=1 npx playwright test`.

### Lista común de toda app

Cada cosa que una persona crea (página, nota, pizarra, proyecto, issue,
contacto, link, flow, agente, robot, widget, tipo de evento):

- aparece en la lista de la app y, si la app tiene listado en el sidebar
  (como Docs o Board), también ahí, y se marca la abierta;
- se encuentra con Cmd+K;
- se abre, se renombra y se borra, y los cambios se ven en la lista y el
  sidebar sin recargar;
- tiene estado vacío claro, estado de carga y mensaje de error;
- se ve bien en claro y oscuro y a 390px de ancho (sin scroll horizontal);
- se maneja con teclado (foco visible, Esc cierra, Enter confirma).

La referencia de experiencia es la app que copiamos (Notion para Docs,
Linear para Track, HubSpot para CRM, etc.): si allá algo es obvio, acá
también tiene que estar.

## Copy y diseño

- Sin pills ni radios grandes. Componentes y tokens existentes.
- Sin rayas largas (—), sin "no es X, es Y", sin tríadas "sin X, sin Y, sin Z",
  sin "gratis para siempre", sin promesas de funciones que no existen ni
  métricas o testimonios inventados. Guía de voz: `docs/voice.md`.

## Backlog

- `research/ideas.json` alimenta el board (ver `research/README.md`). Al
  construir una idea, marcala `status: "done"` con su entrada de
  `content/changelog.ts`.
- Los bugs de seguridad no van al board público: se arreglan directo.

## Git

- Commits como `Lautaro Schiaffino <lschiaffino@users.noreply.github.com>`
  (si no, Vercel rechaza el deploy), con el trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Vercel despliega `main` solo.
