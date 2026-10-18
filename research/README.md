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
