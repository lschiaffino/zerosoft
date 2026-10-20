---
title: "Cal vs. Calendly: qué hace cada uno hoy"
description: "Dónde Calendly está claramente adelante, dónde Cal se defiende y quién debería cambiarse o quedarse donde está. Sin benchmarks inventados."
date: "2026-09-29"
author: "zerosoft"
tags: ["cal", "calendly", "comparativa"]
---

Las comparaciones escritas por el propio vendedor suelen ser inútiles: una tabla de features donde cada fila de nuestro lado tiene un tilde. Vamos a intentar escribir la otra clase. Calendly es un producto maduro, bien hecho, con una década de pulido y un ecosistema enorme. Cal es más joven, open source y más acotado. Para algunos equipos eso es mejor negocio. Para otros, Calendly es simplemente la elección correcta, y lo vamos a decir.

## La versión corta

- **Quedate en Calendly** si vivís en Outlook / Microsoft 365, necesitás integraciones nativas tipo Salesforce, apps móviles o controles enterprise como SSO y audit logs.
- **Mirá Cal** si usás Google Workspace, pagás por asiento para varias personas que en general solo necesitan "un link de reservas que funcione", querés API y webhooks sin un contrato enterprise, o querés hacer self-hosting y ser dueño de tus datos de agenda.

El resto del post es el detalle detrás de esas dos líneas.

## Dónde Calendly está adelante

Arrancamos por acá, porque es la parte que las comparaciones de vendedores se saltean.

**Cobertura de calendarios.** Calendly se conecta con Google, Outlook / Microsoft 365, Exchange e iCloud. Cal se conecta **solo con Google Calendar**. Si tu equipo trabaja con Microsoft, Cal no puede ver tus conflictos ni escribir eventos en tu calendario. Outlook e iCloud están en nuestro roadmap, no en el producto. Y dentro de Google, Cal revisa conflictos en tu calendario principal, no en los secundarios.

**Videollamadas.** Calendly genera links de Zoom, Teams, Webex y Meet. Cal crea links de **Google Meet** a través de Google Calendar. Para cualquier otra cosa, ponés un link fijo en la ubicación del evento.

**Ecosistema de integraciones.** Calendly tiene integraciones nativas con los CRMs grandes, herramientas de marketing y un marketplace de apps, además de extensiones de navegador. Cal tiene webhooks `booking.created`, `booking.rescheduled` y `booking.cancelled`, una API REST e integración nativa con zerosoft CRM. Para todo lo demás, lo armás o lo conectás vos.

**Apps móviles.** Calendly tiene apps para iOS y Android. Cal no. La página de reservas y el panel funcionan en el navegador del celular, pero no hay app nativa.

**Workflows y recordatorios.** Calendly te deja armar secuencias de recordatorios y seguimientos, incluido SMS en planes pagos. Cal manda la confirmación y los mails de reprogramación o cancelación, y cada tipo de evento puede sumar hasta 10 pasos: un email al invitado o al anfitrión, antes o después de la reunión, con asunto y texto propios. Son solo emails, no hay SMS. En zerosoft Cloud los pasos salen con un cron que corre cada minuto; con self-host, son tan puntuales como el cron que configures.

**Tipos de reunión.** Calendly soporta eventos colectivos (varios hosts en la misma llamada), eventos grupales (muchos invitados en un slot) y encuestas de horario. Cal soporta eventos uno a uno, opcionalmente con un pool de hosts en [round-robin](/blog/round-robin-con-cal). Todavía no hay eventos colectivos, grupales ni encuestas.

**Profundidad del ruteo.** Los dos tienen routing forms. Los de Calendly pueden consultar tu CRM ("cuenta existente va a su owner"). Los [routing forms de Cal](/blog/formularios-de-ruteo-en-cal) rutean solo con las respuestas del visitante, una condición por regla.

**Enterprise y madurez.** SSO/SAML, provisioning con SCIM, audit logs, controles de admin, papeles de compliance, años de casos borde ya resueltos. Las features enterprise de Cal viven en nuestra carpeta `/ee` y siguen en desarrollo. Y Calendly procesó más reuniones de las que nosotros vamos a ver este año: la madurez es una feature real.

## Dónde Cal se defiende

Nada de lo que sigue es único en el mundo. Es lo que obtenés gratis, con el código fuente.

