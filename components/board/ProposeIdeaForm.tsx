'use client';

import { useEffect, useState, type FormEvent } from 'react';
import BoardVote, { type BoardVoteLabels } from './BoardVote';
import { PRODUCT_KEYS, type ProductKey } from '@/lib/product-taxonomy';
import { ROADMAP_VOTABLE_STATUSES } from '@/lib/roadmap-constants';

interface Similar {
  id: string;
  ref: string;
  title: string;
  status: string;
  votes: number;
  voted: boolean;
}

/**
 * Proponer una idea. Mientras se escribe el título se buscan ítems parecidos
 * para votar en vez de duplicar. Honeypot + rate limit en la API.
 */
export default function ProposeIdeaForm({
  locale,
  itemBase,
  defaultProduct,
  loginHref,
  labels,
}: {
  locale: string;
  /** Prefijo de los links a ítems (…/i). */
  itemBase: string;
  defaultProduct: ProductKey;
  loginHref: string;
  labels: {
    titleLabel: string;
    titlePlaceholder: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    productLabel: string;
    submit: string;
    sending: string;
    similarTitle: string;
    similarHint: string;
    moderation: string;
    errorInvalid: string;
    errorRate: string;
    errorGeneric: string;
    status: Record<string, string>;
    product: Record<string, string>;
    vote: BoardVoteLabels;
  };
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [product, setProduct] = useState<ProductKey>(defaultProduct);
  const [website, setWebsite] = useState('');
  const [similar, setSimilar] = useState<Similar[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const text = `${title} ${description.slice(0, 200)}`.trim();
    if (text.length < 4) {
      setSimilar([]);
      return;
    }
    const ctrl = new AbortController();
    const id = setTimeout(() => {
      fetch(`/api/board/items?similar=${encodeURIComponent(text)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { items?: Similar[] } | null) => setSimilar(d?.items ?? []))
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [title, description]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (title.trim().length < 6) {
      setError(labels.errorInvalid);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch('/api/board/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, description, product, website, locale }),
    }).catch(() => null);
    if (res?.status === 401) {
      window.location.href = loginHref;
      return;
    }
    const data = res?.ok ? ((await res.json().catch(() => null)) as { item?: { ref: string } } | null) : null;
    if (data?.item) {
      window.location.href = `${itemBase}/${data.item.ref}`;
      return;
    }
    if (res?.ok) {
      // Honeypot: respuesta OK sin ítem.
      setBusy(false);
      return;
    }
    setError(res?.status === 429 ? labels.errorRate : res?.status === 400 ? labels.errorInvalid : labels.errorGeneric);
    setBusy(false);
  }

  return (
    <div className="bp-propose">
      <form className="bp-form" onSubmit={submit} noValidate>
        <label className="bp-field">
          <span className="label">{labels.titleLabel}</span>
          <input
            className="input"
            value={title}
            maxLength={140}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={labels.titlePlaceholder}
            required
            autoFocus
          />
        </label>
        <label className="bp-field">
          <span className="label">{labels.descriptionLabel}</span>
          <textarea
            className="textarea"
            rows={6}
            maxLength={4000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={labels.descriptionPlaceholder}
          />
        </label>
        <label className="bp-field">
          <span className="label">{labels.productLabel}</span>
          <select className="select" value={product} onChange={(e) => setProduct(e.target.value as ProductKey)}>
            {PRODUCT_KEYS.map((p) => (
              <option key={p} value={p}>
                {labels.product[p]}
              </option>
            ))}
          </select>
        </label>
        <div className="bp-hp" aria-hidden="true">
          <label>
            Website
            <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </label>
        </div>
        {error && (
          <p className="bp-error" role="alert">
            {error}
          </p>
        )}
        <div>
          <button type="submit" className="btn btn-solid btn-small" disabled={busy}>
            {busy ? labels.sending : labels.submit}
          </button>
        </div>
        <p className="bp-hint">{labels.moderation}</p>
      </form>

      <aside className="bp-similar" aria-live="polite">
        <h2>{labels.similarTitle}</h2>
        {similar.length === 0 ? (
          <p className="bp-hint">{labels.similarHint}</p>
        ) : (
          similar.map((s) => (
            <div key={s.id} className="bp-similar-item">
              <BoardVote
                id={s.id}
                votes={s.votes}
                voted={s.voted}
                closed={!ROADMAP_VOTABLE_STATUSES.includes(s.status)}
                signedIn
                loginHref={loginHref}
                locale={locale}
                labels={labels.vote}
              />
              <div>
                <p className="bp-similar-title">
                  <a href={`${itemBase}/${s.ref}`}>{s.title}</a>
                </p>
                <p className="bp-meta">
                  <span className="bp-status" data-status={s.status}>
                    {labels.status[s.status] ?? s.status}
                  </span>
                </p>
              </div>
            </div>
          ))
        )}
      </aside>
    </div>
  );
}
