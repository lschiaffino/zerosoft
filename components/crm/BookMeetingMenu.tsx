'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

export interface MeetingEventType {
  slug: string;
  title: string;
  durationMin: number;
}

interface BookMeetingMenuProps {
  /** Event types activos. Si no se pasan, se fetchean de /api/crm/meeting-links al abrir. */
  eventTypes?: MeetingEventType[];
  /** Pre-fill del invitado en la página pública de booking (?name=&email=). */
  name?: string;
  email?: string;
  locale: string;
}

/**
 * Popover "Book meeting" (paridad HubSpot Meetings): lista los event types de
 * Cal y genera el link público /book/[slug] con pre-fill del contacto.
 */
export default function BookMeetingMenu({ eventTypes, name, email, locale }: BookMeetingMenuProps) {
  const t = useTranslations('crm');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<MeetingEventType[]>(eventTypes ?? []);
  const [loaded, setLoaded] = useState(eventTypes !== undefined);
  const [copied, setCopied] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Esc closes the popover and returns focus to the trigger.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Fetch lazy cuando el server no proveyó la lista (p.ej. RecordPreview).
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    fetch('/api/crm/meeting-links')
      .then((res) => (res.ok ? res.json() : { rows: [] }))
      .then((data: { rows?: MeetingEventType[] }) => {
        if (!cancelled) {
          setItems(Array.isArray(data.rows) ? data.rows : []);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, loaded]);

  function linkFor(slug: string): string {
    const qs = new URLSearchParams();
    if (name) qs.set('name', name);
    if (email) qs.set('email', email);
    const suffix = qs.toString();
    return `/${locale}/book/${slug}${suffix ? `?${suffix}` : ''}`;
  }

  async function copyLink(slug: string) {
    const url = `${window.location.origin}${linkFor(slug)}`;
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      // Fallback para contextos sin clipboard API.
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      ta.remove();
    }
    if (ok) {
      setCopied(slug);
      window.setTimeout(() => setCopied((c) => (c === slug ? null : c)), 1800);
    }
  }

  return (
    <div className="book-meeting" ref={ref}>
      <button
        type="button"
        ref={triggerRef}
        className="btn btn-ghost btn-small"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        {t('meetings.book')}
      </button>
      {open && (
        <div className="book-meeting-menu">
          {items.length === 0 ? (
            <p className="book-meeting-empty muted">
              {loaded ? t('meetings.empty') : t('common.saving')}
            </p>
          ) : (
            items.map((et) => (
              <div key={et.slug} className="book-meeting-item">
                <div className="book-meeting-item-head">
                  <span className="book-meeting-item-title">{et.title}</span>
                  <span className="book-meeting-item-meta muted">
                    {t('meetings.duration', { min: et.durationMin })}
                  </span>
                </div>
                <div className="book-meeting-item-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    onClick={() => copyLink(et.slug)}
                  >
                    {copied === et.slug ? t('meetings.copied') : t('meetings.copyLink')}
                  </button>
                  <a
                    className="btn btn-ghost btn-small"
                    href={linkFor(et.slug)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('meetings.open')} ↗
                  </a>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
