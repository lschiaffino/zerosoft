---
title: "Link vs. Bitly: qué hace cada uno hoy (y cuándo quedarte en Bitly)"
description: "Dónde Bitly está claramente adelante, dónde está Link y quién debería cambiarse o quedarse. Funciones, ecosistema, propiedad de los datos y los tradeoffs de cada uno."
date: "2026-10-02"
author: "zerosoft"
tags: ["link", "bitly", "comparación"]
---

Ya escribimos sobre [lo que cobra Bitly contra lo que cuesta un redirect](/blog/bitly-cobra-35-los-bits-son-gratis). Este post compara producto: qué hace mejor cada una, y quién debería elegir cuál. Incluidos los casos en los que la respuesta correcta es "quedate en Bitly".

Una aclaración de justicia: el código de Link lo conocemos línea por línea. A Bitly lo conocemos desde afuera, por su producto y su documentación pública. Los detalles de producto cambian, así que chequeá sus páginas actuales antes de decidir.

## Dónde Bitly está adelante

Arranquemos por la parte incómoda.

**Madurez y escala.** Bitly acorta links desde 2008 y sirve un volumen enorme. Casos borde, manejo de abuso, uptime bajo picos de tráfico reales: ya vieron de todo. Link es joven. Está construido sobre una arquitectura simple y robusta ([acá está entera](/blog/como-construimos-link-arquitectura)), pero joven es joven.

**Reconocimiento de marca.** La gente conoce `bit.ly`. En algunos contextos un dominio familiar recibe más clicks que uno desconocido. (Tu propio dominio les gana a los dos, pero eso vale con cualquiera de las dos herramientas.)

**Integraciones.** Bitly se enchufa a una lista larga de herramientas: plataformas de automatización, suites de marketing, herramientas de diseño, programadores de redes. Link tiene una API REST, los webhooks `link.created` y `link.clicked`, y Flow para conectarlo con el resto de la suite o con cualquier API. Si tu flujo es "toco un botón dentro de otra app y obtengo un link de Bitly", Link todavía no hace eso. Lo tendrías que conectar vos.

**Apps móviles y extensión de navegador.** Bitly las tiene. Link es una web app; anda bien en el navegador del celular, pero no hay app nativa ni extensión.

**Diseño de QR.** Bitly te deja personalizar los QR con colores, logos y marcos, y trata los escaneos de QR como algo de primera clase. Link te da un QR plano y de alto contraste por link, en SVG y PNG. Escanea perfecto y no cuesta nada; no es lindo.

**Deep links a apps.** Bitly ofrece formas de mandar a la gente directo a una app nativa en vez de a una página web. Link redirige a URLs, punto.

**Link-in-bio y campañas más completos.** Las páginas de Bitly tienen más opciones de diseño que nuestra [página bio](/blog/pagina-link-in-bio), que es deliberadamente austera: título, bio, avatar, botones. Bitly además agrupa links en campañas con reportes consolidados; Link tiene tags y analytics por link, sin dashboard por tag todavía.

**Enterprise.** SSO, permisos granulares, account managers, contratos, papeles de compliance. En Link, SSO/SAML, audit logs y roles custom están en nuestra carpeta `/ee` y todavía en desarrollo. Si tu checklist de compras tiene esos ítems, hoy Bitly los tilda y nosotros no.

## Dónde Link está adelante

**Puede ser tuyo.** Link es open source (AGPLv3). Podés leer cada línea, correrlo en tu servidor por $0 y guardar cada clic en tu propia base de datos. O usar zerosoft Cloud: plan gratis y después pago por uso.

**Analytics sin cookies por diseño.** Los clicks se miden solo a partir del request HTTP: día, referrer, país, dispositivo, browser, OS. No usa cookies ni fingerprinting y no guarda IPs ([detalles](/blog/analytics-sin-cookies)). Menos datos de los que juntan otras herramientas, a propósito.

**Controles que suelen ser upsell.** Links con contraseña, fecha de vencimiento y límite de clicks, cada uno con una página clara para el visitante cuando el link se cierra ([casos de uso acá](/blog/links-con-password-vencimiento-y-limite)). Tipo de redirect por link (301 o 302). Campos de preview social (Open Graph) por link.

**Dominios propios sin palabras reservadas.** En tu dominio, cualquier path es un link, `go.tuempresa.com/blog` incluido. Configurás un redirect para la raíz. En self-host, la verificación es un solo CNAME ([paso a paso](/blog/dominios-propios-dns-paso-a-paso)).

**Pensado para developers.** Una API REST pública con keys personales `zs_…` y un límite documentado de 100 requests por minuto, webhooks firmados con reintentos, y docs en `/docs`. No hace falta una llamada con ventas para tener acceso a la API.

**Tus datos se van con vos.** Exportás todos los links en CSV, o JSON con cada uno de los clicks. Los logs de clicks por link se exportan en CSV para cualquier rango. Creemos que [esto debería ser un derecho](/blog/exportar-tus-datos-deberia-ser-un-derecho), así que no está detrás de un plan.

**Es parte de una suite.** El mismo workspace tiene un CRM, una agenda, un tracker de issues, un inbox de soporte y docs. Si estás consolidando herramientas, Link viene incluido. Si solo querés un acortador, también está bien.

**Entrar es fácil.** El [import de Bitly](/blog/migrar-de-bitly-a-link) acepta un token de API o un CSV y conserva tus back-halves, en tu dominio propio si lo verificás primero.

## Quién debería quedarse en Bitly

En serio, si alguno de estos sos vos, no te cambies por cambiarte:

- **Tu flujo vive en integraciones.** Si los links se crean desde adentro de tu CRM, tu herramienta de diseño o tu programador de redes con un click, perder eso te cuesta más que cualquier suscripción.
- **Necesitás QR con tu marca a escala.** Packaging, retail, eventos donde el QR es parte del diseño.
- **Mandás gente a apps nativas.** El deep linking no es algo que Link haga.
- **Compras te pide SSO, audit logs y un contrato.** Los nuestros todavía no están listos.
- **Tu equipo vive en el celular.** Acá no hay app nativa.
- **Estás contento y te resulta barato.** Cambiar tiene un costo, aunque sea chico. Si Bitly no te duele, no hay premio por migrar.

## Quién va a estar mejor con Link

- **Equipos chicos y founders solos** que necesitan dominio propio, UTMs, QR y analytics decentes sin una factura por asiento.
- **Developers** que quieren API y webhooks primero, o meter el acortado de links en su propio producto, y valoran poder leer el código.
- **Organizaciones que cuidan la privacidad** y prefieren no tener que explicarle cookies de tracking a nadie.
- **Quien quiera self-hostear:** acortadores internos, entornos regulados, o gente a la que simplemente le gusta ser dueña de su stack.
- **Equipos que ya usan zerosoft**, o que están consolidando varios SaaS en un solo workspace.
- **Quien necesite contraseñas, vencimientos o límites de clicks** en links del día a día.

## Una forma sensata de decidir

No hace falta migrar todo para averiguarlo. Creá una cuenta gratis o levantalo en tu propio servidor con Docker Compose, agregá un subdominio que no estés usando (`l.tuempresa.com`) y pasá tu próxima campaña por ahí. Usá el UTM builder, compartí el QR, mirá las analytics un par de semanas. Si cubre lo que necesitás, importá el resto. Si no, perdiste una tarde y sabés exactamente qué faltaba. Contanos qué fue; el roadmap es público y el repo acepta pull requests.

Bitly es un producto maduro con un ecosistema real. Link es uno más chico, abierto y honesto. Elegí el que sirve para el trabajo, no el del logo más grande.
