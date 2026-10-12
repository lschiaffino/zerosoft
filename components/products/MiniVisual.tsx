/**
 * Tiny decorative product previews for the arsenal cards on /products.
 * Pure CSS shapes, no text beyond fake URLs — no translation needed.
 */
export default function MiniVisual({ product }: { product: string }) {
  if (product === 'link') {
    const rows = [
      { url: 'zs.ai/launch', bars: [8, 12, 10, 16, 14] },
      { url: 'zs.ai/demo', bars: [6, 9, 14, 11, 15] },
      { url: 'zs.ai/docs', bars: [10, 7, 12, 9, 13] },
    ];
    return (
      <div className="pv" aria-hidden="true">
        {rows.map((row) => (
          <div className="pv-row" key={row.url}>
            <span className="pv-url">{row.url}</span>
            <span className="pv-bars">
              {row.bars.map((h, i) => (
                <i key={i} style={{ height: h }} />
              ))}
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (product === 'track') {
    const cols = [3, 2, 4];
    return (
      <div className="pv pv-track" aria-hidden="true">
        {cols.map((count, c) => (
          <div className="pv-tcol" key={c}>
            {Array.from({ length: count }).map((_, i) => (
              <div className="pv-tcard" key={i}>
                <i />
                <i />
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (product === 'crm') {
    const widths: [string, string][] = [
      ['34%', '58%'],
      ['52%', '30%'],
      ['28%', '66%'],
    ];
    return (
      <div className="pv pv-crm" aria-hidden="true">
        {widths.map(([a, b], i) => (
          <div className="pv-crm-row" key={i}>
            <span className="pv-crm-dot" />
            <span className="pv-crm-line" style={{ width: a }} />
            <span className="pv-crm-line" style={{ width: b, marginLeft: 'auto' }} />
          </div>
        ))}
      </div>
    );
  }

  if (product === 'chat') {
    const rows = ['62%', '48%', '70%'];
    const bubbles: { w: string; us: boolean }[] = [
      { w: '58%', us: false },
      { w: '74%', us: true },
      { w: '46%', us: false },
    ];
    return (
      <div className="pv pv-chat" aria-hidden="true">
        <div className="pv-chat-list">
          {rows.map((w, i) => (
            <div className="pv-chat-row" key={i}>
              <i />
              <span style={{ width: w }} />
            </div>
          ))}
        </div>
        <div className="pv-chat-thread">
          {bubbles.map((b, i) => (
            <span className={`pv-chat-b${b.us ? ' us' : ''}`} style={{ width: b.w }} key={i} />
          ))}
        </div>
      </div>
    );
  }

  // cal: a month grid with a few "available" days filled
  const on = new Set([3, 8, 10, 15, 17, 22, 27]);
  return (
    <div className="pv pv-cal" aria-hidden="true">
      {Array.from({ length: 35 }).map((_, i) => (
        <i key={i} className={on.has(i) ? 'on' : ''} />
      ))}
    </div>
  );
}
