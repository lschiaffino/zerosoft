'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { DESIGN_ICON_NAMES, iconPath } from '@/lib/design-icons';
import { DESIGN_FONTS } from '@/lib/design-fonts';
import { makeFrame, makeGrid, makeIcon, makeLine, makeShape, makeText, type GridLayout, type TextKind } from '@/lib/design-factories';
import { resizeDoc, shapePath, SHAPES, type DesignDoc, type DesignElement, type Mask } from '@/lib/design-model';
import type { BrandKit, DesignFileDto } from '@/lib/design';
import PageSvg, { fileHref } from './PageSvg';
import { G, Glyph } from './ui';
import type { Editor } from './useEditor';

export type PanelTab = 'templates' | 'elements' | 'text' | 'uploads' | 'brand' | 'layers';
const TABS: Array<{ key: PanelTab; d: string }> = [
  { key: 'templates', d: G.template },
  { key: 'elements', d: G.shapes },
  { key: 'text', d: G.text },
  { key: 'uploads', d: G.upload },
  { key: 'brand', d: G.brand },
  { key: 'layers', d: G.layers },
];

const GRIDS: GridLayout[] = ['2-cols', '2-rows', '3-cols', '2x2', '1+2', '3x2'];
const MASKS: Mask[] = ['none', 'rounded', 'circle'];

