/**
 * Widget de Chat propio para soporte (vive en el workspace del equipo, con bot
 * 'ai'). Si SUPPORT_WIDGET_ID no está, no se muestra en ningún lado.
 */
export function supportWidgetId(): string | null {
  const id = process.env.SUPPORT_WIDGET_ID?.trim();
  return id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}
