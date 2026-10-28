'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  DEFAULT_QR_STYLE,
  hasEnoughContrast,
  QR_DOTS,
  QR_FRAMES,
  QR_LABEL_MAX,
  qrSvgSize,
  renderQrSvg,
  type QrStyle,
} from '@/lib/link-qr-render';
import FormSection from '@/components/ui/FormSection';
import LinkIcon from './LinkIcon';

interface QrSectionProps {
  id: string;
  slug: string;
}

const MAX_LOGO_BYTES = 200 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function download(href: string, filename: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

interface QrTemplate {
  id: string;
  name: string;
  style: QrStyle;
}

/** QR con marca: colores, módulos, logo, marco y plantillas del workspace. Vista previa en vivo y descarga SVG/PNG. */
export default function QrSection({ id, slug }: QrSectionProps) {
  const t = useTranslations('link');
  const [target, setTarget] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [style, setStyle] = useState<QrStyle>(DEFAULT_QR_STYLE);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<QrTemplate[] | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateMsg, setTemplateMsg] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/links/qr-templates')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { templates: QrTemplate[] } | null) => !cancelled && setTemplates(d?.templates ?? []))
      .catch(() => !cancelled && setTemplates([]));
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveTemplate() {
    const name = templateName.trim();
    if (!name) return;
    setSavingTemplate(true);
    setTemplateMsg(null);
    const res = await fetch('/api/links/qr-templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, style }),
    }).catch(() => null);
    setSavingTemplate(false);
    const data = (await res?.json().catch(() => null)) as { template?: QrTemplate; error?: string } | null;
    if (res?.ok && data?.template) {
      setTemplates((prev) => [...(prev ?? []), data.template!]);
      setTemplateName('');
      setTemplateMsg({ kind: 'info', text: t('qr.templateSaved', { name }) });
    } else {
      setTemplateMsg({ kind: 'error', text: data?.error === 'template_limit' ? t('qr.templateLimit') : t('errors.generic') });
    }
  }

  async function removeTemplate(tpl: QrTemplate) {
    setTemplateMsg(null);
    const res = await fetch(`/api/links/qr-templates/${tpl.id}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) setTemplates((prev) => (prev ?? []).filter((x) => x.id !== tpl.id));
    else setTemplateMsg({ kind: 'error', text: t(res?.status === 403 ? 'errors.forbidden' : 'errors.generic') });
  }

  // El estilo se carga una vez por link; el destino se vuelve a pedir cuando
  // cambia el slug (renombrar y guardar hace router.refresh con el mismo id):
  // si no, la vista previa y las descargas seguirían con el slug viejo.
  const styleLoadedFor = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    fetch(`/api/links/${id}/qr?format=json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { style: QrStyle; target: string } | null) => {
        if (cancelled) return;
        if (!data) {
          setLoadFailed(true);
          return;
        }
        setTarget(data.target);
        if (styleLoadedFor.current !== id) {
          styleLoadedFor.current = id;
          setStyle(data.style);
        }
      })
      .catch(() => !cancelled && setLoadFailed(true));
    return () => {
      cancelled = true;
    };
  }, [id, slug]);

  const svg = useMemo(() => (target ? renderQrSvg(target, style) : null), [target, style]);
  const svgUrl = useMemo(() => (svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null), [svg]);

  function update(patch: Partial<QrStyle>) {
    setStyle((s) => ({ ...s, ...patch }));
  }

  function onLogo(file: File | undefined) {
    setLogoError(null);
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) return setLogoError(t('qr.logoType'));
    if (file.size > MAX_LOGO_BYTES) return setLogoError(t('qr.logoTooBig'));
    const reader = new FileReader();
    reader.onload = () => update({ logo: String(reader.result) });
    reader.readAsDataURL(file);
  }

  async function save(): Promise<string | void> {
    const res = await fetch(`/api/links/${id}/qr`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(style),
    }).catch(() => null);
    if (!res?.ok) return t('errors.generic');
  }

  function downloadPng() {
    if (!svgUrl) return;
    const img = new Image();
    img.onload = () => {
      // Con marco y texto el QR es más alto que ancho: se respeta la proporción.
      const dims = svg ? qrSvgSize(svg) : { width: 1, height: 1 };
      const width = 1024;
      const height = Math.round((width * dims.height) / dims.width);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, width, height);
      download(canvas.toDataURL('image/png'), `${slug}-qr.png`);
    };
    img.src = svgUrl;
  }

  const lowContrast = !hasEnoughContrast(style.fg, style.bg);

  return (
    <div className="lk-qr">
      <div className="lk-qr-preview">
        <div className="lk-qr-plate" role="img" aria-label={t('qr.previewAria')} data-testid="qr-preview">
          {svg ? (
            // SVG armado en el cliente con nuestra propia URL corta; el logo es un data URL raster validado.
            <div dangerouslySetInnerHTML={{ __html: svg }} />
          ) : loadFailed ? (
            <p className="ui-error">{t('qr.loadError')}</p>
          ) : (
            <span className="ui-skeleton lk-qr-skeleton" aria-hidden="true" />
          )}
        </div>
        <div className="lk-qr-downloads">
          <button type="button" className="btn btn-sm" disabled={!svgUrl} onClick={() => svgUrl && download(svgUrl, `${slug}-qr.svg`)}>
            <LinkIcon name="download" size={14} />
            {t('detail.downloadSvg')}
          </button>
          <button type="button" className="btn btn-sm" disabled={!svgUrl} onClick={downloadPng}>
            <LinkIcon name="download" size={14} />
            {t('detail.downloadPng')}
          </button>
        </div>
        {target && <p className="ui-help lk-qr-note">{t('qr.scansNote', { url: target })}</p>}
      </div>

      <FormSection title={t('qr.design')} description={t('qr.designDesc')} onSubmit={save} submitLabel={t('qr.save')} className="lk-form">
        {templates && templates.length > 0 && (
          <div className="ui-field">
            <span className="label" id="qr-templates-label">
              {t('qr.templates')}
            </span>
            <ul className="lk-qr-templates" aria-labelledby="qr-templates-label" data-testid="qr-templates">
              {templates.map((tpl) => (
                <li key={tpl.id} className="lk-qr-template">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setStyle({ ...DEFAULT_QR_STYLE, ...tpl.style });
                      setTemplateMsg({ kind: 'info', text: t('qr.templateApplied', { name: tpl.name }) });
                    }}
                  >
                    <span className="lk-qr-swatch" style={{ background: tpl.style.fg, borderColor: tpl.style.bg }} aria-hidden="true" />
                    {tpl.name}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost btn-icon"
                    aria-label={t('qr.templateDelete', { name: tpl.name })}
                    title={t('qr.templateDelete', { name: tpl.name })}
                    onClick={() => removeTemplate(tpl)}
                  >
                    <LinkIcon name="trash" size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {templateMsg && (
          <p className={templateMsg.kind === 'error' ? 'ui-error' : 'ui-help'} role={templateMsg.kind === 'error' ? 'alert' : 'status'}>
            {templateMsg.text}
          </p>
        )}

        <div className="ui-fields-2">
          <div className="ui-field">
            <label className="label" htmlFor="qr-fg">
              {t('qr.fg')}
            </label>
            <span className="lk-color">
              <input id="qr-fg" type="color" value={style.fg} onChange={(e) => update({ fg: e.target.value })} />
              <span className="data">{style.fg}</span>
            </span>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="qr-bg">
              {t('qr.bg')}
            </label>
            <span className="lk-color">
              <input id="qr-bg" type="color" value={style.bg} onChange={(e) => update({ bg: e.target.value })} />
              <span className="data">{style.bg}</span>
            </span>
          </div>
        </div>
        {lowContrast && <p className="ui-error">{t('qr.lowContrast')}</p>}

        <div className="ui-field">
          <label className="label" htmlFor="qr-dots">
            {t('qr.dots')}
          </label>
          <select id="qr-dots" className="select lk-select-auto" value={style.dots} onChange={(e) => update({ dots: e.target.value as QrStyle['dots'] })}>
            {QR_DOTS.map((d) => (
              <option key={d} value={d}>
                {t(d === 'square' ? 'qr.dotsSquare' : d === 'rounded' ? 'qr.dotsRounded' : 'qr.dotsDots')}
              </option>
            ))}
          </select>
        </div>

        <div className="ui-field">
          <span className="label">{t('qr.logo')}</span>
          <div className="lk-qr-logo">
            <label className="btn btn-sm lk-file">
              {style.logo ? t('qr.replaceLogo') : t('qr.uploadLogo')}
              <input type="file" accept={LOGO_TYPES.join(',')} onChange={(e) => onLogo(e.target.files?.[0])} data-testid="qr-logo-input" />
            </label>
            {style.logo && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => update({ logo: null })}>
                {t('qr.removeLogo')}
              </button>
            )}
          </div>
          <p className={logoError ? 'ui-error' : 'ui-help'} role={logoError ? 'alert' : undefined}>
            {logoError ?? t('qr.logoHint')}
          </p>
        </div>

        <div className="ui-fields-2">
          <div className="ui-field">
            <label className="label" htmlFor="qr-frame">
              {t('qr.frame')}
            </label>
            <select
              id="qr-frame"
              className="select lk-select-auto"
              value={style.frame ?? 'none'}
              onChange={(e) => update({ frame: e.target.value as QrStyle['frame'] })}
            >
              {QR_FRAMES.map((f) => (
                <option key={f} value={f}>
                  {t(`qr.frames.${f}`)}
                </option>
              ))}
            </select>
          </div>
          {style.frame === 'label' && (
            <div className="ui-field">
              <label className="label" htmlFor="qr-label">
                {t('qr.label')}
              </label>
              <input
                id="qr-label"
                className="input"
                maxLength={QR_LABEL_MAX}
                value={style.label ?? ''}
                placeholder={t('qr.labelPlaceholder')}
                onChange={(e) => update({ label: e.target.value })}
              />
            </div>
          )}
        </div>

        <div className="ui-field">
          <label className="label" htmlFor="qr-template-name">
            {t('qr.saveTemplate')}
          </label>
          <div className="lk-inline-row">
            <input
              id="qr-template-name"
              className="input"
              maxLength={60}
              value={templateName}
              placeholder={t('qr.templateNamePlaceholder')}
              onChange={(e) => setTemplateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void saveTemplate();
                }
              }}
            />
            <button type="button" className="btn btn-sm" disabled={!templateName.trim() || savingTemplate} onClick={() => void saveTemplate()}>
              {t('qr.saveTemplateButton')}
            </button>
          </div>
          <p className="ui-help">{t('qr.templateHelp')}</p>
        </div>
      </FormSection>
    </div>
  );
}
