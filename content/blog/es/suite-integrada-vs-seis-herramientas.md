---
title: "Suite integrada o herramientas especializadas: qué conviene"
description: "Login compartido, una base de datos y búsqueda común, o productos especializados que van más a fondo. Qué comparten de verdad las apps de zerosoft, qué no y cuándo conviene elegir a los especialistas."
date: "2026-09-27"
author: "zerosoft"
tags: ["producto", "herramientas", "arquitectura"]
---

Hay dos formas de equipar con software a una empresa chica. Elegís la mejor herramienta para cada trabajo (un acortador de links, un CRM, un issue tracker, una agenda, un inbox de soporte, una wiki) y las conectás entre sí. O elegís una suite que hace todo eso, un poco menos a fondo, en un solo lugar.

zerosoft es del segundo tipo, así que somos parte interesada. Este post intenta ser justo: qué comparten de verdad nuestras once apps (chequeado en el código), qué no, y cuándo conviene elegir a los especialistas.

## Qué comparten las apps

- **Una app, un login.** Las once apps son una sola aplicación Next.js. Entrás una vez con Google y estás en todas.
- **Un mismo workspace.** Un owner invita gente, cada miembro es owner, admin o member, y todos trabajan en el mismo espacio. Invitás a alguien una vez.
- **Una búsqueda.** ⌘K encuentra contactos, empresas, deals, links, páginas de Docs y tareas.
- **Un inbox de notificaciones.** Menciones y asignaciones de Track, mensajes de Chat y avisos de los workflows del CRM caen en el mismo lugar.
- **Cal y Chat escriben en el CRM.** Cada reserva de Cal crea o actualiza el contacto del invitado y registra la reunión en su timeline. Desde una conversación de Chat creás el contacto y guardás la charla.
- **Flow conecta todo.** Una reserva, un clic, un contacto nuevo, un issue o un mensaje de Chat pueden disparar un flow que actúa en cualquier otra app.
- **Una API, un sistema de webhooks.** Una clave `zs_…` sirve para Link, CRM, Cal y Agents. Los webhooks de todas las apps usan la misma firma y los mismos reintentos.
- **Una base de datos.** Todo vive en una base libSQL: un archivo SQLite si hosteás vos. Una cosa para respaldar y para mover.

## Lo que todavía no está conectado

- **Los clics de Link no se asocian a contactos.** Las métricas no usan cookies y no identifican personas, a propósito.
- **Docs y Track no se referencian.** Las menciones `[[` de Docs apuntan a otras páginas de Docs, no a issues.
- **Track no tiene API pública**, así que no se puede automatizar desde afuera más allá de Flow.

## Dónde ganan los especialistas

Una empresa que hace solo agenda o solo issue tracking durante una década llega más hondo que una suite. En concreto:

- **Profundidad.** Linear tiene atajos de teclado y sincronización en tiempo real; Track no. Notion tiene edición simultánea e importadores; Docs no. Calendly se conecta con Outlook e iCloud; Cal es solo Google. Intercom tiene email, WhatsApp y centro de ayuda; Chat es solo webchat.
- **Ecosistemas.** Las herramientas grandes tienen cientos o miles de integraciones. Nosotros tenemos una API, webhooks, Flow y pedidos HTTP a cualquier servicio.
- **Apps móviles y madurez.** No tenemos apps nativas, y las funciones enterprise (SSO, audit logs, roles a medida) están [en desarrollo](/blog/open-core-explicado).
- **Riesgo concentrado.** Con varios proveedores, una caída afecta a una herramienta. Con una suite, un mal deploy toca todo. Hostear vos te deja elegir cuándo actualizar.

Si una de esas herramientas es el centro de tu negocio (un equipo de ventas que vive de secuencias complejas, un equipo de ingeniería que necesita boards en tiempo real), usá el especialista para ese trabajo.

## Dónde gana la suite

- **No hay pegamento que mantener.** Con herramientas separadas, alguien tiene que cuidar automatizaciones tipo Zapier, sincronizar usuarios en varios paneles de admin y recordar quién tiene acceso a qué.
- **Alta y baja en un paso.** Sumás o sacás a una persona una sola vez. En un stack de muchas herramientas, el offboarding es por donde se filtran accesos.
- **Un solo cobro.** El precio por asiento en varios productos se multiplica cuando el equipo crece. zerosoft cuesta $0 en tu servidor; zerosoft Cloud tiene un plan gratis y después cobra por uso, no por asiento.
- **Una sola exportación.** Tus datos no quedan repartidos entre formatos de distintos proveedores.

## Una regla práctica

Una agencia de cinco personas con unos cientos de contactos, llamadas agendadas desde una página de reservas, un board de proyectos, un widget de soporte y una wiki interna: ninguno de esos trabajos es su producto. Es la plomería del negocio. Ahí una suite es la opción razonable.

Una empresa de cincuenta personas donde la prospección outbound es el negocio debería usar un CRM especialista. Puede igual correr Link, Cal o Docs de zerosoft al lado: las apps no se exigen entre sí. Usá las que te sirvan.
