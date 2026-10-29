'use client';

import { useTranslations } from 'next-intl';
import { DESIGN_FONTS, FONT_WEIGHTS } from '@/lib/design-fonts';
import { FONT_KEYS, SHAPES, zoomCrop, type DesignElement, type FontKey, type ImageEl, type Mask, type ShapeKind } from '@/lib/design-model';
import { ColorField, G, Glyph, Popover } from './ui';
import type { Editor, Patch } from './useEditor';

/**
 * Barra de arriba del lienzo: lo que se puede cambiar de lo elegido (como la
 * barra contextual de Canva). Sin selección, el fondo de la página.
 */
export default function Toolbar({
  ed,
  cropId,
  setCropId,
  onMagic,
  onPickBackgroundImage,
  onReplaceImage,
  readOnly,
}: {
  ed: Editor;
  cropId: string | null;
  setCropId: (id: string | null) => void;
  onMagic: () => void;
  onPickBackgroundImage: () => void;
  onReplaceImage: () => void;
  readOnly: boolean;
}) {
  const t = useTranslations('design.toolbar');
  const sel = ed.page.elements.filter((e) => ed.selectedSet.has(e.id));
  if (readOnly) return <div className="dz-toolbar" role="toolbar" aria-label={t('label')} />;
  const one = sel.length === 1 ? sel[0] : null;
  const allType = (type: DesignElement['type']) => sel.length > 0 && sel.every((e) => e.type === type);
  const patch = (p: Patch | ((el: DesignElement) => Patch | null)) => ed.patchSelected(p);

  if (!sel.length) {
    const bg = ed.page.background;
    return (
      <div className="dz-toolbar" role="toolbar" aria-label={t('label')} data-testid="design-toolbar">
        <span className="dz-tb-label">{t('background')}</span>
        <ColorField label={t('background')} value={bg.color} onChange={(color) => ed.setBackground({ color })} testId="design-bg-color" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={onPickBackgroundImage}>
          {t('bgImage')}
        </button>
        {bg.image && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => ed.setBackground({ image: null })}>
            {t('removeBg')}
          </button>
        )}
      </div>
    );
  }

  const first = sel[0];
  const locked = sel.every((e) => e.locked);
  const opacity = Math.round((first.opacity ?? 1) * 100);

  return (
    <div className="dz-toolbar" role="toolbar" aria-label={t('label')} data-testid="design-toolbar">
      {allType('text') && first.type === 'text' && (
        <>
          <select className="select dz-tb-font" aria-label={t('font')} value={first.font} onChange={(e) => patch({ font: e.target.value as FontKey })} data-testid="design-font">
            {FONT_KEYS.map((k) => (
              <option key={k} value={k}>
                {DESIGN_FONTS[k].label}
              </option>
            ))}
          </select>
          <span className="dz-tb-size">
            <button type="button" className="btn btn-ghost btn-sm dz-tool" aria-label={t('smaller')} onClick={() => patch((el) => (el.type === 'text' ? { size: Math.max(4, Math.round(el.size - 2)) } : null))}>
              <Glyph d={G.minus} />
            </button>
            <input
              className="input dz-tb-num"
              type="number"
              min={4}
              max={2000}
              aria-label={t('size')}
              value={Math.round(first.size)}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 4 && v <= 2000) patch({ size: v });
              }}
              data-testid="design-font-size"
            />
            <button type="button" className="btn btn-ghost btn-sm dz-tool" aria-label={t('bigger')} onClick={() => patch((el) => (el.type === 'text' ? { size: Math.min(2000, Math.round(el.size + 2)) } : null))}>
              <Glyph d={G.plus} />
            </button>
          </span>
          <ColorField label={t('color')} value={first.color} onChange={(color) => patch({ color })} testId="design-text-color" />
          <select className="select dz-tb-weight" aria-label={t('weight')} value={first.weight} onChange={(e) => patch({ weight: Number(e.target.value) })}>
            {FONT_WEIGHTS.map((w) => (
              <option key={w} value={w}>
                {t(`weights.${w}`)}
              </option>
            ))}
          </select>
          <button type="button" className={`btn btn-ghost btn-sm dz-tool${first.weight >= 700 ? ' is-on' : ''}`} aria-pressed={first.weight >= 700} aria-label={t('bold')} title={t('bold')} onClick={() => patch({ weight: first.weight >= 700 ? 400 : 700 })}>
            <Glyph d={G.bold} />
          </button>
          <button type="button" className={`btn btn-ghost btn-sm dz-tool${first.italic ? ' is-on' : ''}`} aria-pressed={!!first.italic} aria-label={t('italic')} title={t('italic')} onClick={() => patch({ italic: !first.italic })}>
            <Glyph d={G.italic} />
          </button>
          <button type="button" className={`btn btn-ghost btn-sm dz-tool${first.underline ? ' is-on' : ''}`} aria-pressed={!!first.underline} aria-label={t('underline')} title={t('underline')} onClick={() => patch({ underline: !first.underline })}>
            <Glyph d={G.underline} />
          </button>
          <button type="button" className={`btn btn-ghost btn-sm dz-tool${first.uppercase ? ' is-on' : ''}`} aria-pressed={!!first.uppercase} aria-label={t('uppercase')} title={t('uppercase')} onClick={() => patch({ uppercase: !first.uppercase })}>
            <Glyph d={G.caps} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm dz-tool"
            aria-label={t('align', { value: t(`aligns.${first.align}`) })}
            title={t('align', { value: t(`aligns.${first.align}`) })}
            onClick={() => patch({ align: first.align === 'left' ? 'center' : first.align === 'center' ? 'right' : 'left' })}
          >
            <Glyph d={first.align === 'left' ? G.alignLeft : first.align === 'center' ? G.alignCenter : G.alignRight} />
          </button>
          <Popover label={t('spacing')} button={<span>{t('spacing')}</span>}>
            {() => (
              <div className="dz-pop-form">
                <label className="dz-range">
                  <span>{t('lineHeight')}</span>
                  <input type="range" min={0.6} max={3} step={0.05} value={first.lineHeight} onChange={(e) => patch({ lineHeight: Number(e.target.value) })} />
                  <span className="data">{first.lineHeight.toFixed(2)}</span>
                </label>
                <label className="dz-range">
                  <span>{t('letterSpacing')}</span>
                  <input type="range" min={-10} max={60} step={0.5} value={first.letterSpacing} onChange={(e) => patch({ letterSpacing: Number(e.target.value) })} />
                  <span className="data">{first.letterSpacing}</span>
                </label>
              </div>
            )}
          </Popover>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onMagic} data-testid="design-magic">
            <Glyph d={G.sparkle} /> {t('magic')}
          </button>
        </>
      )}

      {allType('shape') && first.type === 'shape' && (
        <>
          <select className="select" aria-label={t('shape')} value={first.shape} onChange={(e) => patch({ shape: e.target.value as ShapeKind })}>
            {SHAPES.map((s) => (
              <option key={s} value={s}>
                {t(`shapes.${s}`)}
              </option>
            ))}
          </select>
          <ColorField label={t('fill')} value={first.fill} onChange={(fill) => patch({ fill })} allowTransparent testId="design-fill" />
          <ColorField label={t('stroke')} value={first.stroke} onChange={(stroke) => patch({ stroke })} allowTransparent />
          <label className="dz-tb-inline">
            <span>{t('strokeWidth')}</span>
            <input className="input dz-tb-num" type="number" min={0} max={200} value={Math.round(first.strokeWidth)} onChange={(e) => patch({ strokeWidth: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
          {first.shape === 'rect' && (
            <label className="dz-tb-inline">
              <span>{t('radius')}</span>
              <input className="input dz-tb-num" type="number" min={0} max={10000} value={Math.round(first.radius)} onChange={(e) => patch({ radius: Math.max(0, Number(e.target.value) || 0) })} />
            </label>
          )}
        </>
      )}

      {allType('line') && first.type === 'line' && (
        <>
          <ColorField label={t('stroke')} value={first.stroke} onChange={(stroke) => patch({ stroke })} />
          <label className="dz-tb-inline">
            <span>{t('strokeWidth')}</span>
            <input
              className="input dz-tb-num"
              type="number"
              min={1}
              max={200}
              value={Math.round(first.strokeWidth)}
              onChange={(e) => {
                const v = Math.max(1, Number(e.target.value) || 1);
                patch((el) => (el.type === 'line' ? { strokeWidth: v, h: v, y: el.y + el.h / 2 - v / 2 } : null));
              }}
            />
          </label>
          <select className="select" aria-label={t('dash')} value={first.dash} onChange={(e) => patch({ dash: e.target.value as 'solid' | 'dashed' | 'dotted' })}>
            {(['solid', 'dashed', 'dotted'] as const).map((d) => (
              <option key={d} value={d}>
                {t(`dashes.${d}`)}
              </option>
            ))}
          </select>
          <button type="button" className={`btn btn-ghost btn-sm${first.arrowStart ? ' is-on' : ''}`} aria-pressed={!!first.arrowStart} onClick={() => patch({ arrowStart: !first.arrowStart })}>
            {t('arrowStart')}
          </button>
          <button type="button" className={`btn btn-ghost btn-sm${first.arrowEnd ? ' is-on' : ''}`} aria-pressed={!!first.arrowEnd} onClick={() => patch({ arrowEnd: !first.arrowEnd })}>
            {t('arrowEnd')}
          </button>
        </>
      )}

      {allType('icon') && first.type === 'icon' && (
        <>
          <ColorField label={t('color')} value={first.color} onChange={(color) => patch({ color })} />
          <label className="dz-range dz-tb-inline">
            <span>{t('strokeWidth')}</span>
            <input type="range" min={0.5} max={4} step={0.1} value={first.strokeWidth} onChange={(e) => patch({ strokeWidth: Number(e.target.value) })} />
          </label>
        </>
      )}

      {one && one.type === 'image' && <ImageTools el={one} ed={ed} cropId={cropId} setCropId={setCropId} onReplace={onReplaceImage} />}

      <span className="dz-tb-spacer" />

      <Popover label={t('opacity')} button={<Glyph d={G.opacity} />} align="right">
        {() => (
          <div className="dz-pop-form">
            <label className="dz-range">
              <span>{t('opacity')}</span>
              <input type="range" min={0} max={100} value={opacity} onChange={(e) => ed.patchSelected({ opacity: Number(e.target.value) / 100 })} data-testid="design-opacity" />
              <span className="data">{opacity}%</span>
            </label>
          </div>
        )}
      </Popover>
      <Popover label={t('position')} button={<span>{t('position')}</span>} align="right" testId="design-position">
        {(close) => (
          <div className="dz-pop-grid">
            <p className="dz-pop-h">{t('arrange')}</p>
            {(['forward', 'backward', 'front', 'back'] as const).map((m) => (
              <button key={m} type="button" className="btn btn-ghost btn-sm" onClick={() => ed.zorder(m)}>
                {t(`z.${m}`)}
              </button>
            ))}
            <p className="dz-pop-h">{t('alignTitle')}</p>
            {(['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const).map((m) => (
              <button key={m} type="button" className="btn btn-ghost btn-sm" onClick={() => ed.align(m)} data-testid={`design-align-${m}`}>
                {t(`alignTo.${m}`)}
              </button>
            ))}
            {sel.length >= 3 && (
              <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => ed.distribute('x')}>
                  {t('distributeH')}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    ed.distribute('y');
                    close();
                  }}
                >
                  {t('distributeV')}
                </button>
              </>
            )}
          </div>
        )}
      </Popover>
      {sel.length > 1 && !sel.every((e) => e.groupId && e.groupId === first.groupId) && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={ed.group} data-testid="design-group">
          {t('group')}
        </button>
      )}
      {sel.some((e) => e.groupId) && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={ed.ungroup}>
          {t('ungroup')}
        </button>
      )}
      <button
        type="button"
        className={`btn btn-ghost btn-sm dz-tool${locked ? ' is-on' : ''}`}
        aria-pressed={locked}
        aria-label={locked ? t('unlock') : t('lock')}
        title={locked ? t('unlock') : t('lock')}
        onClick={() => ed.patchSelected({ locked: !locked })}
      >
        <Glyph d={locked ? G.lock : G.unlock} />
      </button>
      <button type="button" className="btn btn-ghost btn-sm dz-tool" aria-label={t('duplicate')} title={t('duplicate')} onClick={ed.duplicate}>
        <Glyph d={G.copy} />
      </button>
      <button type="button" className="btn btn-ghost btn-sm dz-tool" aria-label={t('delete')} title={t('delete')} onClick={ed.deleteSelected} data-testid="design-delete">
        <Glyph d={G.trash} />
      </button>
    </div>
  );
}

