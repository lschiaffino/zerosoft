---
title: "¿Una suite o seis herramientas especializadas? Los tradeoffs honestos"
description: "Login compartido, una base de datos y un inbox, o seis productos especializados que van más a fondo. Qué comparten hoy de verdad las seis apps de Zerosoft, qué no, y cuándo conviene elegir a los especialistas."
date: "2026-09-27"
author: "Zerosoftware"
tags: ["producto", "herramientas", "arquitectura"]
---

Hay dos formas de equipar con software a una empresa chica. Elegís la mejor herramienta para cada trabajo — un acortador de links, un CRM, un issue tracker, un agendador, un inbox de soporte, una wiki — y las pegás entre sí. O elegís una suite que hace las seis cosas, un poco menos a fondo, pero en un solo lugar.

Zerosoft es del segundo tipo. Eso nos hace parciales, así que este post se esfuerza en ser justo: qué te da realmente ser "integrado" en nuestro caso (verificado en el código, no en una slide), qué no, y cuándo seis herramientas especializadas son simplemente la mejor respuesta.

## Qué significa "integrado" en Zerosoft, en concreto

"Suite integrada" es una frase que muchas veces esconde un paquete de apps separadas con un logo en común. Así que acá va la lista de lo que nuestros seis productos comparten de verdad hoy:

- **Una app, un login.** Link, CRM, Track, Cal, Chat y Docs son una sola aplicación Next.js. Entrás una vez con Google y estás en las seis. Sin cuentas separadas, sin seis reseteos de contraseña.
- **Un mismo modelo de workspace.** Los equipos funcionan igual en todos lados: un owner invita gente, cada miembro es owner, admin o member, y los miembros operan dentro del workspace compartido. Invitás a tu colega una vez; no hay que sumarlo a seis herramientas.
- **Un solo inbox de notificaciones.** Las menciones, asignaciones, cambios de estado y comentarios de Track, los mensajes nuevos de Chat y la acción "notificar usuario" de los workflows del CRM caen en el mismo inbox.
- **Chat conoce tu CRM.** Cuando un visitante en una conversación de Chat tiene un email que coincide con un contacto del CRM, el panel lateral de la conversación muestra ese contacto con un link directo a su ficha.
- **Una sola configuración de Google.** El sync de Gmail del CRM y el de Google Calendar de Cal reutilizan las mismas credenciales de Google OAuth que el login.
- **Una API key, un sistema de webhooks.** Una key personal `zs_…` funciona en toda la API pública: `/api/v1/links`, `/api/v1/crm/*`, `/api/v1/calendar/*`. Los webhooks `link.created` / `link.clicked` de Link y los `booking.*` de Cal pasan por la misma maquinaria de entrega firmada y reintentos.
- **Una base de datos.** Todo vive en una sola base libSQL: un único archivo SQLite si hosteás vos. Una cosa para backupear, una cosa para mover, una cosa para consultar.

Esa última está subestimada. Cuando tus contactos, reservas, issues y conversaciones están en un archivo, "¿dónde están nuestros datos?" tiene una respuesta de una palabra.

## Lo que *todavía* no está conectado

Igual de concreto. Son cosas que podrías suponer que una suite hace, y la nuestra hoy no:

- **Las reservas de Cal no crean ni actualizan contactos del CRM.** Alguien agenda una demo; tu CRM no se entera solo. (El webhook `booking.created` puede hacer de puente, si lo conectás.)
- **Los clicks de Link no aparecen en los contactos del CRM.** El analytics de Link es sin cookies por diseño, y no está atado a personas.
- **Chat no crea contactos en el CRM.** Muestra el que coincide si ya existe; no agrega nuevos.
- **Las páginas de Docs y los issues de Track no se referencian entre sí.** Las menciones `[[` de Docs linkean a otras páginas de Docs, no a issues.

