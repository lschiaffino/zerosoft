import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { actorOf } from '@/lib/shop-http';
import {
  ensureStore,
  enabledMethods,
  getCollection,
  getCustomer,
  getDiscount,
  getProduct,
  inventoryHistory,
  listCollections,
  listCustomers,
  listDiscounts,
  listInventory,
  listLocations,
  listProducts,
  listShippingRates,
  listTaxRates,
  storeDto,
} from '@/lib/shop';
import { getOrder, listOrders, shopAnalytics } from '@/lib/shop-orders';
import { paymentsView } from '@/lib/shop-payments';
import ShopOverview from '@/components/shop/admin/ShopOverview';
import ProductsList from '@/components/shop/admin/ProductsList';
import ProductEditor from '@/components/shop/admin/ProductEditor';
import CollectionsList from '@/components/shop/admin/CollectionsList';
import CollectionEditor from '@/components/shop/admin/CollectionEditor';
import InventoryView from '@/components/shop/admin/InventoryView';
import OrdersList from '@/components/shop/admin/OrdersList';
import OrderDetail from '@/components/shop/admin/OrderDetail';
import PackingSlip from '@/components/shop/admin/PackingSlip';
import CustomersList from '@/components/shop/admin/CustomersList';
import CustomerDetail from '@/components/shop/admin/CustomerDetail';
import DiscountsList from '@/components/shop/admin/DiscountsList';
import DiscountEditor from '@/components/shop/admin/DiscountEditor';
import AnalyticsView from '@/components/shop/admin/AnalyticsView';
import ShopSettings from '@/components/shop/admin/ShopSettings';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; zs?: string[] }>; searchParams: Promise<Record<string, string | undefined>> };

const SECTIONS = ['orders', 'products', 'collections', 'inventory', 'customers', 'discounts', 'analytics', 'settings'] as const;

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale, zs = [] } = await props.params;
  const t = await getTranslations({ locale, namespace: 'shop' });
  const section = (SECTIONS as readonly string[]).includes(zs[0] ?? '') ? zs[0] : null;
  return { title: section ? `${t(`nav.${section}`)} · Shop` : t('meta.title') };
}

/**
 * Shop en una sola ruta (presupuesto de rutas): /app/shop, /orders, /orders/<id>,
 * /orders/<id>/packing-slip, /products(/new|/<id>), /collections(/new|/<id>),
 * /inventory, /customers(/<id>), /discounts(/new|/<id>), /analytics y /settings.
 */
