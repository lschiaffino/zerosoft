'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AiNotice, Field, LANG_OPTIONS, useAiTool, useCopy } from './shared';

/** Selector de idioma de salida (por defecto, el de la página). */
function LanguageField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations('tools.ai');
  return (
    <Field label={t('language')}>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {LANG_OPTIONS.map((l) => (
          <option key={l} value={l}>
            {t(`languages.${l}`)}
          </option>
        ))}
      </select>
    </Field>
  );
}

function AiForm({
  onSubmit,
  loading,
  children,
  submitLabel,
}: {
  onSubmit: () => void;
  loading: boolean;
  children: ReactNode;
  submitLabel: string;
}) {
  const t = useTranslations('tools.ai');
  return (
    <form
      className="tl-form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (!loading) onSubmit();
      }}
    >
      <div className="tl-grid">{children}</div>
      <div className="tl-actions">
        <button type="submit" className="btn btn-solid btn-small" disabled={loading}>
          {loading ? t('generating') : submitLabel}
        </button>
      </div>
      <p className="tl-hint">{t('limitNote')}</p>
    </form>
  );
}

function Placeholder({ loading }: { loading: boolean }) {
  const t = useTranslations('tools.ai');
  return <p className="tl-empty mono">{loading ? t('generating') : t('empty')}</p>;
}

// ---------- Nombres de negocio ----------

interface NamesOut {
  names: Array<{ name: string; tagline: string; domain: string }>;
}