Preferimos listar esto antes que dejar que "integrado" haga más trabajo del que debe. Si la automatización entre productos es tu razón principal para cambiarte, contrastá esta lista con tu flujo de trabajo primero.

## Dónde ganan seis herramientas especializadas

No nos hagamos los distraídos. Una empresa que hace solo agendamiento, o solo issue tracking, durante una década va a llegar más hondo que una suite que hace seis cosas. En concreto, los especialistas están adelante en:

- **Profundidad.** HubSpot tiene secuencias de email, tracking de aperturas, cotizaciones y productos; nuestro CRM todavía no tiene nada de eso. Linear tiene atajos de teclado y sync en tiempo real; Track no. Notion tiene coedición en tiempo real e importaciones; Docs no. Calendly se conecta con Outlook e iCloud; Cal por ahora es solo Google.
- **Ecosistemas.** Las herramientas grandes tienen marketplaces con cientos o miles de integraciones. Nosotros tenemos una API, webhooks y workflows en el CRM. Es un kit de arranque, no un ecosistema.
- **Features de IA.** Varios incumbentes ya tienen features con LLM. Nuestro bot de Chat es matching de palabras clave sobre respuestas guardadas y páginas de docs, y lo decimos.
- **Apps móviles y madurez.** Apps nativas, años de casos borde, papeles de compliance enterprise. No tenemos apps móviles nativas, y nuestras features enterprise (SSO, audit logs, roles custom) están [todavía en desarrollo](/blog/open-core-explicado).
- **Radio de impacto.** Con seis proveedores, una caída tumba una herramienta. Con una suite, un mal deploy toca todo. Hostear vos te deja elegir cuándo actualizar; no hace que una app única deje de ser única.

Si una de esas herramientas es el corazón de tu negocio — un equipo de ventas que vive de secuencias, un equipo de ingeniería que necesita boards en tiempo real —, quedate con el especialista para ese trabajo. No es un fracaso de la idea de suite. Es la decisión correcta.

## Dónde gana la suite

Las ventajas de la suite son menos vistosas y, para muchos equipos chicos, más grandes:

- **Desaparece el pegamento.** Seis herramientas necesitan a alguien que mantenga automatizaciones tipo Zapier, que sincronice usuarios en seis paneles de admin y que se acuerde de quién tiene acceso a qué. Cada conexión es un mini proyecto de integración que se rompe en silencio.
- **El alta y la baja son una sola acción.** Sumás a una persona al equipo una vez. La sacás una vez. En un stack de seis herramientas, el checklist de offboarding es justo por donde se filtran accesos.
- **Un solo modelo de cobro, una sola historia de datos.** El precio por asiento en seis productos se multiplica rápido cuando el equipo crece: mirá cualquiera de sus páginas de precios y multiplicá. Zerosoft es gratis para hostear bajo AGPLv3; Zerosoft Cloud tiene un plan gratis generoso y después cobra por uso, no por asiento.
- **Una sola exportación, si te vas.** Tus datos no están repartidos entre seis formatos de exportación de seis proveedores. En self-host es un archivo SQLite que ya es tuyo.

## Una regla práctica

Pensá en una agencia hipotética de cinco personas: unos cientos de contactos, llamadas con clientes agendadas desde una página de reservas, un board de proyectos, un widget de soporte en un par de sitios de clientes y una wiki interna. Ninguno de esos trabajos es su producto principal. Son la plomería del negocio. Ese es el punto justo para una suite: suficientemente buena en todo, un solo lugar donde mirar, nada que pegar.

Ahora pensá en una empresa de cincuenta personas, orientada a ventas, donde las secuencias outbound *son* el negocio. Usá un CRM especialista. Igual podés correr Link, Cal o Docs de Zerosoft al lado: los productos no se exigen entre sí.

Quizás eso sea lo más honesto de nuestra suite: son seis productos en una app, no un combo que tenés que tragarte entero. Usá los que te sirvan y dejá el resto.
