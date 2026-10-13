'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import { EMPTY_QR_FIELDS, qrPayload, QR_KINDS, type QrFields, type QrKind } from '@/lib/tools/qr-payload';
import { downloadFile, Field } from './shared';

type Ecc = 'L' | 'M' | 'Q' | 'H';

export default function QrGenerator() {
  const t = useTranslations('tools.qr');
  const [kind, setKind] = useState<QrKind>('url');
  const [f, setF] = useState<QrFields>({ ...EMPTY_QR_FIELDS, url: 'https://zerosoft.ai' });
  const [size, setSize] = useState(512);
  const [fg, setFg] = useState('#0d0d0d');
  const [bg, setBg] = useState('#ffffff');
  const [margin, setMargin] = useState(2);
  const [ecc, setEcc] = useState<Ecc>('M');
  const [svg, setSvg] = useState('');
  const [tooLong, setTooLong] = useState(false);

  const payload = useMemo(() => qrPayload(kind, f), [kind, f]);
  const opts = useMemo(
    () => ({ margin, errorCorrectionLevel: ecc, color: { dark: fg, light: bg } }) as const,
    [margin, ecc, fg, bg],
  );

  useEffect(() => {
    let cancelled = false;
    if (!payload) {
      setSvg('');
      setTooLong(false);
      return;
    }
    QRCode.toString(payload, { ...opts, type: 'svg' })
      .then((s) => {
        if (cancelled) return;
        setSvg(s);
        setTooLong(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSvg('');
        setTooLong(true);
      });
    return () => {
      cancelled = true;
    };
  }, [payload, opts]);

  const set = (k: keyof QrFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((cur) => ({ ...cur, [k]: e.target.value }));

  const downloadPng = async () => {
    if (!payload) return;
    const url = await QRCode.toDataURL(payload, { ...opts, width: size, type: 'image/png' });
    const a = document.createElement('a');
    a.href = url;
    a.download = `qr-${kind}.png`;
    a.click();
  };

  const downloadSvg = async () => {
    if (!payload) return;
    const s = await QRCode.toString(payload, { ...opts, type: 'svg', width: size });
    downloadFile(`qr-${kind}.svg`, s, 'image/svg+xml');
  };

  const lowContrast = fg.toLowerCase() === bg.toLowerCase();

  return (
    <div className="tl-split">
      <form className="tl-form" onSubmit={(e) => e.preventDefault()}>
        <div className="tl-seg" role="tablist" aria-label={t('type')}>
          {QR_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              className={`tl-seg-btn${kind === k ? ' is-on' : ''}`}
              onClick={() => setKind(k)}
            >
              {t(`kinds.${k}`)}
            </button>
          ))}
        </div>

        <div className="tl-grid">
          {kind === 'url' && (
            <Field label={t('fields.url')} wide>
              <input className="input" value={f.url} onChange={set('url')} inputMode="url" placeholder="https://" />
            </Field>
          )}
          {kind === 'text' && (
            <Field label={t('fields.text')} wide>
              <textarea className="textarea" rows={4} value={f.text} onChange={set('text')} />
            </Field>
          )}
          {kind === 'wifi' && (
            <>
              <Field label={t('fields.ssid')}>
                <input className="input" value={f.ssid} onChange={set('ssid')} />
              </Field>
              <Field label={t('fields.password')}>
                <input className="input" value={f.password} onChange={set('password')} disabled={f.security === 'nopass'} />
              </Field>
              <Field label={t('fields.security')}>
                <select className="select" value={f.security} onChange={set('security')}>
                  <option value="WPA">WPA/WPA2/WPA3</option>
                  <option value="WEP">WEP</option>
                  <option value="nopass">{t('fields.open')}</option>
                </select>
              </Field>
              <label className="tl-check">
                <input type="checkbox" checked={f.hidden} onChange={(e) => setF((c) => ({ ...c, hidden: e.target.checked }))} />
                {t('fields.hidden')}
              </label>
            </>
          )}
          {kind === 'vcard' && (
            <>
              <Field label={t('fields.firstName')}>
                <input className="input" value={f.firstName} onChange={set('firstName')} />
              </Field>
              <Field label={t('fields.lastName')}>
                <input className="input" value={f.lastName} onChange={set('lastName')} />
              </Field>
              <Field label={t('fields.org')}>
                <input className="input" value={f.org} onChange={set('org')} />
              </Field>
              <Field label={t('fields.jobTitle')}>
                <input className="input" value={f.jobTitle} onChange={set('jobTitle')} />
              </Field>
              <Field label={t('fields.phone')}>
                <input className="input" value={f.phone} onChange={set('phone')} inputMode="tel" />
              </Field>
              <Field label={t('fields.email')}>
                <input className="input" value={f.email} onChange={set('email')} inputMode="email" />
              </Field>
              <Field label={t('fields.website')} wide>
                <input className="input" value={f.website} onChange={set('website')} inputMode="url" />
              </Field>
            </>
          )}
          {kind === 'email' && (
            <>
              <Field label={t('fields.to')} wide>
                <input className="input" value={f.to} onChange={set('to')} inputMode="email" />
              </Field>
              <Field label={t('fields.subject')} wide>
                <input className="input" value={f.subject} onChange={set('subject')} />
              </Field>
              <Field label={t('fields.body')} wide>
                <textarea className="textarea" rows={3} value={f.body} onChange={set('body')} />
              </Field>
            </>
          )}
        </div>

        <div className="tl-grid tl-grid-opts">
          <Field label={`${t('fields.size')} · ${size}px`}>
            <input type="range" min={128} max={2048} step={64} value={size} onChange={(e) => setSize(Number(e.target.value))} />
          </Field>
          <Field label={`${t('fields.margin')} · ${margin}`}>
            <input type="range" min={0} max={8} step={1} value={margin} onChange={(e) => setMargin(Number(e.target.value))} />
          </Field>
          <Field label={t('fields.fg')}>
            <input type="color" className="tl-color tl-color-wide" value={fg} onChange={(e) => setFg(e.target.value)} />
          </Field>
          <Field label={t('fields.bg')}>
            <input type="color" className="tl-color tl-color-wide" value={bg} onChange={(e) => setBg(e.target.value)} />
          </Field>
          <Field label={t('fields.ecc')} hint={t('hints.ecc')} wide>
            <select className="select" value={ecc} onChange={(e) => setEcc(e.target.value as Ecc)}>
              {(['L', 'M', 'Q', 'H'] as const).map((l) => (
                <option key={l} value={l}>
                  {t(`ecc.${l}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </form>

      <div className="tl-output tl-qr-out">
        <div className="tl-qr-box" aria-live="polite">
          {svg ? (
            // SVG generado localmente por la librería qrcode.
            <div className="tl-qr-svg" role="img" aria-label={t('previewAlt')} dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <p className="tl-empty mono">{tooLong ? t('tooLong') : t('empty')}</p>
          )}
        </div>
        {lowContrast && <p className="tl-notice">{t('lowContrast')}</p>}
        <div className="tl-actions">
          <button type="button" className="btn btn-solid btn-small" disabled={!svg} onClick={downloadPng}>
            {t('downloadPng')}
          </button>
          <button type="button" className="btn btn-ghost btn-small" disabled={!svg} onClick={downloadSvg}>
            {t('downloadSvg')}
          </button>
        </div>
        <p className="tl-hint">{t('staticNote')}</p>
      </div>
    </div>
  );
}
