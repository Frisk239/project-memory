# 技术债务与优化路线

盘点时间：2026-08-27。基线当时：`main` @ `7e31616`，`npm test` 70 passed。P0/P1/P2 优化批次已在后续提交落地；2026-08-30 审计修复批次后 `npm test` 120 passed。

这份文档取代 `docs/roadmap.md` 的 Phase 2/3（那份已自标 superseded）和 `docs/implementation-plan.md`（Slice A–E 已全部落地）作为**当前唯一在跑的计划**。产品边界仍由 `CONTEXT.md` 与 ADR 0001–0006 锁定：不做 sidecar、不做 persona、不做向量库、不做 Dream 常规回路。下面每一条都在这个边界内，只补实现债，不扩产品面。

## 现状快照

| 面 | 状态 |
|---|---|
| store / similarity / write | 已完整实现，含路径越界拒绝、同 slug agent 覆盖、近似新 slug 拒绝、写锁、atomic write、整行索引截断、Unicode slug、敏感内容拒写 |
| paths / gitignore / kiro-agent | 已实现且有测试 |
| hooks / MCP / CLI | 已实现，`hooks.test.ts` 覆盖 8 host 的事件与 flavor 分支 |
| install.ts | Kiro workspace MCP、host-config 纯函数、uninstall、doctor selftest / stale path 扫描均有测试 |
| CI | `.github/workflows/ci.yml` 跑 Node 20/22 + Ubuntu/Windows |
| 卸载 | `node dist/cli.js uninstall [--agents ...]` |

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
2. **Kiro 装 workspace 级 MCP 条目，带 `env.PROJECT_MEMORY_ROOT`。** ✅ 已落地。`install --cwd` 写 `<workspace>/.kiro/settings/mcp.json`；已有不同条目则不覆盖。该文件是本机生成配置，`/.kiro/settings/mcp.json` 已精确加入 `.gitignore`，保留在磁盘但不进入 Git。
3. **缓存加 TTL + 拒绝陈旧兜底。** ✅ 已落地。`last-root.txt` 存 `{root, at}`，TTL 30 分钟；过期 / 损坏 / 缺失一律 `UnresolvedRootError`（读和写都拒绝，比原稿更严）。
4. **清理现存污染。** ✅ 已落地。owner 已授权清理；本仓库 `.memory/` 当前不再保有 `m9-release-hardening`。

验收（已满足）：`src/paths.test.ts` 缓存过期后 cwd-less 写抛错；`memory_index` 返回文本包含 root 路径。

---

## P1 — 会咬人的实现债

### 1. `hook` 在没有 stdin 管道时永久挂起 — ✅ 已落地

`readHookInput`：TTY stdin 直接当 `{}`，不再读 fd 0。非 TTY 空管道同样当 `{}`。

### 2. `install.ts` 零测试，却在改 8 个用户级配置 — ✅ 已关闭

已抽出 `src/core/host-config.ts`，用纯函数测试覆盖 JSON merge、hook group upsert/remove、TOML table 删除、MCP server 删除。重装识别只匹配显式 `id` 或确实指向当前 `dist/cli.js hook` 的命令，不再因为外部 hook 文本里出现 `project-memory` 字符串就删除。

原风险点：

```ts
function containsMarker(value: unknown): boolean {
  return JSON.stringify(value).includes(MARKER) || JSON.stringify(value).includes(CLI...);
}
```

`MARKER` 就是字符串 `"project-memory"`。owner 自己写的、命令里恰好出现这个词的 hook，会在重装时被**静默删掉**。这是在别人家的 `~/.claude/settings.json` 里做的删除操作。

回归测试：外部 `project-memory` 文本不被吞，旧的当前 CLI hook 会被替换；非对象 JSON 报错。

### 3. 没有 `uninstall` — ✅ 已关闭

`node dist/cli.js uninstall [--agents ...]` 已落地。它移除 project-memory 自己的 MCP 条目、hook 组、插件/命令文件与 skill copy；不删除项目 `.memory/`。`doctor` 也会扫描已知配置里的 `dist/cli.js` / `dist/mcp.js` 绝对路径，报告仓库移动后留下的悬空路径。

