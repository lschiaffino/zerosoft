/**
 * Opciones para `request.post('/api/inbox/whatsapp', waLinkIp())`.
 *
 * Vincular el WhatsApp de Inbox tiene tope por IP (20 cada 10 minutos, en
 * app/api/inbox/whatsapp/route.ts). En CI todo el shard pega desde 127.0.0.1,
 * y más de 20 specs que vinculan en el mismo shard dejaban a las siguientes en
 * "disconnected" según cómo cayera el reparto. Cada vinculación de un test
 * viene de una IP propia (el servidor de e2e toma la de x-forwarded-for), así
 * el tope sigue probándose como lo vive una persona y no depende del shard.
 */
export function waLinkIp(): { headers: Record<string, string> } {
  const b = () => 1 + Math.floor(Math.random() * 254);
  return { headers: { 'x-forwarded-for': `10.${b()}.${b()}.${b()}` } };
}
