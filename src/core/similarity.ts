/** Shared token Jaccard used by dream planning and create-time similar-slug checks. */

export const BODY_SIMILAR = 0.82;
export const TITLE_OVERLAP = 0.55;
export const BODY_DIVERGE = 0.35;

const HAN = /\p{Script=Han}/u;

/**
 * Latin words (len > 2) plus overlapping Han character bigrams.
 * CJK has no spaces; a latin-only split treats 中文 as empty, so same-slug
 * conflict never fires. Bigrams match OpenSearch `cjk_bigram` / agentmemory:
 * zero dictionary. A non-Han character breaks the run (mixed 禁止 pnpm 不
 * join across the English). Single-character runs emit a unigram.
 * Ceiling: Hangul/Kana are not Han and stay on the latin path.
 */
export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const part of text.toLowerCase().split(/[^a-z0-9]+/g)) {
    if (part.length > 2) out.add(part);
  }
  addHanBigrams(out, text);
  return out;
}

function addHanBigrams(out: Set<string>, text: string): void {
  const run: string[] = [];
  const flush = (): void => {
    if (run.length === 1) out.add(run[0]);
    else {
      for (let i = 0; i < run.length - 1; i += 1) out.add(run[i] + run[i + 1]);
    }
    run.length = 0;
  };
  for (const ch of text) {
    if (HAN.test(ch)) run.push(ch);
    else flush();
  }
  flush();
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const item of a) if (b.has(item)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** |A∩B| / min(|A|,|B|). Empty-empty is 0. */
function overlapOf(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const item of a) if (b.has(item)) inter += 1;
  return inter / Math.min(a.size, b.size);
}

export function overlapScore(a: string, b: string): number {
  return overlapOf(tokens(a), tokens(b));
}

export function bodyScore(a: string, b: string): number {
  return jaccard(tokens(a), tokens(b));
}

/**
 * Same-slug agree vs conflict. Empty previous still upserts.
 * Gray Jaccard [BODY_DIVERGE, BODY_SIMILAR): agree iff overlap ≥ BODY_SIMILAR
 * (a Chinese added sentence is Jaccard ~0.77 with overlap 1).
 */
export function bodiesAgree(prev: string, incoming: string): boolean {
  const prevTok = tokens(prev);
  if (prevTok.size === 0) return true;
  const nextTok = tokens(incoming);
  const score = jaccard(prevTok, nextTok);
  if (score >= BODY_SIMILAR) return true;
  if (score < BODY_DIVERGE) return false;
  return overlapOf(prevTok, nextTok) >= BODY_SIMILAR;
}

export function titleScore(
  a: { name: string; description: string },
  b: { name: string; description: string },
): number {
  return jaccard(tokens(`${a.name} ${a.description}`), tokens(`${b.name} ${b.description}`));
}

export function isCloseTopic(
  incoming: { name: string; description: string; body: string },
  existing: { name: string; description: string; body: string },
): boolean {
  const incomingBody = tokens(incoming.body);
  const existingBody = tokens(existing.body);
  const incomingTitle = tokens(`${incoming.name} ${incoming.description}`);
  const existingTitle = tokens(`${existing.name} ${existing.description}`);
  if (incomingBody.size === 0 && existingBody.size === 0 && incomingTitle.size === 0 && existingTitle.size === 0) {
    return false;
  }
  const bodies =
    incomingBody.size === 0 && existingBody.size === 0 ? 0 : jaccard(incomingBody, existingBody);
  const titles =
    incomingTitle.size === 0 && existingTitle.size === 0 ? 0 : jaccard(incomingTitle, existingTitle);
  return bodies >= BODY_SIMILAR || titles >= TITLE_OVERLAP;
}
