'use client';

import { useEffect, useState } from 'react';

type Os = 'mac-arm' | 'mac-intel' | 'win' | 'other';

interface Props {
  links: { macArm64: string | null; macX64: string | null; win: string | null };
  labels: { macArm: string; macIntel: string; win: string; otherMac: string; otherArm: string };
}

/**
 * Sistema de quien mira: Windows o Mac. En Mac el navegador no siempre dice
 * el chip: Chrome lo expone (userAgentData); Safari y Firefox no, y ahí se
 * asume Apple silicon (los Mac nuevos), con el link a Intel abajo.
 */
async function detect(): Promise<Os> {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'win';
  if (!/Mac/i.test(ua) || /iPhone|iPad/i.test(ua) || navigator.maxTouchPoints > 1) return 'other';
  const uad = (navigator as Navigator & { userAgentData?: { getHighEntropyValues?: (h: string[]) => Promise<{ architecture?: string }> } }).userAgentData;
  try {
    const v = await uad?.getHighEntropyValues?.(['architecture']);
    if (v?.architecture === 'x86') return 'mac-intel';
  } catch {
    /* sin datos: Apple silicon */
  }
  return 'mac-arm';
}

export default function DownloadButtons({ links, labels }: Props) {
  const [os, setOs] = useState<Os | null>(null);

  useEffect(() => {
    let alive = true;
    void detect().then((v) => {
      if (alive) setOs(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  const all = [
    { key: 'mac-arm' as const, href: links.macArm64, label: labels.macArm },
    { key: 'mac-intel' as const, href: links.macX64, label: labels.macIntel },
    { key: 'win' as const, href: links.win, label: labels.win },
  ].filter((b) => b.href);
  const primary = all.find((b) => b.key === os) ?? null;
  const rest = primary ? all.filter((b) => b !== primary) : all;
  const macHint = os === 'mac-arm' ? links.macX64 && { href: links.macX64, label: labels.otherMac } : os === 'mac-intel' ? links.macArm64 && { href: links.macArm64, label: labels.otherArm } : null;

  return (
    <div className="dl-buttons" data-os={os ?? ''}>
      <div className="read-actions">
        {primary && (
          <a className="btn btn-primary btn-lg" href={primary.href!} data-testid="download-primary">
            {primary.label}
          </a>
        )}
        {(primary ? rest.filter((b) => !b.key.startsWith('mac') || !os?.startsWith('mac')) : rest).map((b) => (
          <a key={b.key} className={`btn ${primary ? 'btn-secondary' : 'btn-primary'} btn-lg`} href={b.href!} data-testid={`download-${b.key}`}>
            {b.label}
          </a>
        ))}
      </div>
      {macHint && (
        <p className="read-meta">
          <a href={macHint.href}>{macHint.label}</a>
        </p>
      )}
    </div>
  );
}
