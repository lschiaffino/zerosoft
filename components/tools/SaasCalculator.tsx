'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { SAAS_TOOLS, yearlyCost } from '@/lib/tools/saas-costs';
import { Field } from './shared';

const DEFAULT_ON = new Set(['hubspot', 'intercom', 'calendly', 'notion', 'linear']);

export default function SaasCalculator() {
  const t = useTranslations('tools.saas');
  const locale = useLocale();
  const [team, setTeam] = useState(10);
  const [rows, setRows] = useState(() =>
    SAAS_TOOLS.map((tool) => ({ id: tool.id, on: DEFAULT_ON.has(tool.id), seats: 10 })),
  );

  const usd = (v: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: v % 1 ? 2 : 0 }).format(v);

  const lines = useMemo(
    () =>
      rows.map((r) => {
        const tool = SAAS_TOOLS.find((x) => x.id === r.id)!;
        return { ...r, tool, yearly: r.on ? yearlyCost(tool, r.seats) : 0 };
      }),
    [rows],
  );
  const total = lines.reduce((a, l) => a + l.yearly, 0);
  const count = lines.filter((l) => l.on).length;

  const applyTeam = (n: number) => {
    setTeam(n);
    setRows((cur) => cur.map((r) => ({ ...r, seats: n })));
  };

  return (
    <div className="tl-split">
      <div className="tl-form">
        <Field label={t('teamSize')} hint={t('teamHint')}>
          <input
            className="input"
            type="number"
            min={1}
            max={10000}
            value={team}
            onChange={(e) => applyTeam(Math.max(1, Math.min(10000, Number(e.target.value) || 1)))}
          />
        </Field>
        <ul className="tl-saas-list">
          {lines.map((l) => (
            <li key={l.id} className={`tl-saas-row${l.on ? ' is-on' : ''}`}>
              <label className="tl-check">
                <input
                  type="checkbox"
                  checked={l.on}
                  onChange={(e) => setRows((cur) => cur.map((r) => (r.id === l.id ? { ...r, on: e.target.checked } : r)))}
                />
                <span className="tl-saas-name">{l.tool.vendor}</span>
              </label>
              <span className="tl-saas-price mono">
                {usd(l.tool.monthly)}
                {l.tool.perUser ? t('perSeat') : t('perMonth')}
              </span>
              {l.tool.perUser ? (
                <input
                  className="input tl-seats"
                  type="number"
                  min={0}
                  aria-label={t('seatsFor', { vendor: l.tool.vendor })}
                  value={l.seats}
                  disabled={!l.on}
                  onChange={(e) =>
                    setRows((cur) => cur.map((r) => (r.id === l.id ? { ...r, seats: Math.max(0, Number(e.target.value) || 0) } : r)))
                  }
                />
              ) : (
                <span className="tl-seats tl-flat mono">{t('flat')}</span>
              )}
              <span className="tl-saas-year mono">{l.on ? usd(l.yearly) : '—'}</span>
            </li>
          ))}
        </ul>
        <p className="tl-hint">{t('listPriceNote')}</p>
      </div>

      <div className="tl-output">
        <div className="tl-result">
          <p className="label">{t('yearlyToday', { count })}</p>
          <p className="tl-big">{usd(total)}</p>
          <p className="tl-sub mono">
            {t('threeYears')} {usd(total * 3)}
          </p>
        </div>
        <div className="tl-result tl-result-zero">
          <p className="label">{t('withZerosoft')}</p>
          <p className="tl-big">{usd(0)}</p>
          <p className="tl-sub">{t('zeroNote')}</p>
        </div>
        <ul className="tl-replace">
          {lines
            .filter((l) => l.on)
            .map((l) => (
              <li key={l.id}>
                <s>{l.tool.vendor}</s> → <strong>{l.tool.replacedBy}</strong>
              </li>
            ))}
        </ul>
        <div className="tl-actions">
          <Link className="btn btn-solid btn-small" href="/app">
            {t('cta')}
          </Link>
          <Link className="btn btn-ghost btn-small" href="/products">
            {t('seeApps')}
          </Link>
        </div>
      </div>
    </div>
  );
}
