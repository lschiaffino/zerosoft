# Voice: pedidos del 8 y 9 de noviembre de 2026, punto por punto

Repaso del 18/11/2026. Los pedidos están parafraseados. Fuentes: los pedidos
sobre Voice de esos días (la pantalla de reunión de Granola con capturas, y
después "todavía falta", "no comparte el audio de la compu" y "no anda el
transcript"), los pedidos de dictado tipo Wispr Flow que siguieron, los PRs y
el historial de git.

Estados: **hecho** (en `main`), **parcial** (hecho en código, falta algo que
necesita al dueño o una prueba real), **falta**.

## La reunión como en Granola

| # | Pedido | Estado | Dónde |
|---|---|---|---|
| 1 | Página de documento limpia: título grande, fila de chips (notas mejoradas o mías, "Hoy · Yo", agregar a carpeta), arriba a la derecha más acciones, compartir y copiar link | hecho | #148 |
| 2 | Notas mejoradas como documento editable con títulos y viñetas anidadas, distinguiendo lo que escribió la persona de lo que agregó la IA | hecho | #148 (b418e4d84); #455 (en curso, otro agente) para que el refresco no pise ediciones |
| 3 | Barra flotante abajo: botón de audio y transcripción en vivo, "Ask anything" y "Write follow up email" | hecho | #148 |
| 4 | Panel de chat sobre las notas: historial, recipes (follow up, todos, notas más largas, TL;DR, biblioteca con recipes propios y del workspace, crear y editar), modelo, adjuntar, dictar la pregunta, pantalla grande, chat nuevo, "Say more"; durante la reunión y después | hecho | #115, #148 |
| 5 | Calendario: "Hoy · Yo" abre el evento de hoy (elige solo el que está pasando) y "Agregar asistentes" con sugerencias, agrupados por empresa | hecho | #148 |
| 6 | Aviso "la IA puede equivocarse" | hecho | #148 |
| 7 | Atajos: ⌘J o / enfocan la pregunta, Esc cierra | hecho | #148, 4da40cd4b |
| 8 | Email de seguimiento por el Gmail u Outlook conectado, o copiarlo | hecho | #148 |
| 9 | Tokens de zerosoft, radios chicos, sin pills | hecho | #148, #205 |

## Lo que se reportó después ("todavía no está todo")

| # | Pedido | Estado | Dónde |
|---|---|---|---|
| 10 | **No anda el transcript** | parcial | #148 le dio a la transcripción su propio cupo (antes compartía el de chat y notas y devolvía 429). La causa que quedaba sale de los logs de producción: el AI Gateway limita `openai/whisper-1` a 5 pedidos por minuto por equipo, y una reunión con micrófono y audio de la compu manda unos 6 trozos por minuto. Los trozos que pasaban el límite se perdían. #457 suma modelos de respaldo, saltea un minuto el modelo lleno y, si están todos llenos, el grabador espera y reintenta. Falta: que el dueño grabe una reunión real en producción |
| 11 | Al grabar no se comparte el audio de la computadora | parcial | Navegador: se pide pestaña o pantalla con audio y se mezcla con el micrófono (#148). Mac: captura nativa con ScreenCaptureKit (#148), aviso si el audio no llega (#205), Rec mezcla el audio de la compu (#426). Falta: probarlo en la Mac del dueño con una llamada real y el permiso de Grabación de pantalla |

## Dictado tipo Wispr Flow (pedidos de esos mismos días y los siguientes)

| # | Pedido | Estado | Dónde |
|---|---|---|---|
| 12 | Que el dictado arme listas, mails y puntuación dicha, sin inventar contenido | hecho | #205, #301 |
| 13 | Limpieza de muletillas configurable | hecho | #205 (poco, normal, mucho) |
| 14 | Que sea muy muy rápido; el escritorio tardaba mucho en "cleaning up" | parcial | #303 (setup en paralelo, gpt-4o-mini-transcribe con respaldo), #300 y 529d47614 (precalentamiento). Groq, el más rápido, necesita `GROQ_API_KEY` |
| 15 | La animación de "te escucho" tiene que reaccionar a la voz | hecho | #250, publicado en el escritorio 0.3.8 (hoy 0.3.12) |
| 16 | App descargable para Voice | hecho | #97, #116 (Tauri), releases `desktop-v0.3.x` |

## Lo que necesita al dueño

- Grabar una reunión real en zerosoft.ai después de #457 y mirar que la
  transcripción en vivo se llene (con micrófono y con la pestaña compartida).
- En la Mac: actualizar el escritorio, dar permiso de Grabación de pantalla y
  audio del sistema, y probar una llamada real para ver que entra la otra voz.
- Opcional, para más velocidad y más margen de transcripción: `GROQ_API_KEY`
  en Vercel (producción), o una clave propia de OpenAI cargada en el AI Gateway
  (BYOK), que saca el tope de 5 pedidos por minuto de whisper-1.

## Lo que no se pudo hacer en este repaso

- La pasada en navegador (Playwright en 1280 y 390, claro y oscuro, los cinco
  aspectos) no corrió: la sesión automática no tuvo permiso para levantar el
  servidor ni Playwright. #457 cambia solo el servidor y tiene tests unitarios;
  los e2e de Voice los corre el CI.
