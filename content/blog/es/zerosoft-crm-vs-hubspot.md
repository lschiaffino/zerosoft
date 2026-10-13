---
title: "Zerosoft CRM vs. HubSpot: una comparación honesta"
description: "Dónde HubSpot está muy adelante, dónde Zerosoft CRM se defiende y quién debería quedarse donde está. Una comparación que admite los huecos en vez de esconderlos."
date: "2026-10-05"
author: "Zerosoftware"
tags: ["crm", "hubspot", "comparativa"]
---

HubSpot no es un CRM. Es una plataforma de marketing, ventas, soporte y contenido con un CRM en el medio, construida durante casi dos décadas por una empresa muy grande. Zerosoft CRM es un CRM: contactos, empresas, deals, tareas y los reportes alrededor. Compararlos feature por feature sería injusto para nosotros y deshonesto para vos, así que vamos a hacer otra cosa: decir claramente dónde gana HubSpot, qué hace hoy Zerosoft CRM y quién debería elegir cuál.

## La versión corta

- **Quedate en HubSpot** si tu marketing pasa por el CRM: campañas de email, secuencias, tracking de aperturas, formularios en tu sitio, lead scoring. O si necesitás cotizaciones, un marketplace grande de integraciones, funciones de IA o apps móviles.
- **Mirá Zerosoft CRM** si lo que realmente usás es el pipeline, las fichas de contacto y algunos reportes, estás pagando asientos y planes que no tocás, y preferís ser dueño de la base, la API y el código.

## Dónde HubSpot está muy adelante

Esta es la sección larga, a propósito.

**Automatización de marketing.** HubSpot puede manejar toda tu operación de marketing: campañas, flujos de nurturing, landing pages, segmentación según el comportamiento en tu sitio. Zerosoft CRM no tiene módulo de marketing. Nuestros workflows pueden mandar un email cuando le pasa algo a un registro, pero es un email automático suelto, no una herramienta de campañas.

**Secuencias y plantillas de email.** Secuencias de venta de varios pasos que se cortan cuando el prospecto responde, una biblioteca de plantillas compartida, snippets. Zerosoft CRM **no tiene nada de eso** hoy. Está en el roadmap.

**Tracking de aperturas y clics.** HubSpot te dice quién abrió qué. Nosotros no trackeamos aperturas ni clics de los emails del CRM.

**Sincronización automática del email.** HubSpot registra tu bandeja en el contacto correcto en segundo plano. Nuestra integración con Gmail es **de solo lectura y a demanda**: apretás "sincronizar", revisa hasta 100 de tus contactos actualizados más recientemente, trae hasta 8 mensajes recientes por contacto y guarda metadata (asunto, fragmento, dirección, fecha), no el cuerpo. Nada corre en segundo plano. Sin Outlook.

**Cotizaciones, productos y líneas.** HubSpot arma una cotización desde un catálogo de productos y la manda a firmar. Los deals de Zerosoft CRM tienen monto, etapa y fecha de cierre. Sin productos, sin cotizaciones, sin line items.

**Formularios de captura.** HubSpot te da formularios para embeber en tu sitio que crean contactos solos. Nosotros no tenemos formularios de leads en el CRM. Podés crear contactos por API desde tu propio formulario, pero eso es código que escribís vos.

**Marketplace de integraciones.** HubSpot tiene un marketplace con una cantidad enorme de apps. Zerosoft CRM tiene una API REST, una acción `webhook` dentro de los workflows y conexiones nativas con los otros productos de Zerosoft. Todavía no emitimos eventos de webhook propios del CRM.

**Funciones de IA.** HubSpot trae asistentes de IA para redactar, resumir y prospectar. Zerosoft CRM no tiene funciones de IA.

**Apps móviles.** HubSpot tiene apps para iOS y Android. Nosotros no; el CRM funciona en el navegador del celular y listo.

**Enterprise y madurez.** SSO, SCIM, audit logs, roles personalizados, permisos granulares, papeles de compliance, una red de partners y un ejército de consultores. Nuestras funciones enterprise viven en la carpeta `/ee` y siguen en desarrollo. Y una más mundana: los deals y las actividades no se pueden importar, solo contactos y empresas.

Si alguno de estos puntos es la razón por la que compraste HubSpot, el resto del post no cambia eso.

## Qué hace hoy Zerosoft CRM

Nada de esto es exótico. Es el núcleo de un CRM, hecho con cuidado, con el código a la vista.

