'use client';

import { useTranslations } from 'next-intl';
import { fmtClock, MAX_REC_OVERLAYS, parseClock, REC_OVERLAY_COLORS, REC_OVERLAY_KINDS, type RecOverlay, type RecOverlayKind } from '@/lib/rec-schema';

/**
 * Textos, cajas y flechas sobre el video. Se ven en el reproductor mientras se
 * editan; se guardan con el botón. Los dibuja el reproductor (también en la
 * página compartida y al insertar); el archivo descargado no los lleva.
 */
export default function RecOverlayEditor({
  overlays,
  duration,
  currentAbs,
  busy,
  onChange,
  onSave,
}: {
  overlays: RecOverlay[];
  duration: number;
  currentAbs: () => number;
  busy: boolean;
  onChange: (next: RecOverlay[]) => void;
  onSave: () => void;
}) {
  const t = useTranslations('rec.overlays');
  const tc = useTranslations('rec.common');

  function add(kind: RecOverlayKind) {
    const start = Math.round(currentAbs() * 10) / 10;
    onChange([
      ...overlays,
      {
        id: `o${Date.now().toString(36)}`,
        kind,
        start,
        end: Math.min(duration || start + 5, start + 5),
        x: 0.1,
        y: 0.1,
        w: kind === 'text' || kind === 'link' ? 0.5 : 0.3,
        h: kind === 'text' || kind === 'link' ? 0 : 0.2,
        text: '',
        ...(kind === 'link' ? { url: '' } : {}),
        color: REC_OVERLAY_COLORS[2],
      },
    ]);
  }

  const update = (id: string, patch: Partial<RecOverlay>) => onChange(overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)));

  const slider = (o: RecOverlay, key: 'x' | 'y' | 'w' | 'h', label: string) => (
    <label className="rec-overlay-slider">
      <span className="label">{label}</span>
      <input type="range" min={0} max={100} value={Math.round(o[key] * 100)} onChange={(e) => update(o.id, { [key]: Number(e.target.value) / 100 })} />
    </label>
  );

  return (
    <section className="rec-edit-block" data-testid="rec-overlays">
      <h2 className="rec-h">{t('title')}</h2>
      <p className="ui-help">{t('help')}</p>
      {overlays.length === 0 && <p className="ui-help">{t('empty')}</p>}
      <ul className="rec-overlay-list">
        {overlays.map((o) => (
          <li key={o.id} className="rec-overlay-row" data-testid="rec-overlay-row">
            <div className="rec-overlay-head">
              <span className="label">{t(`kind.${o.kind}`)}</span>
              <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => onChange(overlays.filter((x) => x.id !== o.id))}>
                {t('remove')}
              </button>
            </div>
            {(o.kind === 'text' || o.kind === 'link') && (
              <div className="ui-field">
                <label className="label" htmlFor={`rec-ov-${o.id}`}>
                  {t('text')}
                </label>
                <input id={`rec-ov-${o.id}`} className="input" value={o.text} maxLength={160} onChange={(e) => update(o.id, { text: e.target.value })} data-testid="rec-overlay-text" />
              </div>
            )}
            {o.kind === 'link' && (
              <div className="ui-field">
                <label className="label" htmlFor={`rec-ov-u-${o.id}`}>
                  {t('url')}
                </label>
                <input id={`rec-ov-u-${o.id}`} className="input" value={o.url ?? ''} maxLength={2000} placeholder="https://" inputMode="url" onChange={(e) => update(o.id, { url: e.target.value })} data-testid="rec-overlay-url" />
                <p className="ui-help">{t('urlHelp')}</p>
              </div>
            )}
            <div className="ui-fields ui-fields-2">
              <div className="ui-field">
                <label className="label" htmlFor={`rec-ov-s-${o.id}`}>
                  {t('from')}
                </label>
                <input
                  id={`rec-ov-s-${o.id}`}
                  key={`s${o.start}`}
                  className="input data"
                  defaultValue={fmtClock(o.start)}
                  onBlur={(e) => {
                    const v = parseClock(e.target.value);
                    if (v !== null) update(o.id, { start: v });
                  }}
                />
              </div>
              <div className="ui-field">
                <label className="label" htmlFor={`rec-ov-e-${o.id}`}>
                  {t('to')}
                </label>
                <input
                  id={`rec-ov-e-${o.id}`}
                  key={`e${o.end}`}
                  className="input data"
                  defaultValue={fmtClock(o.end)}
                  onBlur={(e) => {
                    const v = parseClock(e.target.value);
                    if (v !== null) update(o.id, { end: v });
                  }}
                />
              </div>
            </div>
            <div className="rec-overlay-sliders">
              {slider(o, 'x', t('x'))}
              {slider(o, 'y', t('y'))}
              {slider(o, 'w', o.kind === 'arrow' ? t('dx') : t('w'))}
              {o.kind !== 'text' && o.kind !== 'link' && slider(o, 'h', o.kind === 'arrow' ? t('dy') : t('h'))}
            </div>
            <fieldset className="rec-overlay-colors">
              <legend className="label">{t('color')}</legend>
              {REC_OVERLAY_COLORS.map((c) => (
                <label key={c} className="rec-overlay-color" style={{ background: c }}>
                  <input type="radio" className="sr-only" name={`rec-ov-c-${o.id}`} checked={o.color === c} onChange={() => update(o.id, { color: c })} aria-label={t(`colors.${c.slice(1)}`)} />
                  {o.color === c && <span aria-hidden="true" className="rec-overlay-color-on" />}
                </label>
              ))}
            </fieldset>
          </li>
        ))}
      </ul>
      <div className="rec-pane-foot">
        {REC_OVERLAY_KINDS.map((k) => (
          <button key={k} type="button" className="btn btn-secondary btn-sm" disabled={overlays.length >= MAX_REC_OVERLAYS} onClick={() => add(k)} data-testid={`rec-overlay-add-${k}`}>
            {t(`add.${k}`)}
          </button>
        ))}
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={onSave} data-testid="rec-overlays-save">
          {tc('save')}
        </button>
      </div>
    </section>
  );
}
