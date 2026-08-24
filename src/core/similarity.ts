/** Shared token Jaccard used by dream planning and create-time similar-slug checks. */

export const BODY_SIMILAR = 0.82;
export const TITLE_OVERLAP = 0.55;
export const BODY_DIVERGE = 0.35;

export function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((part) => part.length > 2),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const item of a) if (b.has(item)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export function bodyScore(a: string, b: string): number {
  return jaccard(tokens(a), tokens(b));
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
