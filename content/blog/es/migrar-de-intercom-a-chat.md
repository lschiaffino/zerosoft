---
title: "Migrar de Intercom a Chat: cómo traer tus conversaciones"
description: "Guía para pasar de Intercom a Chat: cómo sacar el JSON de la API de Intercom, qué entra (personas, mensajes, estado), qué no y qué revisar antes del cambio."
date: "2026-10-31"
author: "zerosoft"
tags: ["chat", "intercom", "migración", "guía"]
---

Cuando un equipo de soporte deja Intercom, lo que más pesa es el historial. Cada conversación vieja es contexto: qué preguntó ese cliente el año pasado, qué se le prometió, cómo se resolvió. Empezar de cero en otra bandeja significa perder eso.

Esta guía explica cómo traer ese historial a [Chat](/products/chat), qué trae exactamente el importador (lo leímos del código), qué queda afuera y en qué orden hacer el cambio. Vale avisarlo desde el principio: el import de Intercom en Chat funciona con un archivo JSON, no con una conexión directa, y lo probamos con los ejemplos de la documentación de Intercom, no con una cuenta real. Por eso la guía insiste en hacer una prueba chica antes.

## Qué necesitás

- **Un access token de Intercom.** Según la [documentación de Intercom](https://developers.intercom.com/docs/build-an-integration/learn-more/authentication), al crear una app en tu workspace desde el Developer Hub, el token aparece en Configure › Authentication de esa app.
- **Un widget creado en Chat.** Las conversaciones importadas se guardan en un widget. Si todavía no tenés uno, creálo primero.
- **Ser admin del workspace** en zerosoft.
- **Una terminal** con `curl` y `jq`, o cualquier lenguaje que haga pedidos HTTP. Es la única parte técnica.

## Paso 1: sacar el JSON de Intercom

Chat lee el formato que devuelve la API de Intercom al pedir una conversación: `GET /conversations/{id}`. Ese pedido trae el primer mensaje y las partes de la conversación. El listado (`GET /conversations`) sirve para conseguir los ids, pero la documentación de Intercom aclara que no incluye las partes, así que hay que pedir cada conversación por separado. Intercom también avisa que por API devuelve como máximo las 500 partes más recientes de una conversación.

Un ejemplo mínimo para una página del listado:

```bash
TOKEN="tu_access_token"
curl -s -H "Authorization: Bearer $TOKEN" -H "Accept: application/json" \
  "https://api.intercom.io/conversations?per_page=50" | jq -r '.conversations[].id' > ids.txt

while read id; do
  curl -s -H "Authorization: Bearer $TOKEN" -H "Accept: application/json" \
    "https://api.intercom.io/conversations/$id"
done < ids.txt | jq -s '.' > intercom.json
```

El listado viene paginado: para traer todo, repetí el primer pedido con el cursor que devuelve Intercom y juntá los ids. Chat acepta un array de conversaciones, un objeto con `conversations` o `data` adentro, o una sola conversación.

Dos límites del lado de Chat: **hasta 4 MB por archivo** y **2.000 conversaciones por archivo**. Si tu historial es más grande, partilo en varios archivos y subilos de a uno.

## Paso 2: importar en Chat

1. En Chat, andá a **Reportes** y tocá **Importar conversaciones** en el encabezado de la página.
2. En **Al widget**, elegí dónde van las conversaciones.
3. En **Archivo JSON**, subí el archivo y tocá **Importar**.

Al terminar ves cuántas conversaciones entraron, cuántas ya estaban y cuántos mensajes se importaron. Si alguna falló, se limpia y la podés reintentar subiendo el mismo archivo de nuevo: lo que ya entró no se duplica.

## Qué se importa

De cada conversación:

- **La persona**: nombre y email del contacto (o del autor del primer mensaje, si es el cliente). Los emails que no tienen forma de email se descartan.
- **El asunto**, si la conversación lo tenía, o su título.
- **Los mensajes en orden**, con su fecha. Los que escribió el contacto, lead o usuario quedan como del visitante; los demás, como respuestas del equipo.
- **El estado**: abierta si estaba abierta en Intercom; cualquier otro estado entra como resuelta.
- **Una etiqueta `import-intercom`** en cada conversación, para encontrarlas y separarlas en la bandeja.

Lo importado no dispara reglas, bot ni webhooks. Y las personas importadas no reciben campañas hasta que un admin marque su consentimiento en la ficha.

## Qué no se importa

- **Las notas internas.** El importador las saltea a propósito.
- **Adjuntos e imágenes.** Intercom manda los mensajes en HTML; Chat se queda con el texto.
- **Quién respondió.** Las respuestas del equipo entran como del equipo, sin la persona puntual. Los mensajes de bots también caen ahí.
- **Asignaciones, cambios de estado y conversaciones pospuestas.** Las asignaciones vienen como partes sin texto y no se importan. Una conversación pospuesta entra como resuelta.
- **Tags, atributos, empresas y calificaciones** de Intercom.
- **La persona unificada.** Cada conversación importada crea su propio registro de visitante, aunque el email se repita.
- **Artículos del centro de ayuda, bots y reglas.** Eso se arma de nuevo en Chat.

## Antes de cambiar el widget

1. **Probá con un archivo chico**, de diez o veinte conversaciones. Abrí algunas en Chat y compará con Intercom.
2. **Importá el resto** en tandas.
3. **Cargá tus respuestas guardadas** y los artículos de ayuda que el bot puede usar. En [artículos de ayuda que el bot puede leer](/blog/articulos-de-ayuda-que-el-bot-puede-leer) está cómo.
4. **Pegá el script del widget de Chat** en tu sitio y sacá el de Intercom.
5. **Corré una última exportación** de Intercom con las conversaciones de los últimos días e importala. Lo repetido se saltea.

## Qué le falta a Chat frente a Intercom

De la tabla de paridad, tal cual:

- **WhatsApp, Instagram, Messenger y SMS**: todavía no.
- **Teléfono y voz**: todavía no.
- **Apps nativas de iOS y Android para el equipo y SDK mobile del messenger**: todavía no.
- **Tienda de apps**: no hay. Intercom tiene más de 450.
- **Centro de ayuda multilingüe, privado o con dominio propio**: todavía no.
- **Email entrante, tickets, workflows visuales, multimarca y SSO**: cubiertos en parte. Por ejemplo, los issues de Track hacen de tracker tickets, pero no hay tipos de ticket ni portal para el cliente.
- **Campañas por email**: solo de texto, a personas con consentimiento, con tope diario.
- **Prioridades**: cuatro niveles; Intercom tiene cinco.
- **Idiomas del messenger**: 15, contra unos 45 de Intercom.
- **El import mismo**: sin conexión directa, adjuntos ni notas internas.

La tabla completa está en [/compare/zerosoft-vs-intercom](/compare/zerosoft-vs-intercom).

## Cuánto cuesta

Intercom arranca cerca de $29 por asiento por mes: un equipo de diez paga $3.480 al año. Chat en tu servidor cuesta $0, con el core en AGPLv3. En zerosoft Cloud empezás con un plan gratis y después pagás por uso. Los asientos no se cobran, así que sumar a alguien a soporte no cambia la factura.

Si querés ver la comparación del día a día antes de mudarte, leé [Chat vs Intercom](/blog/zerosoft-chat-vs-intercom).
