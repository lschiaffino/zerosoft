import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-1350-shop-collection-filters',
  date: '2026-11-20',
  title: {
    en: 'Shop: filter a collection by size, color, brand and type',
    es: 'Shop: filtrá una colección por talle, color, marca y tipo',
    pt: 'Shop: filtre uma coleção por tamanho, cor, marca e tipo',
  },
  items: [
    {
      product: 'shop',
      en: 'Collection pages in your store now show a filter for each product option (size, color or whatever you named it), plus brand and type, with how many products each value leaves. Options have to match on the same variant: size M in red only shows products that sell an M in red, and with "In stock only" that variant has to have stock. The filters stay in the address, so a filtered collection can be shared as a link.',
      es: 'Las páginas de colección de tu tienda ahora muestran un filtro por cada opción de los productos (talle, color o como la hayas llamado), más marca y tipo, con cuántos productos deja cada valor. Las opciones se cumplen en la misma variante: talle M en rojo muestra solo productos que venden un M rojo, y con "Solo con stock" esa variante tiene que tener stock. Los filtros quedan en la dirección, así que una colección filtrada se comparte con un link.',
      pt: 'As páginas de coleção da sua loja agora mostram um filtro para cada opção dos produtos (tamanho, cor ou como você chamou), além de marca e tipo, com quantos produtos cada valor deixa. As opções valem para a mesma variante: tamanho M em vermelho mostra só produtos que vendem um M vermelho, e com "Só com estoque" essa variante precisa ter estoque. Os filtros ficam no endereço, então uma coleção filtrada pode ser compartilhada por link.',
    },
  ],
} satisfies ChangelogEntry;
