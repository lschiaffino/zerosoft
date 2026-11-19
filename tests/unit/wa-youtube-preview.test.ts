import { describe, expect, it } from 'vitest';
import { youtubeOembedMeta, youtubeThumbnails, youtubeVideoId } from '@/lib/wa-extras';

describe('vista previa de un video de YouTube', () => {
  it('reconoce el id en las formas de link de un video', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=abcDEF12345',
      'https://youtube.com/watch?v=abcDEF12345&t=42s',
      'https://m.youtube.com/watch?feature=share&v=abcDEF12345',
      'https://youtu.be/abcDEF12345?si=xyz',
      'https://www.youtube.com/shorts/abcDEF12345',
      'https://www.youtube.com/live/abcDEF12345',
      'https://www.youtube.com/embed/abcDEF12345',
      'https://music.youtube.com/watch?v=abcDEF12345',
    ]) {
      expect(youtubeVideoId(url), url).toBe('abcDEF12345');
    }
  });

  it('lo que no es un video no se trata como YouTube', () => {
    for (const url of [
      'https://www.youtube.com/@canal',
      'https://www.youtube.com/playlist?list=PL123',
      'https://www.youtube.com/watch',
      'https://youtube.com.example.test/watch?v=abcDEF12345',
      'https://example.test/watch?v=abcDEF12345',
      'https://youtu.be/',
      'https://www.youtube.com/watch?v=<script>',
      'no es una url',
    ]) {
      expect(youtubeVideoId(url), url).toBe('');
    }
  });

  it('las miniaturas salen solo del dominio de imágenes de YouTube, de mayor a menor', () => {
    const list = youtubeThumbnails('abcDEF12345');
    expect(list).toHaveLength(3);
    expect(list.every((u) => u.startsWith('https://i.ytimg.com/vi/abcDEF12345/'))).toBe(true);
    expect(list[2]).toMatch(/hqdefault\.jpg$/);
  });

  it('oEmbed: título y canal; sin título no hay tarjeta', () => {
    expect(youtubeOembedMeta({ title: '  Un video\n de prueba ', author_name: 'Canal Demo' })).toEqual({ title: 'Un video de prueba', description: 'Canal Demo' });
    expect(youtubeOembedMeta({ title: 'Solo título' })).toEqual({ title: 'Solo título', description: '' });
    expect(youtubeOembedMeta({ author_name: 'Canal' })).toBeNull();
    expect(youtubeOembedMeta('Unauthorized')).toBeNull();
    expect(youtubeOembedMeta(null)).toBeNull();
  });
});
