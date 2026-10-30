/**
 * Plantillas integradas de Hiring: descripciones de puesto para empezar y los
 * emails por defecto (acuse, rechazo, entrevista, oferta) y la carta de
 * oferta, en los tres idiomas. Las del workspace (hiring_templates) las
 * reemplazan cuando existen.
 */
import type { Question, TemplateKind } from './types';

type Loc = 'en' | 'es' | 'pt';
const pick = (locale: string): Loc => (locale === 'es' || locale === 'pt' ? locale : 'en');

export interface JobTemplate {
  key: string;
  title: string;
  department: string;
  employmentType: 'full_time' | 'part_time' | 'contract';
  description: string;
  questions: Question[];
}

const yesNo = (id: string, label: string, knockoutYes: boolean): Question => ({
  id,
  label,
  type: 'yesno',
  required: true,
  options: [],
  knockout: knockoutYes ? { accepted: ['yes'], min: null } : null,
});

const JOBS: Record<Loc, JobTemplate[]> = {
  en: [
    {
      key: 'software-engineer',
      title: 'Software Engineer',
      department: 'Engineering',
      employmentType: 'full_time',
      description:
        '## About the role\nYou will design, build and ship features end to end with a small product team.\n\n## What you will do\n- Write and review code that goes to production every week\n- Work with design and product on what to build next\n- Keep the systems you own fast and reliable\n\n## What we look for\n- 3+ years building web applications\n- Comfort with TypeScript or a similar typed language\n- Clear written communication\n\n## Nice to have\n- Experience with SQL databases\n- Open-source contributions',
      questions: [yesNo('work_auth', 'Are you authorized to work in the country of this role?', true), { id: 'years', label: 'Years of professional experience', type: 'number', required: true, options: [], knockout: null }],
    },
    {
      key: 'account-executive',
      title: 'Account Executive',
      department: 'Sales',
      employmentType: 'full_time',
      description:
        '## About the role\nYou will own the full sales cycle with mid-size companies, from first call to signed contract.\n\n## What you will do\n- Run discovery calls and product demos\n- Build and manage your pipeline in the CRM\n- Work with customer success on a clean handoff\n\n## What we look for\n- 2+ years in B2B sales with a quota\n- A track record you can talk about with numbers\n- Spanish or Portuguese is a plus',
      questions: [yesNo('quota', 'Have you carried a sales quota before?', false)],
    },
    {
      key: 'product-designer',
      title: 'Product Designer',
      department: 'Design',
      employmentType: 'full_time',
      description:
        '## About the role\nYou will shape how people use our product, from research to the final pixels.\n\n## What you will do\n- Talk to users and turn what you learn into flows and prototypes\n- Work with engineers until the details ship\n- Keep our design system consistent\n\n## What we look for\n- A portfolio with shipped product work\n- Strong interaction and visual design skills',
      questions: [{ id: 'portfolio', label: 'Link to your portfolio', type: 'text', required: true, options: [], knockout: null }],
    },
    {
      key: 'customer-support',
      title: 'Customer Support Specialist',
      department: 'Support',
      employmentType: 'full_time',
      description:
        '## About the role\nYou will help customers get unstuck by chat and email, and bring what they tell us back to the product team.\n\n## What you will do\n- Answer questions with care and speed\n- Write and update help articles\n- Spot patterns and report bugs\n\n## What we look for\n- Experience in a support role\n- Patience and clear writing',
      questions: [yesNo('shifts', 'Can you work rotating shifts, including some weekends?', true)],
    },
  ],
  es: [
    {
      key: 'software-engineer',
      title: 'Ingeniero/a de software',
      department: 'Ingeniería',
      employmentType: 'full_time',
      description:
        '## Sobre el puesto\nVas a diseñar, construir y publicar funciones de punta a punta con un equipo de producto chico.\n\n## Qué vas a hacer\n- Escribir y revisar código que sale a producción cada semana\n- Definir con diseño y producto qué construir\n- Mantener rápidos y estables los sistemas a tu cargo\n\n## Qué buscamos\n- 3 o más años construyendo aplicaciones web\n- Manejo de TypeScript u otro lenguaje tipado\n- Buena comunicación por escrito\n\n## Suma\n- Experiencia con bases SQL\n- Contribuciones open source',
      questions: [yesNo('work_auth', '¿Tenés permiso para trabajar en el país del puesto?', true), { id: 'years', label: 'Años de experiencia profesional', type: 'number', required: true, options: [], knockout: null }],
    },
    {
      key: 'account-executive',
      title: 'Ejecutivo/a de cuentas',
      department: 'Ventas',
      employmentType: 'full_time',
      description:
        '## Sobre el puesto\nVas a llevar el ciclo de venta completo con empresas medianas, de la primera llamada al contrato firmado.\n\n## Qué vas a hacer\n- Llamadas de descubrimiento y demos\n- Armar y seguir tu pipeline en el CRM\n- Pasar las cuentas a customer success sin perder nada\n\n## Qué buscamos\n- 2 o más años en ventas B2B con cuota\n- Resultados que puedas contar con números',
      questions: [yesNo('quota', '¿Trabajaste con una cuota de ventas?', false)],
    },
    {
      key: 'product-designer',
      title: 'Diseñador/a de producto',
      department: 'Diseño',
      employmentType: 'full_time',
      description:
        '## Sobre el puesto\nVas a definir cómo se usa el producto, desde la investigación hasta el último detalle.\n\n## Qué vas a hacer\n- Hablar con usuarios y convertirlo en flujos y prototipos\n- Trabajar con ingeniería hasta que salga\n- Mantener el sistema de diseño\n\n## Qué buscamos\n- Un portfolio con trabajo de producto publicado\n- Buen diseño de interacción y visual',
      questions: [{ id: 'portfolio', label: 'Link a tu portfolio', type: 'text', required: true, options: [], knockout: null }],
    },
    {
      key: 'customer-support',
      title: 'Especialista de soporte',
      department: 'Soporte',
      employmentType: 'full_time',
      description:
        '## Sobre el puesto\nVas a ayudar a los clientes por chat y email, y llevar lo que nos cuentan al equipo de producto.\n\n## Qué vas a hacer\n- Responder con cuidado y rapidez\n- Escribir y actualizar artículos de ayuda\n- Detectar patrones y reportar bugs\n\n## Qué buscamos\n- Experiencia en soporte\n- Paciencia y buena escritura',
      questions: [yesNo('shifts', '¿Podés trabajar en turnos rotativos, con algunos fines de semana?', true)],
    },
  ],
  pt: [
    {
      key: 'software-engineer',
      title: 'Engenheiro(a) de software',
      department: 'Engenharia',
      employmentType: 'full_time',
      description:
        '## Sobre a vaga\nVocê vai projetar, construir e publicar funcionalidades de ponta a ponta com um time de produto pequeno.\n\n## O que você vai fazer\n- Escrever e revisar código que vai para produção toda semana\n- Definir com design e produto o que construir\n- Manter rápidos e estáveis os sistemas sob sua responsabilidade\n\n## O que buscamos\n- 3 ou mais anos construindo aplicações web\n- Domínio de TypeScript ou outra linguagem tipada\n- Boa comunicação escrita',
      questions: [yesNo('work_auth', 'Você tem autorização para trabalhar no país da vaga?', true), { id: 'years', label: 'Anos de experiência profissional', type: 'number', required: true, options: [], knockout: null }],
    },
    {
      key: 'account-executive',
      title: 'Executivo(a) de contas',
      department: 'Vendas',
      employmentType: 'full_time',
      description:
        '## Sobre a vaga\nVocê vai conduzir o ciclo de vendas completo com empresas médias, da primeira ligação ao contrato assinado.\n\n## O que você vai fazer\n- Ligações de descoberta e demos\n- Montar e acompanhar seu pipeline no CRM\n\n## O que buscamos\n- 2 ou mais anos em vendas B2B com meta',
      questions: [yesNo('quota', 'Você já trabalhou com meta de vendas?', false)],
    },
    {
      key: 'product-designer',
      title: 'Designer de produto',
      department: 'Design',
      employmentType: 'full_time',
      description:
        '## Sobre a vaga\nVocê vai definir como as pessoas usam o produto, da pesquisa ao último detalhe.\n\n## O que você vai fazer\n- Conversar com usuários e transformar isso em fluxos e protótipos\n- Trabalhar com engenharia até a entrega\n\n## O que buscamos\n- Um portfólio com trabalho de produto publicado',
      questions: [{ id: 'portfolio', label: 'Link do seu portfólio', type: 'text', required: true, options: [], knockout: null }],
    },
    {
      key: 'customer-support',
      title: 'Especialista de suporte',
      department: 'Suporte',
      employmentType: 'full_time',
      description:
        '## Sobre a vaga\nVocê vai ajudar os clientes por chat e email e levar o que eles contam para o time de produto.\n\n## O que você vai fazer\n- Responder com cuidado e rapidez\n- Escrever artigos de ajuda\n\n## O que buscamos\n- Experiência em suporte',
      questions: [yesNo('shifts', 'Você pode trabalhar em turnos rotativos, incluindo alguns fins de semana?', true)],
    },
  ],
};

