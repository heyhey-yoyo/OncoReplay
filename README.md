# OncoReplay｜肿瘤研究时光机

> 输入一个肿瘤研究主题，观看论文、引用、研究分支、争议候选和临床转化如何随时间演化。

OncoReplay 是一个面向科研探索与传播的双语互动网页。默认界面为简体中文，可切换英文。它不是系统综述、临床决策工具、科学真伪裁判或医疗建议。

## 当前版本：完整自定义生成管线

本仓库已经实现：

- OpenAlex 主题检索、核心论文抽样、参考文献扩展、被引论文扩展和 related works 扩展；
- Europe PMC 摘要、PMID、PMCID 和 DOI 补充；
- Crossref 更正、撤稿、表达关注及其他 DOI 更新关系核对；
- 可解释的 relevance 与 turning-point 评分；
- 基于引用、主题、文本相似度和 bibliographic coupling 的加权图；
- Louvain 社区发现，并把分支数量约束为 3–6 条；
- Birth、Breakthrough、Branching、Revival、Translation、Challenge、Correction 规则事件；
- Workers AI JSON Schema 输出、应用端二次严格校验、一次修复重试和规则回退；
- D1 持久化、Cloudflare Queue 五阶段任务、失败状态与重试；
- 中文首页、创建页、进度页、回放页、证据抽屉、Methodology、About，以及中英文切换；
- 内置 KRAS G12D 交互演示。

## 五阶段生成流程

```text
1. FETCH_WORKS
   OpenAlex 核心检索 + 参考文献 + 被引文献 + related works
2. ENRICH_BIOMEDICAL
   Europe PMC 摘要补充 + Crossref 更新状态核对
3. BUILD_TIMELINE
   真实评分 + 加权图 + Louvain 聚类 + 规则事件
4. GENERATE_NARRATIVE
   Workers AI 严格 Schema 叙事；失败则保留规则文本
5. FINALIZE_REPLAY
   写入统计并发布只读回放
```

候选集最多保存 500 篇；为控制 Cloudflare Worker 的图计算开销，评分和 O(n²) 加权图分析最多选取相关性最高的 220 篇，最终默认展示最多 70 个关键节点。

## 已部署旧版的升级入口

你曾经看到的：

```text
Custom generation pipeline is scaffolded. Configure D1, Queue, and Workers AI to continue.
```

来自旧版前端硬编码提示，不是 Cloudflare 配置错误。升级本版本后，需要应用新增迁移并重新部署：

```bash
npm install
npx wrangler d1 migrations apply oncoreplay-db --remote
npm run deploy
```

完整升级步骤和故障排查见 [`SETUP_ZH.md`](./SETUP_ZH.md)。

## 本地运行

要求 Node.js 20 或更高版本。

```bash
npm install
cp .dev.vars.example .dev.vars
# 在 .dev.vars 中填写 OPENALEX_API_KEY
npm run db:local
npm run dev
```

Wrangler 会输出本地地址。使用完整 `npm run dev` 才能测试 API、D1、Queue 和 AI binding；`npm run dev:static` 只预览静态页面和内置示例。

## 部署

```bash
npx wrangler login
npx wrangler d1 create oncoreplay-db
npx wrangler queues create oncoreplay-replay-jobs
npx wrangler queues create oncoreplay-replay-jobs-dlq
npx wrangler secret put OPENALEX_API_KEY
npx wrangler d1 migrations apply oncoreplay-db --remote
npm run deploy
```

创建 D1 后，把命令返回的 `database_id` 写入 `wrangler.jsonc`。同时把 `CONTACT_EMAIL` 和 `CROSSREF_MAILTO` 改为你自己的联系邮箱。

## 验证

```bash
npm run check
npm test
npm run build
```

部署后访问（Workers Builds 或 wrangler 部署均适用）：

```text
https://oncoreplay.<你的子域>.workers.dev/api/health
```

预期四个 binding 均为 `true`：

```json
{
  "bindings": {
    "d1": true,
    "queue": true,
    "ai": true,
    "openAlex": true
  }
}
```

## 主要目录

```text
public/app.js                    中文/英文 SPA、创建与回放交互
public/data/kras-g12d.json       固定演示数据，不得作为科学引用
src/worker/index.js              Worker API、任务创建、状态和重试
src/worker/lib/clients.js        OpenAlex / Europe PMC / Crossref 客户端
src/worker/lib/analysis.js       评分、图构建、Louvain、事件规则
src/worker/lib/pipeline.js       五阶段 Queue 生成管线、AI Schema 校验
migrations/0001_init.sql         基础 D1 模型
migrations/0002_full_pipeline.sql 完整管线升级字段
SETUP_ZH.md                      中文部署、升级与排错教程
```

## 科学边界

- 内置 KRAS G12D 数据是交互演示数据，界面会明确标识，不能引用。
- 自定义回放使用开放学术元数据和来源约束的机器归纳，但仍可能受数据库覆盖、摘要缺失、引用偏差和聚类稳定性影响。
- `Challenge` 是机器检测的待核查候选；`Correction` 只根据结构化来源展示，不推断学术不端。
- 每个关键事件都应通过证据抽屉返回 DOI、PMID 或 OpenAlex 来源核查。
