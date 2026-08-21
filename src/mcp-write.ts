import { isMemoryType, type MemoryEntry } from "./core/types.js";

export type WriteInput = {
  name?: string;
  description?: string;
  title?: string;
  type?: string;
  body?: string;
  content?: string;
};

export type WriteOk = { ok: true; entry: MemoryEntry };
export type WriteErr = { ok: false; error: string };

export function normalizeWriteInput(input: WriteInput): WriteOk | WriteErr {
  const name = input.name?.trim() ?? "";
  const description = (input.description ?? input.title ?? "").trim();
  const body = (input.body ?? input.content ?? "").trim();
  const typeRaw = input.type?.trim() ?? "";
  const missing: string[] = [];
  if (!name) missing.push("name");
  if (!description) missing.push("description (or title)");
  if (!typeRaw) missing.push("type");
  if (!body) missing.push("body (or content)");
  if (missing.length) {
    return { ok: false, error: `memory_write needs name, description (or title), type, body (or content). received: ${receivedKeys(input)}. missing: ${missing.join(", ")}.` };
  }
  if (!isMemoryType(typeRaw)) {
    return { ok: false, error: `invalid type: ${typeRaw}. use user | feedback | project | reference. received: ${receivedKeys(input)}.` };
  }
  return { ok: true, entry: { name, description, type: typeRaw, body } };
}

function receivedKeys(input: WriteInput): string {
  const keys = Object.entries(input)
    .filter(([, value]) => value != null && String(value).trim() !== "")
    .map(([key]) => key);
  return keys.length ? keys.join(", ") : "(none)";
}
