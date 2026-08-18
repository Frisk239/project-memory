import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { forgetEntry, listIndex, readEntry, readIndexText, searchEntries, writeEntry } from "./core/store.js";
import { MEMORY_TYPES } from "./core/types.js";

export async function startMcp(): Promise<void> {
  const server = new McpServer({ name: "project-memory", version: "0.1.0" });

  server.tool("memory_index", "List the project MEMORY.md index. Call at the start of non-trivial work.", {}, async () => {
    const text = readIndexText() || "(empty)";
    return { content: [{ type: "text" as const, text }] };
  });

  server.tool(
    "memory_read",
    "Read one memory topic file by name/slug.",
    { name: z.string() },
    async ({ name }) => {
      const entry = readEntry(name);
      if (!entry) return { content: [{ type: "text" as const, text: `memory not found: ${name}` }], isError: true };
      return { content: [{ type: "text" as const, text: render(entry) }] };
    },
  );

  server.tool(
    "memory_search",
    "Keyword search across memory titles and bodies.",
    { query: z.string() },
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
      name: z.string(),
      description: z.string(),
      type: z.enum(MEMORY_TYPES),
      body: z.string(),
    },
    async ({ name, description, type, body }) => {
      const saved = writeEntry({ name, description, type, body, origin: "mcp" });
      return { content: [{ type: "text" as const, text: `wrote ${saved.name}` }] };
    },
  );

  server.tool(
    "memory_forget",
    "Delete a memory topic and remove it from MEMORY.md.",
    { name: z.string() },
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
