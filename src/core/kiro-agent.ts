/** YAML hook block for Kiro CLI custom agents (agentSpawn / userPromptSubmit / stop). */
export function kiroMemoryHookYaml(cli: string): string {
  const spawn = JSON.stringify(kiroHookCommand(cli, "agentSpawn"));
  const prompt = JSON.stringify(kiroHookCommand(cli, "userPromptSubmit"));
  const stop = JSON.stringify(kiroHookCommand(cli, "stop"));
  return `hooks:\n  agentSpawn:\n    - command: ${spawn}\n  userPromptSubmit:\n    - command: ${prompt}\n  stop:\n    - command: ${stop}`;
}

/**
 * Insert or replace the project-memory hooks in a Kiro agent markdown file.
 * Returns null if the file has no YAML frontmatter. Idempotent when our CLI
 * path is already in the frontmatter.
 */
export function patchKiroAgentFrontmatter(raw: string, cli: string): string | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  const front = patchKiroHooks(match[1], cli);
  if (front === match[1]) return raw;
  return `---\n${front}\n---\n${match[2]}`;
}

export function removeKiroAgentHooks(raw: string, cli: string): string | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  const front = removeKiroHooks(match[1], cli);
  if (front === match[1]) return raw;
  return `---\n${front}\n---\n${match[2]}`;
}

/** True for daily coding agents we should wire (engineer, or already granted @project-memory). */
export function shouldPatchKiroAgent(filename: string, raw: string): boolean {
  const base = filename.replace(/\\/g, "/").split("/").pop() ?? filename;
  if (!base.endsWith(".md")) return false;
  if (base === "HARNESS.md" || base.includes(".bak") || base.includes(".example")) return false;
  return base === "engineer.md" || /@project-memory/.test(raw);
}

function patchKiroHooks(front: string, cli: string): string {
  const lines = front.split(/\r?\n/);
  const block = topLevelBlock(lines, "hooks");
  if (!block) return `${front.trimEnd()}\n${kiroMemoryHookYaml(cli)}`;

  const next = [...lines];
  for (const event of ["agentSpawn", "userPromptSubmit", "stop"]) {
    const current = topLevelBlock(next, "hooks") ?? block;
    insertKiroCommand(next, current.start, current.end, event, kiroHookCommand(cli, event));
  }
  return next.join("\n");
}

function removeKiroHooks(front: string, cli: string): string {
  const lines = front.split(/\r?\n/);
  const block = topLevelBlock(lines, "hooks");
  if (!block) return front;
  const commands = new Set(["agentSpawn", "userPromptSubmit", "stop"].map((event) => kiroHookCommand(cli, event)));
  const next = lines.filter((line, index) => {
    if (index < block.start || index >= block.end) return true;
    return !commands.has(extractCommand(line) ?? "");
  });
  return dropEmptyHookEvents(next).join("\n");
}

function insertKiroCommand(lines: string[], hooksStart: number, hooksEnd: number, event: string, command: string): void {
  const existing = JSON.stringify(command);
  for (let i = hooksStart + 1; i < hooksEnd; i += 1) {
    if (lines[i].includes(existing)) return;
  }
  const eventRange = nestedBlock(lines, hooksStart, hooksEnd, event);
  if (!eventRange) {
    lines.splice(hooksEnd, 0, `  ${event}:`, `    - command: ${existing}`);
    return;
  }
  lines.splice(eventRange.end, 0, `    - command: ${existing}`);
}

function topLevelBlock(lines: string[], key: string): { start: number; end: number } | undefined {
  const start = lines.findIndex((line) => line === `${key}:`);
  if (start === -1) return undefined;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^[^\s][^:]*:/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

function nestedBlock(lines: string[], start: number, end: number, key: string): { start: number; end: number } | undefined {
  const eventStart = lines.findIndex((line, index) => index > start && index < end && line === `  ${key}:`);
  if (eventStart === -1) return undefined;
  let eventEnd = end;
  for (let i = eventStart + 1; i < end; i += 1) {
    if (/^  [^\s][^:]*:/.test(lines[i])) {
      eventEnd = i;
      break;
    }
  }
  return { start: eventStart, end: eventEnd };
}

function dropEmptyHookEvents(lines: string[]): string[] {
  const next: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^  [^\s][^:]*:$/.test(lines[i]) && (i + 1 >= lines.length || !/^    - /.test(lines[i + 1]))) {
      continue;
    }
    next.push(lines[i]);
  }
  return next;
}

function extractCommand(line: string): string | undefined {
  const match = line.match(/^\s*-\s*command:\s*(.+)$/);
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]) as string;
  } catch {
    return match[1].trim();
  }
}

function kiroHookCommand(cli: string, event: string): string {
  return `node "${cli}" hook --event ${event} --plain`;
}
