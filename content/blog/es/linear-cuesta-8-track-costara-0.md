---
title: "Linear cuesta $8. Track va a costar $0."
description: "Linear es probablemente el mejor gestor de issues jamás construido: velocidad, teclado primero, cycles. Lo único malo es la factura por asiento. Por eso estamos construyendo Track. Q4 2026."
date: "2026-06-21"
author: "Zerosoftware"
tags: ["track", "linear", "open source"]
---

Arranquemos con honestidad: Linear es probablemente el mejor gestor de issues jamás construido. Si alguna vez lo usaste, sabés de qué hablamos. Y es, al mismo tiempo, la demostración perfecta de todo lo que está mal con el SaaS.

## Lo que amamos de Linear

No venimos a tirar piedras. Venimos a copiar lo bueno:

- **La velocidad.** Todo es instantáneo. Las mutaciones son optimistas, el sync es en tiempo real, nunca hay un spinner. La velocidad no es un detalle: es lo que hace que el equipo *quiera* actualizar el board.
- **Teclado primero.** `Cmd+K` y nunca tocás el mouse. Crear, asignar, mover, cerrar: todo desde el teclado. La herramienta desaparece y queda el trabajo.
- **Los cycles.** Sprints sin ceremonia. El trabajo entra, se prioriza, se hace, se mide. Sin dos semanas configurando workflows ni permisos.

Linear probó que un issue tracker puede sentirse como un editor de texto moderno. Eso es real y es difícil.

## Lo que no amamos: la factura

El plan básico cuesta $8 por usuario por mes, pagando anual. Hagamos la cuenta que hace cualquier CTO:

- Equipo de 10: $960 al año.
- Equipo de 50: $4.800 al año.
- Equipo de 200: $19.200 al año.

¿Por qué? Por guardar issues — título, descripción, estado, prioridad, un par de timestamps — en una base de datos. El costo real de infraestructura por asiento se mide en centavos. Y el precio crece en la dirección equivocada: cuanto más grande tu equipo, más grande la factura, más dolorosa la salida. Tu historial de producto entero queda de rehén.

## Qué va a tener Track

Track es nuestro clon de Linear, en construcción ahora, con lanzamiento en Q4 2026. La lista corta:

- Issues con estados, prioridades, labels y asignados.
- Cycles, con velocity y progreso automático.
- Teclado primero de verdad: command palette y atajos para todo.
- Velocidad como requisito no negociable, no como meta de roadmap.
- API desde el día uno.
- Self-host desde el día uno también: un deploy, tu Postgres, tus datos.

Sin workflow builder de 40 pantallas. Sin marketplace de plugins pagos. Sin "contactá a ventas".

## Por qué va a costar $0

Porque es software, y el software son bits, y los bits son gratis. El código de Track va a ser open source: descargalo, auditalo, corrésolo para tu equipo entero sin pagar un peso. Si no querés hostear, lo corremos nosotros y pagás exactamente lo que cuesta la nube. Al costo. Sin margen.

Linear cobra $8 por asiento porque puede. Nosotros cobramos $0 porque podemos. La diferencia es el modelo, no la tecnología.

## La lista de espera

Track sale en Q4 2026. Si querés acceso temprano — y voz en qué se construye primero — anotate en la lista de espera en zerosoftware.ai. El sitio está en español, inglés y portugués, como todo lo que hacemos.

Linear mostró cómo tiene que sentirse un tracker. Track va a mostrar cuánto tiene que costar.
