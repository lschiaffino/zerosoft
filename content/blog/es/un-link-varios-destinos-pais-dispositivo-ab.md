---
title: "Un link, varios destinos: país, dispositivo y test A/B"
description: "Cómo mandar a cada visitante al destino correcto con un solo link corto: reglas por país y dispositivo, test A/B con pesos y deep links a tu app, con el orden exacto en que Link los resuelve."
date: "2026-10-24"
author: "zerosoft"
tags: ["link", "ruteo", "ab-testing"]
---

Pegás un link en la bio de Instagram y lo abre gente de Montevideo, de Madrid y de Ciudad de México, desde un iPhone, un Android y una notebook. Todos llegan a la misma página. La tienda de apps que corresponde, el precio en la moneda local o la versión en el idioma correcto quedan para después, si es que quedan.

La solución es un link corto que decide el destino en el momento del clic. Dub tiene dos artículos de ayuda sobre el tema, uno de [geo targeting](https://dub.co/help/article/geo-targeting) y otro de [device targeting](https://dub.co/help/article/device-targeting), y su documentación aclara que el segundo está disponible desde el plan Pro. Este post cubre el mismo problema desde otro lado: cómo diseñar las reglas para que no se pisen, cómo medir si funcionan y cómo se arma en Link.

## Qué decisiones puede tomar un link

En Link, el ruteo vive en el detalle de cada link, en la sección **Ruteo**. Tiene tres piezas:

- **Reglas por país y dispositivo.** Hasta 20 reglas. Cada una tiene una lista de países (códigos de dos letras como `AR`, `UY`, `CL`), una lista de dispositivos (iOS, Android, desktop) y una URL de destino. Una lista vacía significa "cualquiera".
- **Test A/B.** De 2 a 5 destinos con un peso de 0 a 100. Cada visitante ve siempre la misma variante.
- **Deep links.** Una URL de app para iOS y otra para Android, cada una con un fallback para cuando la app no está instalada.

Sin ninguna regla, el link va a su URL de siempre y el redirect no hace trabajo extra.

## El orden de resolución importa

Cuando alguien hace clic, Link resuelve el destino en este orden:

1. **Deep link del dispositivo**, si configuraste uno para su sistema (iOS o Android).
2. **La primera regla que coincide**, leyendo la lista de arriba abajo.
3. **El test A/B**, si ninguna regla coincidió.
4. **La URL del link**, si nada de lo anterior aplica.

De ahí salen tres consejos de diseño:

**Ordená de lo específico a lo general.** Si tenés una regla "Argentina, iOS" y otra "Argentina", la primera tiene que ir arriba. Gana la primera que coincide, y la segunda la taparía por completo si estuviera antes.

**El A/B solo ve el tráfico que las reglas dejaron pasar.** Si mandás a todo Brasil a una página en portugués con una regla, esos visitantes nunca entran al test. Si querés testear dentro de un país, el test tiene que correr sobre el link que ese país recibe, no sobre uno general.

**El deep link le gana a todo en su plataforma.** Si definiste una app para iOS, ningún visitante de iPhone llega a las reglas web. Usalo solo cuando querés que la app sea siempre la primera opción.

## Receta 1: una campaña, tres mercados

Una campaña de lanzamiento para Argentina, Uruguay y el resto de la región.

1. Creá el link con la página global como destino. Va a ser el último recurso.
2. En **Ruteo**, agregá la regla 1: países `AR`, destino `/ar/lanzamiento`.
3. Regla 2: países `UY`, destino `/uy/lanzamiento`.
4. Guardá con **Guardar ruteo**.

Todo el resto del mundo cae en la URL del link. Cada clic registra qué regla lo sirvió, y la analítica del link muestra la regla que atendió cada visita (Regla 1, Regla 2) junto al país. Así verificás con datos que el reparto es el que pensaste.

Ojo con un detalle: el país sale de la cabecera que manda la plataforma de hosting. Si un clic llega sin país, no coincide con ninguna regla que pida países y va al siguiente paso.

## Receta 2: app o web según el dispositivo

Querés que quien abre el link desde un celular entre a la app y que el resto vaya a la web.

1. En **Deep links**, cargá la URL de la app en iOS, por ejemplo `miapp://producto/42`, o un universal link `https`.
2. Cargá el fallback: la ficha de la tienda de apps o la página web equivalente.
3. Repetí para Android.

Con un esquema propio (`miapp://`), Link entrega una página mínima que intenta abrir la app y, si en un segundo y medio no pasó nada, redirige al fallback. Con un universal link `https`, el redirect es directo y el sistema operativo decide si abre la app.

Lo que todavía no hace: deep linking diferido. Si la persona no tiene la app, va a la tienda, pero después de instalarla no vuelve sola al producto que tocó. Eso necesita un SDK en la app y no lo tenemos.

Otra salvedad que el panel avisa: los iPad con Safari se identifican como Mac, así que reciben el destino de desktop.

## Receta 3: un test A/B de landing de verdad

Dos versiones de una página de precios, 50 y 50.

1. En **Test A/B**, agregá la variante A con la URL actual y peso 50.
2. Agregá la variante B con la URL nueva y peso 50.
3. Guardá.

Dos cosas que hacen que el test sirva:

- **El visitante no cambia de variante.** Link guarda una cookie de visitante (`zs_vid`) y calcula la variante con un hash estable. Quien vuelve mañana ve la misma página, y no contamina el resultado.
- **Los clics saben de qué variante vinieron.** Cada clic guarda la variante (A, B) y el CSV de exportación del link incluye una columna `variant`. Podés cruzarla con las conversiones de tu analítica.

Lo que Link no hace es decirte cuál variante ganó. Mide clics por variante, no conversiones. La conversión vive en el sitio de destino, así que para comparar necesitás los UTM de [una convención corta](/blog/utms-sin-planilla) y tu herramienta de analítica.

Y una regla de higiene: no corras el test hasta que cada variante tenga un volumen razonable de visitas. Con 30 clics por lado cualquier diferencia es ruido.

## Cómo no romperlo

- **Probalo desde afuera.** Abrí el link en el celular con datos móviles y con una VPN en otro país. Es la forma más rápida de ver cada rama.
- **Un destino no puede apuntar al propio link.** Link revisa todos los destinos de las reglas, del A/B y de los deep links para evitar bucles.
- **Cada regla necesita países o dispositivos.** Una regla vacía se rechaza al guardar; para "todos", usá la URL del link.
- **Un A/B necesita al menos dos variantes**, y al menos una con peso mayor a cero.

## Self-host y costo

El ruteo es parte del core AGPL. No hay un plan que lo habilite: si corrés Link en tu servidor, lo tenés. En zerosoft Cloud no se cobra por regla ni por asiento, solo por clics, reservas, emails y almacenamiento.

Y como la configuración vive en una columna JSON de la misma fila que lee el redirect, un JSON roto nunca rompe el redirect: el link simplemente vuelve a su URL.

## Para llevarte

- Orden: deep link, primera regla que coincide, A/B, URL del link.
- Reglas de lo específico a lo general.
- Probá cada rama desde un dispositivo y un país real.
- Medí clics en Link y conversiones en tu analítica, unidas por UTM.

Si venís de otro acortador, el [importador de Link](/blog/migrar-de-bitly-a-link) trae tus links con sus destinos, y el ruteo lo configurás después en los que lo necesiten.
