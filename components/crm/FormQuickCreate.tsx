'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';
import { localizedFormDefaults } from '@/lib/crm-forms-builder';

/** CTA "New form": tecla C y `?new=1` abren el modal; al crear abre el builder. */
export default function FormQuickCreate({ variant = 'head', label }: { variant?: 'head' | 'empty'; label?: string }) {
  const t = useTranslations('crm');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setOpen(true);
      const params = new URLSearchParams(searchParams.toString());
      params.delete('new');
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }, [searchParams, pathname, router]);

  // Solo hay un botón en pantalla (cabecera o estado vacío): ambos atienden C y ?new=1.
  useKeyShortcut('c', () => setOpen(true), !open);

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/crm/forms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Los textos por defecto del form nuevo, en el idioma de quien lo crea.
      body: JSON.stringify({
        name: name.trim(),
        ...localizedFormDefaults({
          submit: t('forms.defaults.submit'),
          success: t('forms.defaults.success'),
          email: t('forms.defaults.email'),
          firstName: t('forms.defaults.firstName'),
          lastName: t('forms.defaults.lastName'),
          emailPlaceholder: t('forms.defaults.emailPlaceholder'),
        }),
      }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      const form = (await res.json()) as { id: string };
      setOpen(false);
      router.push(`/app/crm/forms/${form.id}`);
      return;
    }
    setError(t('errors.generic'));
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => setOpen(true)}
        data-testid="crm-quick-form"
      >
        {label ?? t('forms.new')}
        <kbd className="kbd" aria-hidden="true">
          C
        </kbd>
      </button>
      <QuickModal
        open={open}
        onClose={() => setOpen(false)}
        crumb={`CRM › ${t('forms.new')}`}
        onSubmit={submit}
        submitLabel={busy ? t('common.creating') : t('forms.createSubmit')}
        cancelLabel={t('common.cancel')}
        submitDisabled={!name.trim()}
        busy={busy}
        error={error}
        hint={t('quick.hint')}
      >
        <input
          data-autofocus
          className="qm-title"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('forms.namePlaceholder')}
          aria-label={t('forms.name')}
          maxLength={200}
        />
        <p className="muted qm-note">{t('forms.newHint')}</p>
      </QuickModal>
    </>
  );
}