**Registros y asociaciones.** Contactos, empresas y deals, vinculados entre sí, cada uno con su timeline de actividades y sus tareas. Campos personalizados de cinco tipos: texto, número, fecha, selección y booleano.

**Pipelines.** Varios pipelines con tus propias etapas y probabilidades, una vista de tabla y un tablero kanban donde arrastrás deals entre etapas. Escribimos sobre [cómo mantener ese tablero honesto](/blog/higiene-del-pipeline).

**Listas y vistas.** Listas estáticas donde agregás gente a mano, listas dinámicas que se actualizan desde un filtro, y vistas guardadas por entidad para que nadie reconstruya el mismo filtro el lunes a la mañana.

**Reportes y dashboards.** KPIs y series de tiempo, un embudo con tasa de conversión por etapa, un forecast ponderado por la probabilidad de cada etapa, rendimiento por origen y por responsable, un ranking de actividad, y dashboards que armás con widgets. Alcanza para correr [una revisión semanal](/blog/revision-semanal-del-crm) sin planilla.

**Workflows.** Disparadores sobre contactos, deals, tareas y emails entrantes (creado, actualizado, cambio de etapa, ganado, perdido, tarea vencida, email recibido, o manual) que alimentan acciones: mandar un email, crear una tarea, registrar una actividad, actualizar un campo, agregar a una lista, llamar a un webhook, avisarle a alguien del equipo. Los workflows son solo para admins. Acá tenés [cinco recetas prácticas](/blog/workflows-crm-tareas-de-seguimiento).

**Importar y exportar.** Importación de CSV con mapeo de columnas y dedupe (por email para contactos, por dominio para empresas; saltear o actualizar los existentes), más un panel de duplicados. Exportación a CSV o JSON cuando quieras, solo para admins. La [guía de migración desde HubSpot](/blog/migrar-contactos-de-hubspot-por-csv) lo explica paso a paso.

**Una API que no tenés que negociar.** `/api/v1/crm/*` cubre contactos, empresas, deals, tareas y pipelines con las mismas claves personales `zs_` que el resto de Zerosoft, documentadas en [/docs](/docs).

**El resto de la suite.** Desde un contacto podés sacar un link de reserva de Zerosoft Cal con su nombre y email ya cargados. Link, Track, Chat y Docs están detrás del mismo login.

## Precios, sin números inventados

HubSpot tiene un CRM gratis y hubs pagos que se venden por plan y por asiento, con algunos productos que además cobran por contactos de marketing. Los detalles cambian seguido; mirá su página de precios en vez de confiar en un número de un post, incluido este.

Zerosoft CRM es gratis para self-hosting, para siempre, con todas las funciones del núcleo, bajo AGPLv3. En Zerosoft Cloud hay un free tier generoso y después pago por uso, con precios transparentes publicados antes de cobrarte nada. Ni por asiento ni por contacto.

El precio importa recién cuando las funciones encajan. Si necesitás secuencias y cotizaciones, un CRM más barato sin ellas es solo un problema más barato.

## Quién debería quedarse en HubSpot

- Equipos donde **marketing y ventas comparten el CRM** y viven de campañas, secuencias, formularios y tracking.
- Equipos de ventas que dependen del **tracking de aperturas, las plantillas y el registro automático de la bandeja**.
- Cualquiera que mande **cotizaciones desde un catálogo de productos**.
- Empresas cuyo stack se sostiene con **integraciones del marketplace**.
- Vendedores que trabajan desde **la app del celular**.
- Organizaciones que necesitan **SSO, audit logs y roles personalizados** hoy.

Si sos vos, quedate. HubSpot es bueno en esas cosas y no vamos a hacer de cuenta que no.

## A quién le sirve Zerosoft CRM

- Equipos chicos que usan HubSpot como **una base de contactos más un pipeline** y pagan por mucho más.
- Founders y agencias que quieren **pipelines, tareas y reportes** sin una llamada de ventas ni un upgrade de plan.
- **Developers** que quieren una API documentada, exportación completa y la opción de hacer self-hosting sobre un archivo SQLite o Turso.
- Equipos a los que les importa **dónde viven los datos de sus clientes** y quieren leer el código que los toca.
- Cualquiera que ya use **Zerosoft Cal, Link o Chat**.

## Probalo con tus propios datos

Exportá una parte de tus contactos y empresas de HubSpot, importalos, armá un pipeline y hacé tu próxima revisión semanal desde ahí. Con una tarde alcanza para saber. Si lo primero que extrañás es una secuencia o un email trackeado, ya tenés la respuesta, y HubSpot vale lo que pagás.
