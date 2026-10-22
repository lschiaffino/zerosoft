# Benchmark: Board vs Excalidraw+ y Miro

Fecha: 2026-10-22. Incumbente principal: Excalidraw+ (Board usa el editor open source de
Excalidraw 0.18, así que el lienzo es el mismo). Referencia: Miro (talleres, plantillas, IA).
Método: capacidades públicas (precios, changelog y roadmap de Excalidraw+, help center de Miro,
ver Fuentes), código de Board en `lib/board*.ts`, `components/board/` y `app/api/boards`, y una
pasada en el navegador sobre un build de producción local (`next start` con
DEMO_MODE sobre `main`, Playwright con dos navegadores sobre la misma pizarra). Los tiempos no se
miden: la máquina de prueba estaba saturada.

**Paridad global contra Excalidraw+: 54 %** (promedio ponderado, ver tabla de puntajes).

Leyenda: **tiene** · **parcial** · **falta** · **mejor** (lo hacemos mejor que el incumbente).

## Resumen

Board corre el mismo editor open source que Excalidraw+, así que el dibujo en sí está a la par:
formas, flechas que se pegan a las formas, frames, imágenes (guardadas en Blob), embeds, puntero
láser, biblioteca de formas (compartida por workspace e instalable desde el catálogo de
Excalidraw) y Mermaid a Excalidraw. Encima de eso sumamos cosas que Excalidraw+ no tiene:
herramienta de stickies con colores, etiquetas y pegado en lote, comentarios anclados con
@menciones y resolver, votación por puntos y timer compartido, historial de versiones por hora con
restaurar como copia, stickies convertidos en issues de Track con su estado en vivo, y pizarras
dentro de páginas de Docs.

La gran diferencia es la colaboración en vivo. En Excalidraw+ dos personas ven los cursores y los
cambios del otro al instante, se pueden seguir y hablar por voz. En Board cada navegador guarda
cada 1,2 s y los cambios de otro recién aparecen cuando uno guarda (merge por elemento) o recarga:
en la prueba, el segundo navegador no vio la elipse del primero durante 15 s. Tampoco hay modo
presentación, export a PDF, IA para generar diagramas, carpetas ni API pública.

## Capacidades por área

### 1. Edición del lienzo (8/10)

| Capacidad | Excalidraw+ | Miro | Board | Nota |
|---|---|---|---|---|
| Formas, lápiz, texto, borrador | sí | sí | **tiene** | editor Excalidraw 0.18 |
| Flechas que se pegan, flechas en codo, flowchart con Cmd+flecha | sí | conectores | **tiene** | |
| Frames | sí | sí | **tiene** | herramienta Frame en "más herramientas" |
| Imágenes | hasta 4000 px / 10 MB | sí | **tiene** | guardadas en Blob, no en la escena |
| Embeds web | sí | sí | **tiene** | Web Embed |
| Puntero láser | sí | sí | **tiene** | tecla K |
| Biblioteca de formas | personal; de workspace "pronto" | sí | **mejor** | una biblioteca por workspace + instalar del catálogo |
| Stickies | herramienta nativa (sep 2026) | sí | **mejor** | colores, etiquetas, pegar una lista en lote, seleccionar por etiqueta |
| Novedades 2026 de Excalidraw+ (relleno con balde, autoshape, lápiz de ancho fijo) | sí | n/a | **falta** | llegan al actualizar el paquete |
| Mapa mental | no | sí | **falta** | |
| Tablas | no | sí | **falta** | |

### 2. Colaboración (5/10)

| Capacidad | Excalidraw+ | Miro | Board | Nota |
|---|---|---|---|---|
| Multiplayer en vivo con cursores | sí | sí | **falta** | guardado con merge por elemento; idea en backlog |
| Seguir a alguien / traer a todos | Follow, Spotlight Me | sí | **falta** | depende del tiempo real |
| Voz y pantalla compartida | sí | sí (Talktrack) | **falta** | |
| Comentarios anclados | sí | sí | **tiene** | hilos, responder, resolver, ver resueltos |
| @menciones | no confirmado | sí | **mejor** | menciones con aviso |
| Votación y timer | no | sí | **mejor** | votación por puntos oculta hasta cerrar, timer 1-10 min |
| Presentar frames como slides | sí, con notas y animaciones | sí | **falta** | idea en backlog |
| Link de solo lectura | sí | sí | **tiene** | "Share by link" |
| Link de edición para invitados sin cuenta | sí | Business | **tiene** | "Guest edit link" |
| Permiso por pizarra | edit / view | sí | **tiene** | todo el workspace o solo invitados, con rol por persona |

### 3. Espacio de trabajo (6/10)