卸载同样复用 `host-config` 的精确识别，不按裸字符串 `project-memory` 删除外部配置。

### 4. README 曾通过 `npx` 指向同名第三方包 — ✅ 已关闭

已核实 npm 上的 `project-memory@0.1.0` 是另一位维护者（`folterung`）的包，描述为 "Local-first Project Memory: scoped indexing, embeddings, Cursor integration"。README 曾把 CLI 示例写成通过 `npx` 执行该同名包，会下载并执行**第三方代码**。这是文档级的供应链坑，且意味着本项目不能安全复用该未限定名称发布。

Owner 于 2026-08-30 明确该仓库只作为本地工具，不建立 npm 发布链。现已将 `package.json` 标记为 `private: true`，移除 `bin`、`files`、`keywords` 等发布表面，并把 README 的 CLI 示例统一改成 `node dist/cli.js …`。不再规划 scoped 包名、CHANGELOG、tag 或 release workflow。

---

## P2 — 该补但不急

### 5. 没有 CI — ✅ 已关闭

已新增 `.github/workflows/ci.yml`：Node 20 + 22，Ubuntu + Windows，跑 `npm ci` + `npm test`。

### 6. 写索引没有锁，`dream` 有锁 — ✅ 已关闭

store 写入口现在使用 `.memory/.store.lock`，并在同一锁域内绑定 ledger dir；topic 文件与 `MEMORY.md` 写入改成同目录临时文件 + rename。冲突 sibling 选择也在锁内完成。

### 7. `capIndex` 按字节截断，会切坏 UTF-8 — ✅ 已关闭

```ts
cut = Buffer.from(cut, "utf8").subarray(0, INDEX_BYTE_LIMIT).toString("utf8");
```

ledger 是中文为主，25KB 边界切在多字节序列中间就是乱码。同时超过 200 行的索引行被**静默丢弃**，topic 文件还在但 agent 再也看不到——`rebuildIndex` 也只能重建到上限。

已按整行截断，并追加 `(+N more topics; run node dist/cli.js dream --dry-run)`，不再把 UTF-8 切成替换字符。

### 8. `slugify` 只保 Han 与 latin — ✅ 已关闭

已放宽到 `\p{L}\p{N}`，Kana / Hangul / 西里尔会保留；无字母数字的名字用 `memory-<short-hash>`，避免全塌成同一个 `memory.md`。

### 9. `doctor` 只查文件存在 — ✅ 已关闭

`doctor --selftest` 会用当前 checkout 的真实 `dist/cli.js hook --event SessionStart --plain` 跑一次根解析和注入检查；普通 doctor 会扫描已知配置里的 project-memory dist 路径并报告悬空路径。真实宿主 UI 的 trust/enable 状态仍需 owner 在各 host 内确认。

### 10. 小性能：`listEntries` 的 O(n²) — ✅ 已关闭

`saveEntry` 的 new-slug 检查复用一次 entries 快照；`dream` apply 阶段也复用 entries/pinned/name map 快照，不再为每个名字重扫所有文件。

---

## 方向性建议（非债务）

- **文档收敛。** ✅ 已落地。`roadmap.md`、`implementation-plan.md` 顶部指向本文，本文保留为当前入口。
- **host 分级要写进 README。** ✅ 已落地。README 明确 Kiro + OpenCode 是 primary，本地同机器/同 checkout 是边界，其余 host 是 best-effort。
- **写入侧的密钥边界检查（可选，但属于信任边界）。** ✅ 已落地。store 对 OpenAI key、GitHub token、AWS access key、private key block 拒写，要求先 redact。
- **本地工具边界。** 已锁定为 `private: true` 且不发布；后续保持 README 只引用仓库内的 `node dist/cli.js`，不要重新引入 npm release 表面。
- **worktree 语义。** 每个 checkout 保有独立、未进 Git 的 `.memory/` 是接受的设计，不视为项目身份分裂缺口；需要继承上下文时，由使用者把整个 `.memory/` 复制到目标 worktree。
- **agent 自主维护 ledger。** ADR-0006 覆盖早期“冲突交 owner 裁决”口径：`.memory/` 是给 agent 读写的账本，更新/删除不是人审边界。证据足够时 agent 直接 `memory_write` 同 slug 或 `memory_forget`；证据不足才问。
- **继续拒绝的东西（重申，别让它们回流）。** sidecar extract、auto-apply dream、`/memory` UI、search snippet、supersede 审计链、向量检索、写 AGENTS.md、把 store 挪出项目目录。ADR 0001–0006 已经付过决策成本了。

