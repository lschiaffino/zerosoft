---
title: "Zerosoft Docs vs Notion: una comparación honesta"
description: "Notion está adelante en coedición en tiempo real, bases de datos, IA, importación y exportación, integraciones y apps móviles. Docs es un editor liviano y self-hosteable para wikis y notas. Quién debería quedarse, y para quién sirve."
date: "2026-10-07"
author: "Zerosoftware"
tags: ["docs", "notion", "comparación"]
---

Notion cambió lo que la gente espera de una herramienta de documentos. Páginas dentro de páginas, bloques que arrastrás, un menú con barra, bases de datos que convierten un documento en una app liviana. Docs, la alternativa a Notion de la suite de Zerosoft, toma muchas de esas ideas — e implementa una porción bastante más chica.

Así que esto no es un post de "somos igual de buenos, pero gratis". Es un mapa: dónde Notion está claramente adelante, qué hace Docs en realidad y cómo darte cuenta de cuál necesita tu equipo.

## La versión corta

- **Notion** es un espacio de trabajo todo-en-uno y maduro: colaboración en tiempo real, bases de datos potentes, IA integrada, importación y exportación desde y hacia muchos formatos, un gran ecosistema de integraciones y apps para todas las plataformas. Hace mucho, y casi todo bien.
- **Docs** es open source (AGPLv3), self-hosteable y enfocado: un editor por bloques, páginas anidadas, links con `[[`, templates, comentarios, permisos y papelera. Le sirve a una wiki de equipo, notas de reunión y specs — en tu propio servidor si querés.

## Dónde Notion está claramente adelante

**Coedición en tiempo real.** En Notion, varias personas escriben en la misma página a la vez y ven el cursor de los demás. Docs guarda solo, pero no combina ediciones simultáneas: si dos personas editan la misma página al mismo tiempo, gana el último que guarda. Para una wiki con dueños de página, se maneja. Para un equipo que escribe junto en vivo, no va.

**Bases de datos.** Es el superpoder de Notion. Relaciones entre bases, rollups, fórmulas, muchos tipos de propiedades y vistas como board, calendario y timeline sobre los mismos datos. Docs tiene un **bloque de base de datos**: una tabla chica con columnas tipadas (texto, número, select, fecha) que podés ver como tabla o como galería. Sirve para una lista de herramientas o de lecturas. No reemplaza una base de Notion que maneja la mitad de tu operación.

**IA.** Notion trae IA integrada para escribir, resumir y responder preguntas sobre todo tu espacio. Docs no tiene funciones de IA.

**Importación y exportación.** Notion importa desde muchas herramientas y formatos, y exporta a Markdown, HTML y PDF. Docs no importa desde Notion y todavía no exporta a JSON ni Markdown; lo más parecido es "Copiar contenido de la página", que copia la página como texto plano. Si lo hosteás vos, tus páginas viven en tu propia base de datos — pero una exportación como la gente sigue siendo deuda nuestra.

**Búsqueda.** Notion busca en el contenido de todas las páginas. Docs busca por título de página — es lo que hace funcionar los links con `[[` — y no busca dentro del cuerpo.

**Integraciones y API.** Notion tiene API pública y un ecosistema enorme de integraciones y automatizaciones. Docs todavía no tiene ninguna de las dos.

**Apps, offline y pulido.** Apps nativas de escritorio y móviles, historial de páginas, páginas públicas que podés publicar como sitio, bloques sincronizados, años de refinamiento. Docs corre en el navegador, y ahí termina.

**Enterprise.** SSO, logs de auditoría, permisos granulares. Nuestras piezas enterprise — SSO/SAML, logs de auditoría, roles personalizados — están en desarrollo en `/ee`, no lanzadas.

## Lo que Docs hace bien de verdad

**Lo básico del editor.** Escribí `/` para el menú de comandos: párrafos, tres niveles de título, listas con viñetas y numeradas, to-dos, citas, bloques de código con lenguaje, divisores, tablas simples y el bloque de base de datos. Formato inline, íconos de página con selector de emojis, portadas.

