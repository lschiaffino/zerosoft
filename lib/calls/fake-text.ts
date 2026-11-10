/** Calls: lo que "se dijo" en la reunión simulada de los tests (puro). */
export const CALLS_FAKE_TEXT =
  'Thanks for joining, Ana. How are you handling sales calls today? We record some calls but our current tool is too expensive for the team. What would it mean for you to cut that cost in half? It would save us about two thousand dollars a month. We also looked at Gong last quarter. Who else is involved in the decision? Our CFO signs anything above five thousand. Great, I will send a proposal by Friday and we can review it with your CFO next week.';

export function fakeSentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]?/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
}
