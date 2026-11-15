'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import BoardEditor, { BoardLoading } from './BoardEditor';
import { createLocalBoard, NEW_BOARD_VERSION, readLocalBoard, syncLocalBoard, type LocalBoard as LocalRecord } from '@/lib/board-sync';
import type { BoardDetail } from '@/lib/boards-types';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** La pizarra como la vería el editor si ya existiera: vacía y en la versión con la que nace. */
function asDetail(local: LocalRecord): BoardDetail {
  const at = new Date(local.createdAt || Date.now()).toISOString();
  return {
    id: local.id,
    name: local.name,
    thumbnail: null,
    version: NEW_BOARD_VERSION,
    shared: false,
    access: 'workspace',
    created_at: at,
    updated_at: at,
    updated_by: null,
    folder_id: local.folderId,
    scene: { elements: [], appState: {}, files: {} },
    share_token: null,
    my_access: 'manage',
  };
}

type View = { kind: 'loading' } | { kind: 'missing' } | { kind: 'editor'; board: BoardDetail };

/**
 * Pizarra creada sin red (lib/board-sync.ts, LocalBoard). Sin red se dibuja en
 * el editor de siempre y todo queda en el borrador del dispositivo (una recarga
 * lo restaura solo). Con red se crea con su mismo id y se pasa a la pizarra de
 * verdad: un reintento nunca la duplica.
 */
export default function LocalBoard({ locale, meId }: { locale: string; meId: string }) {
  const t = useTranslations('board');
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [created, setCreated] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const idRef = useRef<string | null>(null);
  const creatingRef = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    idRef.current = id;
    const local = id ? readLocalBoard(storage(), id) : null;
    if (!id || !local) {
      // Ya se subió (o nunca estuvo acá): con red, la pizarra de verdad.
      if (id && navigator.onLine) router.replace(`/app/board/${id}`);
      else setView({ kind: 'missing' });
      return;
    }
    if (!navigator.onLine) {
      setView({ kind: 'editor', board: asDetail(local) });
      return;
    }
    let alive = true;
    void syncLocalBoard(storage(), id).then((r) => {
      if (!alive) return;
      if (r === 'synced' || r === 'missing') router.replace(`/app/board/${id}`);
      else {
        setSyncError(r === 'failed');
        setView({ kind: 'editor', board: asDetail(local) });
      }
    });
    return () => {
      alive = false;
    };
  }, [router]);

  /** Antes de cada guardado del editor: la crea una sola vez (los pedidos simultáneos comparten el mismo). */
  const ensureCreated = useCallback((): Promise<boolean> => {
    const id = idRef.current;
    if (!id) return Promise.resolve(false);
    if (!creatingRef.current) {
      creatingRef.current = createLocalBoard(storage(), id).then((r) => {
        if (r.result === 'created' || r.result === 'missing') {
          setCreated(true);
          return true;
        }
        creatingRef.current = null;
        setSyncError(r.result === 'failed');
        return false;
      });
    }
    return creatingRef.current;
  }, []);

  // Volvió la red con la pizarra abierta: se crea ya (aunque no haya nada nuevo que guardar).
  useEffect(() => {
    if (view.kind !== 'editor') return;
    const onOnline = () => void ensureCreated();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [view.kind, ensureCreated]);

  // Ya existe: a la pizarra de verdad (al desmontar, el editor manda lo que falte).
  useEffect(() => {
    if (!created || !idRef.current) return;
    const id = idRef.current;
    const h = setTimeout(() => router.replace(`/app/board/${id}`), 1500);
    return () => clearTimeout(h);
  }, [created, router]);

  if (view.kind === 'loading') return <BoardLoading />;
  if (view.kind === 'missing') {
    return (
      <div className="board-local-missing" data-testid="board-local-missing">
        <EmptyState product="board" title={t('local.missingTitle')} body={t('local.missingBody')} action={{ label: t('editor.back'), href: '/app/board' }} />
      </div>
    );
  }
  const notice = syncError ? (
    <div className="board-notice" role="alert" data-testid="board-local-error">
      <span>{t('local.syncError')}</span>
    </div>
  ) : null;
  return <BoardEditor board={view.board} locale={locale} meId={meId} ensureCreated={ensureCreated} notice={notice} />;
}
