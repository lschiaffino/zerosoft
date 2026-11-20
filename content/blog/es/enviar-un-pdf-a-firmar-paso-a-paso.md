---
title: "Cómo enviar un PDF a firmar y qué queda registrado"
description: "Paso a paso para mandar un contrato a firmar con Sign, sin que el firmante cree una cuenta, y cómo leer el certificado de finalización para comprobar que nadie tocó el documento."
date: "2026-11-20"
author: "zerosoft"
tags: ["sign", "docusign", "firma electrónica", "guía"]
---

Mandar un PDF a firmar parece simple hasta que alguien pregunta cómo se sabe que lo firmó quien dice que lo firmó, y que el archivo no cambió después. Las guías de DocuSign, como [la que explica cómo firmar y enviar un PDF](https://www.docusign.com/blog/how-to-electronically-sign-and-send-pdf), recorren el camino básico: subir, ubicar la firma, enviar. Acá hacemos el mismo recorrido con [Sign](/products/sign), la app de firma de zerosoft, y nos detenemos en lo que casi nadie mira: la evidencia que queda al final.

## Qué necesitás antes de empezar

- Un PDF. Sign solo acepta PDF, hasta 4 MB y 100 páginas. Si tu contrato está en Word, exportalo antes. Si lo escribiste en una página de Docs, Sign la convierte al PDF por vos.
- Los emails de quienes firman. No necesitan cuenta en zerosoft.
- Decidir el orden: quién firma primero, y si alguien solo aprueba o solo recibe copia.

Sign saca del archivo todo lo que ejecuta o abre algo: scripts, acciones al abrir, formularios y adjuntos. Es un PDF limpio, y el certificado guarda el hash del original por si querés comparar.

## Paso 1: subí el documento y poné los destinatarios

Creá un sobre nuevo, subí el PDF y agregá a cada persona con su rol: firmante, aprobador o copia. El rol de aprobador sirve para un visto bueno sin firma, por ejemplo el de finanzas antes de que firme el cliente.

Cada destinatario tiene un número de orden. Quienes comparten número firman en paralelo, y el número siguiente recibe su invitación recién cuando todos los anteriores terminaron. Para un contrato con tu socio y un cliente, poné 1 al socio y 2 al cliente: el cliente no ve nada hasta que tu parte esté firmada.

## Paso 2: ubicá los campos

Arrastrá los campos sobre las páginas y asignale cada uno a su destinatario. Hay firma, iniciales, fecha, nombre, email, texto, casilla y lista desplegable, obligatorios u opcionales. Cada persona completa solo los suyos y no puede editar los de otra.

Una regla práctica: marcá como obligatorios los campos sin los que el documento no vale (firma y fecha) y dejá opcional el resto. Los campos guiados llevan al firmante de uno en uno, y eso reduce los documentos devueltos a medias.

Algo que todavía no hacemos: ubicar campos automáticamente por un texto ancla. Si mandás el mismo contrato todos los meses, usá una plantilla: guarda roles y campos, y solo cambian los emails.

## Paso 3: elegí vencimiento y recordatorios

Fijá en cuántos días vence el sobre (entre 1 y 365, por defecto 30) y cada cuántos días se manda un recordatorio a quien no firmó (de 0 a 30, donde 0 es sin recordatorios). Un buen punto de partida para un contrato comercial: vence a los 14 días, recordatorio cada 3. Si vence sin completarse, se avisa y el link deja de servir.

Podés agregar un mensaje que viaja en el email. Escribí qué es el documento y qué esperás: "Contrato de servicio de diciembre, firmás en la última página" ayuda más que un texto genérico.

## Paso 4: enviá y mirá el estado

Al enviar, cada destinatario recibe un link personal. Ese link:

- es de un solo uso por persona,
- vence con el sobre,
- se puede revocar si lo mandaste a la dirección equivocada,
- y en la base solo se guarda su hash, no el link.

Por defecto, además, el firmante confirma un código que le llega por email antes de abrir el documento. Los códigos también se guardan como hash, y hay límites de intentos por destinatario y por IP. Esta verificación es por email: todavía no hay SMS ni verificación de identidad con documento.

Antes de firmar, la persona acepta firmar de forma electrónica. Después escribe, dibuja o sube su firma. Puede rechazar con un motivo, y ese motivo te llega. Si te equivocaste en algo con el sobre ya enviado, no se edita: lo anulás con un motivo (los destinatarios lo reciben por email) y lo copiás a un borrador nuevo.

## Paso 5: leé el certificado de finalización

Cuando firman todos, Sign dibuja los campos en el PDF y le suma al final un certificado de finalización. Ahí figura:

- cada destinatario, con IP y navegador,
- cada evento del sobre (creado, enviado, abierto, firmado) con hora, IP y navegador,
- el SHA-256 del documento original y del firmado.

Todos reciben la copia firmada. Para comprobarla, calculá el SHA-256 del archivo que tenés y compará con el hash que figura en el email de finalización y en la página del sobre:

```bash
sha256sum contrato-firmado.pdf
```

Si un solo byte cambió, el resultado es otro. Una aclaración honesta: el certificado lista un hash intermedio (las páginas firmadas antes de sumar el certificado), que no se puede recalcular desde el PDF final. Por eso el que comparás es el del archivo final.

## Qué valor legal tiene

Sign hace firma electrónica simple con registro de auditoría, del tipo que reconocen la ESIGN Act y la UETA de EE. UU. Todavía no emite firmas avanzadas o calificadas de eIDAS ni la firma digital de la Ley 25.506 de Argentina, que pide un certificador licenciado. Para un contrato de servicios entre dos empresas suele alcanzar. Para un acto que la ley exige con firma digital o calificada, no. Consultalo con alguien que conozca tu jurisdicción antes de decidir.

## Qué hacer después de la firma

Con el sobre completo podés disparar una automatización en [Flow](/products/flow): archivar el PDF, avisar por Chat o actualizar el trato en el [CRM](/products/crm). Los disparadores existen para sobre completado y rechazado.

Y si lo corrés vos, los documentos viven en tu infraestructura: Blob privado o archivos cifrados con AES-256-GCM, accesibles solo para quien envía, los admins y cada destinatario con su link. Es AGPL: podés leer en el código cómo se arma el certificado.
