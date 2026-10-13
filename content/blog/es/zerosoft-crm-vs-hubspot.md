---
title: "CRM vs. HubSpot: qué hace cada uno hoy"
description: "Dónde HubSpot está adelante (marketing, integraciones, IA, apps móviles), qué hace hoy el CRM de zerosoft (secuencias, cotizaciones, formularios, lead scoring, API) y quién debería quedarse donde está."
date: "2026-10-05"
author: "zerosoft"
tags: ["crm", "hubspot", "comparativa"]
---

HubSpot es una plataforma de marketing, ventas, soporte y contenido con un CRM en el medio, construida durante casi dos décadas por una empresa grande. El CRM de zerosoft es un CRM de ventas: contactos, empresas, deals, email, tareas y reportes. Este post dice dónde gana HubSpot, qué hace hoy nuestro CRM y quién debería elegir cuál.

## La versión corta

- **Quedate en HubSpot** si tu marketing pasa por el CRM (campañas masivas, landing pages, nurturing según el comportamiento en tu sitio), si dependés de su marketplace de integraciones o de sus apps móviles, o si necesitás SSO y audit logs hoy.
- **Mirá el CRM de zerosoft** si usás el pipeline, las fichas, el email de ventas y los reportes, pagás asientos que no aprovechás y preferís ser dueño de la base, la API y el código.

## Dónde HubSpot está adelante

**Marketing.** Campañas de email masivas, landing pages, flujos de nurturing y segmentación por comportamiento web. Nuestro CRM no tiene módulo de marketing: tiene formularios de captura y secuencias de ventas uno a uno.

**Email.** HubSpot conecta Gmail y Outlook. Nosotros, solo Gmail, y conectarlo requiere que Google verifique la app para los permisos de lectura y envío; hasta entonces solo funciona con usuarios de prueba. Las secuencias corren desde un cron por hora, así que un paso sale dentro de la hora en que vence.

**Cotizaciones con cobro.** Nuestras cotizaciones tienen página pública, aceptación con nombre y PDF por impresión, pero no firma electrónica ni cobro.

**Integraciones.** HubSpot tiene un marketplace enorme. Nosotros tenemos API REST, webhooks, Flow (que conecta con el resto de la suite y con cualquier API por HTTP) y la acción `webhook` de los workflows.

**IA.** HubSpot trae asistentes para redactar, resumir y prospectar. Nuestro CRM tiene "redactar con IA" en el email, si la IA está activada, y nada más por ahora.

**Apps móviles.** HubSpot tiene apps para iOS y Android. Nuestro CRM se usa desde el navegador del celular, y las tablas se desplazan de costado en lugar de pasar a tarjetas.

**Enterprise.** SSO, SCIM, audit logs y permisos por campo. Nuestras funciones enterprise viven en `/ee` y siguen en desarrollo.

## Qué hace hoy el CRM de zerosoft

**Registros y asociaciones.** Contactos, empresas y deals con su timeline y sus tareas. Un contacto puede estar en varias empresas, con etiquetas (decisor, facturación, champion) y una primaria. Las empresas tienen jerarquía y suman el valor de los deals del árbol. Campos personalizados y tags.

**Pipelines.** Varios pipelines con etapas y probabilidades propias, tabla y tablero kanban, ganado o perdido con motivo e indicador de deals estancados.

**Email de ventas.** Envío desde tu Gmail en el timeline, sync automático de la bandeja con los hilos en el contacto correcto, plantillas y snippets con variables, tracking de aperturas y clics, y secuencias de varios pasos que se cortan solas si el contacto responde, reserva en Cal o se da de baja.

**Productos y cotizaciones.** Catálogo con SKU, impuestos y recurrencia; líneas en cada deal; cotizaciones con página pública donde el cliente acepta o rechaza. Varias monedas con tipos de cambio manuales.

**Captura y calificación.** Formularios hosteados o embebidos que crean el contacto, guardan UTMs y pueden asignar dueño por round-robin. Lead scoring por propiedades y por actividad reciente.

**Equipos.** Visibilidad por miembro (todo, lo propio o lo de su equipo de ventas), cuotas mensuales o trimestrales y asignación de leads por round-robin.

**Workflows y reportes.** Disparadores por cambios en registros, tareas, emails, reuniones, cotizaciones aceptadas, formularios y score, con ramas sí/no. Reportes de embudo, forecast, origen, responsable y actividad, más dashboards con widgets. Ver [cinco recetas](/blog/workflows-crm-tareas-de-seguimiento) y [la revisión semanal](/blog/revision-semanal-del-crm).

**Importar, exportar y API.** Importación CSV de contactos, empresas y deals con mapeo, deduplicado y un preset para la exportación de HubSpot. Exportación en CSV o JSON. API REST en `/api/v1/crm/*` con scopes por clave, documentada en [/docs](/docs).

**El resto de la suite.** Cada reserva de Cal crea el contacto y registra la reunión; desde Chat creás el contacto y guardás la conversación.

## Precios

HubSpot tiene un CRM gratis y hubs pagos por plan y por asiento, con algunos productos que cobran por contactos de marketing. Los detalles cambian seguido: mirá su página de precios.

El CRM de zerosoft cuesta $0 en tu servidor, con todas las funciones del core, bajo AGPLv3. En zerosoft Cloud hay un plan gratis y después pago por uso (emails, almacenamiento). No se cobra por asiento ni por contacto.

## Quién debería quedarse en HubSpot

- Equipos donde **marketing y ventas comparten el CRM** y viven de campañas y landing pages.
- Quien necesita **Outlook**, **firma electrónica** o **cobrar desde la cotización**.
- Empresas cuyo stack depende del **marketplace de integraciones**.
- Vendedores que trabajan desde **la app del celular**.
- Organizaciones que necesitan **SSO, audit logs y permisos por campo** hoy.

## A quién le sirve el CRM de zerosoft

- Equipos chicos que usan HubSpot como **base de contactos, pipeline y email de ventas** y pagan por mucho más.
- Founders y agencias que quieren **secuencias, cotizaciones y reportes** sin una llamada de ventas.
- **Developers** que quieren una API documentada, exportación completa y self-hosting sobre SQLite o Turso.
- Equipos a los que les importa **dónde viven los datos de sus clientes**.
- Quien ya usa **Cal, Link o Chat** de zerosoft.

## Probalo con tus datos

Exportá una parte de tus contactos y empresas de HubSpot, importalos con el preset, armá un pipeline y hacé tu próxima revisión semanal desde ahí. Con una tarde alcanza para saber si te sirve.
