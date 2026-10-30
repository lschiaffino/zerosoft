# Benchmark: Design vs Canva (diseño gráfico desde plantillas)

Fecha: 2026-10-29. Referencia: Canva Business (USD 250 por persona al año en pago anual, USD 25 por persona al mes en pago mensual). Canva Pro, para una sola persona, sale USD 180 al año.

## Cómo se hizo

- **Competidor:** página de precios de Canva y su centro de ayuda público. Ese día `canva.com/pricing` respondió 403 a nuestro verificador, así que el precio de Business sale de sitios públicos que siguen precios (pricingsaas.com, captura del 14 de septiembre de 2026, y guías de precios de 2026 que citan la página de Canva). Si Canva cambia el precio, se corrige acá y en `messages/*/pages.json` (`products.design.compare`).
- **Nuestra app:** la primera versión (editor de lienzo con páginas, 20 plantillas en JSON, kit de marca por workspace, exportación en el navegador, compartir, link público y comentarios en el lienzo). El estado al día de cada capacidad está en `content/feature-parity/design.ts`, que es la fuente de la página de producto.
- **Limitaciones:** no usamos Canva con una cuenta paga: lo descrito sale de su documentación pública y su tabla de planes. No comparamos la calidad de las plantillas, solo la cantidad.

## Capacidades por área

Leyenda: **tiene**, **parcial**, **falta**, **mejor** (mejor que el incumbente o algo que el incumbente no tiene).

### 1. Crear

| Capacidad | Canva | Design | Nota |
|---|---|---|---|
| Tamaños listos y a medida | Sí, cientos de formatos | **tiene** | Post e historia de Instagram, LinkedIn, A4, presentación 16:9, logo y a medida hasta 8000 px |
| Plantillas | Cientos de miles, con fotos de stock | **parcial** | 20 plantillas propias hechas con formas, texto e íconos, sin material protegido |
| Plantillas del equipo | Brand templates en Business | **tiene** | Cualquier diseño se guarda como plantilla del workspace |
| Cambiar el tamaño | Magic Switch reacomoda los elementos | **parcial** | Escala y centra el contenido |

### 2. Editor y elementos

| Capacidad | Canva | Design | Nota |
|---|---|---|---|
| Mover, rotar, cambiar el tamaño, selección múltiple | Sí | **tiene** | |
| Varias páginas y presentar | Sí | **tiene** | |
| Guías de alineación | Sí | **tiene** | Bordes y centro de la página y de otros elementos |
| Reglas | Sí | **falta** | |
| Formas, líneas, marcos y cuadrículas | Sí | **tiene / parcial** | Las cuadrículas se insertan como grupo de marcos |
| Íconos y gráficos | Biblioteca enorme | **parcial** | Unos 40 íconos de línea propios |
| Gráficos, tablas, video y animación | Sí | **falta** | |

### 3. Texto e imágenes

| Capacidad | Canva | Design | Nota |
|---|---|---|---|
| Estilo del texto | Sí | **tiene** | Fuente, tamaño, peso, cursiva, subrayado, color, alineación, interlineado, espaciado, mayúsculas |
| Fuentes | Miles, y subir propias en planes pagos | **parcial** | 12 fuentes, sin subir propias |
| Efectos de texto | Sombra, contorno, curvo | **falta** | |
| Subir imágenes, recortar y voltear | Sí | **tiene** | Hasta 10 MB, con los controles de subida de la suite |
| Filtros y ajustes de imagen | Sí | **falta** | |

### 4. Marca, exportación y equipo

| Capacidad | Canva | Design | Nota |
|---|---|---|---|
| Kit de marca | Sí, varios en Business | **tiene** | Uno por workspace: logos, colores y fuentes |
| PNG, PNG transparente, JPG | Sí | **tiene** | En el navegador, 1x a 3x |
| PDF | Vectorial y para imprenta | **parcial** | Cada página es una imagen |
| SVG, video y GIF | Sí | **falta** | |
| Compartir para ver o editar | Sí | **tiene** | Workspace o personas puntuales |
| Link público | Sí | **tiene** | Solo lectura, revocable, `noindex` |
| Comentarios en el lienzo | Sí | **tiene** | Con respuestas, resolver y avisos |
| Edición en tiempo real | Sí | **parcial** | Los cambios guardados llegan en segundos; dos guardados sobre la misma versión avisan |
| Historial de versiones | Sí | **falta** | |

### 5. IA, integraciones y administración

| Capacidad | Canva | Design | Nota |
|---|---|---|---|
| Escribir con IA (Magic Write) | Sí | **tiene** | Con la IA configurada y la cuota del workspace |
| Quitar fondo y generar imágenes | Sí | **falta** | |
| Insertar en Docs y mandar a Board | No aplica | **tiene / mejor** | Bloque /design en Docs y una página como imagen en Board |
| Usar en emails de Link o CRM | No aplica | **falta** | |
| API | Connect API | **parcial** | Listar y leer diseños con design:read |
| Instalar en tu servidor | No | **mejor** | |
| Apps para el celular | Sí | **falta** | |

## Fuentes

- https://www.canva.com/pricing/ (403 desde el verificador el 2026-10-29)
- https://pricingsaas.com/companies/canva/diffs/2026W32
- https://piktochart.com/blog/canva-pricing-2026-costs-raised/
