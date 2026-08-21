import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeWriteInput } from "./mcp-write.js";

test("title and content aliases fill description and body", () => {
  const parsed = normalizeWriteInput({
    name: "kiro-hooks",
    title: "Kiro hook contract",
    type: "reference",
    content: "plain stdout",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.entry.description, "Kiro hook contract");
  assert.equal(parsed.entry.body, "plain stdout");
});

test("canonical fields win over aliases", () => {
  const parsed = normalizeWriteInput({
    name: "x",
    description: "real",
    title: "alias",
    type: "project",
    body: "body-text",
    content: "content-text",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.entry.description, "real");
  assert.equal(parsed.entry.body, "body-text");
});

test("missing body lists received keys", () => {
  const parsed = normalizeWriteInput({ name: "x", title: "only title", type: "project" });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.error, /received: name, title, type/);
  assert.match(parsed.error, /missing: body \(or content\)/);
});
