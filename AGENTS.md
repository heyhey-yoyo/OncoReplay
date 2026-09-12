# OncoReplay（肿瘤研究时光机） — 项目说明（供 AI 编程代理阅读）

本文件供 AI 编码代理使用。修改代码前请先阅读本文件。

## 项目概览

输入一个肿瘤研究主题，从 OpenAlex 拉取论文，经引用扩展、元数据富化、评分聚类、AI 叙事，产出可暂停、可核查、可分享的研究演化时间线（论文、引用、研究分支、争议候选、更正/撤稿与临床转化）。

五阶段生成管线（Queue 消息驱动，`src/worker/lib/pipeline.js`）：`FETCH_WORKS` → `ENRICH_BIOMEDICAL` → `BUILD_TIMELINE` → `GENERATE_NARRATIVE` → `FINALIZE_REPLAY`。候选集最多 500 篇；O(n²) 图分析只取相关性最高 220 篇；默认展示最多 70 个关键节点。

科学边界：不是系统综述、临床决策工具或真伪裁判；`Challenge` 是机器检测的待核查候选，`Correction` 只展示结构化来源状态，不推断学术不端。

## 技术栈与运行架构

- 前端：原生 JS SPA（无框架、无构建器），`public/app.js` + `public/core.mjs`；双语（默认简体中文，可切英文）
- 后端：Cloudflare Worker（Node 风格 ESM，无 TypeScript、无第三方运行时依赖），wrangler v4
- 数据源：OpenAlex（需 `OPENALEX_API_KEY`）、Europe PMC、Crossref
- 数据库：D1（SQLite，binding `DB`，11 张表，`migrations/` 管理）
- 队列：`oncoreplay-replay-jobs`（consumer `max_batch_size: 5`、`max_retries: 3`，DLQ `-dlq`）
- AI：Workers AI，默认 `@cf/meta/llama-3.3-70b-instruct-fp8-fast`（可用 env `AI_MODEL` 覆盖），`response_format: json_schema`
- 静态资源：Cloudflare Assets（`assets.directory: "./dist"`，`run_worker_first: ["/api/*"]`）；构建 = 复制 `public/` → `dist/`
- Cron：`wrangler.jsonc` 配置每日一次 trigger（`triggers.crons`）触发 `scheduled()` 清理过期回放；另有「每次新生成必触发 + 普通请求 0.5% 概率」的流量钩子作为补充

## 项目结构

| 文件 | 作用 |
| --- | --- |
| `public/index.html` | SPA 页面结构 |
| `public/styles.css` | 全部样式 |
| `public/app.js` | SPA 主文件：路由、表单、轮询、回放渲染、SVG 时间线、中英切换 |
| `public/core.mjs` | 前端纯函数：clamp/yearProgress/playbackStep/escapeHtml 等 |
| `public/data/kras-g12d.json` | 内置 KRAS G12D 交互演示数据 |
| `public/project-mark.svg` | 页面标志与 favicon 共用图形 |
| `public/favicon.svg` / `public/robots.txt` | favicon 图标与抓取规则 |
| `src/worker/index.js` | Worker 入口：路由（/api/health、/api/query/preview、/api/replays）、queue()、scheduled()、输入校验、query_hash 去重、公开写接口限流 |
| `src/worker/lib/pipeline.js` | 五阶段状态机、候选扩展、D1 批量写入、AI Schema 校验、清理策略、回放组装 |
| `src/worker/lib/analysis.js` | 加权图、Louvain、relevance/turning-point 评分、7 类规则事件、中英规则文案 |
| `src/worker/lib/clients.js` | OpenAlex / Europe PMC / Crossref 客户端 |
| `src/worker/lib/utils.js` | tokenize、余弦/Jaccard、fetchJson 重试退避、mapWithConcurrency |
| `src/worker/lib/rate-limit.js` | 公开写接口固定窗口限流（D1 `rate_limits` 计数、fail-open、env 阈值可覆盖） |
| `src/worker/lib/cancer-types.js` | 34 个 TCGA 癌种 → OpenAlex 同义词组 |
| `migrations/` | 0001_init.sql（10 表 + 9 索引）、0002_full_pipeline.sql、0003_query_hash_unique.sql、0004_rate_limits.sql |
| `scripts/build.mjs` | 构建：`public/` → `dist/` |
| `scripts/dev-server.mjs` | 纯静态预览服务器（`dev:static` / `preview`） |
| `tests/` | core / analysis / pipeline / rate-limit 四个测试文件 |
| `wrangler.jsonc` | 主 Worker 配置（D1 / Queue / AI / Assets 绑定） |
| `wrangler.demo.jsonc` | 无后端静态演示配置（`deploy:demo`） |
| `SETUP_ZH.md` | 部署/升级/排错权威文档（排查「卡在 queued」等问题） |
| `package.json` / `package-lock.json` | npm 脚本与锁定依赖 |
| `.dev.vars.example` | 本地 secrets 模板（`OPENALEX_API_KEY` 等） |
| `LICENSE` | MIT 许可证 |
| `.gitignore` | Git 忽略规则 |

