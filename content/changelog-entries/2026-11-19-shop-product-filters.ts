import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-shop-product-filters',
  date: '2026-11-19',
  title: {
    en: 'Shop: filter products by vendor, type and tag',
    es: 'Shop: filtrá productos por proveedor, tipo y etiqueta',
    pt: 'Shop: filtre produtos por fornecedor, tipo e tag',
  },
  items: [
    {
      product: 'shop',
      en: 'In the product list, click a vendor or a product type to see only those products. The filter stays in the address, combines with search and status, and shows as a chip you can remove. The tag filter works through the address too (?tag=summer).',
      es: 'En la lista de productos, hacé clic en un proveedor o en un tipo de producto para ver solo esos productos. El filtro queda en la dirección, se combina con la búsqueda y el estado, y aparece como una etiqueta que podés quitar. El filtro por etiqueta también funciona desde la dirección (?tag=verano).',
      pt: 'Na lista de produtos, clique em um fornecedor ou em um tipo de produto para ver só esses produtos. O filtro fica no endereço, combina com a busca e o status, e aparece como um chip que você pode remover. O filtro por tag também funciona pelo endereço (?tag=verao).',
    },
  ],
} satisfies ChangelogEntry;
