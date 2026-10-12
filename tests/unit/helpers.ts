import { upsertUser } from '@/lib/db';

let n = 0;
export async function makeUser(label = 'u') {
  n += 1;
  const id = `${label}-${n}-${crypto.randomUUID().slice(0, 8)}`;
  return upsertUser({ id, email: `${id}@test.local`, name: label, image: null });
}
