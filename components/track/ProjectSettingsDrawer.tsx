'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import TrackIcon from './TrackIcon';

export type ProjectSettingsTab = 'cycles' | 'statuses' | 'triage';

const TABS: ProjectSettingsTab[] = ['cycles', 'statuses', 'triage'];

interface ProjectSettingsDrawerProps {
  projectName: string;
  initialTab?: ProjectSettingsTab;
  onClose: () => void;
  /** Contenido de cada pestaña (se monta solo la activa). */
  panels: Record<ProjectSettingsTab, ReactNode>;
}

/**
 * Ajustes del proyecto en un drawer (<dialog> modal: foco atrapado, Esc
 * cierra y el foco vuelve al botón que lo abrió). Ciclos, status del
 * workflow y triage, cada uno en su pestaña y fuera de la lista de issues.
 */
export default function ProjectSettingsDrawer({ projectName, initialTab = 'cycles', onClose, panels }: ProjectSettingsDrawerProps) {
  const t = useTranslations('track');
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<ProjectSettingsTab>(initialTab);
  const id = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      opener?.focus?.();
    };
  }, []);

  const onTabKey = (e: React.KeyboardEvent, index: number) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (index + delta + TABS.length) % TABS.length;
    setTab(TABS[next]);
    tabRefs.current[TABS[next]]?.focus();
  };

  return (
    <dialog
      ref={ref}
      className="ui-drawer track-drawer"
      aria-labelledby={`${id}-title`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        // Clic en el telón (fuera del panel) cierra.
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="track-project-drawer"
    >
      <div className="ui-drawer-head">
        <div className="track-drawer-heading">
          <h2 className="ui-drawer-title" id={`${id}-title`}>
            {t('projectSettings.title')}
          </h2>
          <p className="track-drawer-sub">{projectName}</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={onClose}
          aria-label={t('projectSettings.close')}
          data-testid="track-project-drawer-close"
        >
          <TrackIcon name="close" size={16} />
        </button>
      </div>
      <div className="ui-tabs track-drawer-tabs" role="tablist" aria-label={t('projectSettings.title')}>
        {TABS.map((key, i) => (
          <button
            key={key}
            ref={(el) => {
              tabRefs.current[key] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`${id}-panel`}
            tabIndex={tab === key ? 0 : -1}
            className="ui-tab"
            onClick={() => setTab(key)}
            onKeyDown={(e) => onTabKey(e, i)}
            data-testid={`track-settings-tab-${key}`}
          >
            {t(`projectSettings.tabs.${key}`)}
          </button>
        ))}
      </div>
      <div className="ui-drawer-body" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`}>
        {panels[tab]}
      </div>
    </dialog>
  );
}
