/** Links para abrir un borrador de email en Gmail, Outlook o la app de correo (puro). */
export function composeLinks(f: { to: string[]; subject: string; body: string }) {
  const to = f.to.join(',');
  return {
    gmail: `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(f.subject)}&body=${encodeURIComponent(f.body)}`,
    outlook: `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(f.subject)}&body=${encodeURIComponent(f.body)}`,
    mailto: `mailto:${f.to.map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(f.subject)}&body=${encodeURIComponent(f.body)}`,
  };
}
