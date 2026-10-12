'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { HttpMethod } from '@/lib/api-docs';

type Lang = 'curl' | 'js' | 'python' | 'go';

interface CodeTabsProps {
  method: HttpMethod;
  path: string;
  baseUrl: string;
  rootUrl: string;
  request?: unknown;
  authToken: string;
}

function fullUrl(path: string, baseUrl: string, rootUrl: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return path.startsWith('/api/v1') ? `${baseUrl}${path.slice(7)}` : `${rootUrl}${path}`;
}

function buildCurl(method: HttpMethod, url: string, request: unknown | undefined, token: string): string {
  const lines = [`curl -X ${method} "${url}" \\`, `  -H "Authorization: Bearer ${token}"`];
  if (request !== undefined && method !== 'GET' && method !== 'DELETE') {
    lines.push(`  -H "Content-Type: application/json" \\`);
    const body = JSON.stringify(request, null, 2);
    // Shell single-quote safe: wrap in single quotes and escape any single quote.
    const safe = body.replace(/'/g, `'\\''`);
    lines.push(`  -d '${safe}'`);
  }
  return lines.join('\n');
}

function buildJs(method: HttpMethod, url: string, request: unknown | undefined, token: string): string {
  const hasBody = request !== undefined && method !== 'GET' && method !== 'DELETE';
  const lines = [
    'const response = await fetch(' ,
    `  "${url}",`,
    '  {',
    `    method: "${method}",`,
    '    headers: {',
    `      "Authorization": "Bearer ${token}",`,
  ];
  if (hasBody) {
    lines.push('      "Content-Type": "application/json",');
  }
  lines.push('    },');
  if (hasBody) {
    lines.push(`    body: JSON.stringify(${JSON.stringify(request, null, 2).replace(/^/gm, '    ')})`);
  }
  lines.push('  }');
  lines.push(');');
  lines.push('');
  lines.push('const data = await response.json();');
  return lines.join('\n');
}

function buildPython(method: HttpMethod, url: string, request: unknown | undefined, token: string): string {
  const hasBody = request !== undefined && method !== 'GET' && method !== 'DELETE';
  const lines = [
    'import requests, json',
    '',
    `url = "${url}"`,
    'headers = {',
    `    "Authorization": "Bearer ${token}",`,
  ];
  if (hasBody) {
    lines.push('    "Content-Type": "application/json",');
  }
  lines.push('}');
  if (hasBody) {
    lines.push('');
    lines.push(`payload = json.dumps(${JSON.stringify(request, null, 4).replace(/^/gm, '')})`);
  }
  lines.push('');
  lines.push(
    `response = requests.${method.toLowerCase()}(url, headers=headers${hasBody ? ', data=payload' : ''})`,
  );
  lines.push('data = response.json()');
  return lines.join('\n');
}

function buildGo(method: HttpMethod, url: string, request: unknown | undefined, token: string): string {
  const hasBody = request !== undefined && method !== 'GET' && method !== 'DELETE';
  const lines = [
    'package main',
    '',
    'import (',
    '    "bytes"',
    '    "encoding/json"',
    '    "fmt"',
    '    "net/http"',
    ')',
    '',
    'func main() {',
    `    url := "${url}"`,
  ];
  if (hasBody) {
    lines.push(`    payload, _ := json.Marshal(${JSON.stringify(request, null, 4).replace(/^/gm, '    ')})`);
    lines.push('    req, _ := http.NewRequest("' + method + '", url, bytes.NewReader(payload))');
  } else {
    lines.push('    req, _ := http.NewRequest("' + method + '", url, nil)');
  }
  lines.push(`    req.Header.Set("Authorization", "Bearer ${token}")`);
  if (hasBody) {
    lines.push('    req.Header.Set("Content-Type", "application/json")');
  }
  lines.push('');
  lines.push('    client := &http.Client{}');
  lines.push('    resp, _ := client.Do(req)');
  lines.push('    defer resp.Body.Close()');
  lines.push('}');
  return lines.join('\n');
}

export default function CodeTabs({ method, path, baseUrl, rootUrl, request, authToken }: CodeTabsProps) {
  const t = useTranslations('pages.docs');
  const [tab, setTab] = useState<Lang>('curl');
  const [copied, setCopied] = useState(false);

  const url = useMemo(() => fullUrl(path, baseUrl, rootUrl), [path, baseUrl, rootUrl]);

  const snippets = useMemo(
    () => ({
      curl: buildCurl(method, url, request, authToken),
      js: buildJs(method, url, request, authToken),
      python: buildPython(method, url, request, authToken),
      go: buildGo(method, url, request, authToken),
    }),
    [method, url, request, authToken],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippets[tab]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore unsupported environments.
    }
  }

  const tabs: { key: Lang; label: string }[] = [
    { key: 'curl', label: t('cURL') },
    { key: 'js', label: t('js') },
    { key: 'python', label: t('python') },
    { key: 'go', label: t('go') },
  ];

  return (
    <div className="code-tabs">
      <div className="code-tabs-header">
        <div className="code-tabs-list" role="tablist">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              className={`code-tab${tab === item.key ? ' active' : ''}`}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button type="button" className="code-copy" onClick={copy}>
          {copied ? t('copied') : t('copy')}
        </button>
      </div>
      <pre className="code-block">
        <code>{snippets[tab]}</code>
      </pre>
    </div>
  );
}
