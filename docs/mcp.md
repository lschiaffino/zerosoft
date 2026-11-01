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

Clase de cada operación: DELETE y lo que manda algo afuera, mueve plata o toca muchos registros (`DESTRUCTIVE_EFFECT`) es destructiva, GET es lectura salvo que se alcance SQL de escritura o gaste créditos, lo demás es escritura. Exportaciones y datos sensibles (`auditedRead`) quedan en la auditoría. Lo desconocido nunca es lectura. Un POST que solo lee va a `READ_POST` y un GET que solo escribe auditoría o siembra defaults (o refresca un token o un cache) a `MUTATING_GET_OK`, después de mirar todo el SQL que alcanza con `--report`. Un GET que cambia datos de la persona queda como escritura. La búsqueda de SQL tiene profundidad acotada: una escritura más honda se puede escapar.

## Modelo de seguridad

- Todo corre como la persona: `invoke.ts` llama al handler real en proceso, dentro de `runAsDelegated`. `getCurrentUser` y `requireApiUser` resuelven desde ahí, con los mismos chequeos. No hay permisos paralelos.
- El ALS no se prende desde afuera: no hay header ni cookie. Tampoco hay HTTP interno, así que no hay SSRF: el cliente solo elige una entrada de `ROUTE_TABLE`.
- Una conexión queda fijada al workspace elegido al aprobarla (`oauth_grants.team_id`) y no cambia: para trabajar en otro, se vuelve a conectar. Si la persona sale, las operaciones fallan: nunca caen a otro workspace. Cambiar de workspace en el navegador no la mueve.
- Tope de la credencial: scope `read` o `write` en OAuth, scopes de la key en API keys. Una key solo llega al MCP si se creó con acceso al MCP (`mcp`, opt-in): las demás siguen solo con v1. Una app sin scope propio (Flow, Rec, Agents, Robots, Workspace) pide una key con todos.
- Tokens: solo su SHA-256 en la base. Access de 1 h; refresh de 60 días, rota en cada uso. Repetir el recién rotado dentro de 30 s da tokens de la misma conexión (comandos en paralelo); después es reuso y revoca la conexión. Reusar un código de autorización también revoca.
- Audiencia: el token se emite para `<NEXTAUTH_URL>/api/mcp` y se compara en cada pedido.
- Redirects: https o loopback, coincidencia exacta salvo el puerto en loopback (RFC 8252 §7.3, OAuth 2.1 §8.4.2).
- Las pantallas de permisos no se dejan enmarcar y el POST exige Origin propio.
- Salida: etiquetas `<untrusted_data>` con nonce por respuesta, secretos y URLs que funcionan como credencial tapados (`scrub.ts`), 60.000 caracteres por llamada con paginación. Un cuerpo con la marca de valor tapado se rechaza: no pisa el secreto.
- Lo que crea una credencial, una URL que funciona como credencial o guarda keys de terceros no está en el catálogo (`WEB_ONLY_RULES`): responde `web_only` con dónde hacerlo.
- Campos sueltos con una URL que el servidor llama o la key de un tercero, dentro de operaciones normales, se rechazan en `field-policy.ts`: una línea en la lista por cada campo nuevo. Las automatizaciones (flows, workflows del CRM, robots) sí llevan sus URLs: son de clase destructiva, y lo que se prende sigue corriendo al desconectar, como dicen la pantalla de permisos y la documentación.
- Pedidos de autorización inválidos terminan en `/oauth/error`, nunca en una URI registrada. El link del dispositivo no salta a los permisos y arranca en solo lectura.
- Rate limit por conexión: 300 lecturas y 60 escrituras por minuto. Auditoría de cada escritura en `mcp_audit_log`, sin argumentos ni secretos.

## Decisiones

- Sin dependencia nueva: el protocolo es JSON-RPC simple y `lib/track-mcp.ts` ya estaba hecho a mano.
- Registro dinámico de clientes (RFC 7591). Client ID Metadata Documents no está implementado: suma una salida HTTP a URLs ajenas y los clientes actuales caen a DCR.
- Un token de solo lectura que intenta escribir recibe un error de herramienta, no un 403 HTTP con `insufficient_scope`. Con 403 el cliente reabre el navegador para pedir más scope, y acá la persona eligió solo lectura a propósito.
- CORS abierto solo en los endpoints sin cookies (metadatos, registro, token, revocación). `/api/mcp` rechaza cualquier Origin ajeno.
