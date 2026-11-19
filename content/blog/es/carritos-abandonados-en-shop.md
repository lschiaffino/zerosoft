---
title: "Carritos abandonados: cómo recuperarlos desde Shop sin otra herramienta de email"
description: "Qué guarda Shop cuando alguien deja el checkout, cómo ver y recuperar esos carritos, cuándo conviene activar el recordatorio y qué límites tiene hoy."
date: "2026-11-19"
author: "zerosoft"
tags: ["shop", "ecommerce", "carritos abandonados"]
---

Alguien llega a tu tienda, elige dos productos, escribe su email en el checkout y se va. Pasa en casi todas las tiendas chicas, y cada una de esas personas ya hizo la parte difícil: encontrarte y decidir qué quería. Recuperar aunque sea una parte de esos pedidos rinde más que atraer visitas nuevas.

Shopify tiene una [guía sobre emails de carrito abandonado](https://www.shopify.com/ca/blog/abandoned-cart-emails) que cubre cómo escribirlos y cuándo mandarlos. Es una buena base si ya usás Shopify. Acá va la versión de Shop, la tienda online de zerosoft: qué guarda, cómo se recupera un carrito a mano, cómo se activa el recordatorio automático y qué no hace todavía. Todo sale del código, que es abierto.

## Qué guarda Shop cuando alguien se va

En cuanto una persona escribe su email en el checkout, Shop guarda una fila con el carrito: productos, cantidades, subtotal y moneda. No guarda dirección ni datos de pago, porque a esa altura todavía no se completaron.

Hay una fila por tienda y por email. Si la misma persona vuelve y cambia el carrito, la fila se pisa con la versión más nueva en lugar de sumar duplicados. Si el carrito termina en un pedido, la fila pasa a "recuperado" y deja de aparecer como abandonada.

Un checkout cuenta como abandonado recién cuando pasó una hora sin cambios. Antes de eso la persona puede estar buscando la tarjeta. Las filas se borran a los 30 días.

## Paso 1: mirar la lista

Abrí **Carritos abandonados** en Shop. Cada fila muestra al cliente, la cantidad de ítems, el subtotal, la última actividad y el estado: sin recuperar, recordatorio enviado, pidió no recibir o recuperado (con un acceso al pedido).

Mientras el recordatorio automático esté apagado, la lista igual funciona. Cada carrito tiene un botón para copiar el link de recuperación y mandarlo vos por el medio que ya uses con tus clientes: un mensaje de WhatsApp, un mail desde tu casilla, una respuesta en Chat. También hay un botón para mandar el recordatorio a mano, con el mismo texto y los mismos topes que el automático, y una sola vez por checkout.

Ese link abre la tienda con el carrito armado como lo dejó la persona. El link lleva un token largo y aleatorio, y solo sirve mientras el carrito siga abierto. Si el pedido se completó, deja de funcionar.

## Paso 2: decidir si activás el recordatorio

En la configuración de la tienda hay dos opciones:

- **Mandar un recordatorio a quien deja el checkout.** Viene apagado.
- **Horas de espera.** Entre 1 y 72, por defecto 4.

El recordatorio sale desde el cron, no desde tu casilla, y solo si la tienda está publicada. Estas son las reglas que el código aplica, todas fijas:

1. **Un solo email por checkout.** Aunque la persona cambie el carrito cinco veces, recibe uno.
2. **Link para darse de baja** en el cuerpo y también el encabezado `List-Unsubscribe` con baja en un clic. Quien se da de baja queda excluido de los recordatorios de esa tienda.
3. **Tope por destinatario:** dos recordatorios por semana en una misma tienda y tres por día sumando todas las tiendas de zerosoft.
4. **Tope por tienda nueva:** durante los primeros 7 días hay un límite diario más bajo (10 recordatorios por día).
5. **Sin reintentos en bucle.** Si el envío falla o lo frena un tope, no se vuelve a intentar: un recordatorio que llega tarde ya no ayuda.

Los topes existen porque cualquiera puede escribir cualquier dirección en un checkout, y el email sale con el remitente de la app. Sin límites, una tienda recién creada serviría para mandar correo a terceros.

## Cuántas horas esperar

No tenemos datos propios para decirte un número ideal, y no vamos a inventar uno. Lo que sí podés razonar con tu caso:

- **Productos de compra rápida** (accesorios, comida, regalos): una a cuatro horas. La intención todavía está fresca.
- **Compras que se piensan** (muebles, equipos, cursos): entre 12 y 24 horas. La persona quizá esté comparando o consultando con alguien.
- **Si vendés por WhatsApp o atendés vos**: dejá el automático apagado y escribí a mano a los carritos de más valor.

Empezá con las 4 horas por defecto y mirá la lista de carritos recuperados después de una o dos semanas. Si casi nadie vuelve, probá con 24.

## Un flujo que se puede armar hoy

Una rutina de cinco minutos por día para una tienda chica:

1. Abrí la lista de carritos abandonados.
2. Los tres o cuatro de mayor valor (el subtotal está en la fila del carrito), escribilos vos con el link de recuperación. Un mensaje corto alcanza: "Vimos que dejaste el pedido a medias. Te guardamos el carrito acá: [link]. Si tuviste algún problema con el pago o el envío, contanos."
3. Dejá el recordatorio automático para el resto.
4. Cada semana, anotá cuántos carritos pasaron a recuperados y a cuáles les habías escrito vos.

Cada pedido pagado crea o actualiza el contacto en el CRM y deja el pedido en su ficha, así que ahí ves qué compró quien volvió.

## Qué todavía no hace

Para que no armes tu estrategia sobre algo que no existe:

- **El texto del email es fijo.** No hay plantilla editable ni se puede agregar un descuento o un código al recordatorio.
- **Es un solo recordatorio.** No hay secuencias de dos o tres emails.
- **No hay SMS ni WhatsApp automáticos** para carritos. El link se copia y se manda a mano.
- **No hay segmentación** por valor del carrito o por cliente nuevo versus recurrente.

Si necesitás un descuento en el segundo mensaje, hoy lo resolvés a mano: creás un código de descuento en Shop y lo mandás junto al link de recuperación desde tu propia casilla.

La tabla de paridad con Shopify en la página de Shop marca estos puntos como parciales, con fecha de revisión.

## Por qué lo hacemos así

Una herramienta de email aparte para carritos abandonados suele significar otra cuenta, otra factura y los datos de tus clientes en un tercero. En Shop el carrito, el cliente y el pedido viven en la misma base. Si hacés self-host, esa base está en tu servidor y el costo del software es $0.

Y los topes por destinatario, que a veces parecen una restricción, nos parecen la parte correcta: un recordatorio útil es uno, no cinco.