---

## 建议执行顺序

| 批次 | 内容 | 理由 |
|---|---|---|
| 1 | P0.1 响应回带 root + P1.1 stdin 挂起 | 两个都是几行改动，直接止住"静默出错" |
| 2 | P0.2 workspace MCP env + P0.3 缓存 TTL + P0.4 搬迁污染条目 | 从根上消掉猜测 |
| 3 | P1.2 install 纯函数化 + 测试，P1.3 uninstall | ✅ 已落地 |
| 4 | P2.5 CI（含 windows），P2.9 selftest | ✅ 已落地 |
| 5 | P1.4 README 修正，P2.6–P2.8 | ✅ 已落地 |
| 6 | P2.10、方向性建议 | ✅ 已落地 |

每批次结束跑 `npm test`；P0/P1 每条至少留一个会因回归而失败的测试。

进度：2026-08-27 批次1 已落地（P0.1 响应回带 root、P1.1 stdin 挂起，74 测试全绿）；P0.4 污染条目经 owner 决定已搬回 `open-commerce-station/.memory/`，本仓库索引已清（冲突 sibling `tech-debt-audit-2026-08-conflict` 保留，旧条目已 forget）。
2026-08-27 批次2 已落地（P0.2 + P0.3）：`PROJECT_MEMORY_ROOT` 仍最高优先；cwd 探测成功即刷新缓存（env 分支不 stamp，多项目互不污染）；`last-root.txt` 升级为 `{root, at}` JSON + 30 分钟 TTL（`ROOT_CACHE_TTL_MS`），过期/损坏/旧格式一律不可用，读不提示、写直接抛 `UnresolvedRootError`；MCP 七个工具统一过 `toolText` guard，root 未解析时返回 `[ledger: unresolved]` + isError；`install --agents kiro` 写 `<workspace>/.kiro/settings/mcp.json` 带 `env.PROJECT_MEMORY_ROOT`（合并保留其他 server，拒绝覆盖异已配置），本仓库已装并从无关 cwd 验证。88 测试全绿，含 dist 子进程级：从项目 A cwd + env=B 启动确认写入 B。行为变化：非 workspace 目录下 CLI 读命令现在显式报错（原来静默 empty/fallback cwd）；hook 注入在 root 未解析时注入空而非崩。
2026-08-30 全面优化批次已落地：路径越界读取关闭；当时曾对否定/数值硬分歧产生 conflict（后由 ADR-0006 改为同 slug 覆盖 + agent 自主整理）；Kiro agent frontmatter 由替换改为保守合并；Codex hook 改为官方契约下的 SessionStart + Stop 一次 continuation；MCP/store 单次调用绑定 ledger dir；store 写锁 + atomic write；Unicode slug + 整行可见截断；secret/frontmatter guard；host-config 纯函数 + uninstall + doctor selftest/stale path；OpenCode 不再显式 plugin 双加载；CI Node 20/22 x Ubuntu/Windows；108 测试全绿。
2026-08-30 ADR-0006 已落地：更新/删除记忆不再是 owner 审批边界；`saveEntry` 同 slug 直接覆盖/upsert，近似新 slug 仍以 `similar-topic` 拒绝以防重复，legacy conflict 标记保留可读并可由 agent 用 `memory_write` + `memory_forget` 清理。README、skill、hook 注入文案、OpenCode `/memory-dream` 指令、ADR/roadmap 已同步；`npm test` 120 passed。

---

## 审计修复批次（2026-08-30 第二轮，120 测试全绿）

计划内批次全部关闭后，对全仓做了一次独立审计，发现并修复以下问题（均有会因回归而失败的测试）：