function ImageTools({ el, ed, cropId, setCropId, onReplace }: { el: ImageEl; ed: Editor; cropId: string | null; setCropId: (id: string | null) => void; onReplace: () => void }) {
  const t = useTranslations('design.toolbar');
  const cropping = cropId === el.id;
  const zoom = 1 / Math.max(el.crop.w, el.crop.h);
  return (
    <>
      {el.src && (
        <button type="button" className={`btn btn-ghost btn-sm${cropping ? ' is-on' : ''}`} aria-pressed={cropping} onClick={() => setCropId(cropping ? null : el.id)} data-testid="design-crop">
          <Glyph d={G.crop} /> {cropping ? t('cropDone') : t('crop')}
        </button>
      )}
      {cropping && (
        <label className="dz-range dz-tb-inline">
          <span>{t('cropZoom')}</span>
          <input
            type="range"
            min={1}
            max={5}
            step={0.05}
            value={zoom}
            onChange={(e) => {
              const z = Number(e.target.value);
              ed.updateElements([el.id], (x) => (x.type === 'image' ? { ...x, crop: zoomCrop(x.crop, (z * Math.max(x.crop.w, x.crop.h))) } : x));
            }}
          />
        </label>
      )}
      <select className="select" aria-label={t('mask')} value={el.mask} onChange={(e) => ed.patchSelected({ mask: e.target.value as Mask })}>
        {(['none', 'rounded', 'circle'] as const).map((m) => (
          <option key={m} value={m}>
            {t(`masks.${m}`)}
          </option>
        ))}
      </select>
      {el.src && (
        <>
          <button type="button" className="btn btn-ghost btn-sm dz-tool" aria-label={t('flipH')} title={t('flipH')} onClick={() => ed.patchSelected({ flipX: !el.flipX })}>
            <Glyph d={G.flipH} />
          </button>
          <button type="button" className="btn btn-ghost btn-sm dz-tool" aria-label={t('flipV')} title={t('flipV')} onClick={() => ed.patchSelected({ flipY: !el.flipY })}>
            <Glyph d={G.flipV} />
          </button>
        </>
      )}
      <button type="button" className="btn btn-ghost btn-sm" onClick={onReplace}>
        {el.src ? t('replace') : t('fill')}
      </button>
    </>
  );
}
