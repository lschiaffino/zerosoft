import { setRequestLocale } from 'next-intl/server';
import { MCP_DOCS } from '@/content/mcp-docs';
import { staticPageMetadata } from '@/lib/seo-pages';
import { issuerUrl } from '@/lib/oauth/store';
import '@/styles/api-docs.css';
import '@/styles/oauth.css';

function copyFor(locale: string) {
  return MCP_DOCS[locale as keyof typeof MCP_DOCS] ?? MCP_DOCS.en;
}

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return staticPageMetadata('docsMcp', locale);
}

const CLI_EXAMPLES = `zerosoft login
zerosoft whoami
zerosoft apps
zerosoft ops search "deal move"
zerosoft ops show crm.deals.update
zerosoft crm contacts list
zerosoft track issues create \\
  --projectId p1 \\
  --title "Fix the invoice"
zerosoft call crm.deals.update --json \\
  '{"path":{"id":"d1"},
    "body":{"priority":"high"}}'
zerosoft setup claude`;

/**
 * claude.ai necesita una URL pública para conectarse: se prende después de probarlo
 * contra zerosoft.ai ya desplegado, no antes.
 */
const CLAUDE_AI_VERIFIED = false;

/** Cómo conectar Claude Code, claude.ai y la CLI. */
export default async function McpDocsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const c = copyFor(locale);
  const endpoint = `${issuerUrl()}/api/mcp`;
  return (
    <main className="mcp-docs">
      <section className="api-docs-hero">
        <h1 className="doc-title">
          {c.title}
          <br />
          <span className="dim">{c.titleDim}</span>
        </h1>
        <p className="doc-intro">{c.intro}</p>
      </section>

      <section id="claude-code" className="mcp-docs-section">
        <h2>{c.claudeCodeTitle}</h2>
        <p>{c.claudeCodeSteps[0]}</p>
        <pre className="code-block"><code>{`claude mcp add --transport http \\
  zerosoft ${endpoint}`}</code></pre>
        <p>{c.claudeCodeSteps[1]}</p>
      </section>

      {CLAUDE_AI_VERIFIED && (
        <section id="claude-ai" className="mcp-docs-section">
          <h2>{c.claudeAiTitle}</h2>
          <p>{c.claudeAiSteps[0]}</p>
          <p>{c.claudeAiSteps[1]}</p>
          <pre className="code-block"><code>{endpoint}</code></pre>
          <p>{c.claudeAiSteps[2]}</p>
        </section>
      )}

      <section id="cli" className="mcp-docs-section">
        <h2>{c.cliTitle}</h2>
        <p>{c.cliIntro}</p>
        <p>{c.cliRunNote}</p>
        <pre className="code-block"><code>{'cd cli && npm link\n# or: node cli/bin/zerosoft.mjs --help'}</code></pre>
        <p className="code-label">{c.cliExamplesLabel}</p>
        <pre className="code-block"><code>{CLI_EXAMPLES}</code></pre>
        <p>
          {c.cliHeadless.split('zerosoft login --device').flatMap((part, i) =>
            i === 0 ? [part] : [<code key={i} className="mcp-docs-cmd">zerosoft login --device</code>, part],
          )}
        </p>
      </section>

      <section id="how" className="mcp-docs-section">
        <h2>{c.howTitle}</h2>
        {c.howBody.map((p) => <p key={p}>{p}</p>)}
      </section>

      <section id="access" className="mcp-docs-section">
        <h2>{c.accessTitle}</h2>
        {c.accessBody.map((p) => <p key={p}>{p}</p>)}
      </section>

      <section id="out" className="mcp-docs-section">
        <h2>{c.outTitle}</h2>
        <ul>{c.outBody.map((p) => <li key={p}>{p}</li>)}</ul>
        <h3>{c.webOnlyTitle}</h3>
        <p>{c.webOnlyIntro}</p>
        <ul>{c.webOnly.map((p) => <li key={p}>{p}</li>)}</ul>
      </section>

      <section id="keys" className="mcp-docs-section">
        <h2>{c.keysTitle}</h2>
        <p>{c.keysBody}</p>
        <p><a href={`/${locale}/docs`}>{c.apiLink}</a></p>
      </section>
    </main>
  );
}