export function BusinessNameGenerator() {
  const t = useTranslations('tools.names');
  const tc = useTranslations('tools.common');
  const locale = useLocale();
  const [keywords, setKeywords] = useState('');
  const [industry, setIndustry] = useState('');
  const [style, setStyle] = useState('modern');
  const [language, setLanguage] = useState(locale);
  const ai = useAiTool<NamesOut>('business-names');
  const { copied, copy } = useCopy();
  const data = ai.result?.status === 'ok' ? ai.result.data : null;

  return (
    <div className="tl-split">
      <AiForm loading={ai.loading} submitLabel={t('submit')} onSubmit={() => ai.run({ keywords, industry, style, language })}>
        <Field label={t('keywords')} hint={t('keywordsHint')} wide>
          <input className="input" required minLength={2} maxLength={160} value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        </Field>
        <Field label={t('industry')}>
          <input className="input" maxLength={160} value={industry} onChange={(e) => setIndustry(e.target.value)} />
        </Field>
        <Field label={t('style')}>
          <select className="select" value={style} onChange={(e) => setStyle(e.target.value)}>
            {(['modern', 'classic', 'playful', 'techy', 'premium'] as const).map((s) => (
              <option key={s} value={s}>
                {t(`styles.${s}`)}
              </option>
            ))}
          </select>
        </Field>
        <LanguageField value={language} onChange={setLanguage} />
      </AiForm>
      <div className="tl-output" aria-live="polite">
        <AiNotice result={ai.result} failed={ai.failed} />
        {data?.names.length ? (
          <ul className="tl-rows">
            {data.names.map((n) => (
              <li key={n.name} className="tl-row">
                <div>
                  <p className="tl-row-title">{n.name}</p>
                  <p className="tl-row-sub">{n.tagline}</p>
                </div>
                <button type="button" className="tl-row-meta mono" onClick={() => copy(n.domain, n.domain)} title={tc('copy')}>
                  {copied === n.domain ? tc('copied') : n.domain}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Placeholder loading={ai.loading} />
        )}
        {data && <p className="tl-hint">{t('domainNote')}</p>}
      </div>
    </div>
  );
}

// ---------- Emails y anuncios ----------

interface CopyOut {
  variants: Array<{ subject: string; preview: string; body: string }>;
}

export function CopyWriter({ mode }: { mode: 'email' | 'ad' }) {
  const t = useTranslations('tools.writer');
  const tc = useTranslations('tools.common');
  const locale = useLocale();
  const [goal, setGoal] = useState('');
  const [audience, setAudience] = useState('');
  const [tone, setTone] = useState('friendly');
  const [points, setPoints] = useState('');
  const [platform, setPlatform] = useState('google');
  const [language, setLanguage] = useState(locale);
  const ai = useAiTool<CopyOut>('copy');
  const { copied, copy } = useCopy();
  const data = ai.result?.status === 'ok' ? ai.result.data : null;

  return (
    <div className="tl-split">
      <AiForm
        loading={ai.loading}
        submitLabel={t(`${mode}.submit`)}
        onSubmit={() => ai.run({ mode, goal, audience, tone, points, platform, language })}
      >
        <Field label={t(`${mode}.goal`)} hint={t(`${mode}.goalHint`)} wide>
          <textarea className="textarea" rows={3} required minLength={3} maxLength={300} value={goal} onChange={(e) => setGoal(e.target.value)} />
        </Field>
        <Field label={t('audience')}>
          <input className="input" maxLength={160} value={audience} onChange={(e) => setAudience(e.target.value)} />
        </Field>
        <Field label={t('tone')}>
          <select className="select" value={tone} onChange={(e) => setTone(e.target.value)}>
            {(['friendly', 'professional', 'persuasive', 'casual', 'urgent'] as const).map((s) => (
              <option key={s} value={s}>
                {t(`tones.${s}`)}
              </option>
            ))}
          </select>
        </Field>
        {mode === 'ad' && (
          <Field label={t('platform')}>
            <select className="select" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="google">Google Ads</option>
              <option value="meta">Meta (Facebook / Instagram)</option>
              <option value="linkedin">LinkedIn</option>
            </select>
          </Field>
        )}
        <LanguageField value={language} onChange={setLanguage} />
        <Field label={t('points')} hint={t('pointsHint')} wide>
          <textarea className="textarea" rows={3} maxLength={600} value={points} onChange={(e) => setPoints(e.target.value)} />
        </Field>
      </AiForm>
      <div className="tl-output" aria-live="polite">
        <AiNotice result={ai.result} failed={ai.failed} />
        {data?.variants.length ? (
          <ol className="tl-variants">
            {data.variants.map((v, i) => {
              const full = mode === 'email' ? `${v.subject}\n\n${v.body}` : `${v.subject}\n${v.preview}\n\n${v.body}`;
              return (
                <li key={i} className="tl-variant">
                  <p className="label">
                    {t('variant')} {i + 1}
                  </p>
                  <p className="tl-variant-subject">
                    <span className="tl-variant-k mono">{t(`${mode}.subject`)}</span> {v.subject}
                  </p>
                  {v.preview && (
                    <p className="tl-variant-preview">
                      <span className="tl-variant-k mono">{t(`${mode}.preview`)}</span> {v.preview}
                    </p>
                  )}
                  <p className="tl-variant-body">{v.body}</p>
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => copy(full, `v${i}`)}>
                    {copied === `v${i}` ? tc('copied') : tc('copy')}
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <Placeholder loading={ai.loading} />
        )}
      </div>
    </div>
  );
}

// ---------- Buyer persona ----------

interface PersonaOut {
  name: string;
  role: string;
  summary: string;
  goals: string[];
  pains: string[];
  objections: string[];
  channels: string[];
  quote: string;
}

export function PersonaGenerator() {
  const t = useTranslations('tools.persona');
  const tc = useTranslations('tools.common');
  const locale = useLocale();
  const [product, setProduct] = useState('');
  const [industry, setIndustry] = useState('');
  const [market, setMarket] = useState('');
  const [language, setLanguage] = useState(locale);
  const ai = useAiTool<PersonaOut>('persona');
  const { copied, copy } = useCopy();
  const p = ai.result?.status === 'ok' ? ai.result.data : null;

  const asText = (x: PersonaOut) =>
    [
      `${x.name} — ${x.role}`,
      x.summary,
      `${t('goals')}:\n${x.goals.map((g) => `- ${g}`).join('\n')}`,
      `${t('pains')}:\n${x.pains.map((g) => `- ${g}`).join('\n')}`,
      `${t('objections')}:\n${x.objections.map((g) => `- ${g}`).join('\n')}`,
      `${t('channels')}: ${x.channels.join(', ')}`,
      `"${x.quote}"`,
    ].join('\n\n');

  return (
    <div className="tl-split">
      <AiForm loading={ai.loading} submitLabel={t('submit')} onSubmit={() => ai.run({ product, industry, market, language })}>
        <Field label={t('product')} hint={t('productHint')} wide>
          <textarea className="textarea" rows={3} required minLength={3} maxLength={300} value={product} onChange={(e) => setProduct(e.target.value)} />
        </Field>
        <Field label={t('industry')}>
          <input className="input" maxLength={160} value={industry} onChange={(e) => setIndustry(e.target.value)} />
        </Field>
        <Field label={t('market')}>
          <input className="input" maxLength={160} value={market} onChange={(e) => setMarket(e.target.value)} />
        </Field>
        <LanguageField value={language} onChange={setLanguage} />
      </AiForm>
      <div className="tl-output" aria-live="polite">
        <AiNotice result={ai.result} failed={ai.failed} />
        {p ? (
          <article className="tl-persona">
            <p className="tl-persona-name">{p.name}</p>
            <p className="tl-row-sub">{p.role}</p>
            <p className="tl-persona-summary">{p.summary}</p>
            {(['goals', 'pains', 'objections'] as const).map((k) => (
              <div key={k} className="tl-persona-block">
                <p className="label">{t(k)}</p>
                <ul>
                  {p[k].map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="tl-persona-block">
              <p className="label">{t('channels')}</p>
              <p>{p.channels.join(' · ')}</p>
            </div>
            <blockquote className="tl-quote">“{p.quote}”</blockquote>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => copy(asText(p), 'persona')}>
              {copied === 'persona' ? tc('copied') : tc('copy')}
            </button>
          </article>
        ) : (
          <Placeholder loading={ai.loading} />
        )}
      </div>
    </div>
  );
}

// ---------- Ideas para el blog ----------

interface BlogOut {
  ideas: Array<{ title: string; angle: string }>;
}

export function BlogIdeasGenerator() {
  const t = useTranslations('tools.blog');
  const tc = useTranslations('tools.common');
  const locale = useLocale();
  const [topic, setTopic] = useState('');
  const [audience, setAudience] = useState('');
  const [language, setLanguage] = useState(locale);
  const ai = useAiTool<BlogOut>('blog-ideas');
  const { copied, copy } = useCopy();
  const data = ai.result?.status === 'ok' ? ai.result.data : null;

  return (
    <div className="tl-split">
      <AiForm loading={ai.loading} submitLabel={t('submit')} onSubmit={() => ai.run({ topic, audience, language })}>
        <Field label={t('topic')} wide>
          <input className="input" required minLength={2} maxLength={160} value={topic} onChange={(e) => setTopic(e.target.value)} />
        </Field>
        <Field label={t('audience')}>
          <input className="input" maxLength={160} value={audience} onChange={(e) => setAudience(e.target.value)} />
        </Field>
        <LanguageField value={language} onChange={setLanguage} />
      </AiForm>
      <div className="tl-output" aria-live="polite">
        <AiNotice result={ai.result} failed={ai.failed} />
        {data?.ideas.length ? (
          <>
            <ol className="tl-rows tl-rows-num">
              {data.ideas.map((idea, i) => (
                <li key={i} className="tl-row">
                  <div>
                    <p className="tl-row-title">{idea.title}</p>
                    <p className="tl-row-sub">{idea.angle}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="tl-actions">
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => copy(data.ideas.map((x, i) => `${i + 1}. ${x.title} — ${x.angle}`).join('\n'), 'all')}
              >
                {copied === 'all' ? tc('copied') : tc('copyAll')}
              </button>
            </div>
          </>
        ) : (
          <Placeholder loading={ai.loading} />
        )}
      </div>
    </div>
  );
}
