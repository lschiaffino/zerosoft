---
title: "Chat vs. Intercom: qué hace cada uno hoy"
description: "Intercom está muy adelante en IA, canales, integraciones y centro de ayuda. Chat es un inbox de webchat self-hosteable con SLAs y CSAT. Qué hace cada uno y quién no debería cambiarse."
date: "2026-09-23"
author: "zerosoft"
tags: ["chat", "intercom", "comparación"]
---

Intercom y Chat ya no son la misma categoría de producto. Intercom es una plataforma de atención al cliente con la IA al centro. Chat es un widget de webchat con un inbox compartido y lo básico del soporte. Compararlos función por función no tiene sentido. Acá va dónde está cada uno y una respuesta a "¿me conviene cambiarme?".

## La versión corta

- **Intercom** es una suite de atención madura: un agente de IA que responde solo, muchos canales, un centro de ayuda, mensajes salientes, SDKs móviles y un marketplace de integraciones enorme. Si el soporte es una función central con volumen real, está hecho para vos.
- **Chat** es open source (AGPLv3), self-hosteable, y resuelve lo esencial: un widget de webchat embebible, un inbox compartido, reglas de asignación, políticas de SLA, respuestas guardadas, horario de atención y CSAT. Le sirve a equipos chicos que quieren un inbox prolijo y propio, sin precio por asiento.

## Dónde Intercom está claramente adelante

**IA.** El agente Fin de Intercom lleva años en producción, lee tu contenido y resuelve muchas conversaciones de punta a punta. Chat tiene un bot que responde con un modelo de lenguaje si configurás una clave del AI Gateway (y, si no, por coincidencia de palabras clave con tus respuestas guardadas y tus páginas de Docs) hasta que contesta una persona. Para algo más parecido a Fin está [Agents](/products/agents): agentes con tu conocimiento y herramientas de la suite que se conectan al widget de Chat. Son más nuevos y menos probados que Fin.

**Canales.** Intercom junta email, apps de mensajería y redes en un solo inbox. Chat es un widget para tu web, nada más por ahora.

**Centro de ayuda.** Intercom trae un centro de ayuda público con artículos, colecciones y búsqueda. Chat no. Podés apuntar el bot de Chat a tus páginas de Docs, pero Docs es una herramienta de conocimiento interno, no un sitio de ayuda público y listo para SEO.

**Mensajes salientes y dentro del producto.** Tours de producto, banners, mensajes segmentados, campañas de email. Chat solo responde; no sale a buscar a nadie.

**SDKs móviles.** Intercom tiene SDKs nativos para meter soporte dentro de apps de iOS y Android. Chat tiene un widget de JavaScript para sitios web.

**Integraciones y API.** Intercom tiene un marketplace de apps y una API pública. Chat todavía no tiene API pública, ni webhooks de eventos de chat, ni exportación de conversaciones.

**Ticketing, workflows y profundidad de reportes.** Intercom tiene tickets, constructores visuales de flujos y reportes detallados. Los reportes de Chat son un solo panel enfocado: primera respuesta promedio, porcentaje dentro del SLA de primera respuesta, tiempo promedio de resolución, cantidad de resueltas y CSAT.

**Madurez.** Años en producción en empresas muy grandes, certificaciones de seguridad, features enterprise. Nuestras piezas enterprise, SSO/SAML, logs de auditoría, roles personalizados y white-label para el widget, están en desarrollo en `/ee`, no lanzadas.

## Dónde Chat se defiende

**Lo básico del soporte, hecho con cuidado.**

- **Widget:** un `<script>`, tu color, abajo a la izquierda o a la derecha, un mensaje de bienvenida y hasta 20 campos previos al chat (texto, email o número). Los visitantes pueden mandar imágenes, audios y archivos de hasta 10 MB, y ven indicador de escritura y confirmación de lectura.
- **Inbox:** estados abierta, pendiente, pospuesta y resuelta; filtros de sin asignar y mías; prioridades (low, medium, high, urgent); snooze que se reabre solo.
- **Reglas de asignación:** keyword, rango horario, round-robin y catch-all, evaluadas en orden, sin pisar nunca una asignación manual.
- **Políticas de SLA:** objetivo de primera respuesta y, opcional, de resolución por widget y por prioridad, con un badge en vivo "Reply in Xm" o "Breached" en cada conversación. Escribimos un [playbook de SLAs de soporte con Chat](/blog/slas-de-soporte-con-chat), incluido dónde el reloj es más simple de lo que quizás querrías (corre en tiempo de reloj, no en horario laboral).
- **Respuestas guardadas:** escribí `/` en la caja de respuesta para buscar e insertar.
- **Horario de atención:** horario por día y zona horaria; fuera de horario, el widget muestra un aviso de ausencia con cuándo volvés.
- **CSAT:** calificación de 1 a 5 con comentario opcional, que se pide al resolver una conversación.
- **Personas:** una lista de visitantes con sus conversaciones y notas. Desde una conversación creás el contacto en el CRM y guardás la charla en su timeline.

**Es tuyo.** AGPLv3, self-hosteable, conversaciones en tu propia base de datos. Para equipos con requisitos de residencia de datos, o que simplemente no quieren sus conversaciones con clientes en la nube de otro proveedor más, eso importa.

**La suite.** Chat comparte login, equipo y datos con las otras diez apps. Tus páginas de Docs alimentan al bot, tus contactos del CRM aparecen al lado del chat y Flow puede reaccionar a cada mensaje nuevo.

**Un precio que no castiga crecer.** Intercom combina precio por asiento con cargos por uso de su agente de IA; mirá su página de precios para los números actuales, porque cambian. Chat cuesta $0 en tu servidor. zerosoft Cloud tiene un plan gratis y después pago por uso, sin cargo por asiento.

## Quién debería quedarse en Intercom

Muchos equipos. Quedate si:

- Dependés de un agente de IA probado para resolver una parte importante de las conversaciones.
- Atendés clientes en más de un canal (email, WhatsApp, redes) y los querés en un solo lugar.
- Necesitás un centro de ayuda público, tours de producto o mensajes salientes.
- Das soporte dentro de una app móvil nativa.
- Tu stack de soporte depende de integraciones (sincronización con CRM, ticketing, data warehouse) o de la API de Intercom.
- Necesitás requisitos enterprise hoy: SSO, logs de auditoría, roles personalizados, compliance formal.

Para esos equipos, pasarse a Chat sería un paso atrás.

## Para quién es Chat

- Equipos chicos (de dos a diez personas) atendiendo el chat de su web, donde el trabajo es "responder rápido y no perder nada".
- Empresas que quieren las conversaciones de soporte en su propio servidor, bajo una licencia open source.
- Equipos que ya usan zerosoft CRM o Docs y quieren el chat al lado de sus contactos y su conocimiento.
- Cualquiera que miró una factura por asiento más cargo por resolución y decidió que su volumen no lo justifica.

## Cómo probarlo

Creá un widget en **Chat**, copiá el snippet de embebido y ponelo en una página de staging. Configurá dos políticas de SLA, una regla de asignación y cinco respuestas guardadas. Si podés, corrélo una semana al lado de tu herramienta actual y compará: si extrañaste algo todos los días, ya tenés tu respuesta.

## En resumen

Intercom es el producto más capaz, sobre todo en IA y canales. Chat es un inbox de webchat self-hosteable con SLAs, reglas de asignación y CSAT. Elegí el que corresponde al trabajo que tenés.
