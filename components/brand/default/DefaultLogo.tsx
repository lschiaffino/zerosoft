import ZeroMark from '@/components/zero/ZeroMark';
import type { LogoProps } from '../Logo';

/**
 * Logo de la marca default: el cero (ZeroMark) y "zerosoft.ai" en mono.
 * Hereda el color del texto salvo que se pida un tono fijo.
 * `variant="symbol"` es el cero solo.
 */
export default function DefaultLogo({ tone = 'current', height = 22, variant = 'wordmark', title = 'zerosoft.ai', className = '' }: LogoProps) {
  const color = tone === 'ink' ? '#0d0d0d' : tone === 'white' ? '#ffffff' : undefined;
  if (variant === 'symbol') {
    return (
      <span className={`brand-logo brand-logo-default ${className}`.trim()} style={color ? { color } : undefined}>
        <ZeroMark size={height} title={title || undefined} />
      </span>
    );
  }
  const a11y = title ? { role: 'img' as const, 'aria-label': title } : { 'aria-hidden': true as const };
  return (
    <span className={`brand-logo brand-logo-default ${className}`.trim()} style={color ? { color } : undefined} {...a11y}>
      <ZeroMark size={height} />
      <span className="brand-name">zerosoft.ai</span>
    </span>
  );
}
