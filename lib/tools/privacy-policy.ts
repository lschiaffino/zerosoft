/**
 * Generador de políticas de privacidad: plantillas fijas (sin AI) que se
 * arman según lo que la persona marca. El documento sale en el idioma de la
 * página. No es asesoramiento legal (lo dice la UI y el propio documento).
 */

export type Jurisdiction = 'us' | 'eu' | 'uk' | 'br' | 'ar' | 'mx' | 'ca' | 'other';
export const JURISDICTIONS: readonly Jurisdiction[] = ['us', 'eu', 'uk', 'br', 'ar', 'mx', 'ca', 'other'];

export const DATA_KINDS = ['contact', 'account', 'payment', 'usage', 'device', 'location', 'content'] as const;
export type DataKind = (typeof DATA_KINDS)[number];

export const THIRD_PARTIES = [
  'google-analytics',
  'meta-pixel',
  'stripe',
  'paypal',
  'mailchimp',
  'hubspot',
  'intercom',
  'vercel',
  'aws',
  'zerosoft',
] as const;
export type ThirdParty = (typeof THIRD_PARTIES)[number];

export const THIRD_PARTY_NAMES: Record<ThirdParty, string> = {
  'google-analytics': 'Google Analytics',
  'meta-pixel': 'Meta Pixel',
  stripe: 'Stripe',
  paypal: 'PayPal',
  mailchimp: 'Mailchimp',
  hubspot: 'HubSpot',
  intercom: 'Intercom',
  vercel: 'Vercel',
  aws: 'Amazon Web Services',
  zerosoft: 'zerosoft',
};

export interface PolicyInput {
  company: string;
  website: string;
  email: string;
  address: string;
  jurisdiction: Jurisdiction;
  /** YYYY-MM-DD */
  effectiveDate: string;
  data: DataKind[];
  cookies: boolean;
  analytics: boolean;
  ads: boolean;
  newsletter: boolean;
  thirdParties: ThirdParty[];
  /** El servicio no está dirigido a menores. */
  noChildren: boolean;
}