export function jobTemplates(locale: string): JobTemplate[] {
  return JOBS[pick(locale)];
}

export function jobTemplate(locale: string, key: string): JobTemplate | null {
  return JOBS[pick(locale)].find((t) => t.key === key) ?? null;
}

export interface EmailDefault {
  subject: string;
  body: string;
}

const EMAILS: Record<Loc, Record<Exclude<TemplateKind, 'custom' | 'job'>, EmailDefault>> = {
  en: {
    ack: {
      subject: 'We received your application for {{job.title}}',
      body: 'Hi {{candidate.firstName}},\n\nThanks for applying to {{job.title}} at {{company}}. Our team reads every application and will get back to you.\n\nYou can ask us to delete your data at any time: {{privacyLink}}\n\n{{company}}',
    },
    rejection: {
      subject: 'Your application for {{job.title}}',
      body: 'Hi {{candidate.firstName}},\n\nThank you for your time and interest in {{job.title}}. After careful review, we decided to move forward with other candidates.\n\nWe wish you the best in your search.\n\n{{sender.name}}\n{{company}}',
    },
    interview: {
      subject: 'Interview for {{job.title}}: pick a time',
      body: 'Hi {{candidate.firstName}},\n\nWe would like to talk with you about {{job.title}}. Pick a time that works for you here:\n{{schedulingLink}}\n\nYou will get a calendar invite once you book.\n\n{{sender.name}}\n{{company}}',
    },
    offer: {
      subject: 'Your offer for {{job.title}} at {{company}}',
      body: 'Hi {{candidate.firstName}},\n\nWe are happy to offer you the {{job.title}} role. Read the offer and accept or decline it here:\n{{offerLink}}\n\n{{sender.name}}\n{{company}}',
    },
    offer_letter: {
      subject: 'Offer letter',
      body: 'Dear {{candidate.name}},\n\n{{company}} is pleased to offer you the position of {{job.title}}.\n\nSalary: {{offer.salary}}\nStart date: {{offer.startDate}}\n\nThis offer is contingent on the usual conditions of employment. We look forward to working with you.\n\n{{sender.name}}\n{{company}}',
    },
  },
  es: {
    ack: {
      subject: 'Recibimos tu postulación a {{job.title}}',
      body: 'Hola {{candidate.firstName}}:\n\nGracias por postularte a {{job.title}} en {{company}}. Leemos cada postulación y te vamos a responder.\n\nPodés pedirnos que borremos tus datos cuando quieras: {{privacyLink}}\n\n{{company}}',
    },
    rejection: {
      subject: 'Tu postulación a {{job.title}}',
      body: 'Hola {{candidate.firstName}}:\n\nGracias por tu tiempo y tu interés en {{job.title}}. Después de revisarlo con cuidado, decidimos seguir con otras personas.\n\nTe deseamos lo mejor en tu búsqueda.\n\n{{sender.name}}\n{{company}}',
    },
    interview: {
      subject: 'Entrevista para {{job.title}}: elegí un horario',
      body: 'Hola {{candidate.firstName}}:\n\nNos gustaría hablar con vos sobre {{job.title}}. Elegí el horario que te quede mejor:\n{{schedulingLink}}\n\nAl reservar te llega la invitación al calendario.\n\n{{sender.name}}\n{{company}}',
    },
    offer: {
      subject: 'Tu oferta para {{job.title}} en {{company}}',
      body: 'Hola {{candidate.firstName}}:\n\nNos alegra ofrecerte el puesto de {{job.title}}. Leé la oferta y aceptala o rechazala acá:\n{{offerLink}}\n\n{{sender.name}}\n{{company}}',
    },
    offer_letter: {
      subject: 'Carta de oferta',
      body: 'Estimado/a {{candidate.name}}:\n\n{{company}} tiene el agrado de ofrecerte el puesto de {{job.title}}.\n\nSalario: {{offer.salary}}\nFecha de inicio: {{offer.startDate}}\n\nLa oferta está sujeta a las condiciones habituales de contratación. Esperamos trabajar con vos.\n\n{{sender.name}}\n{{company}}',
    },
  },
  pt: {
    ack: {
      subject: 'Recebemos sua candidatura para {{job.title}}',
      body: 'Olá {{candidate.firstName}},\n\nObrigado por se candidatar para {{job.title}} na {{company}}. Lemos cada candidatura e vamos te responder.\n\nVocê pode pedir a exclusão dos seus dados quando quiser: {{privacyLink}}\n\n{{company}}',
    },
    rejection: {
      subject: 'Sua candidatura para {{job.title}}',
      body: 'Olá {{candidate.firstName}},\n\nObrigado pelo seu tempo e interesse em {{job.title}}. Depois de uma análise cuidadosa, decidimos seguir com outras pessoas.\n\nDesejamos sucesso na sua busca.\n\n{{sender.name}}\n{{company}}',
    },
    interview: {
      subject: 'Entrevista para {{job.title}}: escolha um horário',
      body: 'Olá {{candidate.firstName}},\n\nQueremos conversar com você sobre {{job.title}}. Escolha o melhor horário aqui:\n{{schedulingLink}}\n\nAo reservar, você recebe o convite no calendário.\n\n{{sender.name}}\n{{company}}',
    },
    offer: {
      subject: 'Sua oferta para {{job.title}} na {{company}}',
      body: 'Olá {{candidate.firstName}},\n\nTemos o prazer de oferecer a vaga de {{job.title}}. Leia a oferta e aceite ou recuse aqui:\n{{offerLink}}\n\n{{sender.name}}\n{{company}}',
    },
    offer_letter: {
      subject: 'Carta de oferta',
      body: 'Prezado(a) {{candidate.name}},\n\nA {{company}} tem o prazer de oferecer a você a posição de {{job.title}}.\n\nSalário: {{offer.salary}}\nData de início: {{offer.startDate}}\n\nA oferta está sujeita às condições habituais de contratação. Esperamos trabalhar com você.\n\n{{sender.name}}\n{{company}}',
    },
  },
};

export function emailDefault(locale: string, kind: Exclude<TemplateKind, 'custom' | 'job'>): EmailDefault {
  return EMAILS[pick(locale)][kind];
}
