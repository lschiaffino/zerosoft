---
title: "Roadmap público: qué viene después de Link"
description: "Link ya está disponible. Track, CRM y Cal vienen en camino. Publicamos el roadmap completo — trimestres y criterios incluidos — porque los usuarios son socios, no audiencia."
date: "2026-06-06"
author: "Zerosoftware"
tags: ["roadmap", "open source", "link", "coming soon"]
---

En el SaaS tradicional el roadmap es un documento confidencial que se filtra una vez por año en un keynote, entre humo y música épica. El usuario se entera de las features cuando ya están en la factura.

Nosotros no podemos operar así. El código es abierto: cualquiera ve en qué trabajamos mirando los repos. Esconder el roadmap siendo open source sería como ponerle cortinas a una casa de vidrio. Así que lo publicamos entero: trimestres y criterios incluidos.

## Qué viene, en orden

- **Track — Q4 2026.** Nuestro gestor de proyectos. Issues, cycles, keyboard-first, roadmaps. Pensalo como Linear, pero open source y a $0 self-host. Está en construcción ahora.
- **CRM — Q1 2027.** Contactos, pipeline, actividad. El HubSpot que no cobra por contacto guardado. API-first, como todo lo que hacemos: sale con su API pública documentada desde el día uno.
- **Cal — Q2 2027.** Scheduling. Tu disponibilidad, un link público, eventos que caen en tu calendario. El Calendly que no cobra $12 por usuario por dos componentes.

Los tres heredan el contrato de Link: código abierto, self-host gratis con SQLite en un VPS de $5, cloud al costo real y export completo en JSON/CSV/API.

## Cómo elegimos el orden

No tiramos un dado. Tres criterios, en este orden:

1. **Dónde duele más la factura.** Medimos el ratio entre lo que el mercado cobra y lo que la infraestructura cuesta. Un CRM cobra unos $50 por usuario por guardar contactos en una tabla; un acortador cobraba $35 por redirects de 300 bytes. Cuanto más absurdo el margen, antes lo atacamos.
2. **Qué se construye sobre qué.** Track necesita una base de proyectos y permisos que después reusan CRM y Cal. Construir en ese orden es más barato y más rápido que hacerlo al revés.
3. **Lo que pide la comunidad.** Los issues y las discusiones de los repos son públicos y pesan. Si mil personas piden algo que estaba quinto, sube.

## Por qué publicarlo nos conviene (y te conviene)

Un roadmap público hace tres cosas que uno secreto no puede:

- **Nos pone fecha.** Si decimos "Q4 2026" en público, Q4 2026 existe. Accountability gratis: un compromiso con desconocidos ordena más que cien reuniones internas.
- **Te deja planificar.** Si tu empresa está por renovar un contrato de scheduling por dos años, te interesa saber que en Q2 2027 hay una alternativa a $0. Ocultarlo sería hacerte el daño que le criticamos a los demás.
- **Invita a corregirlo.** Un roadmap privado se corrige solo en retrospectiva. Uno público recibe argumentos antes de cometer el error.

¿Y la competencia? Ya sabe lo que hacemos: el código está en GitHub. El único que queda afuera con un roadmap secreto es el usuario. Esa cuenta no cierra.

## Lo que no prometemos

Los trimestres son trimestres, no días. No vas a ver "Track sale el 14 de octubre a las 9 AM" porque no lo sabemos; fingirlo sería el primer hype de una larga serie. Si algo se atrasa, lo vas a leer en el mismo roadmap, con el motivo. Sin post-mortems dramáticos: se movió, esta es la razón, esta es la nueva ventana.

Tampoco prometemos listas de features cerradas. La lista corta de cada producto está en los posts dedicados, pero el detalle final lo decide el uso real y la comunidad, no un mockup de hace un año.

## Cómo seguirlo (y moverlo)

El roadmap vive en zerosoftware.ai/roadmap y en los repos: cada item enlaza a sus issues. Podés votar comentando, proponer features nuevas o directamente construirlas — los PRs son la forma más rápida de mover una prioridad.

Link fue la prueba de que el modelo funciona: software gratis, nube al costo, cero lock-in. Track, CRM y Cal son la prueba de que no fue casualidad. El orden está puesto, las ventanas están dichas y el tablero es público. Nos vemos en Q4.
