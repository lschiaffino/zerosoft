---
title: "Un robot detrás de un login, sin dejar tu contraseña a la vista"
description: "Cómo hacer que un robot entre a un sitio con usuario, contraseña y 2FA, guarde la sesión entre corridas y no exponga datos privados. Pasos y límites reales de Robots de zerosoft."
date: "2026-11-14"
author: "zerosoft"
tags: ["robots", "seguridad", "browse-ai"]
---

La ayuda de Browse AI explica [cómo extraer y monitorear datos detrás de un login](https://help.browse.ai/en/articles/10518514-how-to-scrape-and-monitor-data-behind-a-login). Recomienda cookies de sesión para logins comunes sin 2FA y sugiere renovarlas cada tanto, una vez por mes como referencia. Es un buen punto de partida, porque casi todo lo útil para automatizar (un panel de proveedor, un portal de facturas, un listado interno) vive detrás de una contraseña.

Este post resuelve el mismo problema con Robots, la automatización de navegador de zerosoft, y se concentra en lo que más importa cuando un robot maneja credenciales: dónde se guarda el secreto, a qué sitio se le permite escribirlo y quién ve lo que el robot trae.

## Antes de empezar

Usá un robot con login solo en cuentas tuyas o que te autorizaron a automatizar. Leé los términos del sitio: muchos prohíben el acceso automático incluso con una cuenta válida. Si existe una API o una exportación oficial, es mejor camino que un navegador.

## Paso 1: guardar la credencial una sola vez

Las credenciales viven en el workspace, no dentro del robot. Creá una de tipo "basic" con tres campos:

- **Usuario.**
- **Contraseña.** Se guarda cifrada.
- **Secreto TOTP.** Opcional, para sitios con verificación en dos pasos. Es el texto que muestra el sitio al configurar la app autenticadora (algo como `JBSW Y3DP EHPK 3PXP`). Robots lo valida al guardar.

Un solo nombre, por ejemplo `PORTAL_PROVEEDOR`, sirve para todos los robots que entren a ese sitio. Si cambiás la contraseña, la cambiás en un lugar.

## Paso 2: escribir el login en los pasos

En la pestaña Pasos, el login se arma con pasos normales. La plantilla "Iniciar sesión y extraer" ya trae la estructura y vale como molde:

1. **Ir a URL** con la página de login.
2. **Si existe** el campo de usuario. Si no está, el robot se saltea el login. Eso resuelve el caso de la sesión guardada, que vemos en el paso 4.
3. **Completar** el campo de usuario con `{{credentials.PORTAL_PROVEEDOR.username}}`.
4. **Completar** el campo de contraseña con `{{credentials.PORTAL_PROVEEDOR.password}}`.
5. **Clic** en el botón de entrar y **Esperar** a un elemento que solo aparece logueado.
6. **Extraer lista** con lo que viniste a buscar.

Si el sitio pide 2FA, agregá otro paso Completar con `{{credentials.PORTAL_PROVEEDOR.totp}}`. Robots calcula el código del momento (RFC 6238) en cada intento, así que un reintento después de 30 segundos no usa un código vencido.

## Paso 3: las reglas que Robots te impone

Estas tres restricciones existen para que una credencial no termine en un lugar donde se pueda leer. El editor las verifica al guardar:

- **Solo en el valor de un paso Completar.** Si ponés `{{credentials...}}` en un selector, una URL, un texto o un script, Robots rechaza el robot y te dice qué paso es.
- **Sitio del login.** Cada paso Completar con credencial tiene un campo "Sitio del login". El secreto se escribe únicamente si la página está en ese sitio (un dominio y su `www.` cuentan como el mismo). Si el campo termina en otro lado, por una redirección o un iframe, el paso falla sin escribir nada. Dejar el campo vacío usa el sitio del último paso Ir a URL con dirección fija, pero conviene completarlo a mano.
- **Sin leer lo escrito.** Un robot con credencial no puede tener un paso de script ni extraer el atributo `value`, porque hay sitios que copian ahí lo que tipeaste. También se desactivan los selectores alternativos en los pasos con login, para que el robot no termine escribiendo la contraseña en un elemento parecido pero equivocado.

Es más restrictivo que un navegador común a propósito. El día que alguien edite un robot y pegue una URL de phishing en un paso, el secreto no sale.

## Paso 4: guardar la sesión y no loguearse en cada corrida

En Ajustes del robot activá "Guardar sesión entre corridas". Robots conserva cookies y localStorage, cifrados, y la próxima corrida arranca ya adentro. Gracias al paso "Si existe" del punto 2, el robot detecta que no hay formulario y salta directo a extraer.

Tres detalles prácticos:

- Si la sesión guardada pesa más de 1.000.000 de caracteres, no se guarda y la corrida siguiente vuelve a loguearse.
- "Borrar sesión" la elimina cuando algo quedó raro: un cambio de contraseña, una cuenta bloqueada, un sitio que te dejó a medias.
- Apagar la opción también borra lo guardado.

Una sesión guardada es cómoda, pero también es una llave. Tratala como tal: un robot por cuenta, y la cuenta con los permisos mínimos que necesite para leer.

## Paso 5: decidir quién ve los datos

Un robot con login trae datos privados, y Robots lo asume. Las corridas hechas con un login quedan marcadas con quien las capturó, y solo esa persona y los admins ven las filas. En el workspace, los members pueden crear robots y correr los que no usan login, sesión guardada ni credencial. Los que sí los usan quedan para admins y owners.

Cuando conectes el robot a un destino (el CRM, un flow, una hoja), Robots te muestra un aviso: las filas pueden incluir datos privados, así que mandalas solo a donde esté permitido. Hacele caso. Un listado de clientes de un portal no debería terminar en un canal abierto de chat.

## Paso 6: que no se rompa en silencio

Los logins fallan más que las páginas públicas: caducan, piden un captcha nuevo, cambian el formulario. Dos ajustes que ayudan:

- **Pausa automática.** Por defecto el horario se pausa después de 3 fallas seguidas (se puede subir hasta 20). Importa más con login: un robot que sigue intentando con una contraseña vieja puede bloquear la cuenta.
- **Captura de la falla.** En la pestaña Corridas ves la captura, la URL y un fragmento del DOM del paso que falló, sin la credencial.

## Lo que Robots todavía no hace

- No resuelve captchas ni verificaciones por SMS o llave de hardware. Si el login las exige, el robot no avanza.
- El código TOTP funciona con apps autenticadoras estándar. Un 2FA que llega por email no tiene paso propio.
- La sesión guardada es una por robot, no compartida entre robots.
- La extensión de Chrome para grabar los pasos se instala a mano con el modo de desarrollador y no se actualiza sola.

## Qué cambia frente a un servicio en la nube de otro

Cuando un robot de un tercero entra a tu portal, tu contraseña y las cookies de tu sesión viven en sus servidores. Con zerosoft en tu propio servidor, la credencial cifrada, la sesión y las filas quedan en tu base, y el navegador es tu Chromium. En zerosoft Cloud el código es el mismo y pagás el uso al costo por tres. Para equipos que automatizan accesos a sistemas de clientes, saber dónde está cada secreto vale más que cualquier límite de corridas.
