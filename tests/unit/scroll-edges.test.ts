import { describe, expect, it } from 'vitest';
import { edgesOf } from '@/components/groups/wa/useScrollEdges';

describe('edgesOf', () => {
  it('dice de qué lado hay más para deslizar', () => {
    expect(edgesOf({ scrollLeft: 0, clientWidth: 300, scrollWidth: 300 })).toEqual({ left: false, right: false });
    expect(edgesOf({ scrollLeft: 0, clientWidth: 300, scrollWidth: 500 })).toEqual({ left: false, right: true });
    expect(edgesOf({ scrollLeft: 100, clientWidth: 300, scrollWidth: 500 })).toEqual({ left: true, right: true });
    expect(edgesOf({ scrollLeft: 200, clientWidth: 300, scrollWidth: 500 })).toEqual({ left: true, right: false });
    // Medio píxel de redondeo no cuenta.
    expect(edgesOf({ scrollLeft: 199.5, clientWidth: 300, scrollWidth: 500 })).toEqual({ left: true, right: false });
  });

  it('en derecha a izquierda (scrollLeft negativo) también', () => {
    expect(edgesOf({ scrollLeft: -200, clientWidth: 300, scrollWidth: 500 })).toEqual({ left: true, right: false });
  });
});