export default function SidePanel({
  ed,
  tab,
  setTab,
  open,
  setOpen,
  uploads,
  uploading,
  uploadError,
  onUpload,
  onInsertFile,
  brand,
  canEditBrand,
  onMagicNew,
  onApplyColor,
}: {
  ed: Editor;
  tab: PanelTab;
  setTab: (t: PanelTab) => void;
  open: boolean;
  setOpen: (o: boolean) => void;
  uploads: DesignFileDto[] | null;
  uploading: boolean;
  uploadError: string | null;
  onUpload: (files: File[]) => void;
  onInsertFile: (f: DesignFileDto) => void;
  brand: BrandKit | null;
  canEditBrand: boolean;
  onMagicNew: () => void;
  onApplyColor: (c: string) => void;
}) {
  const t = useTranslations('design.panel');
  const size = { width: ed.doc.width, height: ed.doc.height };
  const add = (els: DesignElement[]) => ed.addElements(els);

  return (
    <aside className={`dz-side${open ? ' is-open' : ''}`} aria-label={t('label')}>
      <div className="dz-side-tabs" role="tablist" aria-label={t('label')}>
        {TABS.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={open && tab === x.key}
            className={`dz-side-tab${open && tab === x.key ? ' is-active' : ''}`}
            onClick={() => {
              if (open && tab === x.key) setOpen(false);
              else {
                setTab(x.key);
                setOpen(true);
              }
            }}
            data-testid={`design-tab-${x.key}`}
          >
            <Glyph d={x.d} size={18} />
            <span>{t(`tabs.${x.key}`)}</span>
          </button>
        ))}
      </div>
      {open && (
        <div className="dz-side-body" role="tabpanel" aria-label={t(`tabs.${tab}`)}>
          {tab === 'templates' && <TemplatesTab ed={ed} />}
          {tab === 'elements' && (
            <div className="dz-side-sections">
              <section>
                <h3 className="dz-side-h">{t('shapes')}</h3>
                <div className="dz-grid-tiles">
                  {SHAPES.map((s) => (
                    <button key={s} type="button" className="dz-tile" onClick={() => add([makeShape(size, s)])} aria-label={t(`shape.${s}`)} title={t(`shape.${s}`)} data-testid={`design-add-shape-${s}`}>
                      <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
                        <path d={shapePath(s, s === 'arrow' ? 44 : 36, s === 'arrow' ? 26 : 36, 6)} transform={s === 'arrow' ? 'translate(2 11)' : 'translate(6 6)'} fill="currentColor" />
                      </svg>
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <h3 className="dz-side-h">{t('lines')}</h3>
                <div className="dz-grid-tiles">
                  {(['solid', 'dashed', 'arrow'] as const).map((v) => (
                    <button key={v} type="button" className="dz-tile" onClick={() => add([makeLine(size, v)])} aria-label={t(`line.${v}`)} title={t(`line.${v}`)}>
                      <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
                        <path d="M6 24h36" stroke="currentColor" strokeWidth="3" strokeDasharray={v === 'dashed' ? '6 4' : undefined} strokeLinecap="round" fill="none" />
                        {v === 'arrow' && <path d="M34 17l8 7-8 7" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
                      </svg>
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <h3 className="dz-side-h">{t('frames')}</h3>
                <div className="dz-grid-tiles">
                  {MASKS.map((m) => (
                    <button key={m} type="button" className="dz-tile" onClick={() => add([makeFrame(size, m)])} aria-label={t(`frame.${m}`)} title={t(`frame.${m}`)} data-testid={`design-add-frame-${m}`}>
                      <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
                        <path d={m === 'circle' ? shapePath('ellipse', 36, 36) : shapePath('rect', 36, 36, m === 'rounded' ? 6 : 0)} transform="translate(6 6)" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
                      </svg>
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <h3 className="dz-side-h">{t('grids')}</h3>
                <div className="dz-grid-tiles">
                  {GRIDS.map((g) => (
                    <button key={g} type="button" className="dz-tile" onClick={() => add(makeGrid(size, g))} aria-label={t(`grid.${g}`)} title={t(`grid.${g}`)}>
                      <GridGlyph layout={g} />
                    </button>
                  ))}
                </div>
              </section>
              <IconsSection onAdd={(name) => add([makeIcon(size, name)])} />
            </div>
          )}
          {tab === 'text' && (
            <div className="dz-side-sections">
              {(['heading', 'subheading', 'body'] as TextKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`dz-text-add dz-text-add-${k}`}
                  onClick={() => add([makeText(size, k, { text: t(`textDefault.${k}`), font: brand?.fonts[k] ?? null })])}
                  data-testid={`design-add-${k}`}
                >
                  {t(`add.${k}`)}
                </button>
              ))}
              <button type="button" className="btn btn-secondary btn-sm" onClick={onMagicNew} data-testid="design-magic-new">
                <Glyph d={G.sparkle} /> {t('magicWrite')}
              </button>
            </div>
          )}
          {tab === 'uploads' && (
            <UploadsTab uploads={uploads} uploading={uploading} error={uploadError} onUpload={onUpload} onInsert={onInsertFile} />
          )}
          {tab === 'brand' && (
            <div className="dz-side-sections">
              {!brand ? (
                <p className="muted">{t('loading')}</p>
              ) : (
                <>
                  <section>
                    <h3 className="dz-side-h">{t('brandColors')}</h3>
                    {brand.colors.length ? (
                      <div className="dz-swatches">
                        {brand.colors.map((c) => (
                          <button key={c} type="button" className="dz-swatch" style={{ background: c }} aria-label={t('applyColor', { color: c })} title={c} onClick={() => onApplyColor(c)} />
                        ))}
                      </div>
                    ) : (
                      <p className="muted dz-side-note">{t('brandNoColors')}</p>
                    )}
                  </section>
                  <section>
                    <h3 className="dz-side-h">{t('brandFonts')}</h3>
                    {(['heading', 'subheading', 'body'] as TextKind[]).map((k) => {
                      const f = brand.fonts[k];
                      return (
                        <button
                          key={k}
                          type="button"
                          className="dz-brand-font"
                          onClick={() => {
                            const sel = ed.selectedElements().filter((e) => e.type === 'text');
                            if (sel.length && f) ed.patchSelected((el) => (el.type === 'text' ? { font: f } : null));
                            else add([makeText(size, k, { text: t(`textDefault.${k}`), font: f })]);
                          }}
                        >
                          <span className="dz-brand-font-k">{t(`add.${k}`)}</span>
                          <span className="dz-brand-font-v">{f ? DESIGN_FONTS[f].label : t('brandFontUnset')}</span>
                        </button>
                      );
                    })}
                  </section>
                  <section>
                    <h3 className="dz-side-h">{t('brandLogos')}</h3>
                    {brand.logos.length ? (
                      <div className="dz-uploads">
                        {brand.logos.map((f) => (
                          <button key={f.id} type="button" className="dz-upload" onClick={() => onInsertFile(f)} aria-label={t('insert', { name: f.name })}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={fileHref(f.id)} alt="" loading="lazy" />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="muted dz-side-note">{t('brandNoLogos')}</p>
                    )}
                  </section>
                  {canEditBrand && (
                    <Link href="/app/design/brand" className="btn btn-ghost btn-sm">
                      {t('editBrand')}
                    </Link>
                  )}
                </>
              )}
            </div>
          )}
          {tab === 'layers' && <LayersTab ed={ed} />}
        </div>
      )}
    </aside>
  );
}

function GridGlyph({ layout }: { layout: GridLayout }) {
  const cells: Array<[number, number, number, number]> =
    layout === '2-cols'
      ? [[6, 6, 17, 36], [25, 6, 17, 36]]
      : layout === '2-rows'
        ? [[6, 6, 36, 17], [6, 25, 36, 17]]
        : layout === '3-cols'
          ? [[6, 6, 11, 36], [18.5, 6, 11, 36], [31, 6, 11, 36]]
          : layout === '2x2'
            ? [[6, 6, 17, 17], [25, 6, 17, 17], [6, 25, 17, 17], [25, 25, 17, 17]]
            : layout === '1+2'
              ? [[6, 6, 20, 36], [28, 6, 14, 17], [28, 25, 14, 17]]
              : [[6, 6, 11, 17], [18.5, 6, 11, 17], [31, 6, 11, 17], [6, 25, 11, 17], [18.5, 25, 11, 17], [31, 25, 11, 17]];
  return (
    <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
      {cells.map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill="currentColor" opacity={0.35} />
      ))}
    </svg>
  );
}

function IconsSection({ onAdd }: { onAdd: (name: string) => void }) {
  const t = useTranslations('design.panel');
  const [q, setQ] = useState('');
  const names = DESIGN_ICON_NAMES.filter((n) => n.includes(q.trim().toLowerCase()));
  return (
    <section>
      <h3 className="dz-side-h">{t('icons')}</h3>
      <input className="input dz-side-search" type="search" placeholder={t('searchIcons')} aria-label={t('searchIcons')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="dz-grid-tiles dz-icons">
        {names.map((n) => (
          <button key={n} type="button" className="dz-tile" onClick={() => onAdd(n)} aria-label={n} title={n} data-testid={`design-add-icon-${n}`}>
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={iconPath(n) ?? ''} />
            </svg>
          </button>
        ))}
        {!names.length && <p className="muted dz-side-note">{t('noIcons')}</p>}
      </div>
    </section>
  );
}

function UploadsTab({
  uploads,
  uploading,
  error,
  onUpload,
  onInsert,
}: {
  uploads: DesignFileDto[] | null;
  uploading: boolean;
  error: string | null;
  onUpload: (files: File[]) => void;
  onInsert: (f: DesignFileDto) => void;
}) {
  const t = useTranslations('design.panel');
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="dz-side-sections">
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) onUpload(files);
        }}
        data-testid="design-upload-input"
      />
      <button type="button" className="btn btn-primary btn-sm" onClick={() => input.current?.click()} disabled={uploading} data-testid="design-upload">
        {uploading ? t('uploading') : t('upload')}
      </button>
      <p className="muted dz-side-note">{t('uploadHint')}</p>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {uploads === null ? (
        <div className="ui-loading-stack" aria-busy="true">
          <span className="ui-skeleton ui-skeleton-row" />
          <span className="ui-skeleton ui-skeleton-row" />
        </div>
      ) : uploads.length ? (
        <div className="dz-uploads">
          {uploads.map((f) => (
            <button
              key={f.id}
              type="button"
              className="dz-upload"
              onClick={() => onInsert(f)}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('application/x-zs-design-file', JSON.stringify({ id: f.id, width: f.width, height: f.height }))}
              aria-label={t('insert', { name: f.name })}
              data-testid="design-upload-item"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileHref(f.id)} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      ) : (
        <p className="muted dz-side-note">{t('noUploads')}</p>
      )}
    </div>
  );
}

function LayersTab({ ed }: { ed: Editor }) {
  const t = useTranslations('design.panel');
  const els = [...ed.page.elements].reverse();
  const label = (el: DesignElement) => {
    if (el.name) return el.name;
    if (el.type === 'text') return el.text.split('\n')[0].slice(0, 40) || t('layer.text');
    if (el.type === 'shape') return t(`shape.${el.shape}`);
    if (el.type === 'icon') return el.icon;
    if (el.type === 'image') return el.src ? t('layer.image') : t('layer.frame');
    return t('layer.line');
  };
  if (!els.length) return <p className="muted dz-side-note">{t('layersEmpty')}</p>;
  return (
    <ul className="dz-layers" aria-label={t('tabs.layers')} data-testid="design-layers">
      {els.map((el) => {
        const active = ed.selectedSet.has(el.id);
        return (
          <li key={el.id} className={`dz-layer${active ? ' is-active' : ''}${el.hidden ? ' is-hidden' : ''}`}>
            <button type="button" className="dz-layer-name" aria-pressed={active} onClick={(e) => ed.select([el.id], e.shiftKey)}>
              <span className="dz-layer-kind" aria-hidden="true">
                {el.groupId ? '▣' : ''}
              </span>
              {label(el)}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm dz-tool"
              aria-label={el.hidden ? t('show') : t('hide')}
              title={el.hidden ? t('show') : t('hide')}
              onClick={() => ed.updateElements([el.id], (x) => ({ ...x, hidden: !x.hidden }))}
            >
              <Glyph d={el.hidden ? G.eyeOff : G.eye} />
            </button>
            <button
              type="button"
              className={`btn btn-ghost btn-sm dz-tool${el.locked ? ' is-on' : ''}`}
              aria-label={el.locked ? t('unlock') : t('lock')}
              title={el.locked ? t('unlock') : t('lock')}
              onClick={() => ed.updateElements([el.id], (x) => ({ ...x, locked: !x.locked }))}
            >
              <Glyph d={el.locked ? G.lock : G.unlock} />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm dz-tool"
              aria-label={t('up')}
              title={t('up')}
              onClick={() => {
                ed.setSelected([el.id]);
                ed.withPage((p) => {
                  const i = p.elements.findIndex((x) => x.id === el.id);
                  if (i < 0 || i === p.elements.length - 1) return p;
                  const list = [...p.elements];
                  [list[i], list[i + 1]] = [list[i + 1], list[i]];
                  return { ...p, elements: list };
                });
              }}
            >
              <Glyph d={G.up} />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm dz-tool"
              aria-label={t('down')}
              title={t('down')}
              onClick={() => {
                ed.setSelected([el.id]);
                ed.withPage((p) => {
                  const i = p.elements.findIndex((x) => x.id === el.id);
                  if (i <= 0) return p;
                  const list = [...p.elements];
                  [list[i], list[i - 1]] = [list[i - 1], list[i]];
                  return { ...p, elements: list };
                });
              }}
            >
              <Glyph d={G.down} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

interface TemplateItem {
  id: string;
  preset: string;
  name: string;
  doc: DesignDoc;
}

/** Plantillas en el editor: suman sus páginas al diseño (escaladas al tamaño actual). */
function TemplatesTab({ ed }: { ed: Editor }) {
  const t = useTranslations('design.panel');
  const locale = useLocale();
  const [items, setItems] = useState<TemplateItem[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(`/api/design/templates?locale=${locale}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ builtIn: TemplateItem[] }>) : Promise.reject(new Error('load'))))
      .then((d) => alive && setItems(d.builtIn))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [locale]);
  const sorted = useMemo(() => {
    if (!items) return null;
    const ratio = ed.doc.width / ed.doc.height;
    return [...items].sort((a, b) => Math.abs(a.doc.width / a.doc.height - ratio) - Math.abs(b.doc.width / b.doc.height - ratio));
  }, [items, ed.doc.width, ed.doc.height]);
  if (error) return <p className="ui-error">{t('templatesError')}</p>;
  if (!sorted)
    return (
      <div className="ui-loading-stack" aria-busy="true">
        <span className="ui-skeleton ui-skeleton-row" />
        <span className="ui-skeleton ui-skeleton-row" />
      </div>
    );
  return (
    <div className="dz-side-sections">
      <p className="muted dz-side-note">{t('templatesHint')}</p>
      <div className="dz-tpl-grid">
        {sorted.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            className="dz-tpl"
            onClick={() => {
              const scaled = resizeDoc(tpl.doc, ed.doc.width, ed.doc.height);
              ed.addPages(scaled.pages);
            }}
            aria-label={t('addTemplate', { name: tpl.name })}
          >
            <PageSvg doc={tpl.doc} page={tpl.doc.pages[0]} displayWidth={120} className="dz-tpl-svg" />
            <span className="dz-tpl-name">{tpl.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
