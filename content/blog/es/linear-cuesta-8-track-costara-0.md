---
title: "Linear cuesta $8 por usuario. Por qué hacemos Track"
description: "Linear es un gran issue tracker: rápido, pensado para el teclado, con ciclos sin ceremonia. Qué tomamos de él para Track, qué hicimos distinto y cómo se compara la factura."
date: "2026-06-21"
author: "zerosoft"
tags: ["track", "linear", "open source"]
---

Linear es probablemente el mejor issue tracker que existe. Es rápido, se maneja con el teclado y hace que los ciclos no pesen. También cobra por usuario, y esa factura crece con el equipo. Este post cuenta qué tomamos de Linear para Track y qué no.

## Lo que hace bien Linear

- **Velocidad.** Las acciones se aplican al instante y se sincronizan en tiempo real. Cuando nada tarda, el equipo actualiza el board.
- **Teclado.** `Cmd+K` y atajos para crear, asignar, mover y cerrar.
- **Ciclos.** Sprints sin configurar workflows durante dos semanas.

Linear demostró que un issue tracker se puede sentir como un buen editor de texto.

## La factura

El plan pago de Linear cuesta $8 por usuario por mes:

- Equipo de 10: $960 por año.
- Equipo de 50: $4.800 por año.
- Equipo de 200: $19.200 por año.

Lo que se guarda (título, descripción, estado, prioridad, fechas) cuesta centavos por usuario en infraestructura. El precio crece con la plantilla y, con los años, también crece lo que cuesta irte.

## Qué tiene Track hoy

- Issues con estados propios por proyecto, prioridades, labels, responsables, sub-issues y relaciones.
- Ciclos y estimaciones.
- Cuatro vistas: lista, board, calendario y Gantt, más vistas guardadas.
- Comentarios, adjuntos, historial de actividad e inbox.
- Self-host con un `docker compose up`.

Lo que todavía no tiene: API pública, atajos de teclado, sincronización en tiempo real, gráficos de velocity e importador desde Linear. La comparación completa está en [Track vs Linear](/blog/zerosoft-track-vs-linear).

## Cuánto cuesta

Track es open source (AGPLv3). En tu servidor cuesta $0 para todo el equipo. En zerosoft Cloud, el workspace tiene un plan gratis y después paga por uso; los asientos no se cobran.

Si tu equipo depende de la velocidad y los atajos de Linear, hoy Linear te va a servir mejor. Si lo que necesitás es una lista de issues, ciclos y un Gantt sin pagar por cabeza, probá Track.