## 运行与构建

```bash
npm ci
cp .dev.vars.example .dev.vars   # 填真实 OPENALEX_API_KEY
npm run db:local                 # 应用迁移到本地 D1
npm run dev                      # = build + wrangler dev（完整本地环境）
npm run check                    # 语法检查
npm test                         # 单元测试
npm run deploy                   # = build + wrangler deploy
npm run deploy:demo              # 纯静态演示部署（wrangler.demo.jsonc）
```

`package-lock.json` 是 Worker 工具的可复现与安全基线；保持稳定 Wrangler 和已审计的间接依赖覆盖，不使用 `npm audit fix --force` 或预发布版本。

注意：`npm run dev` 会先构建（复制 public 到 dist），改前端后需重新 dev 或 build 才能生效；`dist/` 是构建产物勿手改。

## 测试

- Node 内置 `node:test`：core（回放数学）、analysis（图/Louvain/评分端到端 3–6 分支、事件必有来源论文）、pipeline（命名空间隔离、AI 输出严格校验、topicAffinity、癌种同义词全覆盖）、rate-limit（固定窗口计数、超限判定、fail-open、配置回退）
- 纯函数级测试，不测 HTTP/真实 API；不依赖环境变量

## 代码组织与风格约定

- 依赖方向清晰无循环：utils → clients/analysis/cancer-types → pipeline → index（只做路由与校验）
- 双语：前端 `L(zh, en)` 宏；后端规则文案维护 zh/en 两套字面量；AI prompt 带 `language` 字段与字符数约束
- 评分公式在 `analysis.js` 的 `scoreWorks()`（relevance）与 turning-point 评分；候选排序在 `pipeline.js` 的 `candidatePriority`
- SQL 全部手写参数绑定（`.bind()`），批量写用 `env.DB.batch`（75 条/批）
- Worker 错误统一 `{error: {code, message, requestId}}`，响应头带 `x-request-id`；fatal 错误不重试，其余指数退避
- ESM、中文注释（解释「为什么」）、数值取整走 `core.mjs` 纯函数

## 部署

- 先决：`wrangler d1 create oncoreplay-db`（回填 `database_id`）、`wrangler queues create` ×2、`wrangler secret put OPENALEX_API_KEY`（必需，缺失时部署报错）、`wrangler d1 migrations apply --remote`，然后 `npm run deploy`
- 部署后验证 `/api/health` 返回 `bindings: {d1:true, queue:true, ai:true, openAlex:true}`
- 日常迭代推送 `main` 分支经 Cloudflare Git 集成自动构建部署；首次资源创建与排障用上文手动步骤；`wrangler.demo.jsonc` 提供无后端静态演示

## 安全与数据注意事项

