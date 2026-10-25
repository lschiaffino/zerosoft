'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import {
  dismissUndo,
  flushPendingDeletes,
  latestNotice,
  latestRedo,
  latestUndo,
  runRedo,
  runUndo,
  subscribeUndo,
  UNDO_WINDOW_MS,
} from './trackUndo';

const NOTICE_MS = 2500;

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || typeof node.closest !== 'function') return false;
  return node.isContentEditable || Boolean(node.closest('input, textarea, select, [contenteditable="true"]'));
}

/**
 * Toast "Deshacer" de Track y los atajos ⌘Z / ⌘⇧Z (fuera de los campos de
 * texto, donde deshacen lo tipeado). Montado una vez en el layout.
 */
export default function TrackUndoToast() {
  const t = useTranslations('track.ux.undo');
  const entry = useSyncExternalStore(subscribeUndo, latestUndo, () => null);
  const notice = useSyncExternalStore(subscribeUndo, latestNotice, () => null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!notice) return;
    setNow(Date.now());
    const timer = window.setTimeout(() => setNow(Date.now()), NOTICE_MS + 20);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const [mac, setMac] = useState(true);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);

  // El toast se va solo al vencer la ventana.
  useEffect(() => {
    if (!entry || !entry.createdAt) return;
    setNow(Date.now());
    const left = entry.createdAt + UNDO_WINDOW_MS - Date.now();
    if (left <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), left + 20);
    return () => window.clearTimeout(timer);
  }, [entry]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 'z') return;
      if (isTypingTarget(e.target) || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      // ⌘⇧Z rehace, como en Linear.
      if (e.shiftKey) {
        if (!latestRedo()) return;
        e.preventDefault();
        void runRedo();
        return;
      }
      if (!latestUndo()) return;
      e.preventDefault();
      void runUndo();
    };
    const onHide = () => flushPendingDeletes(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pagehide', onHide);
      // Al salir de Track (otra app) se mandan los borrados pendientes.
      flushPendingDeletes(false);
    };
  }, []);

  const visible = entry && entry.createdAt && now - entry.createdAt < UNDO_WINDOW_MS;
  const noticeVisible = notice && now - notice.createdAt < NOTICE_MS && (!visible || !entry || notice.createdAt > entry.createdAt);
  if (noticeVisible && notice) {
    return (
      <div className="ui-toasts track-undo-toasts" role="status" aria-live="polite">
        <div className="ui-toast" data-testid="track-notice">
          <span>{notice.label}</span>
        </div>
      </div>
    );
  }
  if (!visible || !entry) return null;
  return (
    <div className="ui-toasts track-undo-toasts" role="status" aria-live="polite">
      <div className="ui-toast" data-testid="track-undo-toast">
        <span>{entry.label}</span>
        <button
          type="button"
          className="ui-toast-action"
          onClick={() => void runUndo(entry.id)}
          aria-keyshortcuts="Meta+Z Control+Z"
          data-testid="track-undo"
        >
          {t('action')} <kbd className="track-undo-kbd">{mac ? '⌘Z' : 'Ctrl+Z'}</kbd>
        </button>
        <button type="button" className="ui-toast-action track-undo-close" onClick={() => dismissUndo(entry.id)} aria-label={t('dismiss')}>
          ×
        </button>
      </div>
    </div>
  );
}
