---
title: "Por qué solo tenemos 'Continuar con Google'"
description: "No es pereza: las contraseñas son el eslabón más débil de la seguridad, y delegar el login es delegarlo en quien lo hace mejor. Los trade-offs, sin vueltas."
date: "2026-06-13"
author: "Zerosoftware"
tags: ["seguridad", "oauth", "login"]
---

Cuando entrás a Link hay un solo botón: **Continuar con Google**. No hay formulario de registro, no hay email + contraseña, no hay "olvidé mi contraseña". No es una decisión de diseño perezosa. Es una decisión de seguridad, y vale la pena explicarla.

## La contraseña es el eslabón débil

Los datos hace años que cuentan la misma historia:

- Más de la mitad de la gente reutiliza la misma contraseña en varios servicios (encuesta Google/Harris, 2019: 52%). Uno de cada ocho la reutiliza en todos.
- HaveIBeenPwned acumula más de 12.000 millones de cuentas filtradas en breaches.
- El Verizon DBIR lo repite edición tras edición: la mayoría de los compromisos empieza con credenciales robadas, débiles o phisheadas.

El problema es estructural. Cada servicio que te pide crear una contraseña te pide dos cosas: que vos elijas una buena y que ellos la guarden bien. Una de las dos falla siempre. Y cuando falla, el atacante no prueba esa contraseña solo acá: la prueba en tu email, tu banco y tu laburo.

Mientras tanto, del otro lado del botón hay miles de ingenieros de seguridad, detección de logins anómalos, 2FA, passkeys y modelos antiphishing que, según los propios números publicados de Google, bloquean el 99,9% de los ataques automatizados. Ninguna startup puede igualar eso. Nosotros tampoco. Entonces no competimos: delegamos.

## Qué significa para vos

- **Nada que recordar.** Ni contraseña, ni una segunda contraseña "para esta app", ni rotación cada 90 días.
- **Nada que hackear.** Si mañana alguien roba nuestra base de datos, no hay hashes que crackear. La columna de contraseñas no existe. No puede filtrarse lo que no guardamos.
- **Tu sesión hereda la seguridad de tu cuenta de Google**, que probablemente ya es la cuenta mejor protegida que tenés: 2FA, alertas de dispositivo nuevo, passkey.

## Los trade-offs, honestamente

Sería deshonesto vender esto como pura ventaja. No lo es:

- **Necesitás una cuenta de Google.** Si no tenés o no querés tener una, hoy no podés usar el cloud de Zerosoftware. El self-host, en cambio, no te pide login.
- **Dependemos de la disponibilidad de Google.** Si su auth cae, el login cae. Tus links y la API con API keys siguen funcionando — el redirect no depende del login — pero el panel sí.
- **Google se entera de que iniciás sesión acá.** Pedimos solo email y nombre; no ve tu actividad ni tus datos. Pero ese metadato existe, y si te incomoda, la respuesta es el self-host.

## ¿Vamos a agregar más providers?

Sí, cuando sumen sin romper la propiedad clave: que no exista ningún secreto compartido en nuestros servidores. GitHub y Microsoft cumplen. Las passkeys cumplen todavía mejor — son el futuro obvio del login — y probablemente sean lo próximo.

¿Email + contraseña? No. Ese formulario no vuelve. La forma más segura de guardar contraseñas es no guardarlas.
