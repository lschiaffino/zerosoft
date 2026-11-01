---
title: "Migrar de Linear a Track: qué se importa y cómo hacerlo"
description: "Guía para pasar tus issues de Linear a Track con una API key o el CSV: qué entra (teams, cycles, labels, comentarios), qué no viaja y qué revisar después."
date: "2026-10-31"
author: "zerosoft"
tags: ["track", "linear", "migración", "guía"]
---

Dejar Linear da miedo por una razón concreta: años de issues y cycles que nadie quiere copiar a mano. Esta guía explica cómo funciona el import de Linear en [Track](/products/track), qué trae exactamente (lo leímos del código del importador), qué queda afuera y qué conviene revisar cuando termina.

## Dos caminos: API key o CSV

Los dos están en Track, en **Ajustes › Importar y exportar**, y también en el hub de importación del workspace (**Ajustes › Importar**, fuente Linear). Solo quien administra el workspace puede importar, porque lo que entra lo ve todo el equipo.

**API key de Linear.** Es el camino más completo.

1. En Linear, abrí Settings › Account › Security & access › Personal API keys y creá una key nueva.
2. Dale acceso de lectura. El importador solo lee: no escribe nada en Linear.
3. En Track, elegí **Linear (API key)** en *Importar desde*, pegá la key y elegí el destino en *En*: un equipo existente o **Un equipo nuevo por cada team de Linear**.
4. Tocá **Vista previa**, revisá lo que aparece y confirmá con **Importar N issues**.

La key queda cifrada mientras se leen tus datos y se borra cuando el import termina, falla o se cancela.

**CSV de Linear.** Si preferís no generar una key, exportá desde Linear en Settings › Workspace › Import and export › Export CSV y elegí **Linear (export CSV)**. Track reconoce los encabezados de Linear y te propone el mapeo de columnas, que podés corregir (el título es obligatorio). El archivo puede pesar hasta 4 MB; si es más grande, partilo. Por CSV entra lo que traigan las columnas, así que los comentarios y las fechas objetivo de los proyectos son más confiables por API.

Los dos caminos comparten los identificadores externos: si importaste por CSV y después corrés el import por API, los issues que ya estaban no se duplican.

## Cómo se traduce Linear a Track

Track usa el vocabulario de Linear, así que casi todo cae en su lugar:

- **Teams → equipos.** Cada team de Linear pasa a ser un equipo de Track, y la clave del team (por ejemplo `ENG`) es el prefijo de los identificadores nuevos.
- **Proyectos de Linear → milestones** dentro del equipo, con su fecha objetivo. La explicación es estructural: en Linear un proyecto puede cruzar varios teams y acá se cuelga del equipo de cada issue.
- **Estados.** Se buscan por nombre en el equipo; si no existe, se crea con su categoría. Backlog y Triage van a Backlog, Unstarted a Por hacer, Started a En progreso, Completed a Hecho y Canceled a Cancelado.
- **Prioridad.** Urgent, High y Low se mantienen. Medium y *No priority* entran como Media: Track tiene cuatro prioridades y ningún valor aparte de "sin prioridad".
- **Cycles**, con su fecha de inicio y de fin.
- **Labels** con su color, hasta diez por issue.
- **Estimación**, **vencimiento** y **fecha de creación** originales.
- **Sub-issues.** Una segunda pasada engancha cada sub-issue con su padre, aunque el padre haya llegado después.
- **Comentarios** con su fecha, hasta 50 por issue.
- **Responsables**, emparejados por email con los miembros del workspace.

## Qué no viaja

Mejor saberlo antes de empezar:

- **Las relaciones** (bloquea, relacionado, duplicado). Solo se importa la relación padre e hijo.
- **Adjuntos, reacciones y suscriptores.**
- **Los textos largos.** Descripciones y comentarios se cortan a 5.000 caracteres.
- **El número exacto del identificador.** El prefijo viene del team, pero los números se asignan en Track a medida que se crean los issues, así que `ENG-142` puede no quedar como `ENG-142`. Si tenés links a issues en otros lados, revisalos.
- **Cambios posteriores.** Reimportar saltea los issues que ya entraron y solo suma comentarios nuevos. Si cambiás un título en Linear después del import, ese cambio no se trae.
- **Cuentas enormes.** Cada import trae hasta 20.000 issues. Si tu workspace tiene más, la vista previa te avisa que el resto quedó afuera.

## La vista previa: dónde se decide todo

Antes de que se cree nada, Track muestra cuántos issues, comentarios, equipos, labels, cycles y milestones van a entrar. Debajo tenés tres tablas que vale la pena leer:

- **Equipos**, marcados como nuevos o existentes.
- **Status**, con su tipo y si se crea uno nuevo o se usa uno que ya existe.
- **Responsables**, con el miembro que les tocó. Quien no es miembro del workspace queda sin responsable, y la vista previa lo marca.

Ese último punto es el más importante: **invitá a tu equipo antes de importar**. Si las personas ya están en el workspace con el mismo email que usan en Linear, los issues quedan asignados y los comentarios firmados por su autor. Si no, el issue entra sin responsable y el comentario lo firma quien importa, con el nombre original en negrita arriba del texto.

## Mientras corre

El import avanza por tandas. En Linear se lee de a 50 issues por página y, si la API de Linear responde con límite de pedidos, el importador espera un minuto y sigue. Podés cerrar la pestaña: el cron de cada minuto retoma el trabajo donde quedó. El import tampoco manda notificaciones ni dispara webhooks, porque es una mudanza y no actividad nueva.

## Qué revisar después

Cuando termina, el resumen dice cuántos issues y comentarios entraron, cuántos se saltearon, qué se creó y cuántos issues quedaron sin responsable. Después:

1. **Abrí tres o cuatro issues grandes** y compará descripción, labels y comentarios con Linear.
2. **Mirá los estados de cada equipo.** Si Linear tenía estados casi iguales ("In Review" y "Review"), quizás quieras unificarlos.
3. **Revisá los cycles** del equipo y el cycle activo.
4. **Repasá los issues sin responsable** y asignalos.
5. **Pasá los milestones** de cada equipo y sus fechas objetivo.

Si algo salió mal, corregí en Linear y reimportá: no se duplica.

## Qué le falta a Track frente a Linear

Lo publicamos en la tabla de paridad y lo repetimos acá:

- **Apps nativas de iOS y Android con push**: todavía no.
- **Modo offline**: todavía no.
- **SSO**: el login es solo con Google, sin SAML ni SCIM. Sí hay audit log con filtros y export.
- **Permisos por equipo**: hay equipos privados e invitados limitados a ciertos equipos, pero no un rol de dueño por equipo.
- **Integraciones**: Sentry, Figma, Zendesk e Intercom funcionan en parte. No hay app dentro del sidebar de Zendesk o Intercom.

La lista completa, área por área, está en [/compare/zerosoft-vs-linear](/compare/zerosoft-vs-linear).

## Cuánto cuesta

Linear Standard cuesta $8 por usuario por mes: un equipo de diez paga $960 al año. Track en tu servidor cuesta $0; el core es AGPLv3 con todas sus funciones. En zerosoft Cloud arrancás con un plan gratis y después pagás por uso. Los asientos no se cobran, así que sumar a alguien al equipo no cambia la factura.

Si querés ver cómo se comparan en el día a día, escribimos [Track vs Linear](/blog/zerosoft-track-vs-linear), y para planificar después de la mudanza, [cómo usar los ciclos en Track](/blog/ciclos-en-track). Y si un día te querés ir, Track exporta los issues a CSV desde la misma pestaña donde importaste.
