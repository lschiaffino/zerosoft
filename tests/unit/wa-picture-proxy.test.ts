import { describe, expect, it } from 'vitest';
import { contactPicture } from '@/lib/wa-picture-url';
import { isWaPictureUrl, waPictureResponse } from '@/lib/wa-picture-proxy';

describe('fotos de contactos de WhatsApp: nunca la URL de la CDN al navegador', () => {
  it('la URL para el navegador es nuestra ruta', () => {
    const cdn = 'https://pps.whatsapp.net/v/t61/abc.jpg?oh=1&oe=2';
    const url = contactPicture('groups', 'wac_123', cdn);
    expect(url).toMatch(/^\/api\/groups\/contacts\/wac_123\/picture\?v=[a-z0-9]+$/);
    expect(url).not.toContain('whatsapp.net');
    expect(contactPicture('inbox', 'wac_1', cdn)).toMatch(/^\/api\/inbox\/contacts\/wac_1\/picture/);
    expect(contactPicture('inbox', 'wac_1', '')).toBe('');
  });

  it('el proxy solo baja de la CDN de WhatsApp', async () => {
    expect(isWaPictureUrl('https://pps.whatsapp.net/v/x.jpg')).toBe(true);
    expect(isWaPictureUrl('https://evil.example.com/x.jpg')).toBe(false);
    expect(isWaPictureUrl('http://pps.whatsapp.net/v/x.jpg')).toBe(false);
    expect(isWaPictureUrl('https://whatsapp.net.evil.com/x.jpg')).toBe(false);
    expect(await waPictureResponse('https://169.254.169.254/latest')).toBeNull();
  });
});
