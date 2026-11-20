import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-1458-shop-bulk-prices',
  date: '2026-11-20',
  title: {
    en: 'Shop: put many products on sale at once',
    es: 'Shop: poné muchos productos en oferta de una vez',
    pt: 'Shop: coloque muitos produtos em promoção de uma vez',
  },
  items: [
    {
      product: 'shop',
      en: 'Select products in the list and choose Put on sale, End sale, or Raise or lower prices. A sale takes a percentage off every variant and keeps the regular price crossed out in the store; running it again on a product already on sale starts from the regular price, so it never discounts twice. End sale puts the regular price back. Raising or lowering moves prices and crossed-out prices by the same percentage, rounded to your currency.',
      es: 'Seleccioná productos en la lista y elegí Poner en oferta, Terminar oferta, o Subir o bajar precios. La oferta descuenta un porcentaje en cada variante y deja el precio de lista tachado en la tienda; si la volvés a aplicar sobre un producto que ya estaba en oferta, parte del precio de lista, así que nunca descuenta dos veces. Terminar oferta vuelve al precio de lista. Subir o bajar mueve los precios y los tachados el mismo porcentaje, redondeado a tu moneda.',
      pt: 'Selecione produtos na lista e escolha Colocar em promoção, Encerrar promoção, ou Aumentar ou baixar preços. A promoção desconta uma porcentagem em cada variante e deixa o preço de tabela riscado na loja; se você aplicar de novo em um produto que já estava em promoção, parte do preço de tabela, então nunca desconta duas vezes. Encerrar promoção volta ao preço de tabela. Aumentar ou baixar muda os preços e os riscados na mesma porcentagem, arredondada para a sua moeda.',
    },
  ],
} satisfies ChangelogEntry;
