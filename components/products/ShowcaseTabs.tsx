'use client';

import { useState, type ReactNode } from 'react';

interface ShowcaseTabsProps {
  tabs: Array<{ key: string; label: string; tag: string }>;
  /** Un panel por pestaña, en el mismo orden (los mockups se renderizan en el servidor). */
  panels: ReactNode[];
}

/** Pestañas de la vitrina del home: muestra un producto por vez. */
export default function ShowcaseTabs({ tabs, panels }: ShowcaseTabsProps) {
  const [active, setActive] = useState(0);
  return (
    <div className="showcase">
      <div className="showcase-tabs" role="tablist">
        {tabs.map((tab, i) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`showcase-tab-${tab.key}`}
            aria-selected={i === active}
            aria-controls={`showcase-panel-${tab.key}`}
            className={`showcase-tab card-${tab.key}${i === active ? ' active' : ''}`}
            onClick={() => setActive(i)}
          >
            <span className="showcase-tab-name">{tab.label}</span>
            <span className="showcase-tab-tag">{tab.tag}</span>
          </button>
        ))}
      </div>
      {panels.map((panel, i) => (
        <div
          key={tabs[i].key}
          role="tabpanel"
          id={`showcase-panel-${tabs[i].key}`}
          aria-labelledby={`showcase-tab-${tabs[i].key}`}
          hidden={i !== active}
          className="showcase-panel"
        >
          {panel}
        </div>
      ))}
    </div>
  );
}
