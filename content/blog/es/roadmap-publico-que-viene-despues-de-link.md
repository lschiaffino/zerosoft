---
title: "Roadmap público: qué venía después de Link y cómo elegimos el orden"
description: "En junio de 2026 publicamos el orden: Track, CRM y Cal. Ya salieron los tres, y la suite llegó a once apps. Los criterios que usamos para ordenar y por qué el roadmap es público."
date: "2026-06-06"
author: "zerosoft"
tags: ["roadmap", "open source", "link", "producto"]
---

En muchos SaaS el roadmap es un documento interno que se conoce cuando la función ya está en la factura. El código de zerosoft es abierto, así que cualquiera ve en qué trabajamos mirando el repositorio. Esconder el roadmap no tenía sentido, así que lo publicamos con trimestres y criterios.

**Actualización:** este post salió en junio de 2026, cuando solo existía Link. Track, CRM y Cal ya salieron, y después llegaron Chat, Docs, Agents, Flow, Robots, Notes y Board. Hoy son once apps.

## El orden que publicamos

- **Track**, el gestor de proyectos: issues, ciclos, vistas de lista, board, calendario y Gantt.
- **CRM**: contactos, empresas, pipeline, actividad y API pública.
- **Cal**: páginas de reserva conectadas a Google Calendar.

Las tres heredaron las reglas de Link: código abierto, self-host con SQLite en un VPS chico y exportación de datos.

## Cómo elegimos el orden

Tres criterios, en este orden:

1. **Dónde la factura es más alta respecto del costo.** Un CRM cobra unos $50 por usuario por guardar contactos en una tabla; un acortador cobra $35 por redirects de 300 bytes.
2. **Qué se construye sobre qué.** Track necesitaba proyectos y permisos que después reusaron CRM y Cal.
3. **Lo que pide la comunidad.** Los issues y las discusiones del repositorio son públicos y cuentan.

## Por qué publicarlo

- **Nos pone fecha.** Un compromiso público ordena más que una reunión interna.
- **Te deja planificar.** Si estás por renovar un contrato por dos años, te sirve saber qué viene.
- **Permite corregir antes.** Un roadmap público recibe objeciones antes del error, no después.

La competencia ya ve lo que hacemos en GitHub. Con un roadmap secreto, el único que se queda afuera es el usuario.

## Lo que no prometemos

Los trimestres son trimestres, no días. Si algo se atrasa, lo actualizamos en el mismo roadmap con el motivo. Tampoco prometemos listas de funciones cerradas: el detalle lo decide el uso real.

## Cómo seguirlo

El roadmap vive en [/roadmap](/roadmap) y en los issues del repositorio. Podés votar, proponer funciones o mandar un PR, que es la forma más rápida de mover una prioridad.