**Un árbol de páginas de verdad.** Las páginas se anidan tan profundo como necesites. La barra lateral muestra el árbol, podés arrastrar una página sobre otra para anidarla, y mover una página se lleva todo su subárbol.

**Links y menciones.** Escribí `[[` para linkear otra página por título. Escribí `@` para mencionar a un compañero y notificarlo.

**Templates.** Notas de reunión, spec de proyecto y retro semanal, más la página en blanco. Todavía no podés guardar templates propios, pero **Duplicar** copia una página con todas sus subpáginas, y eso hace que una sección "Templates" en tu wiki funcione sorprendentemente bien.

**Comentarios.** Sobre la página entera o sobre un bloque específico, con resolver y reabrir.

**Compartir y papelera.** Un panel para compartir con opciones público, equipo y usuario puntual; una papelera donde las páginas se restauran o se eliminan para siempre.

Escribimos una [guía paso a paso para armar una wiki interna con Docs](/blog/wiki-interna-con-docs) si querés ver estas piezas funcionando juntas.

## Dónde Docs tiene ventaja

**Es tuyo.** AGPLv3, self-hosteable, páginas guardadas en un archivo SQLite o una base libSQL/Turso que controlás vos. Ningún proveedor te puede cambiar las condiciones sobre la base de conocimiento de tu empresa. Si el [lock-in](/blog/el-lock-in-es-el-producto) te preocupa, este es el punto.

**Es parte de una suite.** El mismo login y el mismo equipo te dan Track, Chat, CRM, Cal y Link. Una conexión concreta: el bot de respuesta automática de Chat puede usar tus páginas de Docs como fuente (es matching por palabras clave, no un LLM — responde con un extracto de la página que mejor coincide). Tu wiki puede contestar las preguntas simples de los clientes.

**Menos para configurar.** Docs tiene menos funciones, y eso no es solo una debilidad. Hay equipos que se ahogaron en setups de Notion — bases de bases, relaciones que nadie entiende — y les va mejor con una herramienta que solo sabe de páginas y links.

**Precio.** Notion tiene un plan gratis y planes pagos por usuario, con la IA cobrada aparte en algunos planes; mirá su página de precios para los números actuales. Docs self-hosted es gratis, para siempre. Zerosoft Cloud tiene un tier gratuito generoso y después pago por uso, con precios publicados antes de cobrarte nada.

## Quién debería quedarse en Notion

Quedate si:

- Tu equipo escribe en las mismas páginas al mismo tiempo, seguido.
- Corrés flujos reales sobre bases de Notion — relaciones, rollups, fórmulas, vistas de board y calendario.
- Usás Notion AI todos los días.
- Necesitás búsqueda de texto completo en un espacio grande.
- Dependés de integraciones, de la API o de publicar páginas públicas.
- Necesitás apps móviles o de escritorio, o acceso offline.
- Tenés años de contenido en Notion. Sin importador, mudarlo sería trabajo manual.

Para esos equipos, Docs sería un paso atrás, y preferimos que lo sepas antes de probar.

## Para quién es Docs

- Equipos chicos que necesitan una wiki, notas de reunión y specs, con dueños de página claros.
- Empresas que quieren su conocimiento interno en su propio servidor, bajo una licencia open source.
- Equipos que ya usan otros productos de Zerosoft, sobre todo Chat, y quieren docs y soporte en el mismo lugar.
- Cualquiera que encontró a Notion más potente de lo que necesitaba y está pagando por asiento un poder que no usa.

## En resumen

Notion es el producto más amplio y capaz, y para muchos equipos es la herramienta correcta. Docs es un editor liviano, abierto y self-hosteable que hace páginas, links, templates y comentarios lo bastante bien como para sostener una wiki de equipo — y que es tuyo. Vamos a seguir cerrando huecos; la coedición en tiempo real y la exportación están en nuestro roadmap. Hasta que salgan, no las vamos a prometer.
