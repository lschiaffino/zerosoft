---
title: "Open core: qué es AGPL, qué va en /ee y por qué"
description: "Todo el repositorio de zerosoft es AGPLv3 salvo una carpeta, /ee. Qué va ahí, qué dice su licencia borrador, qué está construido hoy y cómo decidimos dónde va la línea."
date: "2026-08-15"
author: "zerosoft"
tags: ["open source", "open core", "licencias"]
---

"Open core" puede significar cualquier cosa, desde un producto abierto con algunos extras pagos hasta una demo recortada con un repo en GitHub. En lugar de definirlo en abstracto, acá va el nuestro, con nombres de carpetas.

zerosoft es un solo repositorio. Todo lo que hay adentro es AGPLv3, salvo una carpeta llamada `/ee`. Ese es todo el modelo. El resto del post es sobre qué va en esa carpeta, qué no y por qué.

## Qué hay en el core (básicamente, todo)

Cada feature de producto que usás en el día a día está fuera de `/ee`, bajo [AGPLv3](/blog/por-que-agpl):

- **Link:** alias propios, códigos QR, creación masiva, dominios propios, páginas link-in-bio, webhooks, analytics sin cookies, la API pública.
- **CRM:** contactos, empresas, deals con múltiples pipelines, listas, campos custom, reportes y dashboards, workflows, importación y exportación.
- **Track, Cal, Chat, Docs:** todo. Ciclos y vista Gantt, formularios de ruteo y hosts en round-robin, políticas de SLA y CSAT, páginas anidadas y permisos para compartir.
- **Teams:** workspaces con roles owner, admin y member, invitaciones, y acciones solo para admins como los workflows del CRM, la exportación y el borrado masivo.

Nada de eso requiere una license key. Nada es "gratis hasta N usuarios". Hostear las once apps no cuesta nada. Nuestro propio [ee/README.md](https://github.com/lschiaffino/zerosoft/blob/main/ee/README.md) lo dice sin vueltas: todo lo que está fuera de `/ee` es AGPLv3 "y siempre lo va a ser".

## Qué vive en /ee

La lista es corta y, hoy, mayormente un plan. El README dice "lo que vive acá (a medida que se construye)":

- **SSO / SAML y aprovisionamiento SCIM**: entrar con el proveedor de identidad de tu empresa, dar de alta y de baja usuarios automáticamente.
- **Audit logs**: quién hizo qué y cuándo, para compliance.
- **Roles custom y permisos granulares**: más allá de owner / admin / member.
- **White-label**: sacar la marca zerosoft de las páginas de reserva y del widget de chat.

Seamos precisos con el estado, porque de eso se trata este blog: **estas features están en desarrollo.** Lo que hoy existe en la carpeta es la plomería de licencias, `ee/lib/license.ts`, que verifica una license key, y el texto de la licencia. Si necesitás SAML la semana que viene, zerosoft todavía no llegó, y preferimos que lo escuches de nosotros.

## Cómo funciona la plomería

Dos reglas evitan que `/ee` se filtre al core:

1. **El código del core nunca importa de `/ee`**, salvo a través de `ee/lib/license.ts`, que expone `isEnterprise()` y `hasFeature()`.
2. **Las features enterprise tienen que degradar limpio.** Sin licencia, el core sigue funcionando exactamente igual.

Las license keys se verifican **offline**: una firma Ed25519 sobre un JSON chiquito (cliente, fecha de vencimiento, features). No hay phone-home, telemetría ni un servidor nuestro que tenga que estar arriba para que tu instancia funcione. Seteás `ZEROSOFT_LICENSE_KEY` en tu entorno; si falta o es inválida, `/ee` simplemente queda apagado.

## Qué dice la licencia de /ee

La [zerosoft Enterprise License](https://github.com/lschiaffino/zerosoft/blob/main/ee/LICENSE) es source-available, no open source. En resumen, y lo que vale es el texto de la licencia:

- **Desarrollo y testing son gratis.** Leelo, copialo, modificalo, correlo en entornos que no son de producción sin pagar.
- **El uso en producción necesita una suscripción** que cubra tu alcance de uso (usuarios, instancias o uso).
- **Nada de redistribuir, revenderlo como servicio ni saltear los chequeos de licencia.** Los forks del repo están bien, siempre que `/ee` mantenga su licencia y sus avisos.

Una nota honesta más: **la licencia es un borrador pendiente de revisión legal.** Lo dice arriba de todo, y algunos de sus detalles entre corchetes todavía no están completos. Se va a cerrar antes de la primera venta comercial. Hasta entonces, expresa de buena fe los términos que pretendemos. Las preguntas van a hola@zerosoft.ai.

## Por qué la línea está exactamente ahí

Teníamos un test simple: **¿un equipo chico lo necesita para hacer su trabajo?** Si la respuesta es sí, va al core. Contactos, pipelines, páginas de reserva, issues, un inbox compartido, documentos, una API, webhooks, exportaciones: una empresa de cinco personas necesita todo eso, así que todo eso es gratis.

Las features de `/ee` no pasan ese test a propósito. Nadie en una empresa de cinco personas está pidiendo SAML. Los audit logs, SCIM y los roles custom finos aparecen cuando hay un equipo de seguridad, un requisito de compliance, un checklist de compras. Esas son las organizaciones que ya esperan pagar por software, que necesitan a alguien que atienda el teléfono y que le sacan valor real a un contrato.

Hay una segunda razón, menos obvia: ahí es donde está la carga de soporte. Cada proveedor de identidad es un poco distinto; los requisitos de auditoría son específicos de cada industria. Cobrar por eso financia a la gente que hace que funcione.

## Lo que prometemos no hacer

El open core tiene un modo de falla conocido: la empresa va moviendo de a poco features útiles del lado gratis al lado pago, o empieza a sacar lo esencial nuevo solo detrás de la licencia. Algunos productos open core empeoraron así para sus usuarios gratuitos.

Nuestras barandas contra eso:

- **El core no se puede retirar.** Lo que se publicó bajo AGPL sigue siendo AGPL. Aunque cambiáramos de idea, la última versión libre se puede forkear siempre.
- **La lista de `/ee` es pública y específica.** Está en el README. Si algún día crece para incluir algo que un equipo chico necesita, lo vas a ver en un diff.
- **Nuestra nube tampoco vende el core.** zerosoft Cloud tiene un plan gratis y después cobra por uso del workspace (clics, reservas, emails, almacenamiento), sin cargo por asiento. Vendemos operación y extras enterprise, no las funciones del core.

## A quién le importa /ee

Honestamente, a la mayoría de los lectores de este blog, no. Si sos freelancer, una startup o una empresa chica que hostea zerosoft, el core es el producto y nunca vas a tocar una license key.

Si estás en una organización más grande que necesita SSO, audit trails o roles custom: vienen en camino, el código va a ser legible antes de que compres y lo vas a poder probar gratis. Escribinos y contanos cuál necesitás primero: nos ayuda de verdad a decidir qué construir.
