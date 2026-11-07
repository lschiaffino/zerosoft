---
title: "Un link corto que no funciona: cómo diagnosticarlo en cinco minutos"
description: "Guía de diagnóstico para links cortos rotos: las causas más comunes, cómo distinguirlas desde afuera y qué muestra Link en cada caso, con una lista de chequeo para copiar."
date: "2026-11-04"
author: "zerosoft"
tags: ["link", "diagnóstico", "guía"]
---

Un link corto roto casi nunca avisa. Alguien lo imprimió en un afiche, otro lo pegó en un mail a 2.000 personas, y tres días después un cliente escribe: "me tira error". Bitly tiene [su propia guía para resolver problemas con short links](https://bitly.com/blog/troubleshoot-short-link-issues/), pensada para su producto. Esta es la versión para cualquier acortador, con lo que Link muestra en cada caso, porque conocemos su código y podemos decirte qué hace de verdad.

La idea central: un link roto tiene una de unas pocas causas, y cada una deja una huella distinta. Si mirás en orden, el diagnóstico lleva cinco minutos.

## Paso 1: probalo desde afuera

Antes de tocar nada, abrí el link en una ventana privada y, si podés, desde el celular con datos móviles. Esto separa dos mundos:

- **Falla para todos:** el problema está en el link (vencido, archivado, destino caído).
- **Falla solo para algunos:** el problema está en el camino (un firewall, una caché, el dominio).

Si ves una pantalla de zerosoft, mejor: el título te dice la causa exacta (ver la tabla más abajo). Si ves un error del navegador, el problema es de DNS o de red, y el link ni siquiera llegó al acortador.

## Paso 2: ¿qué pantalla ves?

Cuando un link de Link no redirige, no te deja con un error genérico. Muestra una de estas pantallas, cada una con su causa:

| Pantalla | Causa | Qué hacer |
|---|---|---|
| "Este link ya no está" | Nunca existió, se borró o está archivado | Revisá el slug y el archivo de links |
| "Este link expiró" | Pasó la fecha de **Expira el** | Editá la fecha o creá otro link |
| "Límite de clics alcanzado" | Se llegó a **Máx. clicks** | Subí el máximo |
| "Link protegido" | Tiene contraseña | Pasá la contraseña o quitá la protección |
| "Este link fue bloqueado" | El destino se marcó como phishing o malware | Revisá el destino |

Dos detalles útiles. Primero, un link vencido o sin clics restantes puede llevar a una URL de respaldo en vez de la pantalla: cada link y cada dominio propio admiten una. Si tus visitantes llegan a una página que no esperabas, mirá esa configuración. Segundo, el aviso de bloqueo existe porque el destino se revisa al crear el link y de nuevo cada semana: una URL limpia hoy puede estar comprometida mañana.

## Paso 3: mayúsculas y minúsculas

Es la causa más tonta y la más frecuente cuando alguien tipea el link a mano. En Link, los slugs aceptan letras mayúsculas y minúsculas, y la búsqueda es exacta: `/Promo` y `/promo` son dos links distintos, y uno de los dos puede no existir.

Qué hacer:

1. Abrí el link desde el panel y copiá la URL en vez de escribirla.
2. Si el link va a un afiche o a un QR, usá slugs en minúsculas. Es más fácil de dictar y no depende de nadie.
3. Evitá caracteres que se confunden al leerlos: `l` minúscula contra `I` mayúscula, `0` contra `O`.

## Paso 4: el dominio propio

Si el link usa un dominio tuyo (`go.tuempresa.com/oferta`) y falla con un error del navegador o cae en la página de zerosoft, mirá el dominio, no el link. Link verifica la propiedad con dos registros: uno que apunta el dominio al servidor y un TXT en `_zerosoft-verify.<tu-dominio>`. Mientras el dominio no esté verificado, el host no resuelve nada: cualquier slug da "Este link ya no está".

Chequeos:

- En el panel de dominios, confirmá que figura como verificado.
- Si cambiaste de proveedor de DNS, recreá los dos registros. Los TTL largos hacen que el cambio tarde en verse.
- Los links viven dentro de su dominio: el mismo slug en el dominio por defecto y en el tuyo son links separados.

## Paso 5: el destino

A veces el link está perfecto y la página a la que apunta no. Probá el destino directamente. Si el sitio cambió de estructura, la URL vieja da 404 y el acortador no tiene nada que ver. Esta es la razón principal para elegir un acortador donde puedas **editar el destino sin cambiar el link corto**: arreglás una vez y todos los afiches impresos vuelven a funcionar.

Una consecuencia práctica: Link responde con `cache-control: no-store` en sus redirects, incluso los 301. Si editás el destino, archivás o vencés un link, el cambio se aplica en la siguiente visita y no depende de la caché del navegador.

## Paso 6: funciona para unos y para otros no

Si el link abre en tu casa y no en la oficina de un cliente, sospechá del firewall. Algunas redes corporativas bloquean dominios de acortadores enteros, y ahí no hay arreglo del lado del link. Lo que sí podés hacer:

- Usar un dominio propio: es más fácil que un área de TI lo apruebe que un dominio compartido por miles de acortadores.
- Mostrar el destino cuando sea posible ("docs.tuempresa.com/guia"), para que quien no puede abrir el link corto pueda copiar la URL larga.
- Mandar el link también con texto: si es un QR, imprimí el link corto debajo.

## Paso 7: las visitas no coinciden con lo que esperabas

"Mi link tiene 40 clics y mandé el mail a 2.000 personas" casi nunca es un link roto. Link no cuenta como visitas a los bots, a los generadores de previews de Slack, WhatsApp o iMessage ni a las peticiones HEAD, y tampoco gastan **Máx. clicks**. Un clic es una persona que abrió el link, y eso se parece poco a la cantidad de envíos.

Para detectar un problema de verdad, mirá la tendencia en la pestaña de analytics. Una caída brusca a cero con campaña activa sí merece el diagnóstico completo.

## Lista de chequeo para copiar

1. Abrir el link en ventana privada y en datos móviles.
2. Leer el título de la pantalla que muestra.
3. Comparar mayúsculas y minúsculas del slug con el del panel.
4. Si usa dominio propio, confirmar que está verificado y que los dos registros DNS siguen creados.
5. Abrir el destino directo.
6. Si falla solo en una red, pedir a TI que permita el dominio o pasar a uno propio.
7. Revisar la tendencia de clics antes de dar por roto un link con pocas visitas.

## Una última costumbre

Cada mes, abrí tus diez links más usados. Es un chequeo de dos minutos que atrapa destinos caídos antes de que lo haga un cliente. Link todavía no corre ese chequeo solo, así que por ahora es manual.
