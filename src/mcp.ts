import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { forgetEntry, listIndex, readEntry, readIndexText, searchEntries, writeEntry } from "./core/store.js";
import { MEMORY_TYPES } from "./core/types.js";
import { normalizeWriteInput } from "./mcp-write.js";

export async function startMcp(): Promise<void> {
  const server = new McpServer({ name: "project-memory", version: "0.1.0" });

  server.tool("memory_index", "List the project MEMORY.md index. Call at the start of non-trivial work.", {}, async () => {
    const text = readIndexText() || "(empty)";
    return { content: [{ type: "text" as const, text }] };
  });

  server.tool(
    "memory_read",
    "Read one memory topic file by name/slug.",
    { name: z.string().describe("Topic slug from the index, not MEMORY.md") },
    async ({ name }) => {
      const entry = readEntry(name);
      if (!entry) return { content: [{ type: "text" as const, text: `memory not found: ${name}` }], isError: true };
      return { content: [{ type: "text" as const, text: render(entry) }] };
    },
  );

  server.tool(
    "memory_search",
    "Keyword search across memory titles and bodies.",
    { query: z.string().describe("Keyword to search in titles and bodies") },
    async ({ query }) => {
      const hits = searchEntries(query);
      const text = hits.length
        ? hits.map((hit) => `- ${hit.name} — ${hit.description}`).join("\n")
        : "(no hits)";
      return { content: [{ type: "text" as const, text }] };
    },
  );

  server.tool(
    "memory_write",
    "Create or update a durable project memory and refresh MEMORY.md. Types: user, feedback, project, reference.",
    {
      name: z.string().describe("Slug, kebab-case"),
      description: z.string().optional().describe("One-line summary for MEMORY.md. Alias: title"),
      title: z.string().optional().describe("Alias for description"),
      type: z.enum(MEMORY_TYPES).describe("user | feedback | project | reference"),
      body: z.string().optional().describe("Full text: fact, Why, How to apply. Alias: content"),
      content: z.string().optional().describe("Alias for body"),
    },
    async (args) => {
      const parsed = normalizeWriteInput(args);
      if (!parsed.ok) return { content: [{ type: "text" as const, text: parsed.error }], isError: true };
      const saved = writeEntry({ ...parsed.entry, origin: "mcp" });
      return { content: [{ type: "text" as const, text: `wrote ${saved.name}\n- ${saved.name} — ${saved.description}` }] };
    },
  );

  server.tool(
    "memory_forget",
    "Delete a memory topic and remove it from MEMORY.md.",
    { name: z.string().describe("Topic slug to delete") },
    async ({ name }) => {
      const ok = forgetEntry(name);
      return { content: [{ type: "text" as const, text: ok ? `forgot ${name}` : `memory not found: ${name}` }] };
    },
  );

  server.tool("memory_list", "Return memory slugs currently in the index.", {}, async () => {
    const items = listIndex();
    return { content: [{ type: "text" as const, text: JSON.stringify(items, null, 2) }] };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function render(entry: { name: string; type: string; description: string; body: string }): string {
  return `# ${entry.name}\n\n- type: ${entry.type}\n- ${entry.description}\n\n${entry.body}`;
}

if (process.argv[1] && /mcp\.(js|ts)$/.test(process.argv[1].replaceAll("\\", "/"))) {
  await startMcp();
}
