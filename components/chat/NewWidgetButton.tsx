'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';

const SWATCHES = ['#e23d7f', '#2f6bff', '#0e9f6e', '#f2611d', '#7b4dff', '#0d0d0d'];

interface NewWidgetButtonProps {
  /** Muestra el atajo "C" en el botón y lo registra en la página. */
  shortcut?: boolean;
}

/**
 * Crear un widget sin salir del overview: nombre + color en un modal, y al
 * crear lleva directo a la configuración (donde está el código para pegar).
 * Reemplaza el salto a /app/chat/widgets/new (que sigue existiendo).
 */
export default function NewWidgetButton({ shortcut = true }: NewWidgetButtonProps) {
  const t = useTranslations('chat');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(SWATCHES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useKeyShortcut('c', () => setOpen(true), shortcut && !open);

  const close = () => {
    setOpen(false);
    setError(null);
  };

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/chat/widgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, color }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) {
        setError(t(`errors.${data.error === 'missing_name' ? 'missing_name' : 'generic'}`));
        return;
      }
      router.push(`/app/chat/widgets/${data.id}`);
      router.refresh();
    } catch {
      setError(t('errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-solid btn-small" onClick={() => setOpen(true)}>
        {t('overview.newWidget')}
        {shortcut && <span className="kbd-hint">C</span>}
      </button>
      <QuickModal
        open={open}
        onClose={close}
        crumb={`Chat › ${t('overview.newWidget')}`}
        onSubmit={create}
        submitLabel={t('quick.create')}
        cancelLabel={t('common.cancel')}
        submitDisabled={!name.trim()}
        busy={busy}
        error={error}
        hint={t('quick.hint')}
        width={480}
      >
        <input
          className="qm-title"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('quick.widgetPlaceholder')}
          aria-label={t('widgetForm.name')}
        />
        <div className="qm-field">
          <span>{t('widgetForm.color')}</span>
          <div className="chat-swatches" role="radiogroup" aria-label={t('widgetForm.color')}>
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                className={`chat-swatch${color === c ? ' active' : ''}`}
                style={{ backgroundColor: c }}
                onClick={() => setColor(c)}
              />
            ))}
            <input
              type="color"
              className="chat-swatch-custom"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              aria-label={t('widgetForm.color')}
            />
          </div>
        </div>
        <p className="muted chat-quick-note">{t('quick.widgetNote')}</p>
      </QuickModal>
    </>
  );
}
