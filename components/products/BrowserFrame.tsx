import type { ReactNode } from 'react';

/**
 * A fake browser window: three dots, a mono URL bar, and any content
 * rendered as the "page". Pure CSS, no images.
 */
export default function BrowserFrame({
  url,
  children,
}: {
  url: string;
  children: ReactNode;
}) {
  return (
    <div className="bframe">
      <div className="bframe-bar">
        <span className="bframe-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="bframe-url">{url}</span>
        <span className="bframe-spacer" aria-hidden="true" />
      </div>
      <div className="bframe-body">{children}</div>
    </div>
  );
}
