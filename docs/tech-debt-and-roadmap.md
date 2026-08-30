# 技术债务与优化路线

盘点时间：2026-08-27。基线当时：`main` @ `7e31616`，`npm test` 70 passed。P0 与 P1.1 已在后续提交落地；当前 `npm test` 88 passed。

这份文档取代 `docs/roadmap.md` 的 Phase 2/3（那份已自标 superseded）和 `docs/implementation-plan.md`（Slice A–E 已全部落地）作为**当前唯一在跑的计划**。产品边界仍由 `CONTEXT.md` 与 ADR 0001–0005 锁定：不做 sidecar、不做 persona、不做向量库、不做 Dream 常规回路。下面每一条都在这个边界内，只补实现债，不扩产品面。

## 现状快照

| 面 | 状态 |
|---|---|
| store / similarity / conflict | 已完整实现，CJK 分词与 gray-zone containment 有针对性测试 |
| paths / gitignore / kiro-agent | 已实现且有测试 |
| hooks / MCP / CLI | 已实现，`hooks.test.ts` 覆盖 8 host 的事件与 flavor 分支 |
| install.ts | Kiro workspace MCP 有测试；`upsertHookGroup` / 8-host 用户级写入仍缺表驱动覆盖 |
| CI | **不存在**（无 `.github/`） |
| 卸载 | **不存在**，README 让 owner 手改 8 个文件 |

---

## P0 — 已发生的事故：跨项目错投

**这不是理论风险，已经发生了。** 证据（文件时间戳）：

```
e:\code\open-commerce-station\.memory\   m0-m8-quality-audit.md   2026/8/25 14:38
e:\code\project-memory\.memory\          m9-release-hardening.md  2026/8/25 15:18  origin: mcp  pin: true
```

`m9-release-hardening` 讲的是 open-commerce-station 的 M9 发布加固（`packages/data/src/redis.ts`、`feat/m9-release-hardening` 分支），本仓库没有 `packages/`。那条记忆被 MCP 写进了**错误的 ledger**，而 OCS 自己的 ledger 停在 M8。

根因就是 `src/core/paths.ts` 里自己标注的那个 ceiling：MCP 进程没有 cwd → git 探测失败 → `.memory` 上溯失败 → 落到 `~/.project-memory/last-root.txt` 单槽缓存。缓存当前值确实是 `E:\code\project-memory`。谁最后触发过 hook，谁就吃掉所有 cwd-less 的 MCP 写入。

严重性判定：**静默**、**跨项目**、**写路径**。ledger 的全部价值是"下一个会话不用重做"，投错项目同时制造两个损失——A 项目丢事实，B 项目被污染。这条必须先修。

### 修复方向（按性价比排序）

1. **每个工具响应回带解析出的 ledger 路径。** ✅ 已落地。MCP 每个工具经 `toolText` 前缀 `[ledger: <dir>]`；解析失败则 `[ledger: unresolved]` 且 `isError`。
2. **Kiro 装 workspace 级 MCP 条目，带 `env.PROJECT_MEMORY_ROOT`。** ✅ 已落地。`install --cwd` 写 `<workspace>/.kiro/settings/mcp.json`；已有不同条目则不覆盖。
3. **缓存加 TTL + 拒绝陈旧兜底。** ✅ 已落地。`last-root.txt` 存 `{root, at}`，TTL 30 分钟；过期 / 损坏 / 缺失一律 `UnresolvedRootError`（读和写都拒绝，比原稿更严）。
4. **清理现存污染（需 owner 决定，不要静默搬）。** 仍待 owner。
   `m9-release-hardening` 是 `pin: true`，`dream` 不会碰它。它应该搬回 `open-commerce-station/.memory/`。按 ADR-0005 的"冲突不由 agent 定胜负"精神，跨项目搬迁同样是 owner 的决定。

验收（已满足）：`src/paths.test.ts` 缓存过期后 cwd-less 写抛错；`memory_index` 返回文本包含 root 路径。

---

## P1 — 会咬人的实现债

### 1. `hook` 在没有 stdin 管道时永久挂起 — ✅ 已落地

