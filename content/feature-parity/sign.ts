import type { Localized, ParityRow, ParityStatus, ProductParity } from './types';

type L = [en: string, es: string, pt: string];
const loc = ([en, es, pt]: L): Localized => ({ en, es, pt });

function row(
  id: string,
  area: string,
  label: L,
  status: ParityStatus,
  opts: { detail?: L; competitorHas?: boolean; weight?: 1 | 2 } = {},
): ParityRow {
  return {
    id,
    area,
    label: loc(label),
    ...(opts.detail ? { detail: loc(opts.detail) } : {}),
    status,
    competitorHas: opts.competitorHas ?? true,
    ...(opts.weight ? { weight: opts.weight } : {}),
  };
}

/**
 * Sign contra DocuSign eSignature. Fuente: la documentación pública de
 * DocuSign (eSignature user guide: envelopes, recipients, fields, signing,
 * templates, bulk send, certificate of completion, authentication), leída el
 * 2026-10-30, contra el código de esta primera versión. Los ids son estables.
 *
 * Honestidad legal: Sign hace firma electrónica simple con registro de
 * auditoría (estilo ESIGN/UETA). Las firmas avanzadas o calificadas (eIDAS)
 * y la "firma digital" de la Ley 25.506 (AR) quedan como missing.
 */
