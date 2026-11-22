import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-2000-crm-preview-cards-custom',
  date: '2026-11-22',
  title: {
    en: 'CRM: customize the record preview and the deal cards, and act from the preview',
    es: 'CRM: personalizá la vista previa y las tarjetas de deals, y trabajá desde la vista previa',
    pt: 'CRM: personalize a prévia e os cartões de negócios, e trabalhe pela prévia',
  },
  items: [
    {
      product: 'crm',
      en: 'Admins choose, for contacts, companies and deals, which properties the preview shows in About and which cards follow it (deal stage, recent activity, associations, custom properties), in Settings › Data or with Customize in the preview. Each deal pipeline can show up to six properties on its board cards, with a sample card in Settings › Sales. Someone who has a property hidden never sees it on a card or in the preview. The preview has quick actions to write a note, log a call, create a task, send an email or share a meeting link, shows the latest activity, and adds or removes associated contacts, companies and deals from their cards.',
      es: 'Los admins eligen, para contactos, empresas y deals, qué propiedades muestra la vista previa en Acerca de y qué tarjetas siguen (etapa del deal, actividad reciente, asociaciones, propiedades personalizadas), en Ajustes › Datos o con Personalizar en la vista previa. Cada pipeline de deals puede mostrar hasta seis propiedades en sus tarjetas del board, con una tarjeta de muestra en Ajustes › Ventas. Quien tiene una propiedad oculta no la ve nunca en una tarjeta ni en la vista previa. La vista previa tiene acciones rápidas para escribir una nota, registrar una llamada, crear una tarea, mandar un email o compartir un link de reunión, muestra la última actividad, y agrega o quita contactos, empresas y deals asociados desde sus tarjetas.',
      pt: 'Os admins escolhem, para contatos, empresas e negócios, quais propriedades a prévia mostra em Sobre e quais cartões vêm depois (etapa do negócio, atividade recente, associações, propriedades personalizadas), em Ajustes › Dados ou com Personalizar na prévia. Cada pipeline de negócios pode mostrar até seis propriedades nos cartões do quadro, com um cartão de exemplo em Ajustes › Vendas. Quem tem uma propriedade oculta nunca a vê num cartão nem na prévia. A prévia tem ações rápidas para escrever uma nota, registrar uma ligação, criar uma tarefa, enviar um e-mail ou compartilhar um link de reunião, mostra a última atividade, e adiciona ou remove contatos, empresas e negócios associados nos seus cartões.',
    },
  ],
} satisfies ChangelogEntry;