| Capacidad | Excalidraw+ | Miro | Board | Nota |
|---|---|---|---|---|
| Lista y sidebar con la abierta marcada | sí | sí | **tiene** | |
| Carpetas / colecciones | sí | spaces | **falta** | lista plana |
| Buscar pizarras | dashboard; full-text en progreso | sí | **parcial** | Cmd+K por nombre, sin buscar dentro del contenido |
| Plantillas | slides; libs | cientos | **parcial** | 5: retro, brainstorm, user flow, kanban, roadmap |
| Historial de versiones | en progreso | pago | **mejor** | snapshot por hora, restaurar como copia |
| Papelera | sí | sí | **falta** | borrar es definitivo |
| Duplicar | sí | sí | **tiene** | |

### 4. Integraciones y API (5/10)

| Capacidad | Excalidraw+ | Miro | Board | Nota |
|---|---|---|---|---|
| Issues desde stickies | no (Jira en progreso) | Jira Cards | **mejor** | Track con estado en vivo bajo cada sticky |
| Pizarra dentro de un doc | Notion / Obsidian | Notion, Confluence | **tiene** | bloque /board en Docs |
| Eventos para automatizar | no | webhooks | **tiene** | board.created, deleted, comment_created en Flow |
| API REST | beta pública (may 2026) | sí | **falta** | |
| Servidor MCP | sí | sí | **falta** | |
| Slack | no | sí | **falta** | |

### 5. Admin y seguridad (4/10)

| Capacidad | Excalidraw+ | Miro | Board | Nota |
|---|---|---|---|---|
| Roles | member / admin | varios | **parcial** | roles del workspace + rol por pizarra |
| Audit log | vía API | Enterprise | **falta** | |
| SSO | backlog | Business | **falta** | depende de la plataforma |
| Self-host | lista de espera | no | **mejor** | open source |

### 6. Móvil y offline (6/10)

| Capacidad | Excalidraw+ | Miro | Board | Nota |
|---|---|---|---|---|
| Editar en el teléfono | web responsive | apps nativas | **tiene** | barra compacta, sin scroll horizontal a 390 px |
| Offline | editor OSS local | limitado | **parcial** | borrador local restaurable si no se guardó |

### 7. IA (2/10)

| Capacidad | Excalidraw+ | Miro | Board | Nota |
|---|---|---|---|---|
| Mermaid a diagrama | sí | sí | **tiene** | en "más herramientas" |
| Texto a diagrama | sí, en streaming | sí | **falta** | |
| Agrupar y resumir stickies | no | sí | **falta** | |
| Wireframe a código | sí | n/a | **falta** | |

### 8. Importar y exportar (4/10)

| Capacidad | Excalidraw+ | Miro | Board | Nota |
|---|---|---|---|---|
| PNG / SVG | sí | sí | **tiene** | "Export image" del menú |
| Guardar .excalidraw | sí | n/a | **tiene** | "Save to..." |
| Abrir un .excalidraw | sí | n/a | **falta** | el menú no ofrece abrir archivo (`loadScene: false`) |
| PDF / PPTX de frames | Plus | PDF | **falta** | idea en backlog |

### 9. Rendimiento y confiabilidad (6/10)

| Capacidad | Excalidraw+ | Miro | Board | Nota |
|---|---|---|---|---|
| Guardado | en vivo | en vivo | **parcial** | debounce de 1,2 s, merge por elemento, aviso de conflicto con borrados |
| Pizarras grandes | sin límite publicado | muy grandes | **parcial** | límite de tamaño de escena con aviso |

### 10. Pulido de UX (6/10)

| Capacidad | Excalidraw+ | Miro | Board | Nota |
|---|---|---|---|---|
| Atajos del editor | sí | sí | **tiene** | los de Excalidraw |
| Paleta de comandos | en el lienzo | sí | **tiene** | la de Excalidraw + Cmd+K global |
| Barra de herramientas | arriba | arriba | **parcial** | ver Bugs |
| Menú principal con marca propia | sí | sí | **parcial** | muestra links a GitHub, X y Discord de Excalidraw |

## Puntajes

| Área | Peso | Puntaje |
|---|---|---|
| Edición del lienzo | 20 % | 8 |
| Colaboración | 20 % | 5 |
| Espacio de trabajo | 10 % | 6 |
| Integraciones y API | 10 % | 5 |
| Admin y seguridad | 5 % | 4 |
| Móvil y offline | 5 % | 6 |
| IA | 10 % | 2 |
| Importar y exportar | 10 % | 4 |
| Rendimiento y confiabilidad | 5 % | 6 |
| Pulido de UX | 5 % | 6 |
| **Paridad global** | | **54 %** |

## Paridad de UX en los flujos principales

Probado en el navegador (`/en/app/board`, pizarras con prefijo "Board bench"):