const parity: ProductParity = {
  competitor: 'DocuSign',
  lastReviewed: '2026-10-30',
  areas: [
    { id: 'envelopes', label: loc(['Envelopes and documents', 'Sobres y documentos', 'Envelopes e documentos']) },
    { id: 'recipients', label: loc(['Recipients and routing', 'Destinatarios y orden', 'Destinatários e ordem']) },
    { id: 'fields', label: loc(['Fields', 'Campos', 'Campos']) },
    { id: 'signing', label: loc(['Signing experience', 'Experiencia de firma', 'Experiência de assinatura']) },
    { id: 'security', label: loc(['Authentication and security', 'Autenticación y seguridad', 'Autenticação e segurança']) },
    { id: 'completion', label: loc(['Completion and audit trail', 'Finalización y auditoría', 'Conclusão e auditoria']) },
    { id: 'templates', label: loc(['Templates and bulk send', 'Plantillas y envío masivo', 'Modelos e envio em massa']) },
    { id: 'integrations', label: loc(['Integrations and platform', 'Integraciones y plataforma', 'Integrações e plataforma']) },
    { id: 'legal', label: loc(['Legal standing', 'Validez legal', 'Validade jurídica']) },
  ],
  rows: [
    // Sobres y documentos
    row('upload-pdf', 'envelopes', ['Upload a PDF', 'Subir un PDF', 'Enviar um PDF'], 'have', {
      detail: ['Checked by its bytes, up to 4 MB and 100 pages; scripts, actions, forms and attachments are removed', 'Validado por sus bytes, hasta 4 MB y 100 páginas; se sacan scripts, acciones, formularios y adjuntos', 'Validado pelos bytes, até 4 MB e 100 páginas; scripts, ações, formulários e anexos são removidos'],
    }),
    row('other-formats', 'envelopes', ['Word, Excel and image files', 'Archivos de Word, Excel e imágenes', 'Arquivos do Word, Excel e imagens'], 'missing', {
      detail: ['Only PDF; DocuSign converts many formats', 'Solo PDF; DocuSign convierte muchos formatos', 'Só PDF; o DocuSign converte muitos formatos'],
    }),
    row('cloud-import', 'envelopes', ['Documents from other sources', 'Documentos desde otras fuentes', 'Documentos de outras fontes'], 'partial', {
      detail: ['A Docs page becomes the PDF; no Google Drive, Dropbox, Box or OneDrive', 'Una página de Docs se convierte en el PDF; sin Google Drive, Dropbox, Box ni OneDrive', 'Uma página do Docs vira o PDF; sem Google Drive, Dropbox, Box ou OneDrive'],
    }),
    row('multi-document', 'envelopes', ['Several documents in one envelope', 'Varios documentos en un sobre', 'Vários documentos em um envelope'], 'missing'),
    row('message-expiry-reminders', 'envelopes', ['Message, expiry and reminders', 'Mensaje, vencimiento y recordatorios', 'Mensagem, vencimento e lembretes'], 'have', {
      detail: ['Expiry in days and a reminder every N days while someone has not signed', 'Vencimiento en días y un recordatorio cada N días mientras alguien no firmó', 'Vencimento em dias e um lembrete a cada N dias enquanto alguém não assinou'],
    }),
    row('void', 'envelopes', ['Void an envelope', 'Anular un sobre', 'Anular um envelope'], 'have', { detail: ['With a reason that recipients receive by email', 'Con un motivo que les llega por email a los destinatarios', 'Com um motivo que os destinatários recebem por email'] }),
    row('correct', 'envelopes', ['Correct an envelope in progress', 'Corregir un sobre en curso', 'Corrigir um envelope em andamento'], 'partial', {
      detail: ['A sent envelope is fixed: void it and copy it to a new draft', 'Un sobre enviado queda fijo: se anula y se copia a un borrador nuevo', 'Um envelope enviado fica fixo: anule e copie para um novo rascunho'],
    }),
    row('dashboard', 'envelopes', ['Envelope list with status and search', 'Lista de sobres con estado y búsqueda', 'Lista de envelopes com status e busca'], 'have', {
      detail: ['Waiting on me, waiting on others, completed, closed and drafts; detail with timeline and hashes', 'Esperan mi firma, esperan a otros, completados, cerrados y borradores; detalle con línea de tiempo y hashes', 'Esperam minha assinatura, esperam outros, concluídos, fechados e rascunhos; detalhe com linha do tempo e hashes'],
    }),
    row('folders', 'envelopes', ['Folders and shared envelopes', 'Carpetas y sobres compartidos', 'Pastas e envelopes compartilhados'], 'missing'),

    // Destinatarios
    row('roles', 'recipients', ['Signers, approvers and CCs', 'Firmantes, aprobadores y copias', 'Signatários, aprovadores e cópias'], 'have'),
    row('other-roles', 'recipients', ['In-person signer, editor, intermediary, certified delivery', 'Firmante presencial, editor, intermediario, entrega certificada', 'Signatário presencial, editor, intermediário, entrega certificada'], 'missing'),
    row('signing-order', 'recipients', ['Sequential or parallel signing order', 'Orden de firma secuencial o en paralelo', 'Ordem de assinatura sequencial ou em paralelo'], 'have', {
      detail: ['Same number signs in parallel, the next number only after them', 'El mismo número firma en paralelo; el número siguiente, después', 'O mesmo número assina em paralelo; o número seguinte, depois'],
      weight: 2,
    }),
    row('conditional-routing', 'recipients', ['Conditional routing', 'Orden condicional', 'Roteamento condicional'], 'missing'),

    // Campos
    row('standard-fields', 'fields', ['Signature, initials, date, name, email, text, checkbox and dropdown', 'Firma, iniciales, fecha, nombre, email, texto, casilla y lista', 'Assinatura, iniciais, data, nome, email, texto, caixa e lista'], 'have', { weight: 2 }),
    row('required-optional', 'fields', ['Required and optional fields', 'Campos obligatorios y opcionales', 'Campos obrigatórios e opcionais'], 'have'),
    row('advanced-fields', 'fields', ['Formulas, radio groups, attachments and conditional fields', 'Fórmulas, grupos de opciones, adjuntos y campos condicionales', 'Fórmulas, grupos de opções, anexos e campos condicionais'], 'missing'),
    row('auto-place', 'fields', ['Auto-place fields by text anchors', 'Ubicar campos por texto ancla', 'Posicionar campos por texto âncora'], 'missing'),

    // Firma
    row('no-account', 'signing', ['Sign without an account', 'Firmar sin cuenta', 'Assinar sem conta'], 'have', { detail: ['Personal link per recipient, single use, expiring and revocable', 'Link personal por destinatario, de un solo uso, con vencimiento y revocable', 'Link pessoal por destinatário, de uso único, com vencimento e revogável'] }),
    row('consent', 'signing', ['Consent to sign electronically', 'Consentimiento para firmar electrónicamente', 'Consentimento para assinar eletronicamente'], 'have'),
    row('guided', 'signing', ['Guided field filling', 'Campos guiados', 'Campos guiados'], 'have'),
    row('adopt-signature', 'signing', ['Type, draw or upload the signature', 'Escribir, dibujar o subir la firma', 'Digitar, desenhar ou enviar a assinatura'], 'have'),
    row('decline', 'signing', ['Decline with a reason', 'Rechazar con un motivo', 'Recusar com um motivo'], 'have'),
    row('mobile', 'signing', ['Signing on a phone', 'Firma desde el celular', 'Assinatura pelo celular'], 'have', { detail: ['Responsive page at 390 px; no native app', 'Página adaptable a 390 px; sin app nativa', 'Página adaptável a 390 px; sem app nativo'] }),
    row('signer-languages', 'signing', ['Signing in the recipient language', 'Firma en el idioma del destinatario', 'Assinatura no idioma do destinatário'], 'partial', { detail: ['English, Spanish and Portuguese', 'Inglés, español y portugués', 'Inglês, espanhol e português'] }),
    row('in-person', 'signing', ['In-person signing', 'Firma presencial', 'Assinatura presencial'], 'missing'),
    row('payments', 'signing', ['Collect a payment while signing', 'Cobrar al firmar', 'Cobrar ao assinar'], 'missing'),

    // Seguridad
    row('email-otp', 'security', ['Email verification code', 'Código de verificación por email', 'Código de verificação por email'], 'have', {
      detail: ['On by default; codes and links are stored hashed, with limits per recipient and per IP', 'Activado por defecto; códigos y links se guardan como hash, con límites por destinatario y por IP', 'Ativado por padrão; códigos e links são guardados como hash, com limites por destinatário e por IP'],
    }),
    row('sms-id', 'security', ['SMS, phone and ID verification', 'Verificación por SMS, teléfono e identidad', 'Verificação por SMS, telefone e identidade'], 'missing'),
    row('field-isolation', 'security', ['Each recipient fills only their own fields', 'Cada destinatario completa solo sus campos', 'Cada destinatário preenche só os seus campos'], 'have'),
    row('private-files', 'security', ['Private document storage', 'Documentos guardados en privado', 'Documentos guardados em privado'], 'have', {
      detail: ['Private Blob or AES-256-GCM encrypted files; only the sender, admins and recipients through their link', 'Blob privado o archivos cifrados con AES-256-GCM; solo quien envía, los admins y los destinatarios con su link', 'Blob privado ou arquivos cifrados com AES-256-GCM; só quem envia, os admins e os destinatários pelo link'],
    }),

    // Finalización
    row('flatten', 'completion', ['Signed PDF with the fields drawn in', 'PDF firmado con los campos dibujados', 'PDF assinado com os campos desenhados'], 'have', { weight: 2 }),
    row('certificate', 'completion', ['Certificate of completion', 'Certificado de finalización', 'Certificado de conclusão'], 'have', {
      detail: ['Every event with IP, browser and time, and the SHA-256 of the original and of the signed document', 'Cada evento con IP, navegador y hora, y el SHA-256 del original y del documento firmado', 'Cada evento com IP, navegador e horário, e o SHA-256 do original e do documento assinado'],
      weight: 2,
    }),
    row('pdf-seal', 'completion', ['Tamper-evident digital seal on the PDF', 'Sello digital del PDF contra alteraciones', 'Selo digital do PDF contra alterações'], 'missing', {
      detail: ['The final file is not signed with a PKI certificate; integrity is checked with the SHA-256 shown in the app and the email', 'El archivo final no va firmado con un certificado PKI; la integridad se verifica con el SHA-256 de la app y del email', 'O arquivo final não é assinado com um certificado PKI; a integridade é verificada com o SHA-256 do app e do email'],
    }),
    row('copy-everyone', 'completion', ['Signed copy to everyone', 'Copia firmada para todos', 'Cópia assinada para todos'], 'have'),

    // Plantillas
    row('templates', 'templates', ['Templates with roles and fields', 'Plantillas con roles y campos', 'Modelos com papéis e campos'], 'have', { weight: 2 }),
    row('bulk-send', 'templates', ['Bulk send from a CSV', 'Envío masivo desde un CSV', 'Envio em massa por CSV'], 'partial', {
      detail: ['Up to 200 rows; the CSV fills the first signer role and the other roles are fixed', 'Hasta 200 filas; el CSV completa el primer rol que firma y los otros roles van fijos', 'Até 200 linhas; o CSV preenche o primeiro papel que assina e os outros papéis ficam fixos'],
    }),
    row('powerforms', 'templates', ['Self-service signing links (PowerForms)', 'Links de firma de autoservicio (PowerForms)', 'Links de assinatura de autoatendimento (PowerForms)'], 'missing'),
    row('branding', 'templates', ['Custom branding', 'Marca propia', 'Marca própria'], 'missing'),

    // Integraciones
    row('crm', 'integrations', ['Send from the CRM', 'Enviar desde el CRM', 'Enviar pelo CRM'], 'have', {
      detail: ['From a deal or contact; the signed PDF is attached to the record', 'Desde un deal o contacto; el PDF firmado queda adjunto al registro', 'De um negócio ou contato; o PDF assinado fica anexado ao registro'],
    }),
    row('hr', 'integrations', ['Offer letters and HR documents', 'Cartas oferta y documentos de RR. HH.', 'Cartas de oferta e documentos de RH'], 'partial', {
      detail: ['Hiring offers go out for signature and are accepted when signed; People can link envelopes through the API until its app ships', 'Las ofertas de Hiring salen a firmar y quedan aceptadas al firmarse; People vincula sobres por la API hasta que salga su app', 'As ofertas do Hiring saem para assinatura e ficam aceitas ao assinar; o People vincula envelopes pela API até seu app sair'],
    }),
    row('automations', 'integrations', ['Automations on completed and declined', 'Automatizaciones al completar y rechazar', 'Automações ao concluir e recusar'], 'have', { detail: ['Flow triggers', 'Disparadores de Flow', 'Gatilhos do Flow'] }),
    row('api', 'integrations', ['API and webhooks', 'API y webhooks', 'API e webhooks'], 'partial', {
      detail: ['Read envelopes with an API key (sign:read); events through Flow, no DocuSign Connect equivalent', 'Lectura de sobres con una API key (sign:read); eventos por Flow, sin equivalente a DocuSign Connect', 'Leitura de envelopes com uma API key (sign:read); eventos pelo Flow, sem equivalente ao DocuSign Connect'],
    }),
    row('assistant', 'integrations', ['AI assistant over your envelopes', 'Asistente sobre tus sobres', 'Assistente sobre seus envelopes'], 'better', {
      competitorHas: false,
      detail: ['Reads envelopes and templates you can see; sends from a template after you confirm', 'Lee sobres y plantillas que podés ver; envía desde una plantilla cuando confirmás', 'Lê envelopes e modelos que você pode ver; envia de um modelo quando você confirma'],
    }),
    row('mobile-app', 'integrations', ['Mobile app', 'App móvil', 'App móvel'], 'missing'),

    // Validez legal
    row('simple-esignature', 'legal', ['Simple electronic signature with an audit trail', 'Firma electrónica simple con registro de auditoría', 'Assinatura eletrônica simples com trilha de auditoria'], 'have', {
      detail: ['The kind recognized by the US ESIGN Act and UETA', 'Del tipo que reconocen la ESIGN Act y UETA de EE. UU.', 'Do tipo reconhecido pelo ESIGN Act e pela UETA dos EUA'],
      weight: 2,
    }),
    row('eidas-aes-qes', 'legal', ['Advanced and qualified signatures (eIDAS AES and QES)', 'Firmas avanzadas y calificadas (eIDAS AES y QES)', 'Assinaturas avançadas e qualificadas (eIDAS AES e QES)'], 'missing'),
    row('firma-digital-ar', 'legal', ['Digital signature under Argentine Law 25.506', 'Firma digital de la Ley 25.506 (Argentina)', 'Assinatura digital da Lei 25.506 (Argentina)'], 'missing', {
      detail: ['Needs a licensed certifier; Sign does not issue certificates', 'Pide un certificador licenciado; Sign no emite certificados', 'Exige um certificador licenciado; o Sign não emite certificados'],
    }),
  ],
};

export default parity;
