# Permisos por rol

Qué puede hacer cada rol del workspace (owner, admin, member, guest) en la
plataforma y en cada app. Sale del código (rutas y helpers citados); si cambiás
una regla, actualizá esta tabla. Revisado: 2026-10-31.

## Cómo funciona

- **Roles:** guest < member < admin < owner (`roleAtLeast`, `lib/teams.ts`).
  `isWorkspaceAdmin` es admin u owner (`lib/session.ts`).
- **Apps por persona:** `team_members.apps` ('*' o una lista). `canUseApp`
  (`lib/workspace.ts`): el owner entra a todas, admin y member a las de su
  lista, el guest a ninguna.
- **Corte central** (`lib/session.ts` `loadCurrentUser`): la API de una app que
  la persona no tiene responde como sin sesión (401); la página cae a su
  workspace propio con `blockedApp` y el layout la manda a `/app?blocked=<app>`,
  que explica el bloqueo y ofrece **Pedir acceso** (aviso al owner y a los
  admins, `app/api/teams/access-request`).
- **Guest:** nunca tiene sesión dentro del workspace ajeno: `resolveWorkspace`
  lo deja en su workspace propio. Ve solo lo que le comparten por recurso
  (páginas de Docs, link de invitado de Board, canales de Talk con invitados,
  lista de invitados de Track). El onboarding corto se lo dice al entrar.
- **Registro por recurso:** varias apps tienen además permisos por registro
  (páginas de Docs, proyectos privados de Track, inboxes restringidos de Chat,
  notas privadas, diseños privados). Eso manda por encima del rol, también
  para admins donde se indica.

## Workspace

| Acción | Owner | Admin | Member | Guest |
|---|---|---|---|---|
| Ver la ficha y el directorio de miembros | Sí | Sí | Sí | No |
| Editar nombre, logo, identificador, modo, dominios | Sí | Sí | No (solo lectura) | No |
| Invitar members y guests (también en lote, hasta 50) | Sí | Sí | No | No |
| Invitar admins / nombrar admins | Sí | No | No | No |
| Revocar o reenviar invitaciones | Sí | Sí | No | No |
| Cambiar rol, apps y subequipos de alguien | Sí (a cualquiera menos a sí) | Solo a members y guests | No | No |
| Sacar a alguien | Sí | Solo members y guests | No | No |
| Salir del workspace | No (el owner no sale) | Sí, en Miembros | Sí, en Miembros | Sí, en Ajustes › Miembros de su cuenta (`/api/teams/guest-of`) |
| Subequipos (crear, editar, borrar) | Sí | Sí | Solo ver | No |
| Aprobar pedidos de ingreso por dominio | Sí | Sí | No | No |
| Recibir y responder "pide acceso" | Sí | Solo de members y guests, por apps que tiene | No | No |
| Recibir "pide sumarse" | Sí | Sí | No | No |
| Dar apps (invitar, editar acceso, aprobar, apps por dominio) | Todas | Solo las que tiene; puede quitar | No | No |
| Reenviar una invitación o ver su link | Todas | Solo las que podría haber hecho (nunca de admins ni con apps que no tiene) | No | No |
| Abrir una invitación a otro email | Todas | Solo las que hizo | No | No |
| API keys | Ve y revoca todas | Ve y revoca todas | Crea las suyas (scopes de sus apps), ve y revoca solo las suyas | No |
| Webhooks | Sí | Si tiene todas las apps | No | No |
| Importar | Sí | Sí | Solo archivos de Docs | No |
| Transferir la propiedad | Todavía no existe (Ajustes › Workspace lo dice) | No | No | No |
| Cerrar el workspace | Todavía no está en el producto: se pide por email y se responde a mano (Ajustes › Workspace) | No | No | No |

Rutas: `app/api/teams/*`, `lib/routes/teams/*`, `canManage` en
`lib/teams-http.ts`, `app/api/keys`, `app/api/webhooks`, `lib/import-http.ts`.

