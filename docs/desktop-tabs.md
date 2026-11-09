# Pestañas y ventanas en la app de escritorio

Desde la 0.3.3. Código: `desktop/src-tauri/src/tabs.rs` (ventanas y webviews), `session.rs`
(modelo puro, con tests) y `desktop/ui/tabs.ts` (la tira). Test de la tira:
`tests/e2e/desktop-tabs.spec.ts`.

## Cómo lo resuelven otras apps

| App | Modelo | Atajos | Abrir link aparte | Sacar a ventana | Restaura | Memoria |
|---|---|---|---|---|---|---|
| Chrome / Arc | Tira propia + ventanas | ⌘T ⌘N ⌘W ⌘1-9 ⌃Tab ⌘⇧T | ⌘-clic, clic del medio, menú | Sí, y se juntan | Sí | Memory Saver: descarta pestañas quietas y recarga al tocarlas. Arc archiva a las 12 h / 7 días |
| Notion | Tira propia (desde 2022) + ventanas | ⌘T, ⌘⇧N | ⌘-clic pestaña, ⌥⇧-clic ventana | Reordena; sacar, sin confirmar | Sí (2.34) | Beta: un solo proceso por ventana |
| Figma | Tira propia por archivo + ventanas | ⌘T, ⇧⌘N | ⌘ + doble clic | Sí, y entre ventanas | No confirmado | |
| VS Code | Pestañas de editor + ventanas auxiliares (1.85) | ⌘W ⌃Tab ⌘1-9 | | Arrastrar al escritorio (1.85) | Sí (1.86) | |
| Slack | Una ventana + ventanas sueltas por canal, DM o huddle | | ⌘-clic en un canal | | | |
| Things 3 | Varias ventanas, sin pestañas | ⌃⌘N | Menú "Abrir en ventana nueva" | | | |
| Linear, Superhuman, Granola | Sin pestañas confirmadas; ventanas en Superhuman (⌘N) | | | | | |

Ninguna usa las pestañas nativas de macOS (NSWindow tabbing): no dejan poner el ícono del
producto, un punto de novedades ni pausar pestañas, y en Windows no existen.

## Qué elegimos

Ventanas nativas (⌘N), cada una con su tira de pestañas propia, como Chrome, Notion y Figma.
Para una suite de 26 apps es lo que pide la gente: "una app por pestaña" o "cada app en su
ventana". Cada pestaña es su propia webview (no un iframe ni una ruta de la misma página):
conserva su estado al cambiar, se puede mover a otra ventana sin recargar (reparent) y se puede
pausar sola.

- **Ventana**: `Window` de Tauri con webviews hijas (feature `unstable`). Arriba, la tira
  (`tabs.html`, local); debajo, una webview por pestaña. En Mac la tira va en la barra de título.
- **Una sola sesión**: todas las webviews comparten el almacén de cookies; entrar o salir en una
  vale para todas (las demás se recargan).
- **Atajos**: ⌘T pestaña nueva con el buscador (⌘K) abierto; ⌘N ventana; ⌘W cierra la pestaña
  (la última cierra la ventana, y la última ventana se esconde como antes); ⌘⇧W ventana;
  ⌘⇧T vuelve a abrir la última cerrada en su lugar; ⌘1-8, ⌘9 la última; ⌃Tab / ⌃⇧Tab y
  ⌘⇧[ ]. En Windows, Ctrl en vez de ⌘.
- **Links**: ⌘-clic o clic del medio, pestaña atrás (o ventana, según Ajustes); ⌘⇧-clic,
  pestaña adelante; ⌘⌥-clic, ventana. Clic derecho en un link de la app: Abrir en pestaña nueva,
  Abrir en ventana nueva, Copiar link (si la página no tiene su propio menú). `target=_blank` de
  la app abre pestaña al lado.
- **Tira**: ícono y color del producto, título del registro (el de la página, o su h1 si la
  página no tiene título propio), punto de novedades por app (de `/api/desktop/badge`, `byPath`),
  punto rojo si graba, arrastrar para ordenar, soltar fuera para ventana nueva o sobre la tira de
  otra ventana para mudarla, clic del medio cierra, menú con duplicar, mover a ventana nueva y
  cerrar las otras. Teclado: flechas, Enter, Supr, Shift+F10.
- **Menús**: Archivo (pestaña, ventana, volver a abrir, cerrar) y Ventana con la lista de
  ventanas del sistema (el título de cada una es su pestaña). Dock de Mac: Ventana nueva.
- **Restaurar**: `session.json` guarda ventanas, posición, pestañas y la de adelante; al abrir
  carga solo la de adelante de cada ventana y el resto al tocarlas.
- **Pausar pestañas quietas** (Ajustes › General › Pestañas y ventanas, prendido, 30 min por
  defecto): se cierra su webview, la pestaña queda en la tira y recarga al tocarla. Nunca la de
  adelante ni la que graba.
- **Grabación y avisos**: un solo atajo global y un solo indicador; el indicador sabe qué
  pestaña graba (Abrir la trae adelante, Cortar le habla a ella). Los avisos nativos salen si
  ninguna ventana de la app tiene foco.

## Memoria medida (Mac mini M-series, 8 GB, macOS 26)

App de debug contra el servidor de producción en DEMO_MODE, 25 s después de abrir, páginas de
inicio de cada app. Suma de `phys_footprint` (lo que muestra Monitor de Actividad) de la app y de
sus procesos de WebKit. Cada webview de WKWebView es un proceso WebContent propio.

| Escenario | Webviews de páginas | Footprint |
|---|---|---|
| 1 ventana, 1 pestaña | 1 | 122 MB |
| 1 ventana, 10 pestañas, restauradas (solo la de adelante carga) | 1 | 123 MB |
| 1 ventana, 5 pestañas cargadas | 5 | 310 MB |
| 1 ventana, 10 pestañas cargadas | 10 | 519 MB |
| 5 ventanas, 1 pestaña cada una | 5 | 363 MB |

- Cada pestaña cargada suma unos **45 MB** (más en apps pesadas como Talk o Design).
- Cada ventana extra suma unos **60 MB** (su pestaña más la tira, unos 13 MB).
- Una pestaña pausada o sin abrir cuesta casi nada: por eso restaurar es perezoso y las quietas
  se pausan: 10 pestañas restauradas cuestan lo mismo que una (123 MB contra 122 MB).

Por qué no una sola webview con pestañas adentro (rutas o iframes): cambiar de pestaña
recargaría la app o mezclaría 10 apps en un mismo proceso, sin poder liberar una sola.

## Pendiente

- Windows: la tira va debajo de la barra de título nativa; sin lista de saltos ("Ventana nueva"
  en la barra de tareas).
- Probado: tests de Rust del modelo, la tira en Chromium con el IPC simulado y la app real en Mac
  (ventanas, títulos, sesión restaurada y memoria). Sin captura de pantalla de la app nativa
  (sin permiso de grabación de pantalla en la máquina de prueba).