### 1. Codex 安装中断整个 install（已实证、已关闭）

`installCodex` 是唯一不检查宿主目录存在性的安装函数：`~/.codex` 缺失时 `writeFileSync` 直接 ENOENT，而 `installAgents` 循环无异常隔离，默认全量安装在 codex 处退出 1，其后 claude/kiro/commandcode/gemini/grok 全部没装。这违反 README 第 41 行 "if that host's config directory does not exist, install skips it" 的承诺。修复：

- `installCodex`、`installOpenCode`、`installKiro` 补齐与其他 host 一致的目录存在性守卫；
- `installAgents` / `uninstallAgents` 每个 agent 独立 try/catch，失败报告 `<agent>: failed — <message>` 并继续装其余；
- skill 复制同样只在宿主目录已存在时进行（`skillTarget(...).requiresDir`），`.agents` 仅随 codex 出现；OpenCode dream command 只落到已存在的 OpenCode 目录。空 HOME 下 `install` 现在逐个干净 skip、零副作用、exit 0。

### 2. hook 把非工作区 cwd 写进 last-root 缓存，部分重开 P0 错投窗口（已实证、已关闭）

`cli.ts` 的 `runHook` 无条件 `rememberRoot(resolveCwd(input) || process.cwd())`，不校验 cwd 是否 workspace（git root 或 `.memory` 祖先）。在非 git、无 `.memory` 的目录跑 SessionStart hook 会把 `last-root.txt` 指向该目录，30 分钟 TTL 内 cwd-less MCP 写入会错投到那里——正是 P0 的错投类，只是多了 TTL 和 `[ledger: …]` 前缀两道缓冲。修复：`probeFromCwd` 导出，hook 只在 probe 成功时 stamp（`paths.ts` 的 `resolveProjectRoot` 内部规则一致化；Stop 等不读索引的事件保留缓存刷新，但来源 cwd 必须先通过 probe）。

### 3. 用户级 MCP 条目盲覆盖/盲删除（已关闭）

`mergeMcpStdio` 曾无条件覆盖 `servers["project-memory"]`，卸载按裸 key 名删。现在 `host-config.ts` 提供 `referencesPath`（条目内任何字符串归一化后引用本仓库 `dist/mcp.js` 才算"我们的"），`upsertMcpServer` 拒绝覆盖异己条目（与 `installKiroWorkspaceMcp` 同规则），`removeMcpServer` 带路径守卫：异己条目 uninstall 时保留并在报告注明 `foreign project-memory mcp entry left in place`。指向旧 checkout 的条目同样按异己处理，由 doctor 的 stale-path 扫描兜底。

### 4. CLI 位置参数与 flag 值混杂（已关闭）

`read`/`forget`/`search`/`write` 的位置参数过滤只剔除 `--` 开头的 token，flag 的值会漏进正文：`write --name x --type project hello` 会把 `project` 写进 body，`search --cwd <dir> 关键词` 会把目录路径当搜索词。新增 `positionalArgs`（按 `VALUE_FLAGS` 表跳过 flag 及其值），四个子命令统一走它。

### 5. 其他

- `adapters/codex/hooks.json` 曾自称 "merged into ~/.codex/hooks.json by install" 但 install 不读它、且命令缺 `--flavor codex`；已更正为与 install 输出一致并标注 reference-only。`adapters/zcode/hooks/hooks.json` 同样标注。
- `package.json` 的 `test` 从手工列举文件改为 `tsc && cd dist && node --test`（自动发现；Node 20/22 支持，目录参数形式在新 Node 有回归故不用）。
- 新增 `src/cli.test.ts`：hook 在 git 工作区 stamp、非工作区不 stamp、write/search 位置参数不吞 flag 值（均为 dist 子进程级）。install/host-config 测试补 codex/opencode skip、失败隔离、异己 MCP 保留/拒绝覆盖。

验收：空 HOME 全量 install 零副作用 exit 0；非工作区 hook 后无 `last-root.txt`；`npm test` 120 passed（Node 24 本机；CI 覆盖 Node 20/22 x Ubuntu/Windows）。
