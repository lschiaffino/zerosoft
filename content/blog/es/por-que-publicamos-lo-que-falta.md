---
title: "Por qué publicamos lo que nos falta"
description: "El README lista los huecos conocidos de cada producto al lado de sus funciones. Por qué decimos qué falta antes de que lo descubras y cómo lo aplicamos en el sitio y el blog."
date: "2026-09-13"
author: "zerosoft"
tags: ["honestidad", "marketing", "open source"]
---

Abrí el README de zerosoft y mirá debajo de cualquier producto. Justo después de la lista de features hay una línea en cursiva que empieza con *Known gaps*. No está escondida en un changelog ni enterrada en un hilo de un foro. Está en el primer archivo que cualquiera lee.

Muchas empresas de software lo considerarían mal marketing. Para nosotros es una regla.

## Qué dice la lista

Estos son los huecos principales, app por app (actualizados en octubre de 2026; varios de la primera versión de este post ya se cerraron, como las secuencias, las cotizaciones y los formularios del CRM):

- **CRM:** en el celular las tablas solo se desplazan de costado. Las cotizaciones no tienen firma electrónica ni cobro. Los formularios no tienen pasos múltiples, campos condicionales ni CAPTCHA. Conectar Gmail requiere que Google verifique la app.
- **Track:** sin atajos de teclado, sin sincronización en tiempo real, sin integración con GitHub, sin API pública y sin importador de Linear.
- **Cal:** sin Outlook ni iCloud, sin cobros, sin eventos grupales y sin horarios reutilizables entre tipos de evento.
- **Chat:** solo webchat (sin email ni WhatsApp), sin notas internas en la conversación y sin centro de ayuda.
- **Docs:** sin edición simultánea, sin historial de versiones, sin exportación a Markdown o PDF y sin importador de Notion. Compartir una página todavía no le da acceso en la interfaz a quien la recibe.
- **El sitio:** la página de status lista servicios; el monitoreo en vivo todavía no está conectado.
- **Enterprise:** SSO/SAML, audit logs, roles a medida y white-label viven en `/ee` y están en desarrollo.

Si estás evaluando reemplazar HubSpot, Linear o Notion, leé esa lista primero. Para algunos equipos, varios puntos son motivo suficiente para no cambiarse. Por eso están ahí.

## Por qué lo hacemos

### Porque te vas a enterar igual

Un hueco escondido lo descubre el usuario tres semanas después de migrar, en plena semana de trabajo. En ese momento es una promesa rota.

Un hueco publicado nos cuesta al usuario que lo necesitaba el primer día. Está bien: ese usuario tiene que seguir con la herramienta que lo tiene.

### Porque la línea de la IA importa

Hoy es fácil decir que cualquier cosa "tiene IA". Por eso decimos exactamente qué hace cada una: el bot de Chat usa un modelo de lenguaje si configurás una clave del AI Gateway y, si no, responde por coincidencia de palabras clave con tus respuestas guardadas y tus páginas de Docs. Agents usa el modelo que elijas. Si borroneáramos esa diferencia, quien esperaba un LLM se sentiría engañado, con razón.

### Porque nos mantiene honestos puertas adentro

Escribir "no tenemos X" al lado de "tenemos Y" cambia cómo trabaja un equipo. La guía de contribución tiene una regla: las páginas de producto solo pueden afirmar funciones que existen en `main`, no en una rama ni en el próximo sprint.

Esa regla solo funciona si existe también la lista opuesta. Cuando una afirmación y un gap se contradicen, alguien lo nota y uno de los dos se arregla. Generalmente, la afirmación.

### Porque es un proyecto open source

En un proyecto open source, la lista de huecos es también una lista de tareas que cualquiera puede agarrar. Cada línea de *Known gaps* es un lugar donde un contribuidor puede hacer una diferencia real, y [contribuir no necesita permiso de nadie](/blog/como-contribuir-a-zerosoftware).

Calendarios de Outlook para Cal, exportación a Markdown para Docs, una API pública para Track: son issues esperando a alguien, nosotros incluidos.

## Cómo se ve el marketing honesto en la práctica

Publicar los gaps es una parte. La política completa es un puñado de reglas aburridas que aplicamos en todos lados, este blog incluido:

- **Solo afirmar lo que existe en el código.** Si una función no está mergeada, no está en la página de producto. Por eso la página de Cal dice que Outlook e iCloud todavía no están, en lugar de poner "sync de calendarios" y listo.
- **Decir dónde el incumbente está adelante.** HubSpot tiene un ecosistema de integraciones enorme. Linear tiene atajos de teclado y sincronización en tiempo real que nosotros no tenemos. Notion tiene edición simultánea y una biblioteca de plantillas enorme.
- **Nada de números inventados.** Ni cantidad de usuarios inventada, ni testimonios que no recibimos, ni benchmarks que no corrimos. Cuando damos un ejemplo, aclaramos que es hipotético.
- **Nada de precios inventados.** El self-host cuesta $0 bajo AGPLv3. zerosoft Cloud tiene un plan gratis y después cobra por uso, con los precios publicados antes de cobrar. No damos un número por unidad hasta que sea real.
- **Decirle a la gente que no se cambie.** Si tu equipo necesita SAML este trimestre o un inbox de email y WhatsApp, todavía no somos para vos. Decirlo es parte del producto.

## "¿Esto no es malo para el negocio?"

A corto plazo, puede ser. Una landing de la competencia llena de checkmarks se ve mejor que la nuestra con una lista de lo que falta.

La página de los checkmarks optimiza el primer clic. Nosotros, el segundo año. Un software al que le mudaste los contactos, el calendario y los documentos es un software en el que necesitás confiar. Cualquiera escribe una lista de funciones; la confianza sale de la línea que va abajo.

Hay también una razón más simple. Nuestro código es público. Cualquiera puede abrir `lib/` y fijarse si Chat llama a un modelo de lenguaje. En un proyecto open source, mentir sobre funciones además no tiene sentido: cualquiera lo comprueba.

## Cómo sale un gap de la lista

Igual que entró, en público. Una función sale, la página de producto puede afirmarla y la línea sale de *Known gaps*. Si estás esperando una en particular, seguí el README, o [mandá un PR](/blog/como-contribuir-a-zerosoftware) y sacala de la lista vos.
