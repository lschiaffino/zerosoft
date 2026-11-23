import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-1352-sign-image-documents',
  date: '2026-11-23',
  title: {
    en: 'Sign: send a photo or a scan for signature',
    es: 'Sign: mandar a firmar una foto o un escaneo',
    pt: 'Sign: enviar uma foto ou digitalização para assinatura',
  },
  items: [
    {
      product: 'sign',
      en: 'Envelopes and templates now accept a JPEG or PNG image as well as a PDF. The image becomes a one-page A4 PDF, portrait or landscape to match it, and phone photos are turned upright. From there it works like any other document: place fields, send, and the certificate shows the hash of the file you uploaded and of the PDF that was signed.',
      es: 'Los sobres y las plantillas ahora aceptan una imagen JPEG o PNG además de un PDF. La imagen se convierte en un PDF A4 de una página, vertical u horizontal según la imagen, y las fotos del celular quedan derechas. Desde ahí funciona como cualquier documento: ubicás los campos, lo enviás, y el certificado muestra el hash del archivo que subiste y el del PDF que se firmó.',
      pt: 'Envelopes e modelos agora aceitam uma imagem JPEG ou PNG além de um PDF. A imagem vira um PDF A4 de uma página, retrato ou paisagem conforme a imagem, e as fotos do celular ficam na posição certa. A partir daí funciona como qualquer documento: você posiciona os campos, envia, e o certificado mostra o hash do arquivo enviado e o do PDF assinado.',
    },
  ],
} satisfies ChangelogEntry;