| Flujo | Excalidraw+ | Board | Nota |
|---|---|---|---|
| Crear una pizarra | "New scene" | "New board" o plantilla, abre el lienzo y aparece en el sidebar marcada | **paridad** |
| Dibujar | igual | mismo editor y atajos | **paridad** |
| Dos personas en la misma pizarra | ven los cambios al instante | B no vio el cambio de A en 15 s; al guardar B, su escena sumó lo de A sin conflicto; A no vio lo de B hasta guardar | **peor** |
| Taller (retro) | sin votación ni timer | plantilla Retrospective + Workshop con timer y dot voting | **mejor** |
| Compartir | link y permisos | un solo panel: link de lectura, quién puede abrir, link de invitado | **paridad** |
| Encontrar una pizarra | dashboard con búsqueda | Cmd+K por nombre y sidebar | **paridad** |
| 390 px y oscuro | responsive | sin scroll horizontal, barra compacta | **paridad** |

## Top 10 gaps (impacto para un equipo chico que viene de Excalidraw+ o Miro)

| # | Gap | Por qué se vuelven | Esfuerzo |
|---|---|---|---|
| 1 | Multiplayer en vivo con cursores | en una llamada nadie ve lo que dibuja el otro; es la razón de pagar Excalidraw+ | L |
| 2 | Presentar frames y exportar a PDF | revisiones de diseño y demos se hacen desde la pizarra | M |
| 3 | Texto a diagrama con IA | Excalidraw+ y Miro generan diagramas desde un prompt | M |
| 4 | Abrir archivos .excalidraw | quien migra tiene cientos de archivos y no puede traerlos | S |
| 5 | Carpetas y búsqueda dentro del contenido | con 50 pizarras la lista plana no alcanza | M |
| 6 | Agrupar y resumir stickies con IA | después del brainstorm, Miro ordena y resume en un clic | M |
| 7 | API REST y MCP | Excalidraw+ ya expone escenas a agentes y scripts | M |
| 8 | Seguir a alguien / traer a todos a mi vista | facilitar un taller sin eso es pedir "bajen un poco" | M (después de 1) |
| 9 | Papelera | borrar una pizarra por error no tiene vuelta | S |
| 10 | Mapa mental | caso común en Miro para planificar | M |

## Bugs encontrados

1. **La barra de herramientas del lienzo queda unos 130 px más abajo del borde superior y tapa
   el contenido.** Repro: crear una pizarra desde la plantilla Retrospective en 1400x900. La barra
   de formas aparece en y=228 (el lienzo empieza en y=100) porque el contenedor superior de
   Excalidraw (`.App-menu_top`) mide 268 px; queda encima del título "To improve" y el texto de
   ayuda "To move canvas…" se superpone a la plantilla.
2. **El menú principal del lienzo muestra "Excalidraw links" (GitHub, Follow us, Discord chat).**
   Repro: abrir cualquier pizarra, clic en el menú ☰ arriba a la izquierda. Son los links por
   defecto del paquete; llevan a las redes de Excalidraw desde nuestra app.
3. **Los cambios de otra persona no aparecen hasta guardar o recargar.** Repro: abrir la misma
   pizarra en dos navegadores, dibujar en A, esperar 15 s en B: B no muestra el cambio. Al dibujar
   en B y guardar, B recibe lo de A (merge correcto); A sigue sin ver lo de B. No hay aviso de que
   la vista está desactualizada. Es un gap conocido (idea de multiplayer en el backlog), pero sin
   ese aviso parece un bug.

## Fuentes

- Excalidraw+ precios: https://plus.excalidraw.com/pricing
- Excalidraw+ changelog dic 2025 - sep 2026: https://plus.excalidraw.com/changelog
- Excalidraw+ changelog feb - nov 2025: https://plus.excalidraw.com/changelog/2
- Excalidraw+ changelog jul 2023 - ene 2025: https://plus.excalidraw.com/changelog/3
- Excalidraw+ roadmap (versionado, búsqueda full-text, Jira, SSO): https://plus.excalidraw.com/roadmap
- Excalidraw+ API y MCP: https://plus.excalidraw.com/llms-full.txt
- Excalidraw open source: https://github.com/excalidraw/excalidraw
- Flechas en codo: https://excalidraw.com/blog/building-elbow-arrows-part-one
- SOC 2: https://excalidraw.com/blog/excalidraw-soc2
- Miro precios: https://miro.com/pricing/
- Miro IA (crear con IA, agrupar stickies): https://help.miro.com/hc/articles/28782102127890 y https://help.miro.com/hc/articles/28781881506834
- Miro Sidekicks: https://help.miro.com/hc/en-us/articles/29902701849618-Sidekicks-overview
- Miro presentaciones interactivas: https://miro.com/presentations/interactive-presentations/
- Miro Mermaid: https://miro.com/diagramming/mermaid-diagram
- Miro Jira: https://help.miro.com/hc/articles/360017572414
- Miro audit logs: https://help.miro.com/hc/articles/360017571434

