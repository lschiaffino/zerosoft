---
title: "El costo real de la nube, en números públicos"
description: "Un VPS cuesta $5. Un GB de storage cuesta centavos. El ancho de banda se regala por terabyte. Todo es público — y es justo lo que el SaaS no quiere que sumes."
date: "2026-06-10"
author: "Zerosoftware"
tags: ["costos", "nube", "transparencia"]
---

Los precios de la nube son públicos. Cualquiera puede abrir la página de precios de cualquier proveedor y ver cuánto cuesta un servidor, un GB de almacenamiento, un terabyte de tráfico. Sin embargo, casi nadie lo hace. La industria del SaaS construyó sus márgenes sobre esa pereza. Hagamos la cuenta.

## La lista de precios que todos pueden leer

| Recurso | Precio público típico |
| --- | --- |
| VPS (1 vCPU, 1GB RAM, 25GB disco, 1TB de transferencia incluida) | $5/mes |
| Object storage | ~$0,02 por GB/mes |
| Ancho de banda adicional | centavos por GB (y 1TB ya incluido) |
| Dominio propio | ~$10/año |
| SQLite como base de datos | $0 |

Con esa tabla corrés, literalmente, la mayoría de las herramientas que usa tu empresa: links, CRM, analítica, calendario. El costo de infraestructura de un producto como Link para un usuario intenso — 100.000 clicks por mes — queda por debajo de $1/mes. Hicimos esa cuenta en detalle en otro post y la conclusión es siempre la misma: la infra dejó de ser el costo hace años.

## ¿Qué cobra el SaaS, entonces?

Los márgenes también son públicos: los reportes financieros de las empresas de SaaS muestran márgenes brutos que rondan el 70-80%. Es decir, de cada $100 que pagás de suscripción, entre $70 y $80 no son infraestructura ni servicio: son margen. Marketing, ventas, oficinas, crecimiento.

Mirado por producto:

- El acortador de links cobra $35/mes por algo que cuesta menos de $1 servir.
- El CRM cobra ~$50 por usuario por guardar contactos en una tabla.
- El gestor de proyectos cobra ~$30 por usuario por mover tarjetas entre columnas.

Markups de 10x a 50x sobre el costo real de servir el producto. No es ilegal ni secreto. Es simplemente incómodo de mirar de cerca, y por eso casi nadie lo mira.

## Por qué publicamos nuestra fórmula

Zerosoftware funciona al revés. El software es open source y gratis: descargalo y corrélo donde quieras. Y si elegís el cloud, pagás la nube al costo. La fórmula es pública y aburrida:

> Precio = infraestructura real asignada + impuestos y fees de pago. Margen: $0.

La publicamos primero para protegernos de nosotros mismos. Si algún día alguien en esta empresa quiere inflar un precio, va a tener que explicar públicamente por qué se desvía de la fórmula. La transparencia no es un valor de marca: es un mecanismo de control.

Y te protege a vos. Podés auditar el precio contra la tabla pública de la nube, igual que auditás el código. Y si algún número no cierra, el self-host te espera con el mismo software, el mismo código y tu base de datos en un solo archivo.

Los precios de la nube siempre fueron públicos. Lo único que faltaba era alguien dispuesto a sumarlos en voz alta.
