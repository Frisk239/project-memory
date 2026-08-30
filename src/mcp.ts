import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { applyDream, DreamLockError, formatDreamReport } from "./core/dream.js";
import { memoryDir, UnresolvedRootError } from "./core/paths.js";
import {
  forgetEntry,
  listIndex,
  readEntry,
  readIndexText,
  saveEntry,
  searchEntries,
  SimilarTopicError,
  StoreLockError,
  UnsafeMemoryEntryError,
} from "./core/store.js";
import { MEMORY_TYPES } from "./core/types.js";
import { normalizeWriteInput } from "./mcp-write.js";

/**
 * MCP clients may spawn us with no cwd; root resolution then falls back to the
 * single-slot last-root cache. Leading every response with the ledger path the
 * tool actually resolved to makes a misdirected read or write visible on the
 * spot instead of silently wrong.
 */
export function withRoot(text: string): string {
  return `[ledger: ${memoryDir()}]\n${text}`;
}

/** Root-echo for responses where resolution failed: an unknown ledger, stated
 * plainly, beats stamping a plausible-but-wrong path. */
export const UNRESOLVED_LEDGER = "[ledger: unresolved]";

type ToolResponse = { content: { type: "text"; text: string }[]; isError?: boolean };

/**
 * Every tool body runs through this guard, so a response can never leave
 * without either its real ledger prefix or the explicit unresolved marker —
 * per-tool wrappers get forgotten; this one cannot. The body returns plain
 * text, or `{ text, isError: true }` for tool-level failures (not-found,
 * invalid input, similar-topic refusals).
 */
export function toolText(body: () => string | { text: string; isError: true }): ToolResponse {
  const previousDir = process.env.PROJECT_MEMORY_DIR;
  try {
    const ledgerDir = memoryDir();
    process.env.PROJECT_MEMORY_DIR = ledgerDir;
    const result = body();
    if (typeof result === "string") return { content: [{ type: "text" as const, text: result }] };
    return { content: [{ type: "text" as const, text: result.text }], isError: true };
  } catch (error) {
    if (error instanceof UnresolvedRootError) {
      return { content: [{ type: "text" as const, text: `${UNRESOLVED_LEDGER}\n${error.message}` }], isError: true };
    }
    if (error instanceof StoreLockError || error instanceof UnsafeMemoryEntryError) {
      return { content: [{ type: "text" as const, text: withRoot(error.message) }], isError: true };
    }
    throw error;
  } finally {
    if (previousDir === undefined) delete process.env.PROJECT_MEMORY_DIR;
    else process.env.PROJECT_MEMORY_DIR = previousDir;
  }
}

export function memoryIndexText(): string {
  return withRoot(readIndexText() || "(empty)");
}

export async function startMcp(): Promise<void> {
  const server = new McpServer({ name: "project-memory", version: "0.1.0" });

  server.tool("memory_index", "List the project MEMORY.md index. Call at the start of non-trivial work.", {}, async () =>
    toolText(() => memoryIndexText()),
  );

  server.tool(
    "memory_read",
    "Read one memory topic file by name/slug.",
    { name: z.string().describe("Topic slug from the index, not MEMORY.md") },
    async ({ name }) =>
      toolText(() => {
        const entry = readEntry(name);
        if (!entry) return { text: withRoot(`memory not found: ${name}`), isError: true };
        return withRoot(render(entry));
      }),
  );

  server.tool(
    "memory_search",
    "Keyword search across memory titles and bodies.",
    { query: z.string().describe("Keyword to search in titles and bodies") },
    async ({ query }) =>
      toolText(() => {
        const hits = searchEntries(query);
        return withRoot(hits.length ? hits.map((hit) => `- ${hit.name} — ${hit.description}`).join("\n") : "(no hits)");
      }),
  );

  server.tool(
    "memory_write",
    "Create or update a durable project memory and refresh MEMORY.md. Same slug replaces in place; new near-duplicate slugs are refused so the agent can reuse the existing slug or choose a distinct one.",
    {
      name: z.string().describe("Slug, kebab-case"),
      description: z.string().optional().describe("One-line summary for MEMORY.md. Alias: title"),
      title: z.string().optional().describe("Alias for description"),
      type: z.enum(MEMORY_TYPES).describe("user | feedback | project | reference"),
      body: z.string().optional().describe("Full text: fact, Why, How to apply. Alias: content"),
      content: z.string().optional().describe("Alias for body"),
      pin: z.boolean().optional().describe("If true, dream will not auto-forget or merge this topic. Explicit memory_write on the same slug and memory_forget can still update or delete it."),
    },
    async (args) =>
      toolText(() => {
        const parsed = normalizeWriteInput(args);
        if (!parsed.ok) return { text: withRoot(parsed.error), isError: true };
        try {
          const saved = saveEntry({ ...parsed.entry, origin: "mcp" });
          return withRoot(`wrote ${saved.name}\n- ${saved.name} — ${saved.description}`);
        } catch (error) {
          if (error instanceof SimilarTopicError) return { text: withRoot(error.message), isError: true };
          throw error;
        }
      }),
  );

  server.tool(
    "memory_forget",
    "Delete an obsolete, wrong, duplicate, or no-longer-useful memory topic and remove it from MEMORY.md.",
    { name: z.string().describe("Topic slug to delete") },
    async ({ name }) =>
      toolText(() => {
        const forgot = forgetEntry(name);
        return forgot ? withRoot(`forgot ${name}`) : { text: withRoot(`memory not found: ${name}`), isError: true };
      }),
  );

  server.tool("memory_list", "Return memory slugs currently in the index.", {}, async () =>
    toolText(() => withRoot(JSON.stringify(listIndex(), null, 2))),
  );

  server.tool(
    "memory_dream",
    "Consolidate .memory files: rebuild index, drop empty topics, merge identical bodies. Semantic candidates are reported for agent judgment; dryRun defaults true.",
    {
      dryRun: z
        .boolean()
        .optional()
        .describe("If true (default), report only. If false, apply safe ops (index rebuild, empty delete, identical-body merge)."),
    },
    async ({ dryRun }) =>
      toolText(() => {
        try {
          const report = applyDream({ dryRun: dryRun !== false });
          return withRoot(`${formatDreamReport(report)}\n\n${JSON.stringify(report, null, 2)}`);
        } catch (error) {
          if (error instanceof DreamLockError) return withRoot(error.message);
          throw error;
        }
      }),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function render(entry: { name: string; type: string; description: string; body: string }): string {
  return `# ${entry.name}\n\n- type: ${entry.type}\n- ${entry.description}\n\n${entry.body}`;
}

if (process.argv[1] && /mcp\.(js|ts)$/.test(process.argv[1].replaceAll("\\", "/"))) {
  await startMcp();
}
