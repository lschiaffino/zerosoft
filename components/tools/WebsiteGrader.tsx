'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CheckStatus, GradeCategory, GradeResult } from '@/lib/tools/website-grader';

const CATS: readonly GradeCategory[] = ['security', 'performance', 'seo', 'mobile', 'accessibility'];
const MARK: Record<CheckStatus, string> = { pass: '✓', warn: '!', fail: '×' };

function band(score: number): 'good' | 'ok' | 'bad' {
  return score >= 80 ? 'good' : score >= 55 ? 'ok' : 'bad';
}

export default function WebsiteGrader() {
  const t = useTranslations('tools.grader');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GradeResult | null>(null);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tools/grade', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult(null);
        setError(typeof json.error === 'string' ? json.error : 'unreachable');
      } else {
        setResult(json as GradeResult);
      }
    } catch {
      setError('network');
    } finally {
      setLoading(false);
    }
  };

  const errorKey = error && ['invalid_url', 'private_host', 'https_required', 'unreachable', 'timeout', 'not_html', 'http_error', 'rate_limited'].includes(error) ? error : 'network';

  return (
    <div className="tl-grader">
      <form className="tl-grader-form" onSubmit={run}>
        <label className="tl-sr" htmlFor="grader-url">
          {t('urlLabel')}
        </label>
        <input
          id="grader-url"
          className="input"
          inputMode="url"
          autoComplete="url"
          placeholder="https://yourcompany.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <button type="submit" className="btn btn-solid" disabled={loading}>
          {loading ? t('analyzing') : t('submit')}
        </button>
      </form>
      {error && <p className="tl-notice" role="alert">{t(`errors.${errorKey}`)}</p>}
      {loading && <p className="tl-empty mono">{t('analyzingLong')}</p>}

      {result && !loading && (
        <div className="tl-grade" aria-live="polite">
          <div className="tl-grade-top">
            <div className={`tl-score is-${band(result.score)}`}>
              <span className="tl-score-num">{result.score}</span>
              <span className="tl-score-of mono">/100</span>
            </div>
            <div className="tl-grade-meta">
              <p className="tl-row-title">{new URL(result.finalUrl).host}</p>
              <p className="tl-row-sub">{t(`verdict.${band(result.score)}`)}</p>
              {result.pagespeed !== null && (
                <p className="tl-hint">
                  {t('pagespeed')}: <strong>{result.pagespeed}</strong>/100
                </p>
              )}
            </div>
          </div>

          <ul className="tl-cats">
            {result.categories.map((c) => (
              <li key={c.id} className={`tl-cat is-${band(c.score)}`}>
                <span className="tl-cat-name">{t(`categories.${c.id}`)}</span>
                <span className="tl-bar" aria-hidden="true">
                  <span style={{ width: `${c.score}%` }} />
                </span>
                <span className="tl-cat-score mono">{c.score}</span>
              </li>
            ))}
          </ul>

          {CATS.map((cat) => (
            <div key={cat} className="tl-checks-group">
              <h3 className="tl-checks-title">{t(`categories.${cat}`)}</h3>
              <ul>
                {result.checks
                  .filter((c) => c.category === cat)
                  .map((c) => (
                    <li key={c.id} className={`tl-check-row is-${c.status}`}>
                      <span className="tl-mark" aria-label={t(`status.${c.status}`)}>
                        {MARK[c.status]}
                      </span>
                      <div>
                        <p className="tl-check-name">
                          {t(`checks.${c.id}.title`)}
                          {c.value ? <span className="tl-check-value mono"> · {c.value}</span> : null}
                        </p>
                        {c.status !== 'pass' && <p className="tl-check-fix">{t(`checks.${c.id}.fix`)}</p>}
                      </div>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
