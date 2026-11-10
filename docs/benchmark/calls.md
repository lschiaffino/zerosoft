# Benchmark: Calls contra Gong

Leído el 2026-11-08. Base de `content/feature-parity/calls.ts`. Cada fila de paridad sale de una capacidad pública de Gong; ninguna se fusiona ni se saca para subir el número.

## Fuentes leídas

- Precios: https://www.gong.io/pricing/ (no publica montos: licencia por usuario más una tarifa de plataforma que escala con la cantidad de usuarios, y un formulario para pedir propuesta).
- Conversation intelligence: https://www.gong.io/conversation-intelligence/ (grabación de llamadas, reuniones y emails, transcripción, temas, objeciones, menciones de competidores, alertas de riesgo de deals, resúmenes y actualización del CRM, coaching, scorecards, Forecast, Engage y Enable).
- Lo que no figura en esas páginas (bots para Teams y Meet, discador, trackers inteligentes, bibliotecas de clips, app móvil, estadísticas de interacción como talk ratio o paciencia, Ask Anything) sale del centro de ayuda público de Gong (https://help.gong.io) y de su material de producto. Si alguna fila resulta mal, se corrige acá y en la paridad.

## Precio

Gong no publica precios. La página de producto no cita un número: remite a gong.io/pricing.

## Cómo se marcó

- `have`: funciona de punta a punta en la app y tiene tests reales (biblioteca, búsqueda, reproductor con transcripción, comentarios, link público, exportes, métricas calculadas desde la transcripción, vínculo con el CRM de la suite, webhook, API y MCP).
- `partial`: existe con menos alcance o se probó solo con fakes. El bot de Meet se probó contra una página de Meet simulada dentro del contenedor real, todavía no contra Google Meet en vivo; el calendario, con un Google Calendar simulado; los análisis con IA, con un modelo simulado (el circuito es real, la calidad no está medida).
- `missing`: Zoom, Teams, discador, traducción, trackers inteligentes, bibliotecas y playlists, feedback de coaching, tendencias del equipo, forecast, emails y Engage, sincronización con Salesforce o HubSpot, borrador de email de seguimiento y app móvil.

## Pesos

Peso 2 para lo que decide si un equipo de ventas puede dejar Gong: grabar Meet, Zoom, Teams y teléfono, entrar solo desde el calendario, transcripción y nombres, biblioteca y búsqueda, reproductor, comentarios, resumen, scorecard, preguntas sobre una llamada, métricas, coaching, CRM, deals y forecast.
