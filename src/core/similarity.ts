/** Shared token Jaccard used by dream planning and create-time similar-slug checks. */

export const BODY_SIMILAR = 0.82;
export const TITLE_OVERLAP = 0.55;
export const BODY_DIVERGE = 0.35;

const HAN = /\p{Script=Han}/u;
const NEGATORS = new Set(["not", "no", "never", "without", "cannot", "cant", "wont", "dont"]);
const AUXILIARY = new Set(["a", "an", "are", "be", "been", "being", "can", "do", "does", "did", "is", "must", "should", "the", "to", "will"]);
const ACTION_WORDS = new Set([
  "allow",
  "allowed",
  "delete",
  "deleted",
  "disable",
  "disabled",
  "enable",
  "enabled",
  "install",
  "merge",
  "publish",
  "read",
  "run",
  "store",
  "stored",
  "use",
  "write",
  "written",
]);
const HAN_ACTIONS = ["允许", "需要", "可以", "必须", "应该", "启用", "使用", "写入", "删除", "读取", "发布", "覆盖", "合并", "存储", "保存", "提交", "运行"];

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
  if (hasHardDivergence(prev, incoming)) return false;
  const score = jaccard(prevTok, nextTok);
  if (score >= BODY_SIMILAR) return true;
  if (score < BODY_DIVERGE) return false;
  return overlapOf(prevTok, nextTok) >= BODY_SIMILAR;
}

export function hasHardDivergence(prev: string, incoming: string): boolean {
  if (changedValues(prev, incoming)) return true;
  const a = polarity(prev);
  const b = polarity(incoming);
  return intersects(a.negative, b.positive) || intersects(a.positive, b.negative);
}

function changedValues(prev: string, incoming: string): boolean {
  const a = values(prev);
  const b = values(incoming);
  if (!a.size || !b.size) return false;
  return !setEqual(a, b) && !isSubset(a, b) && !isSubset(b, a);
}

function values(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/\bv?\d+(?:\.\d+)*\b/g) ?? []);
}

function polarity(text: string): { positive: Set<string>; negative: Set<string> } {
  const positive = new Set<string>();
  const negative = new Set<string>();
  addLatinPolarity(text, positive, negative);
  addHanPolarity(text, positive, negative);
  return { positive, negative };
}

function addLatinPolarity(text: string, positive: Set<string>, negative: Set<string>): void {
  const words = text
    .toLowerCase()
    .replace(/\b(can|do|does|did|will|would|should|must)n['’]?t\b/g, "$1 not")
    .match(/[a-z0-9]+/g) ?? [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (!ACTION_WORDS.has(word)) continue;
    const object = nearestObject(words, i);
    const key = `${word}:${object}`;
    if (isNegated(words, i)) negative.add(key);
    else positive.add(key);
  }
}

function nearestObject(words: string[], index: number): string {
  for (let i = index + 1; i < Math.min(words.length, index + 5); i += 1) {
    if (words[i].length > 2 && !AUXILIARY.has(words[i]) && !NEGATORS.has(words[i])) return words[i];
  }
  for (let i = index - 1; i >= Math.max(0, index - 5); i -= 1) {
    if (words[i].length > 2 && !AUXILIARY.has(words[i]) && !NEGATORS.has(words[i])) return words[i];
  }
  return "*";
}

function isNegated(words: string[], index: number): boolean {
  for (let i = Math.max(0, index - 3); i < index; i += 1) {
    if (NEGATORS.has(words[i])) return true;
  }
  return false;
}

function addHanPolarity(text: string, positive: Set<string>, negative: Set<string>): void {
  for (const action of HAN_ACTIONS) {
    let start = 0;
    while (true) {
      const index = text.indexOf(action, start);
      if (index === -1) break;
      const object = nextHanAction(text, index + action.length) ?? previousHanToken(text, index) ?? "*";
      const key = `${action}:${object}`;
      if (hanNegated(text, index)) negative.add(key);
      else positive.add(key);
      start = index + action.length;
    }
  }
}

function hanNegated(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 6), index);
  return /(?:不|无|没|未|非|禁止|不要|不能|不可|拒绝)$/.test(before);
}

function nextHanAction(text: string, from: number): string | undefined {
  const tail = text.slice(from, from + 8);
  return HAN_ACTIONS.find((action) => tail.includes(action));
}

function previousHanToken(text: string, index: number): string | undefined {
  const before = [...text.slice(Math.max(0, index - 4), index)].filter((ch) => HAN.test(ch)).join("");
  return before || undefined;
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const item of a) if (b.has(item)) return true;
  return false;
}

function setEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  for (const item of a) if (!b.has(item)) return false;
  return true;
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
