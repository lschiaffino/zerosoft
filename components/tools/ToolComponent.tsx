import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

/**
 * Componente interactivo de cada herramienta. Con next/dynamic cada página
 * carga solo el JS de su herramienta (SSR incluido).
 */
const SignatureGenerator = dynamic(() => import('./SignatureGenerator'));
const QrGenerator = dynamic(() => import('./QrGenerator'));
const InvoiceGenerator = dynamic(() => import('./InvoiceGenerator'));
const SaasCalculator = dynamic(() => import('./SaasCalculator'));
const PrivacyPolicyGenerator = dynamic(() => import('./PrivacyPolicyGenerator'));
const WebsiteGrader = dynamic(() => import('./WebsiteGrader'));
const UtmBuilder = dynamic(() => import('./UtmBuilder'));
const BusinessNameGenerator = dynamic(() => import('./AiTools').then((m) => m.BusinessNameGenerator));
const CopyWriter = dynamic(() => import('./AiTools').then((m) => m.CopyWriter));
const PersonaGenerator = dynamic(() => import('./AiTools').then((m) => m.PersonaGenerator));
const BlogIdeasGenerator = dynamic(() => import('./AiTools').then((m) => m.BlogIdeasGenerator));

const EmailWriter = () => <CopyWriter mode="email" />;
const AdWriter = () => <CopyWriter mode="ad" />;

const COMPONENTS: Record<string, ComponentType> = {
  'email-signature-generator': SignatureGenerator,
  'qr-code-generator': QrGenerator,
  'invoice-generator': InvoiceGenerator,
  'saas-cost-calculator': SaasCalculator,
  'privacy-policy-generator': PrivacyPolicyGenerator,
  'business-name-generator': BusinessNameGenerator,
  'ai-email-writer': EmailWriter,
  'ai-ad-copy-generator': AdWriter,
  'website-grader': WebsiteGrader,
  'buyer-persona-generator': PersonaGenerator,
  'blog-ideas-generator': BlogIdeasGenerator,
  'utm-builder': UtmBuilder,
};

export default function ToolComponent({ slug }: { slug: string }) {
  const C = COMPONENTS[slug];
  return C ? <C /> : null;
}