`readHookInput`：TTY stdin 直接当 `{}`，不再读 fd 0。非 TTY 空管道同样当 `{}`。

### 2. `install.ts` 零测试，却在改 8 个用户级配置

最大的文件、唯一有破坏性副作用的文件、唯一没有测试的文件。最危险的是 `upsertHookGroup` → `containsMarker`：

```ts
function containsMarker(value: unknown): boolean {
  return JSON.stringify(value).includes(MARKER) || JSON.stringify(value).includes(CLI...);
}
```

`MARKER` 就是字符串 `"project-memory"`。owner 自己写的、命令里恰好出现这个词的 hook，会在重装时被**静默删掉**。这是在别人家的 `~/.claude/settings.json` 里做的删除操作。

修：把 `mergeJson` / `upsertHookGroup` / `containsMarker` 提到 `src/core/host-config.ts`（纯函数，无 IO），补表驱动测试：重装幂等、外部 hook 不被吞、非对象 JSON 报错、marker 只匹配自己写的那一组（建议给自己的组打显式 `id` 字段而不是靠子串猜）。

### 3. 没有 `uninstall`

`install` 往 8 个 host 里写命令，全部是绝对路径 `node "E:\code\project-memory\dist\cli.js"`。仓库一旦移动或删除，**每个 host 的每次会话**都会 spawn 一个失败进程。README 目前的答案是"手动删这 6 个路径"。

install 是 marker 标记式的，逆操作几乎免费。`uninstall [--agents ...]` + `doctor` 报告悬空路径。

### 4. README 的 `npx project-memory` 指向别人的包

已核实 npm 上的 `project-memory@0.1.0` 是另一位维护者（`folterung`）的包，描述为 "Local-first Project Memory: scoped indexing, embeddings, Cursor integration"。README 的：

```bash
npx project-memory index
npx project-memory write --name ...
```

会下载并执行**第三方代码**。这是文档级的供应链坑，且意味着本项目无法以此名发布。

修：README 统一改成 `node dist/cli.js …`（或 `npm link` 后的说明）；若要发布，用 scoped 名（`@<owner>/project-memory`）并同步 `package.json`。

---

## P2 — 该补但不急

### 5. 没有 CI

`npm test` 已经 70 绿，接一个 workflow 就是纯收益。矩阵建议 Node 20 + 22，**ubuntu + windows 都跑**——`--plain`、`node "path"` 引号、`slugify`、`USERPROFILE` 这些逻辑重度依赖 Windows 行为，只跑 Linux 等于不跑。

### 6. 写索引没有锁，`dream` 有锁

`writeIndex` 是 read-modify-write `MEMORY.md`，无锁。Kiro 与 OpenCode 同时结束一轮就可能丢一行索引（topic 文件还在，`dream` 能重建，所以是可恢复的降级而非硬丢）。`dream` 已经有 `.dream.lock`，复用它或改成 write-then-rename + 重试即可。

### 7. `capIndex` 按字节截断，会切坏 UTF-8

```ts
cut = Buffer.from(cut, "utf8").subarray(0, INDEX_BYTE_LIMIT).toString("utf8");
```

ledger 是中文为主，25KB 边界切在多字节序列中间就是乱码。同时超过 200 行的索引行被**静默丢弃**，topic 文件还在但 agent 再也看不到——`rebuildIndex` 也只能重建到上限。

修：按整行截断，并追加一行 `(+N more topics, run dream)`，让丢失可见。

### 8. `slugify` 只保 Han 与 latin

Kana / Hangul / 西里尔的名字全部塌成 `"memory"`，两个不同主题会共用一个文件并互相覆盖——这是数据丢失级的 ceiling，不只是美观问题（代码里已注明）。放宽到 `\p{L}\p{N}`，或给 fallback 加短 hash 后缀。

### 9. `doctor` 只查文件存在

现在的 `doctor` 只 `existsSync` + 子串匹配。P0 的错投和 P1 的 stdin 挂起，它一个都发现不了。加一个 `selftest`：按已安装的 host 实际跑一遍 hook 路径，断言注入非空、断言解析出的 root == 当前仓库。这是把上面几条债变成"可回归"的关键一步。

