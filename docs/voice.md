# Voz de zerosoft

Cómo escribimos el sitio público (messages/*/common.json, pages.json, tools.json), el blog y el
changelog. El español es la fuente (rioplatense, voseo). Inglés y portugués se escriben de nuevo
en cada idioma, no se traducen palabra por palabra.

`tests/unit/copy-lint.test.ts` hace cumplir la parte mecánica de estas reglas en los JSON del sitio.

## La voz

Seca y concreta. Frases cortas, verbos concretos, afirmaciones que se pueden verificar.
Cada texto dice qué hace la app y qué reemplaza.

- **Qué hace, no qué significa.** "Acortá links con tu dominio y mirá los clics por país" en
  lugar de "Tus links, liberados".
- **Un dato vale más que un adjetivo.** "Hasta 200 links por carga" en lugar de "carga masiva
  potente". Si no hay número, una acción concreta.
- **Decí lo que falta.** Si una función no existe todavía, se dice "todavía no" y punto. Nada de
  "llega pronto" sin fecha.
- **Una idea por frase.** Si una frase necesita un guion largo para respirar, son dos frases.
- **Sin chistes de relleno.** Un toque de humor está bien si suma información.

Hay **un** momento de manifiesto: la sección Manifiesto del home. Ahí se permite el tono de
convicción (4 o 5 párrafos cortos), con las mismas reglas de abajo: nada repetido, nada de
"el software murió", nada de "nuevo mundo".

## Prohibido en el copy

Estructuras:

- "No es X, es Y" / "no X, sino Y". Decí directamente Y.
- Cierres de eslogan con "— por $0." o "por $0, obviamente".
- Tríadas de relleno: "Sin X, sin Y, sin Z." / "Un X. Un Y. Una Z."
- Pares espejo en títulos: "Todo lo que necesitás. / Nada de lo que pagás."
- Guion largo (—) en strings del sitio. Usá punto, coma, dos puntos o paréntesis. En el blog,
  ninguno en títulos y descripciones, y como mucho dos por post.

Palabras y frases:

- "gratis" más de una vez por pantalla o sección.
- "para siempre", "liberado/liberar", "murió", "nuevo mundo", "el arsenal", "el precio del aire",
  "sin rehenes", "cero humo", "ya está vivo", "ya está en el aire", "obviamente".
- Estadísticas inventadas ("el 80% de HubSpot que de verdad usás"). Solo números que podamos
  mostrar: precios de lista con fuente, límites del código, conteos reales.

Equivalentes en inglés: "it's not X, it's Y", "forever", "set free", "is dead", "new world",
"the price of air", "no hostages", "obviously". En portugués: "não é X, é Y", "para sempre",
"liberado", "morreu", "novo mundo", "obviamente".

## Marca y nombres

- **zerosoft** siempre en minúscula, como el logo, también al principio de una frase y en
  "zerosoft Cloud". Nunca "Zerosoft" ni "Zerosoftware" en el copy. Los identificadores de código
  y el header HTTP `Zerosoft-Signature` no se tocan.
- Los productos van con mayúscula inicial: Link, CRM, Cal, Track, Chat, Docs, Agents, Flow,
  Robots, Notes, Board.
- Son **once apps** ("Once apps" / "Eleven apps" / "Onze apps"). Nunca "seis herramientas".

## Precios

- Self-host: $0. El core es AGPLv3 con todas sus funciones.
- zerosoft Cloud: precio por workspace y por uso. Plan gratis para empezar; después pagás lo que
  consumís: clics, reservas, emails y almacenamiento. Los asientos no se cobran. La IA se cobra
  por tokens, al costo del proveedor ×1,2.
- No publicamos precios por usuario para zerosoft.
- Precios de la competencia: los de lista que ya citamos (components/site/catalog.ts y
  pages.json → products.<key>.compare), con "cerca de" cuando corresponde. No inventamos nuevos.

## Páginas de producto

- Título y bajada propios de cada app. Nada de plantillas repetidas entre productos.
- FAQ específica: cómo migrar desde la competencia, límites reales, self-host, API, qué falta.
- Las preguntas generales ("¿es gratis?", "¿qué pasa si zerosoft cierra?", "¿cómo ganan plata?")
  van en el FAQ del home, una sola vez.
- Botones: "Probar Link", "Abrir CRM". No "Usar X — es gratis".
- Antes de afirmar una función, chequeala en `docs/feature-map.md` o en `lib/`. Si no existe, no
  va.

## Herramientas gratis (/tools)

"Gratis, sin registro" se dice una vez, en el hero de /tools. Las metas y los CTA de cada
herramienta dicen qué hace la herramienta.

## Antes y después

| Antes | Después |
|---|---|
| El software murió. | Once apps para trabajar. Cero licencias. |
| Ver el arsenal | Ver las apps |
| Todo lo que necesitás. Nada de lo que pagás. | Links cortos con métricas. Con tu dominio. |
| Usar Link — es gratis | Probar Link |
| Abrilo y cerrá tu primer deal hoy — por $0, obviamente. | Importá tus contactos desde un CSV y armá tu pipeline. |
