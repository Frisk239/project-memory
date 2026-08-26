/** YAML hook block for Kiro CLI custom agents (agentSpawn / userPromptSubmit / stop). */
export function kiroMemoryHookYaml(cli: string): string {
  const spawn = JSON.stringify(`node "${cli}" hook --event agentSpawn --plain`);
  const prompt = JSON.stringify(`node "${cli}" hook --event userPromptSubmit --plain`);
  const stop = JSON.stringify(`node "${cli}" hook --event stop --plain`);
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
  let front = match[1];
  const spawnCmd = JSON.stringify(`node "${cli}" hook --event agentSpawn --plain`);
  if (front.includes(spawnCmd)) return raw;
  const hookYaml = kiroMemoryHookYaml(cli);
  if (/^hooks:/m.test(front)) {
    front = front.replace(/^hooks:[\s\S]*/m, hookYaml);
  } else {
    front = `${front.trimEnd()}\n${hookYaml}`;
  }
  return `---\n${front}\n---\n${match[2]}`;
}

/** True for daily coding agents we should wire (engineer, or already granted @project-memory). */
export function shouldPatchKiroAgent(filename: string, raw: string): boolean {
  const base = filename.replace(/\\/g, "/").split("/").pop() ?? filename;
  if (!base.endsWith(".md")) return false;
  if (base === "HARNESS.md" || base.includes(".bak") || base.includes(".example")) return false;
  return base === "engineer.md" || /@project-memory/.test(raw);
}