### 10. 小性能：`listEntries` 的 O(n²)

`dream.isPinned` 每个名字重扫一次全部文件，`saveEntry` 也重复 `listEntries`。当前规模（个位数 topic）无感，几百个 topic 时才有意义。传一次快照进去即可。优先级最低。

---

## 方向性建议（非债务）

- **文档收敛。** 现在活着的计划文档有 3 份（`roadmap.md`、`implementation-plan.md`、本文）。前两份的工作已完成或已 superseded，建议在各自顶部加一行指向本文，只留一个入口。
- **host 分级要写进 README。** 代码事实是 Kiro + OpenCode 是一等公民（ADR/plan 都这么写），其余 6 个是 best-effort（目录不存在就 skip）。README 目前的表格读起来像 8 个平权，会带来错误预期。
- **写入侧的密钥边界检查（可选，但属于信任边界）。** 现在"不要存密钥"只是提示词约束，没有任何机制。一段廉价正则（`sk-`、`ghp_`、`AKIA`、`-----BEGIN`）在 `saveEntry` 拒写并告知 agent，成本几行代码。这不算扩产品面——它是写入边界的输入校验。
- **发布纪律。** 若打算给别人用：scoped 名 + `CHANGELOG.md` + tag。不打算给别人用：把 README 里的 `npx` 段落删掉，避免 P1.4 那个坑。
- **继续拒绝的东西（重申，别让它们回流）。** sidecar extract、auto-apply dream、`/memory` UI、search snippet、supersede 审计链、向量检索、写 AGENTS.md、把 store 挪出项目目录。ADR 0001–0005 已经付过决策成本了。

---

## 建议执行顺序

| 批次 | 内容 | 理由 |
|---|---|---|
| 1 | P0.1 响应回带 root + P1.1 stdin 挂起 | 两个都是几行改动，直接止住"静默出错" |
| 2 | P0.2 workspace MCP env + P0.3 缓存 TTL + P0.4 搬迁污染条目 | 从根上消掉猜测 |
| 3 | P1.2 install 纯函数化 + 测试，P1.3 uninstall | 破坏性代码进入回归网 |
| 4 | P2.5 CI（含 windows），P2.9 selftest | 让前三批不再退化 |
| 5 | P1.4 README 修正，P2.6–P2.8 | 收尾 |
| 6 | P2.10、方向性建议 | 有空再说 |

每批次结束跑 `npm test`；P0/P1 每条至少留一个会因回归而失败的测试。

进度：2026-08-27 批次1 已落地（P0.1 响应回带 root、P1.1 stdin 挂起，74 测试全绿）；P0.4 污染条目经 owner 决定已搬回 `open-commerce-station/.memory/`，本仓库索引已清（冲突 sibling `tech-debt-audit-2026-08-conflict` 保留，旧条目已 forget）。
2026-08-27 批次2 已落地（P0.2 + P0.3）：`PROJECT_MEMORY_ROOT` 仍最高优先；cwd 探测成功即刷新缓存（env 分支不 stamp，多项目互不污染）；`last-root.txt` 升级为 `{root, at}` JSON + 30 分钟 TTL（`ROOT_CACHE_TTL_MS`），过期/损坏/旧格式一律不可用，读不提示、写直接抛 `UnresolvedRootError`；MCP 七个工具统一过 `toolText` guard，root 未解析时返回 `[ledger: unresolved]` + isError；`install --agents kiro` 写 `<workspace>/.kiro/settings/mcp.json` 带 `env.PROJECT_MEMORY_ROOT`（合并保留其他 server，拒绝覆盖异已配置），本仓库已装并从无关 cwd 验证。88 测试全绿，含 dist 子进程级：从项目 A cwd + env=B 启动确认写入 B。行为变化：非 workspace 目录下 CLI 读命令现在显式报错（原来静默 empty/fallback cwd）；hook 注入在 root 未解析时注入空而非崩。