- 外部 API 有界：OpenAlex 超时 14s/重试 2 次、并发上限 3；富化只补前 35 篇缺摘要、前 30 篇有 DOI 的
- 输入校验：主题 3–240 字符、年份 1900–当前、maxWorks 40–500、angle/locale 白名单
- 回放默认 `unlisted`，slug 含 7 位随机 UUID；前端提示勿输入可识别患者身份的信息；无登录、无 Cookie
- 公开写接口限流：创建 5 次/小时、重试 10 次/小时（按 CF-Connecting-IP 的固定窗口，D1 `rate_limits` 表计数；env `RATE_LIMIT_CREATE_PER_HOUR` / `RATE_LIMIT_RETRY_PER_HOUR` 可覆盖；限流存储故障 fail-open 放行并记日志）
- 数据保留：失败 7 天 / 成功 90 天 / 孤立论文 7 天 / 失效反馈 90 天，子表级联删除
- AI 安全：AI 只能用输入中的 work ID，禁止发明事实；每次调用落 `ai_runs` 审计；校验失败重试 1 次后回退规则文案（`ai_generated=0`）
- 所有用户/AI 文本经 `escapeHtml` 渲染；外链 `rel="noreferrer"`

## 界面维护约定

前端使用 `ydchen-portfolio` 的米白 / 赤陶色视觉系统；视觉调整不得改变时间线可视化、双语文案、证据边界、Worker 路由或 D1 schema。

## 标志维护约定

项目标志采用统一的深灰方章、米白线条与赤陶色识别点，页面标志与 favicon 共用同一 `public/project-mark.svg`。后续替换必须保持原标志容器宽高，不得借机改变页眉、网格或页面布局。

---

## 2026-09-13 维护补充

query_hash 唯一索引负责并发去重；失败回放也复用原记录，由显式重试接口重新排队。重试的任务更新与回放领取在同一 D1 batch 事务内完成，失败方不得改写任务。限流配置必须为正的安全整数，默认创建 5 次/小时、重试 10 次/小时，429 返回 Retry-After。


## 跨项目视觉与回归基准（2026-09-13）

本项目归类为 **普通项目**。72px / 64px 页眉，48px / 40px 方章，18px / 16px 衬线标题，12px 无衬线副标题。 正文采用统一系统无衬线字体、默认 16px / 1.6；标题使用衬线层级，数字与代码可使用统一等宽族。辅助文字通常为 12–14px，密集科学数据可按实际场景调整。主界面延续米白与赤陶 #a94f31，柔和色块上的文字用更深色保证可读性。

首页及回放页共用品牌页眉，回放操作保留独立工具栏。叙事区使用浅色阅读背景；深色可视化区保留分类色和高对比文字。浏览器禁用存储时仍可打开页面和切换语言。新增内存 SQLite 检查实际 Worker 创建、并发重试、限流与迁移约束。

当前检查命令：

```bash
npm run check
npm test
npm run test:database
npm run build
```

`test:database` 需要 Node.js 22.13+ 的内置 SQLite，在内存库中运行，不读取线上数据库或调用真实生成队列。基础构建的 Node.js 要求保持原项目约定。

本节为当前视觉维护基准，替代此前分散的字号、页眉尺寸和 QA 颜色例外；不要重新添加全局深色主题与末尾浅色覆盖。保留一个顶层 `:root`，条件规则和深色图形舞台局部令牌保持独立。修改后至少核验 1440、820、390px，涉及断点、图表或存储时补查相应交互。构建、单测、浏览器本地和线上部署是不同验收层次，记录其实际范围。

## 页眉滚动行为更新

品牌页眉位于文档顶部，随页面正常滚走，不使用 fixed/sticky 吸顶；字体、字号、标志尺寸和三类排布基准保持一致。 工作室/回放顶部工具栏同步随页面滚走，取消原页眉吸顶偏移。

## AI 维护提醒

> **⚠️ 任何修改此项目的 AI 代理（包括未来的你自己）都必须遵守：**
>
> - `Challenge` 与 `Correction` 必须保持机器检测候选的表述边界，不得推断学术不端
> - 修改 D1 schema 必须新增 migration（`migrations/`），不得改旧文件；分支/事件 ID 需命名空间隔离
> - 改动 AI prompt 或 schema 校验后必须通过 `npm test`（pipeline 测试强制校验不发明证据）
> - 部署前确认 `OPENALEX_API_KEY` 已配置；`SETUP_ZH.md` 是排错权威文档
