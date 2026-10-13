---
title: "Cómo armar tu página link-in-bio con Link (y qué todavía no hace)"
description: "Tu página /@handle en cinco minutos: título, bio, avatar, botones ordenados y clicks medidos con tus propios links cortos. Más la lista honesta de lo que no hace."
date: "2026-08-06"
author: "Zerosoftware"
tags: ["link", "link in bio", "guía"]
---

Las redes te dan un link. Uno. Así que todo internet se puso de acuerdo en el mismo parche: una paginita con una lista de botones, hosteada por una empresa a la que le encantaría cobrarte todos los meses por una lista de botones.

Link trae una de fábrica. Vive en `zerosoft.ai/@tuhandle`, es gratis, y cada botón pasa por uno de tus links cortos, así que los clicks caen en las mismas analytics que ya usás. Acá va cómo configurarla en cinco minutos, y exactamente dónde están sus bordes.

## Qué podés personalizar

Primero bajemos expectativas, porque las herramientas de link-in-bio aman sobrevender. La página tiene:

- **Un título.** Hasta 80 caracteres. Si lo dejás vacío, usa el nombre de tu cuenta, y si no, `@handle`.
- **Una bio.** Hasta 300 caracteres de texto plano.
- **Un avatar.** Una URL a una imagen, y tiene que ser `https`. Si lo dejás vacío, la página muestra la primera letra de tu título.
- **Botones.** Cualquiera de tus links, en el orden que elijas, hasta 50.
- **Un switch de publicación.** Las páginas no publicadas devuelven 404.

Esa es toda la lista. No hay temas, colores, tipografías, imágenes de fondo, filas de íconos sociales, videos embebidos ni CSS custom. La página usa el mismo estilo minimalista que el resto de Zerosoft. Si necesitás una página muy brandeada, una herramienta dedicada (o una página en tu propio sitio) te va a servir mejor — y igual podés apuntar sus botones a tus links cortos.

## Paso 1: creá los links primero

La página bio no tiene links propios; muestra links que ya tenés. Así que arrancá en Link y creá un link corto por botón.

El detalle importante: **el texto del botón es el título del link.** Si un link no tiene título, el botón muestra la URL de destino sin `https://`, y queda desprolijo. Ponele un título humano a cada link que vayas a mostrar: "Episodio nuevo", "Agendá una llamada", "Tienda".

Como son links normales, aplica todo lo demás. Sumale un UTM al destino para que las analytics de tu sitio sepan que la visita vino de tu bio. Usá un [dominio propio](/blog/dominios-propios-dns-paso-a-paso) si tenés. Tagealos `bio` para encontrarlos después.

## Paso 2: completá la página

Abrí la pestaña **Página bio** en Link. Completá título, bio y URL del avatar. El avatar no se sube acá: hosteá la imagen en algún lado (tu sitio, un CDN, la URL de tu foto de perfil actual) y pegá el link `https`.

## Paso 3: elegí y ordená los botones

Debajo de los campos del perfil vas a ver tus links, cada uno con un checkbox. Marcá los que querés en la página. Los marcados suben arriba de todo y ganan flechas de subir/bajar: ese orden es el orden en la página. El editor lista tus 50 links activos más recientes, así que si falta uno muy viejo, creá un link corto nuevo para ese destino.

## Paso 4: publicá

Marcá **Publicada**, tocá **Guardar** y después **Ver página**. Listo. Pegá `zerosoft.ai/@tuhandle` en tu Instagram, TikTok, X o donde sea.

La página además arma su preview social con tu perfil: título, la bio como descripción y el avatar como imagen. Así se ve decente cuando alguien la comparte en un chat.

## Tu handle

El handle se genera a partir de tu email cuando te registrás. Lo podés cambiar desde la configuración de Cal, en **Tu handle**: de 3 a 32 letras minúsculas, números o guiones. Es el mismo handle que usan tus [páginas de reserva](/blog/calendly-y-el-impuesto-a-agendar) (`/book/<handle>/…`), así que cambiarlo mueve las dos cosas, y rompe cualquier link al viejo que ya hayas compartido. Elegilo una vez, elegilo bien.

## Qué se oculta solo

La página se genera en cada request, y se saltea los links que serían un callejón sin salida para el visitante:

- **Links con contraseña** nunca aparecen. Una página bio es pública; un link con password no está pensado para eso.
- **Links archivados** desaparecen.
- **Links vencidos** desaparecen en el momento en que pasa su fecha de expiración. Muy útil para ofertas limitadas: ponés un vencimiento y el botón se saca solo.

Una excepción que conviene saber: un link que llegó a su **límite de clicks** sigue apareciendo, pero lleva a la página de "Límite de clicks alcanzado". Si usás límites para una oferta tipo "las primeras 100 personas", destildalo de la página cuando se llene.

## Medición: qué ves y qué no

Cada botón apunta al link corto, no al destino, así que cada toque es un click normal: día, país, dispositivo, browser y OS, sin cookies, como cualquier otro link ([acá contamos cómo funciona](/blog/analytics-sin-cookies)).

Dos aclaraciones honestas:

- **Las visitas a la página no se cuentan.** Contamos clicks en botones, no visitas a la página. Vas a saber cuánta gente tocó "Tienda", no cuánta abrió la página y se fue.
- **El referrer de esos clicks es la propia página bio.** La gente vino de Instagram, pero hizo click desde `zerosoft.ai`. Así que el referrer por botón no te dice qué red social la mandó.

Un arreglo simple para lo segundo: creá un link corto por plataforma que apunte a tu página bio, tipo `zerosoft.ai/ig-bio` y `zerosoft.ai/tt-bio`, y usá cada uno en su perfil. Las analytics de esos links te dicen cuánta gente llegó desde cada red; los botones te dicen qué hizo después.

## Algunos patrones que funcionan

- **Botón de temporada arriba.** Subí el lanzamiento del momento, dejá lo permanente abajo. Reordenar son dos clicks.
- **Promos que se vencen solas.** Creá el link de la promo con fecha de expiración y marcalo en la página. Desaparece solo.
- **Un link por destino, para siempre.** Si el destino cambia (tienda nueva, otro host para el podcast), editá la URL del link corto. El botón, la página y cualquier QR que hayas impreso siguen andando.

## Lo que todavía no está

Para que los bordes queden claros: no hay personalización visual más allá de título, bio y avatar; no se puede subir el avatar; no hay analytics de visitas a la página; y la página vive solo en el dominio principal, no en tu dominio propio. Si alguna de estas es un deal-breaker para vos, contanos — o, como el código es abierto, mandá un pull request.

Una lista de botones no debería costar una suscripción. Ahora no cuesta.
