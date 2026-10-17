'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';
import ColorField, { WIDGET_SWATCHES } from './ColorField';

interface NewWidgetButtonProps {
  /** Muestra el atajo "C" en el botón y lo registra en la página. */
  shortcut?: boolean;
  /** Abre el modal al montar (la ruta /app/chat/widgets/new). */
  defaultOpen?: boolean;
  /** A dónde volver si se cierra sin crear (cuando el modal es la página). */
  closeHref?: string;
  /** Botón secundario en vez de primario (cuando la página ya tiene su acción principal). */
  secondary?: boolean;
}

/**
 * Crear un widget es nombre y color en un modal; al crear lleva al editor,
 * donde está el código para pegar y el resto (bienvenida, formulario, bot,
 * horario) en pestañas. /app/chat/widgets/new abre este mismo modal.
 */
export default function NewWidgetButton({
  shortcut = true,
  defaultOpen = false,
  closeHref,
  secondary = false,
}: NewWidgetButtonProps) {
  const t = useTranslations('chat');
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState('');
  const [color, setColor] = useState(WIDGET_SWATCHES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useKeyShortcut('c', () => setOpen(true), shortcut && !open);

  const close = () => {
    setOpen(false);
    setError(null);
    if (closeHref) router.replace(closeHref);
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
      <button
        type="button"
        className={`btn ${secondary ? 'btn-secondary' : 'btn-primary'}`}
        onClick={() => setOpen(true)}
        aria-keyshortcuts={shortcut ? 'c' : undefined}
      >
        {t('overview.newWidget')}
        {shortcut && <kbd className="kbd">C</kbd>}
      </button>
      <QuickModal
        open={open}
        onClose={close}
        title={t('overview.newWidget')}
        onSubmit={create}
        submitLabel={t('widgetForm.create')}
        cancelLabel={t('common.cancel')}
        submitDisabled={!name.trim()}
        busy={busy}
        error={error}
        hint={t('quick.hint')}
        width={480}
      >
        <div className="ui-fields">
          <div className="ui-field">
            <label className="label" htmlFor="new-widget-name">
              {t('widgetForm.name')}
            </label>
            <input
              id="new-widget-name"
              className="input"
              data-autofocus
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('quick.widgetPlaceholder')}
            />
          </div>
          <div className="ui-field">
            <span className="label" id="new-widget-color">
              {t('widgetForm.color')}
            </span>
            <ColorField labelId="new-widget-color" value={color} onChange={setColor} />
          </div>
          <p className="ui-help">{t('quick.widgetNote')}</p>
        </div>
      </QuickModal>
    </>
  );
}