**El núcleo es sólido.** Event types con preguntas personalizadas, horarios reutilizables con excepciones por fecha, buffers, aviso mínimo, ventana de reservas, blocked slots, links de un solo uso, branding por evento (color, logo, mensaje de bienvenida) y cobro al reservar con tu propia cuenta de Stripe, con reembolso automático si la reserva se cancela. Eso cubre lo que la mayoría de la gente realmente usa de una herramienta de agenda. Escribimos una guía entera sobre [cómo usar bien esas reglas](/blog/buffers-aviso-minimo-y-ventana).

**Agenda de equipo sin la cuenta por asiento.** Los pools de round-robin de hasta 50 hosts y los routing forms vienen incluidos. No hay paso de "pasate al plan Teams".

**Experiencia del invitado.** Zona horaria detectada desde el navegador, slots en la hora del invitado, mails en su idioma (inglés, español o portugués) con una invitación `.ics` que entiende cualquier app de calendario, y un link sin cuenta para reprogramar o cancelar. La [ingeniería de zonas horarias](/blog/zonas-horarias-en-agendas) está documentada hasta la función.

**Google Calendar bien hecho.** El free/busy bloquea slots, las reservas caen en el calendario del host con link de Meet, reprogramar mueve el evento, cancelar lo borra. Por persona: cada host del equipo conecta el suyo.

**Embebible en cualquier lado.** Un tag de script, inline o popup, altura automática y un evento `zs-cal:booked` que tu página puede escuchar. [Acá está el setup](/blog/embeber-cal-en-tu-sitio).

**API y webhooks para todos.** `/api/v1/calendar/*` para listar event types, listar y crear reservas y cancelarlas, más webhooks firmados. Las mismas API keys personales que el resto de zerosoft, documentadas en [/docs](/docs). Sin plan enterprise.

**Self-hosting.** El núcleo es AGPLv3. Podés correr Cal en tu propio servidor con un archivo SQLite local, tener cada reserva en una base que controlás vos y leer cada línea que toca tu calendario. Si tu empresa tiene opiniones sobre dónde viven los datos de las reuniones, esto pesa.

**Se enchufa al resto de zerosoft.** Desde un contacto en zerosoft CRM podés sacar un link de reserva con su nombre y email precargados.

## Precios, sin números inventados

Calendly tiene un plan gratis y planes pagos por asiento; las features de equipo como round-robin y ruteo están en los planes más altos. Mirá su página de precios para los números actuales, que cambian.

Cal cuesta $0 en tu servidor, con todas las funciones del core. En zerosoft Cloud hay un plan gratis y después pago por uso, con los precios publicados antes de cobrar. No es por asiento: sumar a una quinta persona al pool de round-robin no cambia la factura por sí solo.

El planteo honesto: si a Cal le falta algo que necesitás, la diferencia de precio no importa. Si no le falta, pagar por asiento por un link de reservas es difícil de justificar; [ya lo argumentamos antes](/blog/calendly-y-el-impuesto-a-agendar).

## Quién debería quedarse en Calendly

- Equipos en **Outlook / Microsoft 365**, Exchange o iCloud.
- Equipos de ventas que dependen de **ruteo y sincronización nativos** con Salesforce o HubSpot.
- Quien maneja su agenda desde una **app móvil**.
- Empresas que necesitan **SSO, SCIM, audit logs** y una revisión de seguridad de proveedor hoy.
- Quien necesite **eventos grupales, colectivos, encuestas o recordatorios por SMS**.

Si alguno de esos sos vos, no te cambies. En serio.

## A quién le conviene Cal

- Equipos en **Google Workspace** que necesitan sobre todo reservas uno a uno y round-robin.
- Equipos chicos donde el precio por asiento se acumula por gente que casi no usa la herramienta.
- **Desarrolladores** que quieren API y webhooks sin una llamada de ventas, o quieren hacer self-hosting.
- Equipos que atienden a gente que habla **español y portugués** y quieren páginas de reserva y mails en su idioma.
- Agencias y freelancers que quieren las reservas embebidas en su propio sitio.
- Cualquiera que ya use **zerosoft CRM**.

## Probalo antes de decidir

La forma más barata de saberlo es probarlo. Creá un event type, conectá Google Calendar, reservate a vos mismo desde una ventana privada y reprogramá desde el mail. Quince minutos. Si falta algo crítico, te vas a dar cuenta rápido, y vas a saber que Calendly valía la pena.
