import assert from "node:assert/strict";
import { test } from "node:test";
import { BODY_DIVERGE, BODY_SIMILAR, bodiesAgree, bodyScore, hasHardDivergence, overlapScore, tokens } from "./core/similarity.js";

const CN_LEDGER =
  "采用仓库内明文记忆，不写向量库，整理由人触发。空账本是正常状态。";
const CN_DEPLOY =
  "生产环境由主分支自动发布，不走本地打包，禁止在开发机直接推制品。";
const EN_A = "Use pnpm for install and scripts in this repo because the workspace demands it.";
const EN_B = "Never use pnpm here; the toolchain only supports plain npm with a committed lockfile.";

test("Chinese bodies yield comparable tokens; punctuation-only does not", () => {
  assert.ok(tokens(CN_LEDGER).size > 0);
  assert.equal(tokens("。！？、").size, 0);
});

test("diverging Chinese bodies score below BODY_DIVERGE", () => {
  assert.ok(bodyScore(CN_LEDGER, CN_DEPLOY) < BODY_DIVERGE);
});

test("near-identical Chinese bodies score at or above BODY_SIMILAR", () => {
  // A short tail stays in the similar band. A whole extra sentence can dip
  // under 0.82 (gray); overlap, not Jaccard, is what keeps that an upsert.
  assert.ok(bodyScore(CN_LEDGER, `${CN_LEDGER}读索引。`) >= BODY_SIMILAR);
});

test("latin diverge/similar thresholds are unchanged", () => {
  assert.ok(bodyScore(EN_A, EN_B) < BODY_DIVERGE);
  assert.ok(bodyScore(EN_A, `${EN_A} Also use pnpm for CI.`) >= BODY_SIMILAR);
});

const CN_EXTEND = `${CN_LEDGER}下次会话先读索引。`;
const GRAY_A = "alpha bravo charlie delta echo foxtrot";
const GRAY_B = "alpha bravo charlie delta golf hotel india juliet";

test("empty-empty overlap is 0, not 1", () => {
  assert.equal(overlapScore("", ""), 0);
  assert.equal(overlapScore("", "alpha bravo charlie"), 0);
});

test("Chinese added sentence sits in Jaccard gray but overlap is containment", () => {
  const j = bodyScore(CN_LEDGER, CN_EXTEND);
  assert.ok(j >= BODY_DIVERGE && j < BODY_SIMILAR, `expected gray Jaccard, got ${j}`);
  assert.equal(overlapScore(CN_LEDGER, CN_EXTEND), 1);
  assert.equal(bodiesAgree(CN_LEDGER, CN_EXTEND), true);
});

test("latin extension agrees; opposite facts do not", () => {
  assert.equal(bodiesAgree(EN_A, `${EN_A} Also use pnpm for CI.`), true);
  assert.equal(bodiesAgree(EN_A, EN_B), false);
});

test("same-topic negation is a hard divergence even when token overlap is high", () => {
  assert.equal(bodiesAgree("Use pnpm for installs in this repo.", "Do not use pnpm for installs in this repo."), false);
  assert.equal(bodiesAgree("Production deploys are allowed.", "Production deploys are not allowed."), false);
  assert.equal(bodiesAgree("数据库允许写入。", "数据库不允许写入。"), false);
  assert.equal(hasHardDivergence("Use Node 20 for local runs.", "Use Node 22 for local runs."), true);
  assert.equal(hasHardDivergence("Use Node 20 for local runs.", "Use Node 20 and 22 for local runs."), false);
});

test("empty previous agrees so a first write still upserts", () => {
  assert.equal(bodiesAgree("", EN_A), true);
});

test("gray Jaccard without containment is a disagreement", () => {
  const j = bodyScore(GRAY_A, GRAY_B);
  assert.ok(j >= BODY_DIVERGE && j < BODY_SIMILAR, `expected gray Jaccard, got ${j}`);
  assert.ok(overlapScore(GRAY_A, GRAY_B) < BODY_SIMILAR);
  assert.equal(bodiesAgree(GRAY_A, GRAY_B), false);
});
