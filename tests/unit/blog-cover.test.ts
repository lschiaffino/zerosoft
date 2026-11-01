import { describe, expect, it } from 'vitest';
import { blogCoverSVG } from '@/lib/blog-cover';

describe('blogCoverSVG', () => {
  it('el mismo slug da siempre la misma portada', () => {
    expect(blogCoverSVG('un-post', '#0284c7')).toBe(blogCoverSVG('un-post', '#0284c7'));
  });

  it('slugs distintos dan portadas distintas', () => {
    expect(blogCoverSVG('un-post')).not.toBe(blogCoverSVG('otro-post'));
  });

  it('es liviana y usa el color de la app', () => {
    const svg = blogCoverSVG('un-post', '#0284c7');
    expect(svg.length).toBeLessThan(150_000);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('stroke=');
  });
});
