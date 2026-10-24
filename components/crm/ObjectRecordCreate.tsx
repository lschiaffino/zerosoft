'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { usePathname, useRouter } from '@/i18n/navigation';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';
import CustomFieldInput from './CustomFieldInput';
import { readCustomFields, type CustomFieldDef } from './formPayload';

interface ObjectRecordCreateProps {
  objectId: string;
  singular: string;
  primaryLabel: string;
  owners: Array<{ value: string; label: string }>;
  defaultOwner: string;
  /** Propiedades que la persona puede completar. */
  fields: CustomFieldDef[];
  /** Botón del estado vacío (sin atajo ni ?new=1). */
  variant?: 'primary' | 'empty';
}

/** Alta de un registro de objeto propio en un modal: nombre, owner y propiedades. Atajo C y ?new=1. */
export default function ObjectRecordCreate({
  objectId,
  singular,
  primaryLabel,
  owners,
  defaultOwner,
  fields,
  variant = 'primary',
}: ObjectRecordCreateProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [owner, setOwner] = useState(defaultOwner);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const primary = variant === 'primary';
  useKeyShortcut('c', () => setOpen(true), primary && !open);

  useEffect(() => {
    if (!primary || searchParams.get('new') !== '1') return;
    setOpen(true);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('new');
    router.replace(params.size ? `${pathname}?${params}` : pathname);
  }, [primary, searchParams, pathname, router]);

  function close() {
    setOpen(false);
    setName('');
    setError(null);
  }

  async function submit() {
    if (!name.trim() || busy) return;
    const form = bodyRef.current?.closest('form');
    const custom = form ? readCustomFields(new FormData(form), fields) : {};
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/objects/${objectId}/records`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), ownerId: owner || null, custom }),
    }).catch(() => null);
    setBusy(false);
    if (res?.status === 201) {
      const created = (await res.json()) as { id: string };
      close();
      router.push(`${pathname}/${created.id}`);
      router.refresh();
      return;
    }
    const code = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : null;
    setError(code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
  }

  const label = t('objects.newRecord', { singular });
  return (
    <>
      <button type="button" className={primary ? 'btn btn-primary btn-sm' : 'btn btn-primary'} onClick={() => setOpen(true)}>
        {label}
        {primary && (
          <kbd className="kbd" aria-hidden>
            C
          </kbd>
        )}
      </button>
      <QuickModal
        open={open}
        onClose={close}
        title={t('objects.newRecordTitle', { singular })}
        onSubmit={submit}
        submitLabel={busy ? t('common.creating') : t('common.create')}
        cancelLabel={t('common.cancel')}
        submitDisabled={!name.trim()}
        busy={busy}
        error={error}
      >
        <div ref={bodyRef}>
          <input
            data-autofocus
            className="qm-title"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={primaryLabel}
            aria-label={primaryLabel}
            maxLength={200}
          />
          <label className="qm-field">
            <span>{t('objects.owner')}</span>
            <select value={owner} onChange={(e) => setOwner(e.target.value)}>
              {owners.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {fields.length > 0 && (
            <div className="ui-fields-2 obj-create-fields">
              {fields.map((f) => (
                <CustomFieldInput key={f.name} field={f} idPrefix={`obj-${objectId}`} />
              ))}
            </div>
          )}
        </div>
      </QuickModal>
    </>
  );
}
