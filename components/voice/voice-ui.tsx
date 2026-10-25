'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';

export { LevelBars, MicIcon, voiceErrorKey } from './voice-icons';

/** Pestañas de Voice: Reuniones, Dictado y Ajustes. */
export function VoiceNav() {
  const t = useTranslations('voice.nav');
  const pathname = usePathname();
  const items = [
    { href: '/app/voice', label: t('meetings'), active: pathname === '/app/voice' || pathname.startsWith('/app/voice/meetings') },
    { href: '/app/voice/dictation', label: t('dictation'), active: pathname.startsWith('/app/voice/dictation') },
    { href: '/app/voice/settings', label: t('settings'), active: pathname.startsWith('/app/voice/settings') },
  ];
  return (
    <nav className="ui-tabs vc-nav" aria-label={t('label')}>
      {items.map((i) => (
        <Link key={i.href} href={i.href} className="ui-tab" aria-current={i.active ? 'page' : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
