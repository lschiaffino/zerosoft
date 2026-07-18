'use client';

import { signIn } from 'next-auth/react';

export default function GoogleButton({ label, locale }: { label: string; locale: string }) {
  return (
    <button
      className="btn-google"
      onClick={() => signIn('google', { callbackUrl: `/${locale}/app` })}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path
          d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
          fill="currentColor" opacity="0.9"
        />
        <path
          d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
          fill="currentColor" opacity="0.7"
        />
        <path
          d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
          fill="currentColor" opacity="0.5"
        />
        <path
          d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
          fill="currentColor" opacity="0.85"
        />
      </svg>
      {label}
    </button>
  );
}
