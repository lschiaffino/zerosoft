import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-2116-crm-ai-call-followup',
  date: '2026-11-23',
  title: {
    en: 'CRM: AI suggests the updates after a call',
    es: 'CRM: la IA sugiere los cambios después de una llamada',
    pt: 'CRM: a IA sugere as alterações depois de uma chamada',
  },
  items: [
    {
      product: 'crm',
      en: 'Calls and meetings on the timeline have "Suggest updates with AI". It reads the notes, the attached transcripts and the transcript of a browser call, and suggests property values for the contact, company and deal, moving the deal to a later stage, a follow-up email and tasks. Each suggestion is a card: apply it, edit it first or discard it. Nothing changes until you click, stage moves ask for the fields and approvals the stage needs, and the email goes out from the timeline like any other. AI only reads and suggests the properties you can edit, and your suggestions are visible only to you.',
      es: 'Las llamadas y reuniones del timeline tienen "Sugerir cambios con IA". Lee las notas, las transcripciones adjuntas y la transcripción de una llamada desde el navegador, y sugiere valores de propiedades del contacto, la empresa y el deal, pasar el deal a una etapa siguiente, un email de seguimiento y tareas. Cada sugerencia es una tarjeta: la aplicás, la editás antes o la descartás. Nada cambia hasta que hacés click, mover de etapa pide los campos y aprobaciones que pida la etapa, y el email sale desde el timeline como cualquier otro. La IA solo lee y sugiere las propiedades que podés editar, y tus sugerencias las ves solo vos.',
      pt: 'As chamadas e reuniões do timeline têm "Sugerir alterações com IA". Ela lê as notas, as transcrições anexadas e a transcrição de uma chamada pelo navegador, e sugere valores de propriedades do contato, da empresa e do negócio, mover o negócio para uma etapa seguinte, um email de acompanhamento e tarefas. Cada sugestão é um cartão: você aplica, edita antes ou descarta. Nada muda até você clicar, mudar de etapa pede os campos e aprovações que a etapa exige, e o email sai do timeline como qualquer outro. A IA só lê e sugere as propriedades que você pode editar, e suas sugestões ficam visíveis só para você.',
    },
  ],
} satisfies ChangelogEntry;