export interface PolicySection {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface Policy {
  title: string;
  updated: string;
  disclaimer: string;
  sections: PolicySection[];
}

type Dict = {
  title: string;
  updated: (d: string) => string;
  disclaimer: string;
  intro: (c: string, w: string) => string;
  s: Record<string, string>;
  collectIntro: string;
  data: Record<DataKind, string>;
  useIntro: string;
  uses: { provide: string; support: string; security: string; legal: string; improve: string; marketing: string; ads: string };
  cookies: { base: string; analytics: string; ads: string; control: string };
  thirdIntro: string;
  thirdRole: Record<ThirdParty, string>;
  sharing: string[];
  retention: string;
  security: string;
  rightsIntro: string;
  rights: string[];
  rightsHow: (email: string) => string;
  juris: Partial<Record<Jurisdiction, { title: string; paragraphs: string[] }>>;
  legalBasis: string[];
  transfers: string;
  children: string;
  newsletter: string;
  changes: string;
  contact: (c: string, email: string, address: string) => string;
};

const EN: Dict = {
  title: 'Privacy Policy',
  updated: (d) => `Last updated: ${d}`,
  disclaimer:
    'This policy was generated from a template and is not legal advice. Have it reviewed by a qualified lawyer before publishing it.',
  intro: (c, w) =>
    `This Privacy Policy explains how ${c} ("we", "us") collects, uses and protects personal information when you use ${w} and our related services (the "Service"). By using the Service you agree to the practices described here.`,
  s: {
    collect: 'Information we collect',
    use: 'How we use your information',
    legalBasis: 'Legal bases for processing',
    cookies: 'Cookies and similar technologies',
    third: 'Service providers',
    sharing: 'How we share information',
    retention: 'Data retention',
    security: 'Security',
    rights: 'Your rights',
    transfers: 'International transfers',
    children: "Children's privacy",
    newsletter: 'Marketing emails',
    changes: 'Changes to this policy',
    contact: 'Contact us',
  },
  collectIntro: 'Depending on how you use the Service, we may collect:',
  data: {
    contact: 'Contact details, such as your name, email address and phone number.',
    account: 'Account information, such as your username, password (stored hashed) and preferences.',
    payment: 'Billing information, such as billing address and payment details, processed by our payment providers. We do not store full card numbers.',
    usage: 'Usage data, such as pages visited, features used, and the date and time of your visits.',
    device: 'Device and technical data, such as IP address, browser type, operating system and language.',
    location: 'Approximate location derived from your IP address or, with your permission, precise location from your device.',
    content: 'Content you submit, such as messages, files, forms and support requests.',
  },
  useIntro: 'We use personal information to:',
  uses: {
    provide: 'Provide, operate and maintain the Service, including your account.',
    support: 'Respond to your requests and provide customer support.',
    security: 'Detect, prevent and address fraud, abuse and security issues.',
    legal: 'Comply with legal obligations and enforce our terms.',
    improve: 'Understand how the Service is used and improve it.',
    marketing: 'Send you news and offers you subscribed to (you can unsubscribe at any time).',
    ads: 'Measure and personalize advertising.',
  },
  cookies: {
    base: 'We use cookies and similar technologies that are necessary for the Service to work, for example to keep you signed in and remember your preferences.',
    analytics: 'We also use analytics cookies to understand how visitors use the Service, in aggregated form.',
    ads: 'With your consent where required, we use advertising cookies and pixels to measure campaigns and show relevant ads on other sites.',
    control: 'You can block or delete cookies in your browser settings. Some parts of the Service may not work without necessary cookies.',
  },
  thirdIntro: 'We use trusted providers that process personal information on our behalf, under contracts that require them to protect it:',
  thirdRole: {
    'google-analytics': 'website analytics',
    'meta-pixel': 'advertising measurement',
    stripe: 'payment processing',
    paypal: 'payment processing',
    mailchimp: 'email marketing',
    hubspot: 'customer relationship management',
    intercom: 'customer support and messaging',
    vercel: 'hosting and content delivery',
    aws: 'cloud hosting and storage',
    zerosoft: 'CRM, scheduling, support and productivity tools',
  },
  sharing: [
    'We do not sell your personal information.',
    'We share information only with the service providers listed above, when required by law or to protect our rights, or as part of a merger, acquisition or sale of assets, in which case we will notify you.',
  ],
  retention:
    'We keep personal information for as long as your account is active or as needed to provide the Service, and afterwards only as long as necessary to comply with legal obligations, resolve disputes and enforce our agreements.',
  security:
    'We use reasonable technical and organizational measures to protect personal information, such as encryption in transit and access controls. No method of transmission or storage is completely secure.',
  rightsIntro: 'Depending on where you live, you may have the right to:',
  rights: [
    'Access the personal information we hold about you.',
    'Correct inaccurate or incomplete information.',
    'Delete your personal information.',
    'Object to or restrict certain processing.',
    'Receive your information in a portable format.',
    'Withdraw consent at any time, where processing is based on consent.',
  ],
  rightsHow: (email) => `To exercise your rights, contact us at ${email}. We will respond within the time required by applicable law.`,
  juris: {
    eu: {
      title: 'Additional information for the EEA (GDPR)',
      paragraphs: [
        'If you are in the European Economic Area, we are the data controller of your personal information. You have the right to lodge a complaint with your local data protection authority.',
      ],
    },
    uk: {
      title: 'Additional information for the United Kingdom (UK GDPR)',
      paragraphs: [
        "If you are in the United Kingdom, we are the data controller of your personal information. You have the right to lodge a complaint with the Information Commissioner's Office (ICO).",
      ],
    },
    us: {
      title: 'Additional information for California residents (CCPA/CPRA)',
      paragraphs: [
        'California residents have the right to know what personal information we collect, use and disclose; to request deletion and correction; to opt out of the sale or sharing of personal information; and not to be discriminated against for exercising these rights. We do not sell personal information. Where we use advertising cookies, that may be considered "sharing"; you can opt out using your browser settings or by contacting us.',
      ],
    },
    br: {
      title: 'Additional information for Brazil (LGPD)',
      paragraphs: [
        'If you are in Brazil, you have the rights provided in article 18 of the Lei Geral de Proteção de Dados (Law 13.709/2018), including confirmation of processing, access, correction, anonymization, portability and deletion, and you may file a complaint with the ANPD.',
      ],
    },
    ar: {
      title: 'Additional information for Argentina',
      paragraphs: [
        'If you are in Argentina, you may exercise your rights of access, rectification and deletion under Law 25.326. The Agencia de Acceso a la Información Pública, as the enforcement authority, handles complaints regarding non-compliance with personal data protection rules.',
      ],
    },
    mx: {
      title: 'Additional information for Mexico',
      paragraphs: [
        'If you are in Mexico, you may exercise your ARCO rights (access, rectification, cancellation and opposition) under the applicable federal personal data protection law by contacting us.',
      ],
    },
    ca: {
      title: 'Additional information for Canada (PIPEDA)',
      paragraphs: [
        'If you are in Canada, we handle personal information in accordance with PIPEDA and applicable provincial laws. You may file a complaint with the Office of the Privacy Commissioner of Canada.',
      ],
    },
  },
  legalBasis: [
    'Performance of a contract, to provide the Service you requested.',
    'Legitimate interests, such as securing and improving the Service.',
    'Consent, for example for marketing emails or non-essential cookies.',
    'Compliance with legal obligations.',
  ],
  transfers:
    'Our providers may process information in countries other than yours. When we transfer personal information internationally, we use appropriate safeguards, such as standard contractual clauses.',
  children:
    'The Service is not directed to children under 16, and we do not knowingly collect their personal information. If you believe a child has provided us information, contact us and we will delete it.',
  newsletter:
    'If you subscribe to our emails, we will send you news and offers. Every email includes a link to unsubscribe.',
  changes:
    'We may update this policy from time to time. We will post the new version on this page and update the date above; if the changes are significant, we will notify you.',
  contact: (c, email, address) =>
    `If you have questions about this policy, contact ${c} at ${email}${address ? ` or by mail at ${address}` : ''}.`,
};

const ES: Dict = {
  title: 'Política de privacidad',
  updated: (d) => `Última actualización: ${d}`,
  disclaimer:
    'Esta política se generó a partir de una plantilla y no es asesoramiento legal. Hacela revisar por un abogado antes de publicarla.',
  intro: (c, w) =>
    `Esta Política de privacidad explica cómo ${c} ("nosotros") recopila, usa y protege la información personal cuando usás ${w} y nuestros servicios relacionados (el "Servicio"). Al usar el Servicio aceptás las prácticas descritas acá.`,
  s: {
    collect: 'Información que recopilamos',
    use: 'Cómo usamos tu información',
    legalBasis: 'Bases legales del tratamiento',
    cookies: 'Cookies y tecnologías similares',
    third: 'Proveedores de servicios',
    sharing: 'Cómo compartimos la información',
    retention: 'Conservación de los datos',
    security: 'Seguridad',
    rights: 'Tus derechos',
    transfers: 'Transferencias internacionales',
    children: 'Privacidad de menores',
    newsletter: 'Emails de marketing',
    changes: 'Cambios en esta política',
    contact: 'Contacto',
  },
  collectIntro: 'Según cómo uses el Servicio, podemos recopilar:',
  data: {
    contact: 'Datos de contacto, como tu nombre, email y teléfono.',
    account: 'Datos de la cuenta, como tu usuario, contraseña (guardada con hash) y preferencias.',
    payment: 'Datos de facturación, como dirección de facturación y medios de pago, procesados por nuestros proveedores de pago. No guardamos números de tarjeta completos.',
    usage: 'Datos de uso, como páginas visitadas, funciones usadas y fecha y hora de tus visitas.',
    device: 'Datos técnicos y del dispositivo, como dirección IP, navegador, sistema operativo e idioma.',
    location: 'Ubicación aproximada derivada de tu IP o, con tu permiso, la ubicación precisa de tu dispositivo.',
    content: 'Contenido que nos envías, como mensajes, archivos, formularios y pedidos de soporte.',
  },
  useIntro: 'Usamos la información personal para:',
  uses: {
    provide: 'Prestar, operar y mantener el Servicio, incluida tu cuenta.',
    support: 'Responder tus consultas y darte soporte.',
    security: 'Detectar, prevenir y resolver fraudes, abusos y problemas de seguridad.',
    legal: 'Cumplir obligaciones legales y hacer cumplir nuestros términos.',
    improve: 'Entender cómo se usa el Servicio y mejorarlo.',
    marketing: 'Enviarte novedades y ofertas a las que te suscribiste (podés darte de baja cuando quieras).',
    ads: 'Medir y personalizar publicidad.',
  },
  cookies: {
    base: 'Usamos cookies y tecnologías similares necesarias para que el Servicio funcione, por ejemplo para mantener tu sesión y recordar tus preferencias.',
    analytics: 'También usamos cookies de analítica para entender, de forma agregada, cómo se usa el Servicio.',
    ads: 'Con tu consentimiento cuando la ley lo exige, usamos cookies y píxeles publicitarios para medir campañas y mostrar anuncios relevantes en otros sitios.',
    control: 'Podés bloquear o borrar las cookies desde la configuración de tu navegador. Algunas partes del Servicio pueden no funcionar sin las cookies necesarias.',
  },
  thirdIntro: 'Trabajamos con proveedores de confianza que tratan información personal por cuenta nuestra, bajo contratos que los obligan a protegerla:',
  thirdRole: {
    'google-analytics': 'analítica web',
    'meta-pixel': 'medición publicitaria',
    stripe: 'procesamiento de pagos',
    paypal: 'procesamiento de pagos',
    mailchimp: 'email marketing',
    hubspot: 'gestión de clientes (CRM)',
    intercom: 'soporte y mensajería',
    vercel: 'hosting y distribución de contenido',
    aws: 'hosting y almacenamiento en la nube',
    zerosoft: 'CRM, agenda, soporte y herramientas de productividad',
  },
  sharing: [
    'No vendemos tu información personal.',
    'Solo la compartimos con los proveedores listados arriba, cuando lo exige la ley o para proteger nuestros derechos, o en el marco de una fusión, adquisición o venta de activos, en cuyo caso te avisaremos.',
  ],
  retention:
    'Conservamos la información personal mientras tu cuenta esté activa o mientras sea necesaria para prestar el Servicio, y después solo el tiempo necesario para cumplir obligaciones legales, resolver disputas y hacer cumplir nuestros acuerdos.',
  security:
    'Aplicamos medidas técnicas y organizativas razonables para proteger la información personal, como cifrado en tránsito y controles de acceso. Ningún método de transmisión o almacenamiento es completamente seguro.',
  rightsIntro: 'Según dónde vivas, podés tener derecho a:',
  rights: [
    'Acceder a la información personal que tenemos sobre vos.',
    'Rectificar información inexacta o incompleta.',
    'Suprimir tu información personal.',
    'Oponerte a ciertos tratamientos o pedir que se limiten.',
    'Recibir tu información en un formato portable.',
    'Retirar tu consentimiento en cualquier momento, cuando el tratamiento se base en él.',
  ],
  rightsHow: (email) => `Para ejercer tus derechos, escribinos a ${email}. Te responderemos en el plazo que fije la ley aplicable.`,
  juris: {
    eu: {
      title: 'Información adicional para el EEE (RGPD)',
      paragraphs: [
        'Si estás en el Espacio Económico Europeo, somos el responsable del tratamiento de tu información personal. Tenés derecho a presentar una reclamación ante tu autoridad de protección de datos.',
      ],
    },
    uk: {
      title: 'Información adicional para el Reino Unido (UK GDPR)',
      paragraphs: [
        'Si estás en el Reino Unido, somos el responsable del tratamiento de tu información personal. Tenés derecho a presentar una reclamación ante la Information Commissioner’s Office (ICO).',
      ],
    },
    us: {
      title: 'Información adicional para residentes de California (CCPA/CPRA)',
      paragraphs: [
        'Los residentes de California tienen derecho a saber qué información personal recopilamos, usamos y divulgamos; a pedir su eliminación y corrección; a oponerse a su venta o a que se comparta; y a no ser discriminados por ejercer estos derechos. No vendemos información personal. Si usamos cookies publicitarias, eso puede considerarse "compartir"; podés oponerte desde tu navegador o escribiéndonos.',
      ],
    },
    br: {
      title: 'Información adicional para Brasil (LGPD)',
      paragraphs: [
        'Si estás en Brasil, tenés los derechos del artículo 18 de la Lei Geral de Proteção de Dados (Ley 13.709/2018), incluidos confirmación del tratamiento, acceso, corrección, anonimización, portabilidad y eliminación, y podés presentar una reclamación ante la ANPD.',
      ],
    },
    ar: {
      title: 'Información adicional para Argentina',
      paragraphs: [
        'Si estás en Argentina, podés ejercer tus derechos de acceso, rectificación y supresión según la Ley 25.326. La Agencia de Acceso a la Información Pública, en su carácter de órgano de control, tiene la atribución de atender las denuncias y reclamos que se interpongan con relación al incumplimiento de las normas sobre protección de datos personales.',
      ],
    },
    mx: {
      title: 'Información adicional para México',
      paragraphs: [
        'Si estás en México, podés ejercer tus derechos ARCO (acceso, rectificación, cancelación y oposición) según la ley federal de protección de datos personales aplicable, escribiéndonos.',
      ],
    },
    ca: {
      title: 'Información adicional para Canadá (PIPEDA)',
      paragraphs: [
        'Si estás en Canadá, tratamos la información personal de acuerdo con PIPEDA y las leyes provinciales aplicables. Podés presentar una queja ante la Office of the Privacy Commissioner of Canada.',
      ],
    },
  },
  legalBasis: [
    'Ejecución de un contrato, para prestarte el Servicio que pediste.',
    'Interés legítimo, como proteger y mejorar el Servicio.',
    'Consentimiento, por ejemplo para emails de marketing o cookies no esenciales.',
    'Cumplimiento de obligaciones legales.',
  ],
  transfers:
    'Nuestros proveedores pueden tratar información en países distintos del tuyo. Cuando transferimos información personal fuera de tu país, usamos garantías adecuadas, como cláusulas contractuales tipo.',
  children:
    'El Servicio no está dirigido a menores de 16 años y no recopilamos a sabiendas su información personal. Si creés que un menor nos dio información, escribinos y la eliminaremos.',
  newsletter:
    'Si te suscribís a nuestros emails, te enviaremos novedades y ofertas. Cada email incluye un link para darte de baja.',
  changes:
    'Podemos actualizar esta política. Publicaremos la nueva versión en esta página y actualizaremos la fecha de arriba; si los cambios son importantes, te avisaremos.',
  contact: (c, email, address) =>
    `Si tenés preguntas sobre esta política, contactá a ${c} en ${email}${address ? ` o por correo postal en ${address}` : ''}.`,
};

const PT: Dict = {
  title: 'Política de privacidade',
  updated: (d) => `Última atualização: ${d}`,
  disclaimer:
    'Esta política foi gerada a partir de um modelo e não é aconselhamento jurídico. Peça a um advogado para revisá-la antes de publicar.',
  intro: (c, w) =>
    `Esta Política de privacidade explica como ${c} ("nós") coleta, usa e protege informações pessoais quando você usa ${w} e nossos serviços relacionados (o "Serviço"). Ao usar o Serviço, você concorda com as práticas descritas aqui.`,
  s: {
    collect: 'Informações que coletamos',
    use: 'Como usamos suas informações',
    legalBasis: 'Bases legais do tratamento',
    cookies: 'Cookies e tecnologias semelhantes',
    third: 'Prestadores de serviço',
    sharing: 'Como compartilhamos informações',
    retention: 'Retenção de dados',
    security: 'Segurança',
    rights: 'Seus direitos',
    transfers: 'Transferências internacionais',
    children: 'Privacidade de menores',
    newsletter: 'Emails de marketing',
    changes: 'Alterações nesta política',
    contact: 'Contato',
  },
  collectIntro: 'Dependendo de como você usa o Serviço, podemos coletar:',
  data: {
    contact: 'Dados de contato, como nome, email e telefone.',
    account: 'Dados da conta, como usuário, senha (armazenada com hash) e preferências.',
    payment: 'Dados de cobrança, como endereço de cobrança e meios de pagamento, processados por nossos provedores de pagamento. Não armazenamos números completos de cartão.',
    usage: 'Dados de uso, como páginas visitadas, recursos usados e data e hora das suas visitas.',
    device: 'Dados técnicos e do dispositivo, como endereço IP, navegador, sistema operacional e idioma.',
    location: 'Localização aproximada derivada do seu IP ou, com sua permissão, a localização precisa do seu dispositivo.',
    content: 'Conteúdo que você envia, como mensagens, arquivos, formulários e pedidos de suporte.',
  },
  useIntro: 'Usamos informações pessoais para:',
  uses: {
    provide: 'Fornecer, operar e manter o Serviço, incluindo sua conta.',
    support: 'Responder às suas solicitações e oferecer suporte.',
    security: 'Detectar, prevenir e resolver fraudes, abusos e problemas de segurança.',
    legal: 'Cumprir obrigações legais e fazer valer nossos termos.',
    improve: 'Entender como o Serviço é usado e melhorá-lo.',
    marketing: 'Enviar novidades e ofertas que você assinou (você pode cancelar quando quiser).',
    ads: 'Medir e personalizar publicidade.',
  },
  cookies: {
    base: 'Usamos cookies e tecnologias semelhantes necessários para o funcionamento do Serviço, por exemplo para manter sua sessão e lembrar suas preferências.',
    analytics: 'Também usamos cookies de análise para entender, de forma agregada, como o Serviço é usado.',
    ads: 'Com seu consentimento quando exigido, usamos cookies e pixels de publicidade para medir campanhas e exibir anúncios relevantes em outros sites.',
    control: 'Você pode bloquear ou apagar cookies nas configurações do navegador. Algumas partes do Serviço podem não funcionar sem os cookies necessários.',
  },
  thirdIntro: 'Trabalhamos com provedores confiáveis que tratam informações pessoais em nosso nome, sob contratos que os obrigam a protegê-las:',
  thirdRole: {
    'google-analytics': 'análise do site',
    'meta-pixel': 'medição de publicidade',
    stripe: 'processamento de pagamentos',
    paypal: 'processamento de pagamentos',
    mailchimp: 'email marketing',
    hubspot: 'gestão de clientes (CRM)',
    intercom: 'suporte e mensagens',
    vercel: 'hospedagem e distribuição de conteúdo',
    aws: 'hospedagem e armazenamento em nuvem',
    zerosoft: 'CRM, agenda, suporte e ferramentas de produtividade',
  },
  sharing: [
    'Não vendemos suas informações pessoais.',
    'Compartilhamos informações apenas com os provedores listados acima, quando exigido por lei ou para proteger nossos direitos, ou no contexto de fusão, aquisição ou venda de ativos, caso em que avisaremos você.',
  ],
  retention:
    'Mantemos informações pessoais enquanto sua conta estiver ativa ou enquanto forem necessárias para prestar o Serviço e, depois, apenas pelo tempo necessário para cumprir obrigações legais, resolver disputas e fazer valer nossos acordos.',
  security:
    'Adotamos medidas técnicas e organizacionais razoáveis para proteger informações pessoais, como criptografia em trânsito e controles de acesso. Nenhum método de transmissão ou armazenamento é totalmente seguro.',
  rightsIntro: 'Dependendo de onde você mora, você pode ter o direito de:',
  rights: [
    'Acessar as informações pessoais que temos sobre você.',
    'Corrigir informações inexatas ou incompletas.',
    'Excluir suas informações pessoais.',
    'Opor-se a certos tratamentos ou pedir sua limitação.',
    'Receber suas informações em formato portável.',
    'Retirar seu consentimento a qualquer momento, quando o tratamento se basear nele.',
  ],
  rightsHow: (email) => `Para exercer seus direitos, escreva para ${email}. Responderemos no prazo exigido pela lei aplicável.`,
  juris: {
    eu: {
      title: 'Informações adicionais para o EEE (RGPD)',
      paragraphs: [
        'Se você está no Espaço Económico Europeu, somos o controlador das suas informações pessoais. Você tem o direito de apresentar reclamação à autoridade de proteção de dados local.',
      ],
    },
    uk: {
      title: 'Informações adicionais para o Reino Unido (UK GDPR)',
      paragraphs: [
        'Se você está no Reino Unido, somos o controlador das suas informações pessoais. Você tem o direito de apresentar reclamação ao Information Commissioner’s Office (ICO).',
      ],
    },
    us: {
      title: 'Informações adicionais para residentes da Califórnia (CCPA/CPRA)',
      paragraphs: [
        'Residentes da Califórnia têm o direito de saber quais informações pessoais coletamos, usamos e divulgamos; de pedir sua exclusão e correção; de recusar a venda ou o compartilhamento; e de não sofrer discriminação por exercer esses direitos. Não vendemos informações pessoais. Se usamos cookies de publicidade, isso pode ser considerado "compartilhamento"; você pode recusar pelo navegador ou nos escrevendo.',
      ],
    },
    br: {
      title: 'Informações adicionais para o Brasil (LGPD)',
      paragraphs: [
        'Se você está no Brasil, você tem os direitos do artigo 18 da Lei Geral de Proteção de Dados (Lei 13.709/2018), incluindo confirmação do tratamento, acesso, correção, anonimização, portabilidade e eliminação, e pode apresentar reclamação à ANPD.',
      ],
    },
    ar: {
      title: 'Informações adicionais para a Argentina',
      paragraphs: [
        'Se você está na Argentina, pode exercer seus direitos de acesso, retificação e supressão nos termos da Lei 25.326. A Agencia de Acceso a la Información Pública, como autoridade de controle, recebe denúncias e reclamações sobre o descumprimento das normas de proteção de dados pessoais.',
      ],
    },
    mx: {
      title: 'Informações adicionais para o México',
      paragraphs: [
        'Se você está no México, pode exercer seus direitos ARCO (acesso, retificação, cancelamento e oposição) nos termos da lei federal de proteção de dados pessoais aplicável, entrando em contato conosco.',
      ],
    },
    ca: {
      title: 'Informações adicionais para o Canadá (PIPEDA)',
      paragraphs: [
        'Se você está no Canadá, tratamos informações pessoais de acordo com a PIPEDA e as leis provinciais aplicáveis. Você pode apresentar reclamação ao Office of the Privacy Commissioner of Canada.',
      ],
    },
  },
  legalBasis: [
    'Execução de contrato, para prestar o Serviço que você solicitou.',
    'Legítimo interesse, como proteger e melhorar o Serviço.',
    'Consentimento, por exemplo para emails de marketing ou cookies não essenciais.',
    'Cumprimento de obrigações legais.',
  ],
  transfers:
    'Nossos provedores podem tratar informações em países diferentes do seu. Quando transferimos informações pessoais internacionalmente, usamos salvaguardas adequadas, como cláusulas contratuais padrão.',
  children:
    'O Serviço não é direcionado a menores de 16 anos e não coletamos intencionalmente suas informações pessoais. Se você acredita que um menor nos forneceu informações, escreva para nós e as excluiremos.',
  newsletter:
    'Se você assinar nossos emails, enviaremos novidades e ofertas. Todo email inclui um link para cancelar a inscrição.',
  changes:
    'Podemos atualizar esta política. Publicaremos a nova versão nesta página e atualizaremos a data acima; se as mudanças forem relevantes, avisaremos você.',
  contact: (c, email, address) =>
    `Se você tiver dúvidas sobre esta política, entre em contato com ${c} pelo email ${email}${address ? ` ou por correio em ${address}` : ''}.`,
};

const DICTS: Record<string, Dict> = { en: EN, es: ES, pt: PT };

function formatDate(iso: string, locale: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(d);
}

export function generatePolicy(input: PolicyInput, locale = 'en'): Policy {
  const t = DICTS[locale] ?? EN;
  const company = input.company.trim() || '[Company]';
  const website = input.website.trim() || '[website]';
  const email = input.email.trim() || '[email]';
  const address = input.address.trim();
  const sections: PolicySection[] = [];
  const add = (id: string, paragraphs: string[], bullets?: string[]) =>
    sections.push({ id, title: t.s[id], paragraphs, bullets });

  sections.push({ id: 'intro', title: '', paragraphs: [t.intro(company, website)] });

  const data = DATA_KINDS.filter((k) => input.data.includes(k));
  add('collect', [t.collectIntro], data.length ? data.map((k) => t.data[k]) : [t.data.contact]);

  const uses = [t.uses.provide, t.uses.support, t.uses.security, t.uses.legal];
  if (input.analytics || data.includes('usage')) uses.push(t.uses.improve);
  if (input.newsletter) uses.push(t.uses.marketing);
  if (input.ads) uses.push(t.uses.ads);
  add('use', [t.useIntro], uses);

  if (input.jurisdiction === 'eu' || input.jurisdiction === 'uk' || input.jurisdiction === 'br') {
    add('legalBasis', [], t.legalBasis);
  }

  if (input.cookies || input.analytics || input.ads) {
    const ps = [t.cookies.base];
    if (input.analytics) ps.push(t.cookies.analytics);
    if (input.ads) ps.push(t.cookies.ads);
    ps.push(t.cookies.control);
    add('cookies', ps);
  }

  const third = THIRD_PARTIES.filter((k) => input.thirdParties.includes(k));
  if (third.length) add('third', [t.thirdIntro], third.map((k) => `${THIRD_PARTY_NAMES[k]}: ${t.thirdRole[k]}.`));

  add('sharing', t.sharing);
  add('retention', [t.retention]);
  add('security', [t.security]);
  add('rights', [t.rightsIntro, t.rightsHow(email)], t.rights);

  const juris = t.juris[input.jurisdiction];
  if (juris) sections.push({ id: `juris-${input.jurisdiction}`, title: juris.title, paragraphs: juris.paragraphs });

  if (third.length || input.jurisdiction === 'eu' || input.jurisdiction === 'uk') add('transfers', [t.transfers]);
  if (input.newsletter) add('newsletter', [t.newsletter]);
  if (input.noChildren) add('children', [t.children]);
  add('changes', [t.changes]);
  add('contact', [t.contact(company, email, address)]);

  return {
    title: `${t.title} — ${company}`,
    updated: t.updated(formatDate(input.effectiveDate, locale)),
    disclaimer: t.disclaimer,
    sections,
  };
}

export function policyToMarkdown(p: Policy): string {
  const out = [`# ${p.title}`, '', `_${p.updated}_`, ''];
  for (const s of p.sections) {
    if (s.title) out.push(`## ${s.title}`, '');
    for (const para of s.paragraphs) out.push(para, '');
    if (s.bullets?.length) {
      for (const b of s.bullets) out.push(`- ${b}`);
      out.push('');
    }
  }
  out.push('---', '', `> ${p.disclaimer}`, '');
  return out.join('\n');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Fragmento HTML (sin <html>), listo para pegar en un CMS. */
export function policyToHtml(p: Policy): string {
  const out = [`<h1>${esc(p.title)}</h1>`, `<p><em>${esc(p.updated)}</em></p>`];
  for (const s of p.sections) {
    if (s.title) out.push(`<h2>${esc(s.title)}</h2>`);
    for (const para of s.paragraphs) out.push(`<p>${esc(para)}</p>`);
    if (s.bullets?.length) out.push(`<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`);
  }
  out.push(`<hr />`, `<p><small>${esc(p.disclaimer)}</small></p>`);
  return out.join('\n');
}
