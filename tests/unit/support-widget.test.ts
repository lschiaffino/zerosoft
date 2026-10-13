import { afterEach, describe, expect, it } from 'vitest';
import { cleanVisitorIdentity, createChatWidget } from '@/lib/chat-data';
import { supportWidgetId } from '@/lib/support';
import { makeUser } from './helpers';

const { GET } = await import('@/app/api/chat/widget.js/route');

const saved = process.env.SUPPORT_WIDGET_ID;
afterEach(() => {
  if (saved === undefined) delete process.env.SUPPORT_WIDGET_ID;
  else process.env.SUPPORT_WIDGET_ID = saved;
});

describe('widget de soporte', () => {
  it('sin SUPPORT_WIDGET_ID no hay widget; ids raros se descartan', () => {
    delete process.env.SUPPORT_WIDGET_ID;
    expect(supportWidgetId()).toBeNull();
    process.env.SUPPORT_WIDGET_ID = '  ';
    expect(supportWidgetId()).toBeNull();
    process.env.SUPPORT_WIDGET_ID = '"><script>';
    expect(supportWidgetId()).toBeNull();
    process.env.SUPPORT_WIDGET_ID = ' 3f1c2b9e-1111-4a2b-9c3d-123456789abc ';
    expect(supportWidgetId()).toBe('3f1c2b9e-1111-4a2b-9c3d-123456789abc');
  });

  it('widget.js es JS válido y expone identify', async () => {
    const u = await makeUser('w');
    const w = await createChatWidget(u.id, null, { name: 'W' });
    const res = await GET(new Request(`http://x/api/chat/widget.js?id=${w.id}`));
    const src = await res.text();
    expect(() => new Function(src)).not.toThrow();
    expect(src).toContain('zsChat.identify = function');
    expect(src).toContain('/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/');
  });

  it('identidad del visitante: valida email y recorta el nombre', () => {
    expect(cleanVisitorIdentity(' Ana@Example.com ', ' Ana ')).toEqual({ email: 'ana@example.com', name: 'Ana' });
    expect(cleanVisitorIdentity('not-an-email', 'x'.repeat(500))).toEqual({ email: null, name: 'x'.repeat(120) });
    expect(cleanVisitorIdentity(42, null)).toEqual({ email: null, name: null });
  });
});
