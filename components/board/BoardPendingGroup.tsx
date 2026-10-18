import type { PendingItem } from '@/lib/board';
import ProductMark from '@/components/site/ProductMark';

export interface BoardPendingLabels {
  title: string;
  status: string;
  hint: string;
  product: Record<string, string>;
}

/**
 * Pedidos propios en revisión (feedback que todavía está en triage privado).
 * Solo se renderiza para su autora; sin voto y sin link al detalle, porque el
 * ítem no es público.
 */
export default function BoardPendingGroup({ items, labels }: { items: PendingItem[]; labels: BoardPendingLabels }) {
  if (items.length === 0) return null;
  return (
    <section className="bp-pending" aria-labelledby="bp-pending-title">
      <header className="bp-col-head">
        <h2 id="bp-pending-title">{labels.title}</h2>
        <span className="bp-col-count">{items.length}</span>
      </header>
      <p className="bp-hint bp-pending-hint">{labels.hint}</p>
      <ul className="bp-list">
        {items.map((item) => (
          <li key={item.id} className="bp-row" data-pending="true">
            <span aria-hidden="true" />
            <div>
              <h3 className="bp-row-title">{item.title}</h3>
              <p className="bp-meta">
                <span className="bp-status" data-status="proposed">
                  {labels.status}
                </span>
                <span className="bp-product">
                  <ProductMark product={item.product} size={10} />
                  {labels.product[item.product] ?? item.product}
                </span>
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
