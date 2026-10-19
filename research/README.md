# Investigación de gaps

`ideas.json` es la lista de ideas que salen de comparar cada app con su
competidor (documentación pública, API, changelog y precios). El tick horario
(`/api/cron/tick`) las carga al backlog del board como ideas públicas.

- Cada título entra una sola vez: si alguien la borra o la rechaza desde el
  admin, no vuelve (tabla `roadmap_imports`).
- Para sumar ideas, agregá objetos al final del array y mergeá a main.

```json
{
  "title": "Docs: Export pages to Markdown",
  "description": "Qué hace el competidor (con link), qué tenemos hoy, por qué importa y un primer alcance.",
  "product": "docs",
  "kind": "idea"
}
```

`product` es una de las claves de `lib/products.ts` (o `other`); `kind` es
`idea` o `bug`. La rutina diaria en la nube suma ideas acá en su PR.

## Cuando una idea se construye

Al mergear el arreglo, marcá la idea en `ideas.json` con su avance y, si ya
salió, con la entrada de `content/changelog.ts` que la cuenta:

```json
{ "title": "Link: ...", "...": "...", "status": "done", "changelog": "2026-10-19-link" }
```

`status` acepta `planned`, `in_progress` o `done`. El tick mueve la idea del
board a ese estado (solo hacia adelante: nunca retrocede ni toca una idea
rechazada o fusionada desde el admin) y les avisa a quienes la votaron.