Al **sacar a alguien** (`lib/workspace-lifecycle.ts`): pierde el acceso en el
pedido siguiente; sus API keys se revocan; deja de ser host en Cal y sus
reservas futuras pasan a otro host; sus conversaciones de Chat y Groups vuelven
a la cola; sale de subequipos, canales de Talk, accesos de Track, teamspaces de
Docs y de lo compartido persona a persona. Lo que creó queda en el workspace. Sus links de Send pasan al owner: siguen sobre lo compartido y se frenan sobre lo privado.
Las notas privadas siguen siendo suyas: un admin las puede transferir desde la
consola de Notes solo si la persona ya no está.

## Apps

En todas las apps el guest no entra (ver arriba): la columna Guest solo lista
excepciones. "Admin" incluye al owner.

| App | Member | Solo admin | Por registro / notas |
|---|---|---|---|
| CRM | Crea, edita y borra contactos, empresas y deals dentro de su visibilidad; crea pipelines y campos | Ajustes, equipos de venta, reglas, cuotas, workflows, importar/exportar, acciones en lote, papelera, borrar pipelines, etapas y campos, permisos de campos | Visibilidad del member: todo, solo lo suyo o lo de su equipo (ajuste del workspace). Campos ocultos o de solo lectura por rol |
| Chat | Responde conversaciones, crea inboxes y cambia su configuración | Borrar y renombrar inboxes, equipos, ruteo, campañas, importar, exportar, auditoría, salientes | Inboxes restringidos: solo admins y la lista del inbox |
| Track | Crea y edita issues; crea proyectos y labels | Borrar issues y proyectos, ajustes del proyecto, estados, editar y borrar labels, hitos, ciclos, integraciones, auditoría, accesos | Proyectos privados: solo su lista (los admins los ven listados). Invitados de Track por email ven solo sus proyectos |
| Docs | Según el rol de miembro de la página (por defecto acceso total); manda a la papelera | Borrado definitivo, ajustes (exportar, publicar, invitados), auditoría, sitio y dominio | Teamspaces cerrados o privados: ni los admins entran sin sumarse. Guests: solo páginas compartidas |
| Cal | Ve sus reservas (host o co-host); crea y edita tipos de evento | Ve todas las reservas, borrar tipos de evento, routing, workflows, marca, pagos, SMS, Zoom, actividad, agendar por otros | Encuestas: quien la creó o un admin |
| Link | Crea y edita links | Borrar links, dominios, carpetas, bio, integraciones, exportar | Plantillas y comentarios: quien los creó o un admin |
| Agents | Ve los agentes (o nada, según el agente); edita si está en su lista | Crear agentes, borrar, secretos, aprobaciones, widgets, canales | Acceso por agente |
| Flow | Solo lectura | Crear, editar, borrar y correr flows; credenciales, variables, tablas | Re-correr una ejecución: solo quien la originó |
| Robots | Construye y corre robots si "members pueden construir" está prendido, sin logins guardados | Todo, incluido ese ajuste | |
| Board | Ve y edita los boards abiertos | Gestionar acceso de cualquier board | Boards restringidos: creador, admins e invitados. Link de invitado para editar sin cuenta |
| Notes | Sus notas | Consola: cortar links públicos, transferir notas de quien se fue | Las notas son privadas de quien las escribe, también para el owner |
| Talk | Canales públicos, sus privados y DMs; exporta sus canales | Ajustes, exportar canales públicos, invitados, comandos, campos de perfil | Nadie lee DMs ajenos. Invitados de Talk: solo sus canales |
| Groups | Chats de sus líneas si el acceso por línea está prendido (corte duro, también para asignar), y dentro de ellas los suyos más los de sus etiquetas o equipos si esos accesos están prendidos; marca su estado | Ajustes, líneas y quién ve cada una, accesos, integraciones, reglas, equipos, estado de otros, importar de Periskope, quitar chats de Groups | Teléfonos enmascarados por rol (nunca para el owner). Admins y owner ven todas las líneas |
| People | Edita sus campos de autoservicio; managers aprueban licencias de su línea | Fichas, licencias, documentos, evaluaciones y reportes, sin sueldos | Sueldos y exportación de nómina: owner, HR admins marcados (los nombra solo el owner) y la persona. Un admin sin marca no los lee, no cambia el email de trabajo de una ficha sin cuenta o con sueldo, no cambia el período de pago ni borra una ficha con sueldo. La cuenta enlazada decide quién ve el sueldo: si no coincide con el email de la ficha, el owner o un HR admin la confirman antes de cargarlo. Desempeño: también su línea |
| Books | Lector por defecto; un admin lo hace ventas o contador | Roles, pagos, factura electrónica | Admins son siempre contador |
| Design | Sus diseños y los compartidos | Plantillas del workspace, kit de marca | Diseños privados: ni los admins los ven |
| Rec | Ve sus videos, los del workspace que no están en un espacio y los de sus espacios | Gestionar videos del workspace y todos los espacios | `visibleSql` en `lib/rec.ts` |
| Sign | Sus sobres y los que firma | Ver y gestionar todos | |
| Send | Sus documentos y espacios y los compartidos con el workspace; en un compartido puede armar links propios | Ver y editar todos, exportar CSV, marca del visor | Un documento o espacio nuevo es privado de quien lo sube. Quien abre un link no tiene cuenta: cada imagen, video y descarga vuelve a mirar el link y la sesión. Un link no sirve lo que quien lo armó ya no ve, ni si se fue, perdió la app o pasó a guest; al irse, sus links pasan al owner y siguen solo sobre lo compartido. La URL de un link solo la copia quien lo armó, el dueño o un admin. Crear un link, cambiar sus reglas o lo que muestra no se puede por MCP (`WEB_ONLY_RULES`) |
| Forms | Los compartidos con el workspace (`sharing='workspace'`, el valor por defecto), los suyos y donde está sumado | Ver todos, ajustes | |
| Hiring | Ve los puestos publicados no confidenciales (título y aviso, sin salario oculto, equipo ni etapas) y los de su equipo, sin candidatos salvo que gestione el puesto (`canSeeJob`, `listJobs`, `getJob`); crea puestos solo si un admin lo habilita (`members_create_jobs`, `canCreateJobs`) | Ajustes, ver todo | Candidatos: equipo del puesto y admins. Aprobar ofertas: hiring manager o admin |
| Social | Publica directo o como borrador (aprobación), en las cuentas que le dieron | Conectar cuentas, dar acceso, aprobar | |
| Shop | Gestiona la tienda | Handle, publicar, moneda, reembolsos, credenciales de pago (`savePayments`, `lib/shop-payments.ts`) | |
| Analytics | Usa los proyectos | Proyectos, claves, ajustes, borrar personas | |
| Voice | Sus sesiones; comparte sus reuniones por link (workspace, personas o cualquiera con el link); manda a Slack | Ajustes del workspace, uso, diccionario compartido, mandar a Notion (la credencial escribe con el acceso de quien la cargó) | Sesiones privadas de quien graba, salvo lo que comparte por link |

## Verificado

- **Workspace, en navegador y con pruebas:** `tests/e2e/workspace-roles.spec.ts`
  (por rol), `workspace-teams.spec.ts`, `invite-signup.spec.ts` y
  `tests/unit/workspace-*.test.ts`.
- **Corte por app, en navegador:** `workspace-teams.spec.ts` prueba a una persona
  con CRM y Docs sin Track ni Link (HTML, RSC, búsqueda, inicio, v1 y MCP).
- **Tabla de apps, sin pasada en navegador:** sale de leer rutas y helpers, no de
  probar cada acción con cada rol. Social, Shop, Rec, Sign, Forms, Send, Hiring, Voice
  y Analytics salen sobre todo de comentarios de cabecera y algunas rutas:
  revisarlos antes de publicarlos como garantía.

## Por decidir

- Track y CRM: un member crea proyectos, labels, pipelines y campos que después
  solo un admin puede borrar.
- Cal: un member edita tipos de evento de otra persona (no hay chequeo de host).
- Chat: un member crea inboxes y cambia su configuración salvo el nombre.
- Muchas apps responden 403 a acciones de admin sin explicar por qué en la UI.
