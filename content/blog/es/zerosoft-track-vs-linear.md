---
title: "Zerosoft Track vs Linear: una comparación honesta"
description: "Dónde Linear está claramente adelante, dónde Track se defiende y quién no debería cambiarse. Una comparación escrita por quienes construimos Track, con los huecos a la vista."
date: "2026-09-08"
author: "Zerosoftware"
tags: ["track", "linear", "comparación"]
---

Cuando arrancamos Track, escribimos que [Linear es probablemente el mejor issue tracker que se construyó](/blog/linear-cuesta-8-track-costara-0). Lo seguimos pensando. Aquel post era sobre precio. Este es sobre producto: qué hace cada herramienta hoy, dónde Linear está adelante y quién debería quedarse donde está.

Una aclaración antes de empezar: ese mismo post prometía que Track iba a ser keyboard-first y tener API desde el día uno. No lo es, y no la tiene — todavía. Preferimos decirlo de entrada antes de que lo descubras vos.

## La versión corta

- **Linear** es el producto más maduro, más rápido y más pulido, con un ecosistema de integraciones enorme. Si tu equipo es fuertemente de ingeniería y vive en GitHub, es muy difícil de superar.
- **Track** cubre el núcleo de un issue tracker — proyectos, issues, sub-issues, relaciones, ciclos, cuatro vistas — y es open source (AGPLv3), self-hosteable y parte de una suite con CRM, chat, docs y agenda. Le sirve a equipos chicos que quieren ser dueños de sus datos y no necesitan las integraciones.

Ahora, el detalle.

## Dónde Linear está claramente adelante

**Velocidad y teclado.** La interfaz de Linear está construida sobre actualizaciones optimistas y una paleta de comandos; podés hacer casi todo sin tocar el mouse. Track todavía no tiene atajos de teclado. Es una web app normal: hacés clic, guarda.

**Tiempo real.** En Linear, el cambio de un compañero aparece en tu pantalla mientras pasa. En Track refrescás. Para un equipo de cuatro es una molestia menor; para uno de cuarenta haciendo triage en el mismo board, es una diferencia real.

**Integraciones con Git.** Linear vincula issues con branches, commits y pull requests en GitHub y GitLab, y puede mover issues solo cuando se mergea un PR. Track no tiene ninguna integración con Git. Si "el PR cierra el issue" es parte de tu flujo, eso solo ya define la elección.

**API y webhooks.** Linear tiene API pública y webhooks, y todo un ecosistema de herramientas construidas encima. Track todavía no tiene API pública ni webhooks; sus endpoints son internos y autenticados por sesión. (Otros productos de Zerosoft — Link, CRM, Cal — sí tienen API pública; Track no.)

**Planificación por encima del issue.** Linear tiene roadmaps y planificación de alto nivel entre proyectos. Track tiene proyectos y ciclos, y ahí termina. Sin roadmaps.

**Herramientas de ciclos.** Los ciclos de Linear vienen con seguimiento de progreso y pase automático del trabajo sin terminar. En Track, un ciclo es un nombre y dos fechas; los issues le pertenecen y podés filtrar por él. No hay gráficos de velocity ni burndown, no hay pase automático, y — hoy — los ciclos y los estados propios se crean con un endpoint en lugar de una pantalla de configuración. Escribimos un [playbook para correr ciclos en Track](/blog/ciclos-en-track) que es honesto con los workarounds.

**Importación.** Linear importa desde Jira, Asana, GitHub Issues y otros. Track no importa desde Linear, ni desde ningún otro lado.

**Pulido y amplitud.** Apps móviles, app de escritorio, integraciones con Slack y muchas otras herramientas, flujos de triage, años de refinamiento. Linear tuvo mucho tiempo y un equipo muy bueno. Se nota.

## Dónde Track se defiende

**El modelo central está.** Issues con título, descripción con formato, estado, prioridad, responsable, labels, fecha de entrega, estimación y ciclo. Sub-issues que son issues completos. Relaciones — `blocks`, `related`, `duplicates` — visibles desde las dos puntas. Comentarios con @menciones, adjuntos de hasta 10 MB, log de actividad por issue y un inbox de notificaciones para menciones, asignaciones y cambios de estado. Estados propios mapeados a cinco categorías (backlog, todo, in progress, done, cancelled).

**Cuatro vistas de fábrica.** Lista, board, calendario (por fecha de entrega) y Gantt (arrastrás las barras para cambiar inicio y entrega). Cualquier combinación de vista, filtros y orden se guarda como vista personal, y una puede ser tu default.

**Podés ser dueño.** Track es AGPLv3. Podés leer cada línea, hostearlo en tu servidor gratis, y tus issues viven en un archivo SQLite (o una base libSQL/Turso) que controlás vos. Nadie te puede cambiar las condiciones, discontinuar un plan ni tomar de rehén tu historial. Escribimos más sobre [por qué eso importa](/blog/el-lock-in-es-el-producto).

**Es parte de una suite.** El mismo login y el mismo equipo te dan CRM, chat de soporte, docs, agenda y links. La retro del sprint puede vivir en Docs; un bug que llegó por Chat se convierte en issue de Track cuando una persona lo copia (todavía no hay vínculo automático entre los dos — somos precisos). Si sos una empresa chica tratando de bajar la cantidad de herramientas y facturas, eso suma.

**Precio que no crece con la nómina.** Linear cobra por usuario en sus planes pagos y tiene un plan gratis con límites; mirá su página de precios para los números actuales. Track self-hosted es gratis, para siempre. Zerosoft Cloud tiene un tier gratuito generoso y después pago por uso, con precios publicados antes de cobrarte nada. Sin línea por asiento.

## Quién debería quedarse en Linear

Sé honesto con vos mismo. Quedate en Linear si:

- Tu equipo de ingeniería vincula PRs con issues y depende de esa automatización.
- En tu equipo hay gente que vive en el teclado y sentiría la falta de atajos cada hora.
- Más de un puñado de personas trabaja el mismo board a la vez y necesita tiempo real.
- Usás la API, los webhooks o las integraciones de Linear (Slack, Sentry, herramientas de soporte, etc.).
- Planificás con roadmaps, o dependés de las métricas de ciclo y el pase automático.
- Necesitás apps móviles.

Para esos equipos, pasarse hoy a Track sería un retroceso, y no queremos que lo hagan.

## Para quién es Track

Track tiene sentido si:

- Sos un equipo chico (agencia, estudio, startup temprana, equipo interno de operaciones) que necesita issues, ciclos y un board, no una plataforma de ingeniería.
- Querés tus datos en tu propio servidor, o al menos en una herramienta open source que podrías llevar ahí.
- Ya usás, o querés usar, otros productos de Zerosoft y preferís un solo stack.
- El precio por asiento es un costo real para vos, sobre todo con colaboradores ocasionales que solo necesitan ver el board.

## Cómo probarlo sin riesgo

Levantá Track en local con `DEMO_MODE=true` y jugá con los datos de demo, o creá una cuenta gratis en Zerosoft Cloud. Corré un ciclo real con un proyecto chico antes de mover algo importante. No hay importador desde Linear, así que mudarte significa recrear tus issues abiertos — razonable para un equipo con cincuenta tickets abiertos, doloroso para uno con cinco mil.

## En resumen

Linear es mejor producto hoy, y para muchos equipos vale cada centavo. Track es la alternativa honesta, abierta y self-hosteable que cubre el núcleo — y que es tuya. Vamos a seguir achicando la distancia. Cuando lleguen los atajos de teclado, el tiempo real o una API, lo vamos a contar acá, no antes.
