'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

interface Ask {
  title: ReactNode;
  body?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
}

/**
 * confirm() con el modal de la app: `ask` abre el diálogo y resuelve true/false.
 * El foco vuelve al elemento que lo abrió.
 */
export function useConfirm(): [ReactNode, (opts: Ask) => Promise<boolean>] {
  const t = useTranslations('agents');
  const [state, setState] = useState<Ask | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const ask = useCallback((opts: Ask) => {
    opener.current = (document.activeElement as HTMLElement | null) ?? null;
    setState(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (v: boolean) => {
    setState(null);
    resolver.current?.(v);
    resolver.current = null;
    window.setTimeout(() => opener.current?.focus(), 0);
  };

  const node = (
    <ConfirmDialog
      open={state !== null}
      title={state?.title ?? ''}
      body={state?.body}
      confirmLabel={state?.confirmLabel ?? ''}
      cancelLabel={t('qa.cancel')}
      danger={state?.danger}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  );
  return [node, ask];
}
