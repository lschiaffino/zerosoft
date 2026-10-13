---
title: "Links con contraseña, fecha de vencimiento o límite de clicks: cuándo usar cada uno"
description: "Casos de uso concretos para links con contraseña, que vencen o con máximo de clicks en Link, qué ve exactamente el visitante cuando uno se cierra, y dónde entran los QR en SVG y PNG."
date: "2026-09-18"
author: "Zerosoftware"
tags: ["link", "qr", "casos de uso"]
---

La mayoría de los links cortos viven para siempre y dejan pasar a cualquiera. Es el default correcto. Pero cada tanto querés un link que sepa decir que no: solo a quien tenga la contraseña, solo hasta el viernes, solo para los primeros cien.

Link tiene tres switches para eso, en **Opciones avanzadas** cuando creás o editás un link: **Protección con contraseña**, **Expira el** y **Máx. clicks**. Son gratis, se combinan, y son lo bastante simples como para que valga la pena saber exactamente cómo se comportan antes de imprimir uno en un afiche.

## Links con contraseña

**Qué pasa:** en vez de ser redirigido, el visitante cae en una pantallita de "Link protegido" con un campo de contraseña. Con la contraseña correcta, pasa al destino. Si le erra, puede volver a probar.

Detalles que conviene saber:

- **El navegador se acuerda por 7 días.** Después de desbloquear, una cookie atada a ese link deja pasar al mismo navegador sin volver a preguntar durante una semana. Si cambiás la contraseña, todos los desbloqueos anteriores dejan de valer en el acto.
- **La fuerza bruta está frenada.** Los intentos tienen rate limit por IP y por link (cinco por minuto sobre un mismo link), así que adivinar una contraseña decente no es práctico.
- **Los clicks cuentan después de desbloquear.** Alguien que abre el link y nunca escribe la contraseña no aparece como click en tus analytics.
- **Guardamos un hash, no la contraseña.** Así que no te podemos decir cuál era. Si te la olvidaste, poné una nueva en el formulario de edición, o marcá **Quitar la protección con contraseña**.
- **Nunca aparecen en tu [página bio](/blog/pagina-link-in-bio).** Una página pública llena de puertas con llave no tiene sentido.

**Cuándo usarlo:** slides o grabaciones para quienes fueron a un workshop; un kit de prensa antes de que se levante el embargo; un preview para un cliente que preferís que no se reenvíe alegremente.

**Cuándo no:** cualquier cosa realmente secreta. La contraseña protege el link corto, no el destino. Una vez que alguien pasa, ve la URL real y puede compartir esa. Si el destino es una página pública, siempre fue alcanzable. Para secretos de verdad, control de acceso de verdad.

## Links que vencen

**Qué pasa:** hasta la fecha y hora que pusiste, es un link normal. Después, los visitantes ven una página que dice "Este link expiró". El link aparece como **expirado** en tu lista, y desaparece solo de tu página bio.

El link no se borra. Sus analytics quedan, y lo podés revivir: editalo y corré la fecha, o vaciá el campo (vacío es nunca).

**Cuándo usarlo:**

- **Promos con fecha límite.** El link del Black Friday se corta a la medianoche, y nadie llega al checkout para descubrir que el código ya no anda.
- **Inscripción a eventos.** La inscripción cierra cuando cierra el link.
- **Compartidos temporales.** Un link de descarga para un proveedor que solo tiene que andar esta semana.

## Links con límite de clicks

**Qué pasa:** cada redirect suma uno al contador de clicks del link. Cuando llega al límite, el siguiente visitante ve "Límite de clicks alcanzado" en lugar del destino.

Dos aclaraciones honestas sobre qué es "un click":

- **Cuenta redirects, no personas.** Las analytics de Link no usan cookies, así que no sabemos si diez clicks son diez personas o una persona tocando diez veces. Un límite de 100 son 100 redirects.
- **Los requests automáticos también cuentan.** No hay filtro de bots. Algunas apps de chat y redes sociales piden el link para armar la tarjeta de preview, y si ese request sigue el redirect, es un click como cualquier otro.

Así que el límite de clicks es un buen **tope blando**, no un sistema de entradas. Usalo para "los primeros cien, más o menos, se llevan el template gratis", y ponelo un poco por encima del número que realmente te importa. Si necesitás reabrir, editá el link y subí el límite o vacialo (vacío es ilimitado).

Un detalle más: un link que llegó a su límite sigue en tu página bio (a diferencia de los vencidos), llevando a la página del límite. Destildalo ahí cuando se llene.

## Combinarlos

Los switches se apilan. El orden en que Link los chequea es:

1. ¿El link existe y no está archivado? Si no: "Este link ya no está".
2. ¿Venció? Si sí: "Este link expiró".
3. ¿Llegó al límite de clicks? Si sí: "Límite de clicks alcanzado".
4. ¿Tiene contraseña? Entonces, la página de contraseña.
5. Si no: registra el click y redirige.

O sea que un link vencido ni siquiera pide la contraseña, y un link con candado y límite solo cuenta a quienes pasaron. Un combo clásico: contraseña más vencimiento para un link "solo esta semana, solo para asistentes".

Todas esas páginas funcionan también en tu dominio propio, así que el visitante nunca ve un error genérico.

## Códigos QR: las mismas reglas, en papel

Cada link tiene su QR, descargable en **SVG** (vectorial, para imprimir) o **PNG** (512 px, para slides y documentos). El QR contiene la URL corta, no el destino, en tu [dominio propio](/blog/dominios-propios-dns-paso-a-paso) si el link usa uno. Eso tiene dos consecuencias fáciles de pasar por alto:

**Todo lo de arriba aplica al QR.** Imprimí un QR de un link que vence y, después de la fecha, quien escanee el afiche cae en "Este link expiró". Es una ventaja para un flyer que no debería sobrevivir a su evento; es una trampa para un packaging que va a estar años en una góndola.

**Podés cambiar a dónde va el QR sin reimprimir.** Editá el destino del link y cada copia impresa apunta al lugar nuevo. Eso es lo que otras herramientas venden como "QR dinámicos". Acá es simplemente cómo funcionan los links cortos.

Un consejo práctico si pensás cambiar destinos: dejá el tipo de redirect en **302 Temporal**, que es el default. Un **301 Permanente** le dice a los navegadores que pueden cachear el redirect, así que alguien que escaneó antes del cambio podría seguir cayendo en el destino viejo. Usá 301 solo cuando el destino de verdad no vaya a cambiar nunca.

Lo que el QR todavía no hace: colores, logos ni marcos. Son códigos negros sobre blanco con un margen chico. Para la mayoría de las impresiones, es lo que mejor escanea igual. Si necesitás uno brandeado, el SVG se estiliza fácil en cualquier herramienta de diseño, siempre que mantengas buen contraste.

## Guía rápida para decidir

- **Solo algunas personas deberían pasar:** contraseña. Acordate de que protege el link corto, no el destino.
- **Tiene que dejar de andar en un momento puntual:** fecha de vencimiento.
- **Tiene que cortarse después de unos N usos:** límite de clicks, con margen.
- **Va a ir en papel:** QR, redirect 302, y pensalo dos veces antes de ponerle vencimiento.

Y cuando un link se cierra, el visitante ve una página clara que le dice por qué, en lugar de un redirect roto. Una cortesía chica, una diferencia grande.
