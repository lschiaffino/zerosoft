/**
 * Asociado que la persona no puede ver (fuera de su alcance por owner o
 * equipo): una etiqueta neutra, sin nombre ni link. Sirve en server y client:
 * el texto llega ya traducido (crm.common.privateRecord).
 */
export default function PrivateRecord({ label }: { label: string }) {
  return (
    <span className="muted crm-private-record" data-testid="crm-private-record">
      {label}
    </span>
  );
}
