import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-claude-ai-connector',
  date: '2026-11-19',
  title: {
    en: 'Connect zerosoft to claude.ai',
    es: 'Conectá zerosoft a claude.ai',
    pt: 'Conecte a zerosoft ao claude.ai',
  },
  items: [
    {
      product: 'platform',
      en: 'zerosoft works as a custom connector in claude.ai, and from there in Claude Desktop and the Claude mobile apps. Paste the connector URL in Settings, Connectors, Add custom connector, sign in and pick the workspace and the access. Claude then acts as you in every app.',
      es: 'zerosoft funciona como conector personalizado en claude.ai, y desde ahí en Claude Desktop y las apps de Claude para el celular. Pegá la URL del conector en Settings, Connectors, Add custom connector, entrá y elegí el workspace y el acceso. Claude actúa como vos en todas las apps.',
      pt: 'A zerosoft funciona como conector personalizado no claude.ai, e a partir dele no Claude Desktop e nos apps do Claude para celular. Cole a URL do conector em Settings, Connectors, Add custom connector, entre e escolha o workspace e o acesso. O Claude age como você em todos os apps.',
    },
    {
      product: 'platform',
      en: 'The connector URL, with a copy button, is in Settings, API and webhooks, above your connected apps. The site footer links to the setup page, which also covers Claude Code, ChatGPT in developer mode and other MCP clients.',
      es: 'La URL del conector, con un botón para copiarla, está en Ajustes, API y webhooks, arriba de tus apps conectadas. El pie del sitio lleva a la página de configuración, que también explica Claude Code, ChatGPT en modo desarrollador y otros clientes MCP.',
      pt: 'A URL do conector, com um botão para copiar, fica em Ajustes, API e webhooks, acima dos seus apps conectados. O rodapé do site leva à página de configuração, que também explica o Claude Code, o ChatGPT em modo desenvolvedor e outros clientes MCP.',
    },
  ],
} satisfies ChangelogEntry;