export default async function ShopPage(props: Props) {
  const { locale, zs = [] } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const actor = actorOf(user);
  const store = await ensureStore(actor.ws);
  const dto = storeDto(store);
  const currency = store.currency;
  const [section, id, sub] = zs;
  if (zs.length > 3) notFound();

  if (!section) {
    if (sp.new === '1') redirect(`/${locale}/app/shop/products/new`);
    const [analytics, orders, low, products] = await Promise.all([
      shopAnalytics(actor.ws, 30),
      listOrders(actor.ws, { limit: 6 }),
      listInventory(actor.ws, { lowOnly: true }),
      listProducts(actor.ws, { limit: 1 }),
    ]);
    const rates = await listShippingRates(actor.ws);
    return (
      <ShopOverview
        store={dto}
        analytics={analytics}
        orders={orders.items}
        low={low.slice(0, 8)}
        setup={{ products: products.total, shipping: rates.length, payments: enabledMethods(store).length, published: dto.published }}
      />
    );
  }

  switch (section) {
    case 'orders': {
      if (!id) {
        const data = await listOrders(actor.ws, { q: sp.q, status: sp.status, limit: 200 });
        return <OrdersList currency={currency} initial={data.items} total={data.total} q={sp.q ?? ''} status={sp.status ?? ''} />;
      }
      const order = await getOrder(actor.ws, id);
      if (!order) notFound();
      if (sub === 'packing-slip') return <PackingSlip order={order} store={dto} />;
      if (sub) notFound();
      return <OrderDetail initial={order} storeHandle={dto.handle} canAdmin={actor.admin} />;
    }
    case 'products': {
      if (!id) {
        const data = await listProducts(actor.ws, { q: sp.q, status: sp.status, limit: 200 });
        return <ProductsList currency={currency} initial={data.items} total={data.total} q={sp.q ?? ''} status={sp.status ?? ''} />;
      }
      if (sub) notFound();
      const [locations, collections] = await Promise.all([listLocations(actor.ws), listCollections(actor.ws)]);
      const manual = collections.filter((c) => c.kind === 'manual').map((c) => ({ id: c.id, title: c.title }));
      if (id === 'new') return <ProductEditor product={null} currency={currency} locations={locations} collections={manual} storeHandle={dto.handle} published={dto.published} />;
      const product = await getProduct(actor.ws, id);
      if (!product) notFound();
      const history = await inventoryHistory(actor.ws, { limit: 30 }).then((h) => h.filter((e) => product.variants.some((v) => v.id === e.variantId)));
      return <ProductEditor product={product} currency={currency} locations={locations} collections={manual} storeHandle={dto.handle} published={dto.published} history={history} />;
    }
    case 'collections': {
      if (!id) return <CollectionsList initial={await listCollections(actor.ws, { q: sp.q })} q={sp.q ?? ''} />;
      if (sub) notFound();
      const products = (await listProducts(actor.ws, { limit: 500 })).items.map((p) => ({ id: p.id, title: p.title, status: p.status, image: p.image }));
      if (id === 'new') return <CollectionEditor collection={null} products={products} storeHandle={dto.handle} />;
      const collection = await getCollection(actor.ws, id);
      if (!collection) notFound();
      return <CollectionEditor collection={collection} products={products} storeHandle={dto.handle} />;
    }
    case 'inventory': {
      if (id) notFound();
      const [rows, locations, history] = await Promise.all([listInventory(actor.ws, { lowOnly: sp.low === '1' }), listLocations(actor.ws), inventoryHistory(actor.ws, { limit: 50 })]);
      return <InventoryView initial={rows} locations={locations} history={history} lowOnly={sp.low === '1'} threshold={store.low_stock} />;
    }
    case 'customers': {
      if (!id) return <CustomersList currency={currency} initial={await listCustomers(actor.ws, { q: sp.q })} q={sp.q ?? ''} />;
      if (sub) notFound();
      const customer = await getCustomer(actor.ws, id);
      if (!customer) notFound();
      const orders = await listOrders(actor.ws, { customerId: id, limit: 100 });
      return <CustomerDetail customer={customer} orders={orders.items} currency={currency} />;
    }
    case 'discounts': {
      if (!id) return <DiscountsList currency={currency} initial={await listDiscounts(actor.ws, { q: sp.q })} q={sp.q ?? ''} />;
      if (sub) notFound();
      if (id === 'new') return <DiscountEditor discount={null} currency={currency} />;
      const discount = await getDiscount(actor.ws, id);
      if (!discount) notFound();
      return <DiscountEditor discount={discount} currency={currency} />;
    }
    case 'analytics': {
      if (id) notFound();
      const days = [7, 30, 90, 365].includes(Number(sp.days)) ? Number(sp.days) : 30;
      return <AnalyticsView analytics={await shopAnalytics(actor.ws, days)} />;
    }
    case 'settings': {
      if (id) notFound();
      const [locations, shipping, taxes] = await Promise.all([listLocations(actor.ws), listShippingRates(actor.ws), listTaxRates(actor.ws)]);
      return (
        <ShopSettings
          store={dto}
          payments={actor.admin ? paymentsView(store) : null}
          locations={locations}
          shipping={shipping}
          taxes={taxes}
          canAdmin={actor.admin}
          tab={sp.tab ?? 'store'}
        />
      );
    }
    default:
      notFound();
  }
}
