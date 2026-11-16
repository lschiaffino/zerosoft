import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-icu-help-texts',
  date: '2026-11-15',
  title: {
    en: 'Help texts that showed a code instead of the text',
    es: 'Textos de ayuda que mostraban un código en lugar del texto',
    pt: 'Textos de ajuda que mostravam um código no lugar do texto',
  },
  items: [
    {
      product: 'forms',
      en: 'The help under a question title in the Forms builder, the one about inserting earlier answers with {{name}}, showed forms.builder.pipingHelp. It reads as text again.',
      es: 'La ayuda bajo el título de una pregunta en el editor de Forms, la que explica cómo insertar respuestas anteriores con {{name}}, mostraba forms.builder.pipingHelp. Ahora se lee el texto.',
      pt: 'A ajuda embaixo do título de uma pergunta no editor do Forms, a que explica como inserir respostas anteriores com {{name}}, mostrava forms.builder.pipingHelp. Agora aparece o texto.',
    },
    {
      product: 'platform',
      en: 'The same happened in 17 other places that quote {{variables}}, <tags> or { objects }: the analytics install snippet, Cal workflow webhooks, Docs database actions, Flow, Link conversions, Track in Slack and nine parameters of the API reference at /docs.',
      es: 'Lo mismo pasaba en otros 17 lugares que citan {{variables}}, <etiquetas> u { objetos }: el snippet de instalación de Analytics, los webhooks de flujos de Cal, las acciones de bases de Docs, Flow, las conversiones de Link, Track en Slack y nueve parámetros de la referencia de la API en /docs.',
      pt: 'O mesmo acontecia em outros 17 lugares que citam {{variáveis}}, <tags> ou { objetos }: o snippet de instalação do Analytics, os webhooks de fluxos do Cal, as ações de bancos do Docs, o Flow, as conversões do Link, o Track no Slack e nove parâmetros da referência da API em /docs.',
    },
  ],
} satisfies ChangelogEntry;
