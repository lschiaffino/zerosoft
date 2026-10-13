---
title: "Por qué publicamos lo que nos falta"
description: "Nuestro README lista los gaps conocidos de cada producto, al lado de las features. Sin calendario de Outlook, sin bot con LLM, sin coedición en tiempo real. Por qué el marketing honesto es una política y no un humor."
date: "2026-09-13"
author: "Zerosoftware"
tags: ["honestidad", "marketing", "open source"]
---

Abrí el README de Zerosoft y mirá debajo de cualquier producto. Justo después de la lista de features hay una línea en cursiva que empieza con *Known gaps*. No está escondida en un changelog ni enterrada en un hilo de un foro. Está en el primer archivo que cualquiera lee.

La mayoría de las empresas de software le diría a eso mal marketing. Nosotros creemos que es el único que funciona a largo plazo, y lo volvimos una regla.

## Qué dice la lista, de verdad

Estos son los gaps, tal como están publicados, producto por producto:

- **CRM:** el sync de Gmail es manual, no en segundo plano. Sin templates de email, secuencias ni tracking de aperturas. Sin cotizaciones ni productos. Sin formularios de leads. Sin eventos de webhook del CRM. No se pueden importar deals ni actividades. Los reportes usan una sola moneda.
- **Track:** sin atajos de teclado, sin sync en tiempo real, sin integración con Git/GitHub, sin API pública ni webhooks, sin importación desde Linear.
- **Cal:** sin calendarios de Outlook ni iCloud. Google Calendar, sí.
- **Chat:** el bot de respuestas automáticas es matching de palabras clave sobre respuestas guardadas y páginas de docs, *no un LLM*. Sin exportación de conversaciones.
- **Docs:** sin coedición en tiempo real, sin exportación a JSON/Markdown, sin importación desde Notion.
- **El sitio:** la página de status lista servicios; el monitoreo en vivo todavía no está conectado.
- **Enterprise:** SSO/SAML, audit logs, roles custom y white-label viven en `/ee` y están en desarrollo.

Releé esa lista si estás evaluando reemplazar HubSpot o Linear. Para algunos equipos, varios de esos puntos son dealbreakers. Justamente por eso están ahí.

## Por qué lo hacemos

### Porque te vas a enterar igual

Un gap que escondés es un gap que tu usuario descubre tres semanas después de migrar, en plena semana de ventas, cuando quiere mandar una secuencia o mover el board de Track con un atajo de teclado. En ese momento ya no es una feature que falta. Es una promesa rota, y la confianza no vuelve.

Un gap que publicás te cuesta el usuario que lo necesitaba el primer día. Está bien. Ese usuario tiene que seguir usando la herramienta que lo tiene. Preferimos perderlo con honestidad que retenerlo infeliz.

### Porque la línea de la IA importa justo ahora

Sería facilísimo, en 2026, decir que el bot de Chat es "con IA". Al fin y al cabo responde preguntas solo. Pero lo que hace es matchear palabras clave contra tus respuestas guardadas y tus páginas de docs. Es útil, predecible y barato de correr, y no es un modelo de lenguaje. Si borroneáramos esa línea, cada cliente que esperaba un LLM se sentiría engañado, y tendría razón.

Así que el README lo dice en criollo: *no es un LLM*.

### Porque nos mantiene honestos puertas adentro

Escribir "no tenemos X" al lado de "tenemos Y" cambia cómo trabaja un equipo. Nuestra guía de contribución tiene una regla: las páginas de producto solo pueden afirmar features que existen en `main`. No "en una rama". No "el próximo sprint". En `main`.

Esa regla solo funciona si existe también la lista opuesta. Cuando una afirmación y un gap se contradicen, alguien lo nota y uno de los dos se arregla. Generalmente, la afirmación.

### Porque es un proyecto open source

En un producto cerrado, una lista de gaps es una confesión. En un proyecto open source es una lista de tareas que cualquiera puede agarrar. Cada línea de *Known gaps* es un lugar donde un contribuidor puede hacer una diferencia real, y [contribuir no necesita permiso de nadie](/blog/como-contribuir-a-zerosoftware).

Calendarios de Outlook para Cal, exportación a Markdown para Docs, una API pública para Track: no son secretos que nos den vergüenza. Son issues esperando a alguien, nosotros incluidos.

## Cómo se ve el marketing honesto en la práctica

Publicar los gaps es una parte. La política completa es un puñado de reglas aburridas que aplicamos en todos lados, este blog incluido:

- **Solo afirmar lo que existe en el código.** Si una feature no está mergeada, no está en la página de producto. "Próximamente" se permite solo cuando está etiquetado así; por eso nuestra página de Cal dice que Outlook e iCloud vienen pronto, en vez de poner "sync de calendarios" y listo.
- **Decir dónde el incumbente está adelante.** HubSpot tiene un ecosistema de integraciones enorme. Linear tiene una velocidad keyboard-first y un sync en tiempo real que nosotros no tenemos. Notion tiene colaboración en tiempo real y una biblioteca de templates gigante. Hacer como que no, es subestimar al lector.
- **Nada de números inventados.** Ni cantidad de usuarios inventada, ni testimonios que no recibimos, ni benchmarks que no corrimos. Cuando damos un ejemplo, aclaramos que es hipotético.
- **Nada de precios truchos.** El self-host es gratis para siempre bajo AGPLv3. Zerosoft Cloud tiene un plan gratis generoso y después cobra por uso, con precios transparentes publicados antes de cobrarte nada. No vamos a tirar un número por unidad hasta que sea real.
- **Decirle a la gente que no se cambie.** Si tu equipo de ventas vive de secuencias de email, nuestro CRM todavía no es para vos. Si necesitás SAML este trimestre, esperá. Decirlo en voz alta es parte del producto.

## "¿Esto no es malo para el negocio?"

A corto plazo, puede ser. Una landing de la competencia llena de checkmarks se ve mejor que la nuestra con una lista de lo que falta.

Pero pensá para qué optimiza la página de los checkmarks: para el primer click. Nosotros optimizamos para el segundo año. Un software al que le mudaste los contactos, el calendario y los documentos es un software en el que necesitás confiar. Y la confianza no se construye con la lista de features — cualquiera escribe una lista de features. Se construye con la línea que va abajo.

Hay también una razón más simple. Nuestro código es público. Cualquiera puede abrir `lib/` y fijarse si Chat llama a un modelo de lenguaje. Mentir sobre features en un proyecto open source no solo está mal: no tiene sentido. La única posición coherente es decirlo primero.

## Cómo sale un gap de la lista

Igual que entró: en público. Una feature se shipea, la página de producto puede afirmarla y la línea sale de *Known gaps*. Si estás esperando una en particular, seguí el README, o [mandá un PR](/blog/como-contribuir-a-zerosoftware) y sacala de la lista vos.
