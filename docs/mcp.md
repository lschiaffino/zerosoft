# MCP unificado y CLI

Un endpoint, `POST /api/mcp`, llega a todas las apps con la identidad de la persona. Lo usan Claude Code, claude.ai y `cli/`. Texto público: `/docs/mcp` (`content/mcp-docs.ts`).

## Piezas

| Qué | Dónde |
| --- | --- |
| Protocolo (JSON-RPC, herramientas, instrucciones) | `lib/mcp/server.ts` |
| Quién llama (token OAuth o API key, tope de permisos) | `lib/mcp/caller.ts` |
| Ejecutar una operación | `lib/mcp/invoke.ts` |
| Identidad delegada (AsyncLocalStorage) | `lib/mcp/identity.ts`, leída por `lib/session.ts` y `requireApiUser` |
| Secretos fuera de las respuestas | `lib/mcp/scrub.ts` |
| Catálogo generado | `lib/mcp/catalog.generated.ts`, `lib/mcp/route-table.generated.ts` |
| Exclusiones y correcciones de clase | `lib/mcp/excludes.mjs` |
| Esquemas a mano | `lib/mcp/hand-schemas.mjs` |
| Servidor OAuth | `lib/oauth/`, `app/api/oauth/*`, `app/.well-known/*` |
| Permisos y conexiones | `app/[locale]/oauth/*`, `components/oauth/*`, `components/app/ConnectedClientsPanel.tsx` |

## Agregar o cambiar rutas

Después de tocar una ruta de la API:

```sh
NODE_OPTIONS=--max-old-space-size=6144 node scripts/mcp-catalog.mjs
```

`tests/unit/mcp-catalog.test.ts` falla si una ruta no está en el catálogo ni en las exclusiones. Una ruta nueva entra sola al regenerar, así que si no debe estar al alcance de un token (cron, webhook, login, algo con secreto en la URL) hay que sumarla a `EXCLUDE_RULES` con su razón **antes** de regenerar. Una operación sin sesión detectada hace fallar el test hasta decidir qué es (`NO_SESSION_OK`).

Clase de cada operación: DELETE es destructiva, GET es lectura salvo que se alcance SQL de escritura, lo demás es escritura. Lo desconocido nunca es lectura. Un POST que solo lee va a `READ_POST` y un GET que solo escribe auditoría o siembra defaults (o refresca un token o un cache) a `MUTATING_GET_OK`, después de mirar todo el SQL que alcanza con `--report`. Un GET que cambia datos de la persona queda como escritura. La búsqueda de SQL tiene profundidad acotada: una escritura más honda se puede escapar.

## Modelo de seguridad

- Todo corre como la persona: `invoke.ts` llama al handler real en proceso, dentro de `runAsDelegated`. `getCurrentUser` y `requireApiUser` resuelven desde ahí, con los mismos chequeos. No hay permisos paralelos.
- El ALS no se prende desde afuera: no hay header ni cookie. Tampoco hay HTTP interno, así que no hay SSRF: el cliente solo elige una entrada de `ROUTE_TABLE`.
- Una conexión queda fijada a un workspace (`oauth_grants.team_id`). Si la persona sale, las operaciones fallan: nunca caen a otro workspace. Cambiar de workspace en el navegador no la mueve.
- Tope de la credencial: scope `read` o `write` en OAuth, scopes de la key en API keys. Una app sin scope propio (Flow, Rec, Agents, Robots, Workspace) pide una key con todos.
- Tokens: solo su SHA-256 en la base. Access de 1 h; refresh de 60 días, rota en cada uso y reusarlo revoca la conexión. Reusar un código de autorización también.
- Audiencia: el token se emite para `<NEXTAUTH_URL>/api/mcp` y se compara en cada pedido.
- Redirects: https o loopback, coincidencia exacta salvo el puerto en loopback (RFC 8252 §7.3, OAuth 2.1 §8.4.2).
- Las pantallas de permisos no se dejan enmarcar y el POST exige Origin propio.
- Salida: etiquetas `<untrusted_data>` con nonce por respuesta, secretos tapados, 60.000 caracteres por llamada con paginación.
- Rate limit por conexión: 300 lecturas y 60 escrituras por minuto. Auditoría de cada escritura en `mcp_audit_log`, sin argumentos ni secretos.

## Decisiones

- Sin dependencia nueva: el protocolo es JSON-RPC simple y `lib/track-mcp.ts` ya estaba hecho a mano.
- Registro dinámico de clientes (RFC 7591). Client ID Metadata Documents no está implementado: suma una salida HTTP a URLs ajenas y los clientes actuales caen a DCR.
- Un token de solo lectura que intenta escribir recibe un error de herramienta, no un 403 HTTP con `insufficient_scope`. Con 403 el cliente reabre el navegador para pedir más scope, y acá la persona eligió solo lectura a propósito.
- CORS abierto solo en los endpoints sin cookies (metadatos, registro, token, revocación). `/api/mcp` rechaza cualquier Origin ajeno.
