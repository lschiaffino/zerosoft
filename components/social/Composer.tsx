'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { AccountDto, PostDto } from '@/lib/social';
import type { LibraryItem } from '@/lib/social';
import { countText, extractTags, NETWORK_SPECS, textFor, validateForNetwork, type MediaItem, type SocialNetwork, type ValidationIssue } from '@/lib/social-networks';
import { api, fmtDateTime, initial, NetworkTag, useErrorText, useIssueText, type ApiError } from './shared';

type When = 'now' | 'schedule' | 'queue' | 'draft';

interface BestTimes {
  source: 'data' | 'default';
  samples: number;
  times: Array<{ weekday: number; hour: number; score: number | null; next: string }>;
}

/** "2026-10-29T14:30" en hora local del navegador. */
function localInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function measure(file: File): Promise<{ width?: number; height?: number; duration?: number }> {
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith('image/')) {
      return await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({});
        img.src = url;
      });
    }
    if (file.type.startsWith('video/')) {
      return await new Promise((resolve) => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => resolve({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
        v.onerror = () => resolve({});
        v.src = url;
      });
    }
    return {};
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Texto con #hashtags, @menciones y links resaltados. */
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/((?:^|\s)[#@][\p{L}\p{N}_.-]+|https?:\/\/\S+)/gu);
  return (
    <>
      {parts.map((p, i) =>
        /^(\s?)[#@]|^https?:\/\//u.test(p) ? (
          <span key={i} className="sc-hl">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function Preview({ account, text, media, firstComment }: { account: AccountDto; text: string; media: MediaItem[]; firstComment: string }) {
  const t = useTranslations('social.compose');
  const spec = NETWORK_SPECS[account.network];
  // LinkedIn y Facebook cortan con "ver más"; el resto muestra hasta el límite.
  const fold = account.network === 'linkedin' ? 210 : account.network === 'facebook' ? 480 : account.network === 'instagram' ? 125 : spec.limit;
  const shown = text.length > fold ? text.slice(0, fold) : text;
  const first = media[0];
  return (
    <div className="sc-preview" data-net={account.network} data-testid={`preview-${account.network}`}>
      <div className="sc-preview-head">
        <span className="sc-avatar" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : initial(account.name)}
        </span>
        <div className="sc-grow">
          <div className="sc-account-name">{account.name}</div>
          <NetworkTag network={account.network} name={`${account.networkName}${account.handle ? ` · @${account.handle.replace(/^@/, '')}` : ''}`} />
        </div>
      </div>
      {account.network === 'youtube' && <strong className="sc-small">{(text.split('\n')[0] || first?.name || '').slice(0, 100)}</strong>}
      {text && (
        <div className="sc-preview-text">
          <Highlighted text={shown} />
          {text.length > fold && <span className="sc-preview-more"> … {t('seeMore')}</span>}
        </div>
      )}
      {first &&
        (first.type === 'video' ? (
          <video className="sc-preview-media" src={first.url} muted playsInline preload="metadata" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="sc-preview-media" src={first.url} alt="" />
        ))}
      {media.length > 1 && <span className="sc-muted sc-small">{t('moreMedia', { n: media.length - 1 })}</span>}
      {firstComment && spec.firstComment && <div className="sc-preview-comment">{t('firstCommentPreview', { text: firstComment.slice(0, 140) })}</div>}
    </div>
  );
}

export default function Composer({
  accounts,
  post,
  library,
  canShorten,
  drafter,
  initialDate,
  initialAccountId,
}: {
  accounts: AccountDto[];
  post: PostDto | null;
  library: LibraryItem[];
  canShorten: boolean;
  drafter: boolean;
  initialDate?: string | null;
  initialAccountId?: string | null;
}) {
  const t = useTranslations('social.compose');
  const tNet = useTranslations('social.networks');
  const locale = useLocale();
  const router = useRouter();
  const errorText = useErrorText();
  const issueText = useIssueText();
  const [text, setText] = useState(post?.text ?? '');
  const [selected, setSelected] = useState<string[]>(post ? post.targets.map((x) => x.accountId) : initialAccountId ? [initialAccountId] : []);
  // Texto propio por red (se guarda para cada cuenta de esa red).
  const [overrides, setOverrides] = useState<Partial<Record<SocialNetwork, string>>>(() => {
    const out: Partial<Record<SocialNetwork, string>> = {};
    for (const tg of post?.targets ?? []) if (tg.textOverride && tg.account) out[tg.account.network] = tg.textOverride;
    return out;
  });
  const [tab, setTab] = useState<'all' | SocialNetwork>('all');
  const [media, setMedia] = useState<MediaItem[]>(post?.media ?? []);
  const [firstComment, setFirstComment] = useState(post?.firstComment ?? '');
  const [when, setWhen] = useState<When>(post?.status === 'draft' || !post ? (initialDate ? 'schedule' : 'schedule') : 'schedule');
  const [at, setAt] = useState(() => localInput(post?.scheduledAt ?? (initialDate ? `${initialDate}T10:00:00` : new Date(Date.now() + 3600_000).toISOString())));
  const [link, setLink] = useState({ url: '', source: '', medium: 'social', campaign: '' });
  const [linkOpen, setLinkOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<Array<{ accountId: string; issues: ValidationIssue[] }>>([]);
  const [queueNext, setQueueNext] = useState<string | null | undefined>(undefined);
  const [best, setBest] = useState<BestTimes | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const chosen = useMemo(() => accounts.filter((a) => selected.includes(a.id)), [accounts, selected]);
  const networks = useMemo(() => [...new Set(chosen.map((a) => a.network))], [chosen]);
  const tags = useMemo(() => extractTags(text), [text]);
  const textOf = (n: SocialNetwork) => textFor(text, overrides[n]);
  const issues = useMemo(
    () => networks.map((n) => ({ network: n, issues: validateForNetwork(n, textFor(text, overrides[n]), media) })).filter((x) => x.issues.length),
    [networks, text, overrides, media],
  );
  const snippets = library.filter((l) => l.kind === 'snippet' || l.kind === 'hashtags');
  const anyFirstComment = networks.some((n) => NETWORK_SPECS[n].firstComment);

  useEffect(() => {
    if (tab !== 'all' && !networks.includes(tab)) setTab('all');
  }, [networks, tab]);

  // Próximo horario de la cola y mejores horarios para las cuentas elegidas.
  useEffect(() => {
    if (!selected.length) {
      setQueueNext(undefined);
      return;
    }
    let live = true;
    api<{ next: string | null }>(`/queue-next?accounts=${selected.join(',')}`)
      .then((r) => live && setQueueNext(r.next))
      .catch(() => live && setQueueNext(null));
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    api<BestTimes>(`/best-times?tz=${encodeURIComponent(tz)}${selected.length === 1 ? `&account=${selected[0]}` : ''}`)
      .then((r) => live && setBest(r))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [selected]);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function insert(snippet: string) {
    const el = textRef.current;
    const editing = tab === 'all' ? text : (overrides[tab] ?? text);
    const pos = el ? el.selectionStart : editing.length;
    const glue = pos > 0 && !/\s$/.test(editing.slice(0, pos)) ? ' ' : '';
    const next = `${editing.slice(0, pos)}${glue}${snippet}${editing.slice(pos)}`;
    if (tab === 'all') setText(next);
    else setOverrides((o) => ({ ...o, [tab]: next }));
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    for (const file of Array.from(files).slice(0, 10)) {
      setBusy('upload');
      try {
        const dims = await measure(file);
        const fd = new FormData();
        fd.set('file', file);
        if (dims.width) fd.set('width', String(dims.width));
        if (dims.height) fd.set('height', String(dims.height));
        if (dims.duration) fd.set('duration', String(dims.duration));
        const item = await api<MediaItem>('/upload', { method: 'POST', body: fd });
        setMedia((m) => [...m, item]);
      } catch (err) {
        setError(errorText(err));
      } finally {
        setBusy(null);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function shorten() {
    if (!link.url.trim()) return;
    setBusy('shorten');
    setError(null);
    try {
      const r = await api<{ shortUrl: string }>('/shorten', {
        method: 'POST',
        json: { url: link.url.trim(), utmSource: link.source || undefined, utmMedium: link.medium || undefined, utmCampaign: link.campaign || undefined },
      });
      insert(r.shortUrl);
      setLink({ url: '', source: '', medium: 'social', campaign: '' });
      setLinkOpen(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function save(action: When) {
    setBusy(action);
    setError(null);
    setServerIssues([]);
    const perAccount: Record<string, string | null> = {};
    for (const a of chosen) perAccount[a.id] = overrides[a.network] && overrides[a.network] !== text ? (overrides[a.network] as string) : null;
    const body = {
      text,
      accountIds: selected,
      overrides: perAccount,
      media,
      firstComment: firstComment || null,
      action,
      scheduledAt: action === 'schedule' && at ? new Date(at).toISOString() : action === 'draft' && at ? new Date(at).toISOString() : null,
    };
    try {
      const saved = post ? await api<PostDto>(`/posts/${post.id}`, { method: 'PATCH', json: body }) : await api<PostDto>('/posts', { method: 'POST', json: body });
      router.push(`/app/social/posts/${saved.id}`);
      router.refresh();
    } catch (err) {
      const e = err as ApiError;
      if (e.code === 'validation' && Array.isArray(e.details)) setServerIssues(e.details as Array<{ accountId: string; issues: ValidationIssue[] }>);
      setError(errorText(err));
      setBusy(null);
    }
  }

  const blocked = issues.length > 0 || !selected.length;
  const primaryLabel = drafter ? t('sendForApproval') : when === 'now' ? t('publishNow') : when === 'queue' ? t('addToQueue') : t('schedule');
  const weekday = (d: number) => new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(Date.UTC(2024, 0, 7 + d)));

  if (!accounts.length) {
    return (
      <div className="ui-empty">
        <p className="ui-empty-title">{t('noAccountsTitle')}</p>
        <p className="ui-empty-body">{t('noAccountsBody')}</p>
      </div>
    );
  }

  return (
    <form
      className="sc-compose"
      onSubmit={(e) => {
        e.preventDefault();
        if (!blocked && !busy) void save(when === 'draft' ? 'schedule' : when);
      }}
    >
      <div className="sc-compose-main">
        <section className="sc-panel" aria-labelledby="sc-accounts-title">
          <h2 id="sc-accounts-title">{t('accounts')}</h2>
          <div className="sc-accounts" role="group" aria-label={t('accounts')}>
            {accounts.map((a) => (
              <button
                key={a.id}
                type="button"
                className="sc-account"
                aria-pressed={selected.includes(a.id)}
                data-expired={a.status !== 'connected'}
                onClick={() => toggle(a.id)}
                title={a.status !== 'connected' ? t('needsReconnect') : undefined}
              >
                <NetworkTag network={a.network} name={a.networkName} />
                <span className="sc-account-name">{a.name}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="sc-panel" aria-labelledby="sc-text-title">
          <div className="sc-row">
            <h2 id="sc-text-title" className="sc-grow">
              {t('text')}
            </h2>
            {snippets.length > 0 && (
              <select className="select" aria-label={t('insertFromLibrary')} value="" onChange={(e) => e.target.value && insert(snippets.find((s) => s.id === e.target.value)?.body ?? '')}>
                <option value="">{t('insertFromLibrary')}</option>
                {snippets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {networks.length > 0 && (
            <div className="ui-tabs" role="tablist" aria-label={t('perNetwork')}>
              <button type="button" role="tab" className="ui-tab" aria-selected={tab === 'all'} onClick={() => setTab('all')}>
                {t('allNetworks')}
              </button>
              {networks.map((n) => (
                <button key={n} type="button" role="tab" className="ui-tab" aria-selected={tab === n} onClick={() => setTab(n)}>
                  {NETWORK_SPECS[n].name}
                  {overrides[n] != null && <span className="ui-tab-count">·</span>}
                </button>
              ))}
            </div>
          )}
          {tab === 'all' ? (
            <textarea
              ref={textRef}
              className="textarea sc-textarea"
              aria-label={t('text')}
              data-testid="compose-text"
              value={text}
              placeholder={t('placeholder')}
              onChange={(e) => setText(e.target.value)}
            />
          ) : overrides[tab] != null ? (
            <>
              <textarea
                ref={textRef}
                className="textarea sc-textarea"
                aria-label={t('textFor', { network: NETWORK_SPECS[tab].name })}
                data-testid={`compose-text-${tab}`}
                value={overrides[tab]}
                onChange={(e) => setOverrides((o) => ({ ...o, [tab]: e.target.value }))}
              />
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOverrides((o) => ({ ...o, [tab]: undefined }))}>
                {t('useCommonText')}
              </button>
            </>
          ) : (
            <div className="sc-row">
              <p className="sc-muted sc-grow">{t('sameAsAll', { network: NETWORK_SPECS[tab].name })}</p>
              <button type="button" className="btn btn-sm" data-testid={`customize-${tab}`} onClick={() => setOverrides((o) => ({ ...o, [tab]: text }))}>
                {t('customize', { network: NETWORK_SPECS[tab].name })}
              </button>
            </div>
          )}
          <div className="sc-counters" aria-live="polite">
            {networks.map((n) => {
              const count = countText(n, textOf(n));
              const limit = NETWORK_SPECS[n].limit;
              return (
                <span key={n} className="sc-counter" data-over={count > limit} data-testid={`counter-${n}`}>
                  {NETWORK_SPECS[n].name} {count}/{limit}
                </span>
              );
            })}
          </div>
          {(tags.hashtags.length > 0 || tags.mentions.length > 0) && (
            <div className="sc-tags" aria-label={t('tags')}>
              {tags.hashtags.map((h) => (
                <span key={`h${h}`} className="sc-tag">
                  #{h}
                </span>
              ))}
              {tags.mentions.map((m) => (
                <span key={`m${m}`} className="sc-tag">
                  @{m}
                </span>
              ))}
            </div>
          )}
          <div className="sc-row">
            <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()} aria-busy={busy === 'upload'} disabled={busy === 'upload'}>
              {t('addMedia')}
            </button>
            <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm" multiple data-testid="compose-file" onChange={(e) => void upload(e.target.files)} />
            {canShorten && (
              <button type="button" className="btn btn-sm" aria-expanded={linkOpen} onClick={() => setLinkOpen((v) => !v)}>
                {t('shortenLink')}
              </button>
            )}
          </div>
          {linkOpen && (
            <div className="ui-fields ui-fields-2">
              <label className="ui-field">
                <span className="label">{t('linkUrl')}</span>
                <input className="input" type="url" value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} placeholder="https://" />
              </label>
              <label className="ui-field">
                <span className="label">utm_source</span>
                <input className="input" value={link.source} onChange={(e) => setLink({ ...link, source: e.target.value })} placeholder={networks[0] ?? 'social'} />
              </label>
              <label className="ui-field">
                <span className="label">utm_medium</span>
                <input className="input" value={link.medium} onChange={(e) => setLink({ ...link, medium: e.target.value })} />
              </label>
              <label className="ui-field">
                <span className="label">utm_campaign</span>
                <input className="input" value={link.campaign} onChange={(e) => setLink({ ...link, campaign: e.target.value })} />
              </label>
              <div>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => void shorten()} aria-busy={busy === 'shorten'} disabled={!link.url.trim() || busy === 'shorten'}>
                  {t('shortenInsert')}
                </button>
              </div>
            </div>
          )}
          {media.length > 0 && (
            <div className="sc-media">
              {media.map((m, i) => (
                <div key={m.url} className="sc-thumb">
                  {m.type === 'video' ? (
                    <video src={m.url} muted preload="metadata" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.url} alt={m.name ?? ''} />
                  )}
                  <button type="button" className="btn btn-sm btn-icon" aria-label={t('removeMedia', { name: m.name ?? '' })} onClick={() => setMedia((all) => all.filter((_, j) => j !== i))}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {anyFirstComment && (
            <label className="ui-field">
              <span className="label">{t('firstComment')}</span>
              <textarea className="textarea" rows={2} value={firstComment} onChange={(e) => setFirstComment(e.target.value)} placeholder={t('firstCommentHint')} />
            </label>
          )}
          {issues.length > 0 && (
            <div role="alert" data-testid="compose-issues">
              {issues.map((x) => (
                <div key={x.network}>
                  <strong className="sc-small">{NETWORK_SPECS[x.network].name}</strong>
                  <ul className="sc-issues">
                    {x.issues.map((i, k) => (
                      <li key={k}>{issueText(i)}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          {serverIssues.length > 0 && issues.length === 0 && (
            <ul className="sc-issues" role="alert">
              {serverIssues.flatMap((s) => s.issues.map((i, k) => <li key={`${s.accountId}${k}`}>{issueText(i)}</li>))}
            </ul>
          )}
        </section>

        <section className="sc-panel sc-when" aria-labelledby="sc-when-title">
          <h2 id="sc-when-title">{t('when')}</h2>
          <div className="sc-when-opts" role="radiogroup" aria-label={t('when')}>
            {(['schedule', 'queue', 'now'] as const).map((w) => (
              <label key={w} className="ui-check">
                <input type="radio" name="when" checked={when === w} onChange={() => setWhen(w)} />
                <span>{t(`when_${w}`)}</span>
              </label>
            ))}
          </div>
          {when === 'schedule' && (
            <>
              <label className="ui-field">
                <span className="label">{t('dateTime')}</span>
                <input className="input" type="datetime-local" data-testid="compose-at" value={at} onChange={(e) => setAt(e.target.value)} />
              </label>
              {best && best.times.length > 0 && (
                <div className="sc-when">
                  <span className="sc-muted sc-small">{best.source === 'data' ? t('bestFromData', { n: best.samples }) : t('bestDefault')}</span>
                  <div className="sc-best">
                    {best.times.map((b) => (
                      <button key={`${b.weekday}-${b.hour}`} type="button" className="btn btn-sm" onClick={() => setAt(localInput(b.next))}>
                        {weekday(b.weekday)} {String(b.hour).padStart(2, '0')}:00
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          {when === 'queue' && (
            <p className="sc-muted" data-testid="queue-next">
              {queueNext === undefined ? t('queuePickAccounts') : queueNext ? t('queueNext', { when: fmtDateTime(queueNext, locale) }) : t('queueEmpty')}
            </p>
          )}
          {drafter && <p className="sc-muted">{t('needsApproval')}</p>}
          {error && (
            <p className="sc-error" role="alert">
              {error}
            </p>
          )}
          <div className="sc-actions">
            <button type="button" className="btn" onClick={() => void save('draft')} aria-busy={busy === 'draft'} disabled={Boolean(busy)}>
              {t('saveDraft')}
            </button>
            <button type="submit" className="btn btn-primary" data-testid="compose-submit" aria-busy={busy !== null && busy !== 'draft'} disabled={blocked || Boolean(busy) || (when === 'queue' && !queueNext)}>
              {primaryLabel}
            </button>
          </div>
        </section>
      </div>

      <aside className="sc-previews" aria-label={t('previews')}>
        {chosen.length === 0 ? (
          <p className="sc-muted">{t('previewEmpty')}</p>
        ) : (
          chosen.map((a) => <Preview key={a.id} account={a} text={textOf(a.network)} media={media} firstComment={firstComment} />)
        )}
        {chosen.some((a) => a.network === 'x') && <p className="sc-muted sc-small">{tNet('xNote')}</p>}
      </aside>
    </form>
  );
}
