/** Los más usados en WhatsApp: completan "Recientes" mientras la persona todavía no usó suficientes. */
export const DEFAULT_RECENT = ['👍', '❤️', '😂', '🙏', '😊', '😍', '🔥', '🙌', '👏', '🎉', '😅', '🤣', '✅', '💪', '😘', '😁', '👌', '🤔', '😎', '🥰', '😉', '💯', '😢', '😮', '🤝', '👀', '😆', '🥲', '😬', '🫶', '✨', '🚀'];

/** "Recientes" siempre lleno, como WhatsApp: los que usó la persona primero y después los más usados. */
export function recentWithDefaults(recent: string[], max = 32): string[] {
  return [...recent, ...DEFAULT_RECENT.filter((e) => !recent.includes(e))].slice(0, max);
}
