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
| Salir del workspace | No (el owner no sale) | Sí | Sí | Sí |
| Subequipos (crear, editar, borrar) | Sí | Sí | Solo ver | No |
| Aprobar pedidos de ingreso por dominio | Sí | Sí | No | No |
| Recibir "pide acceso" y "pide sumarse" | Sí | Sí | No | No |
| API keys | Ve y revoca todas | Ve y revoca todas | Crea las suyas (scopes de sus apps), ve y revoca solo las suyas | No |
| Webhooks | Sí | Si tiene todas las apps | No | No |
| Importar | Sí | Sí | Solo archivos de Docs | No |
| Transferir la propiedad | Todavía no existe (Ajustes › Workspace lo dice) | No | No | No |
| Borrar el workspace | Todavía no hay botón: por email a privacy@ (Ajustes › Workspace) | No | No | No |

Rutas: `app/api/teams/*`, `lib/routes/teams/*`, `canManage` en
`lib/teams-http.ts`, `app/api/keys`, `app/api/webhooks`, `lib/import-http.ts`.

Al **sacar a alguien** (`lib/workspace-lifecycle.ts`): pierde el acceso en el
pedido siguiente; sus API keys se revocan; deja de ser host en Cal y sus
reservas futuras pasan a otro host; sus conversaciones de Chat y Groups vuelven
a la cola; sale de subequipos, canales de Talk, accesos de Track, teamspaces de
Docs y de lo compartido persona a persona. Lo que creó queda en el workspace.
Las notas privadas siguen siendo suyas: un admin las puede transferir desde la
consola de Notes solo si la persona ya no está.

## Apps

En todas las apps el guest no entra (ver arriba): la columna Guest solo lista
excepciones. "Admin" incluye al owner.

| App | Member | Solo admin | Por registro / notas |
|---|---|---|---|
| CRM | Crea, edita y borra contactos, empresas y deals dentro de su visibilidad; crea pipelines y campos | Ajustes, equipos de venta, reglas, cuotas, workflows, importar/exportar, acciones en lote, papelera, borrar pipelines, etapas y campos, permisos de campos | Visibilidad del member: todo, solo lo suyo o lo de su equipo (ajuste del workspace). Campos ocultos o de solo lectura por rol |
| Chat | Responde conversaciones, crea inboxes y cambia su configuración | Borrar y renombrar inboxes, equipos, ruteo, campañas, importar, exportar, auditoría, salientes | Inboxes restringidos: solo admins y la lista del inbox |
| Track | Crea y edita issues, proyectos y labels | Borrar issues y proyectos, ajustes del proyecto, estados, labels, hitos, ciclos, integraciones, auditoría, accesos | Proyectos privados: solo su lista (los admins los ven listados). Invitados de Track por email ven solo sus proyectos |
| Docs | Según el rol de miembro de la página (por defecto acceso total); manda a la papelera | Borrado definitivo, ajustes (exportar, publicar, invitados), auditoría, sitio y dominio | Teamspaces cerrados o privados: ni los admins entran sin sumarse. Guests: solo páginas compartidas |
| Cal | Ve sus reservas (host o co-host); crea y edita tipos de evento | Ve todas las reservas, borrar tipos de evento, routing, workflows, marca, pagos, SMS, Zoom, actividad, agendar por otros | Encuestas: quien la creó o un admin |
| Link | Crea y edita links | Borrar links, dominios, carpetas, bio, integraciones, exportar | Plantillas y comentarios: quien los creó o un admin |
| Agents | Ve los agentes (o nada, según el agente); edita si está en su lista | Crear agentes, borrar, secretos, aprobaciones, widgets, canales | Acceso por agente |
| Flow | Solo lectura | Crear, editar, borrar y correr flows; credenciales, variables, tablas | Re-correr una ejecución: solo quien la originó |
| Robots | Construye y corre robots si "members pueden construir" está prendido, sin logins guardados | Todo, incluido ese ajuste | |
| Board | Ve y edita los boards abiertos | Gestionar acceso de cualquier board | Boards restringidos: creador, admins e invitados. Link de invitado para editar sin cuenta |
| Notes | Sus notas | Consola: cortar links públicos, transferir notas de quien se fue | Las notas son privadas de quien las escribe, también para el owner |
| Talk | Canales públicos, sus privados y DMs; exporta sus canales | Ajustes, exportar canales públicos, invitados, comandos, campos de perfil | Nadie lee DMs ajenos. Invitados de Talk: solo sus canales |
| Groups | Chats según etiquetas si el acceso por etiqueta está prendido | Ajustes, números, accesos, integraciones, reglas, equipos | Teléfonos enmascarados por rol (nunca para el owner) |
| People | Edita sus campos de autoservicio; managers aprueban licencias de su línea | Nombrar admins de RR. HH. | Compensación: RR. HH. y la persona. Desempeño: también su línea |
| Books | Lector por defecto; un admin lo hace ventas o contador | Roles, pagos, factura electrónica | Admins son siempre contador |
| Design | Sus diseños y los compartidos | Plantillas del workspace, kit de marca | Diseños privados: ni los admins los ven |
| Rec | Sus videos y los de sus espacios | Gestionar videos del workspace y todos los espacios | |
| Sign | Sus sobres y los que firma | Ver y gestionar todos | |
| Forms | Sus formularios, los compartidos y donde está sumado | Ver todos, ajustes | |
| Hiring | Lo de los puestos donde está en el equipo de selección | Ajustes, ver todo | Aprobar ofertas: hiring manager o admin |
| Social | Publica directo o como borrador (aprobación), en las cuentas que le dieron | Conectar cuentas, dar acceso, aprobar | |
| Shop | Gestiona la tienda | Handle, publicar, moneda, reembolsos | |
| Analytics | Usa los proyectos | Proyectos, claves, ajustes, borrar personas | |
| Voice | Sus sesiones | Ajustes del workspace, uso, diccionario compartido | Sesiones privadas de quien graba |

## Verificado

- Workspace: pruebas unitarias (`tests/unit/workspace-teams*.test.ts`,
  `tests/unit/workspace-access-request.test.ts`) y e2e por rol
  (`tests/e2e/workspace-roles.spec.ts`, `workspace-teams.spec.ts`,
  `invite-signup.spec.ts`).
- Apps: la tabla sale de leer las rutas y helpers; CRM, Docs, Track, Link y
  Talk tienen e2e de acceso por app (`workspace-teams.spec.ts`). Social, Shop,
  Rec, Sign y Hiring salen de los comentarios de cabecera y algunas rutas:
  revisarlos antes de publicarlos como garantía.

## Por decidir

- Track y CRM: un member crea proyectos, labels, pipelines y campos que después
  solo un admin puede borrar.
- Cal: un member edita tipos de evento de otra persona (no hay chequeo de host).
- Chat: un member crea inboxes y cambia su configuración salvo el nombre.
- Muchas apps responden 403 a acciones de admin sin explicar por qué en la UI.
