'use client';

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';

const SETS: Array<{ key: string; list: string[] }> = [
  {
    key: 'smileys',
    list: '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😜 🤪 😝 🤗 🤭 🤫 🤔 🤐 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 😴 😷 🤒 🤕 🤢 🥵 🥶 🥴 😵 🤯 🥳 😎 🤓 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 😤 😡 😠 🤬'.split(' '),
  },
  {
    key: 'gestures',
    list: '👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 👏 🙌 👐 🤲 🤝 🙏 💪 ✍️ 👀 🧠 🫶'.split(' '),
  },
  {
    key: 'symbols',
    list: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 ❣️ 💕 💯 ✅ ☑️ ✔️ ❌ ❗ ❓ ⚠️ 🔥 ⭐ 🌟 ✨ ⚡ 🎉 🎊 🎁 🏆 🥇 📌 📎 📅 📞 💬 💡 🔔 ⏰ ⏳ 🚀 💰 🛒 📦 🚚 🏠 ☕ 🍕 🍻 🌞 🌧️'.split(' '),
  },
];

/**
 * Emojis para el composer (como el panel de WhatsApp Web, más corto). Esc
 * cierra, flechas recorren, Enter elige.
 */
export default function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const t = useTranslations('groups.wa');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-emoji-toggle]')) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const all = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button[data-emoji]') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 8, ArrowUp: -8 }[e.key];
    if (step) {
      e.preventDefault();
      all[Math.min(all.length - 1, Math.max(0, i + step))]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }

  return (
    <div className="wa-emoji" role="dialog" aria-label={t('emoji')} ref={ref} onKeyDown={onKey}>
      {SETS.map((s) => (
        <section key={s.key} aria-label={t(`emojiSets.${s.key}`)}>
          <p className="wa-emoji-title">{t(`emojiSets.${s.key}`)}</p>
          <div className="wa-emoji-grid">
            {s.list.map((e) => (
              <button key={e} type="button" data-emoji onClick={() => onPick(e)} aria-label={e}>
                {e}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
