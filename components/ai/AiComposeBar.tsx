'use client';

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { COMPOSE_CHANGES, composeErrorKey } from '@/lib/ai-compose';
import { shownDraft } from './compose-machine';
import type { AiCompose } from './useAiCompose';
import '@/styles/ai-compose.css';

/** Lápiz con un destello: escribir con ayuda. Decorativo (el botón lleva el nombre). */
export function PencilSparkle({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 20l1-4.2L15.6 5.2a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.2 19 4 20z" />
      <path d="M13.8 7l3.2 3.2" />
      <path d="M6 2.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Botón que abre la barra. En la fila de íconos del chat es solo el ícono
 * (con nombre accesible y title); en el composer de correo lleva el texto.
 */
export function AiComposeButton({ ai, className, disabled, showLabel = false, size = 20 }: { ai: AiCompose; className: string; disabled?: boolean; showLabel?: boolean; size?: number }) {
  const t = useTranslations('common.aiCompose');
  return (
    <button
      type="button"
      className={className}
      data-testid="ai-compose-open"
      aria-expanded={ai.open}
      aria-label={showLabel ? undefined : t('open')}
      title={t('openHint')}
      disabled={disabled}
      onClick={ai.toggle}
    >
      <PencilSparkle size={size} />
      {showLabel && <span>{t('open')}</span>}
    </button>
  );
}

/**
 * Un botón de la barra. Mientras la AI escribe queda `aria-disabled` (no
 * `disabled`): no hace nada, pero el foco de quien navega con teclado no se
 * pierde.
 */
function Act({ off, onAct, className, children, title, testid }: { off?: boolean; onAct: () => void; className: string; children: ReactNode; title?: string; testid?: string }) {
  return (
    <button
      type="button"
      className={className}
      aria-disabled={off || undefined}
      title={title}
      data-testid={testid}
      onClick={() => {
        if (!off) onAct();
      }}
    >
      {children}
    </button>
  );
}

/**
 * "Ayudame a escribir": la barra pegada al composer. La persona describe el
 * mensaje, lo ve antes de que toque el composer, lo ajusta y lo inserta. Con
 * texto ya escrito en el composer, la barra mejora ese texto. Nunca manda.
 * Cerrada, muestra el aviso de "insertado" con Deshacer mientras haya algo que
 * deshacer.
 *
 * `tone`: 'chat' usa los colores del chat (WhatsApp o zerosoft, claro y
 * oscuro, según el estilo elegido); 'app' usa los de la app (correo, diálogos).
 */
export default function AiComposeBar({ ai, tone = 'chat' }: { ai: AiCompose; tone?: 'chat' | 'app' }) {
  const t = useTranslations('common.aiCompose');
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const { state, open } = ai;

  // Al abrir, el foco va al campo.
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  if (!open) {
    if (ai.undo === null) return null;
    return (
      <p className={`aic-undo aic-${tone}`} role="status" data-testid="ai-compose-undo">
        <span>{t('inserted')}</span>
        <button type="button" className="aic-link" onClick={ai.undoInsert}>
          {t('undo')}
        </button>
      </p>
    );
  }

  const working = state.phase === 'working';
  const hasDraft = state.current !== null;
  const own = ai.composerText.trim() !== '';
  /** El campo describe un cambio (hay un texto sobre el que trabajar) o describe el mensaje. */
  const changing = hasDraft || own;
  const draft = shownDraft(state);
  const langs = ai.adapter.languages ?? [];
  const label = changing ? t('changeLabel') : t('describeLabel');

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      // Un paso por vez: primero corta lo que se está escribiendo; después cierra.
      e.preventDefault();
      e.stopPropagation();
      if (working) ai.cancel();
      else ai.close();
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      ai.insert();
      return;
    }
    // Los atajos de la bandeja (E, R, J, las flechas que cambian de chat...) no corren mientras el foco está en la barra.
    if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
  };

  return (
    <section className={`aic aic-${tone}`} aria-label={t('open')} data-testid="ai-compose" onKeyDown={onKey}>
      <div className="aic-top">
        <div className="aic-field">
          <span className="aic-field-icon">
            <PencilSparkle size={18} />
          </span>
          <label className="sr-only" htmlFor={`${id}-ask`}>
            {label}
          </label>
          <input
            id={`${id}-ask`}
            ref={field}
            className="aic-input"
            type="text"
            autoComplete="off"
            enterKeyHint="go"
            value={ai.prompt}
            maxLength={changing ? 1000 : 2000}
            placeholder={changing ? t('changePlaceholder') : t('describePlaceholder')}
            onChange={(e) => ai.setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                ai.submit();
              }
            }}
          />
          {/* Un solo botón: escribe (o aplica el cambio) y, mientras la AI escribe, la corta. Así el foco no se pierde al cambiar. */}
          <button
            type="button"
            className={`aic-go${working ? ' is-stop' : ''}`}
            aria-disabled={(!working && !ai.prompt.trim()) || undefined}
            aria-label={working ? t('stop') : changing ? t('apply') : t('write')}
            title={working ? t('stop') : changing ? t('apply') : t('write')}
            data-testid={working ? 'ai-compose-stop' : 'ai-compose-go'}
            onClick={() => {
              if (working) ai.cancel();
              else ai.submit();
            }}
          >
            {working ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <rect x="5" y="5" width="14" height="14" rx="1.5" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            )}
          </button>
        </div>
        <button type="button" className="aic-close" onClick={ai.close} aria-label={t('close')} title={t('close')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {state.error && (
        <p className="aic-error" role="alert" data-testid="ai-compose-error">
          {t(`errors.${composeErrorKey(state.error)}`)}
        </p>
      )}

      {!changing && !working && ai.adapter.canSuggest && (
        <div className="aic-row">
          <Act className="aic-chip" onAct={ai.suggest} testid="ai-compose-suggest">
            {t('suggest')}
          </Act>
        </div>
      )}

      {own && !hasDraft && !working && <p className="aic-hint">{t('improveHint')}</p>}

      {(working || hasDraft) && (
        <div className="aic-preview" aria-label={t('preview')} role="group">
          <div className="aic-draft" aria-live="polite" aria-busy={working || undefined} data-testid="ai-compose-draft">
            {draft || <span className="aic-writing">{t('writing')}</span>}
          </div>
          {!working && state.current && state.current.sources.length > 0 && <p className="aic-hint">{t('sources', { list: state.current.sources.join(', ') })}</p>}
        </div>
      )}

      {changing && (
        <div className="aic-row" role="group" aria-label={t('changesLabel')}>
          {COMPOSE_CHANGES.map((c) => (
            <Act key={c} className="aic-chip" off={working} onAct={() => ai.refine(c)}>
              {t(`changes.${c}`)}
            </Act>
          ))}
          {langs.length > 0 && (
            <select
              className="aic-chip aic-select"
              aria-label={t('translateLabel')}
              value=""
              disabled={working}
              onChange={(e) => ai.translate(e.target.value)}
            >
              <option value="">{t('translate')}</option>
              {langs.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {hasDraft && (
        <div className="aic-actions">
          <Act className="btn btn-primary btn-sm" off={working} onAct={ai.insert} title={t('insertHint')} testid="ai-compose-insert">
            {t('insert')}
          </Act>
          <Act className="btn btn-ghost btn-sm" off={working} onAct={ai.regenerate}>
            {t('regenerate')}
          </Act>
          {state.history.length > 0 && (
            <Act
              className="btn btn-ghost btn-sm"
              off={working}
              onAct={() => {
                // Con la última versión anterior, este botón se va: el foco pasa al campo en vez de perderse.
                if (state.history.length === 1) field.current?.focus();
                ai.back();
              }}
            >
              {t('previous')}
            </Act>
          )}
          <Act
            className="btn btn-ghost btn-sm aic-discard"
            onAct={() => {
              // La vista previa se va con sus botones: el foco vuelve al campo, con la descripción para ajustarla.
              field.current?.focus();
              ai.discard();
            }}
          >
            {t('discard')}
          </Act>
        </div>
      )}
    </section>
  );
}
