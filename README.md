# OncoReplay｜肿瘤研究时光机

> 输入一个肿瘤研究主题，观看论文、引用、研究分支、争议候选和临床转化如何随时间演化。

OncoReplay 是一个面向科研探索与传播的双语互动网页。默认界面为简体中文，可切换英文。它不是系统综述、临床决策工具、科学真伪裁判或医疗建议。

## 主要功能

- OpenAlex 主题检索、核心论文抽样、参考文献扩展、被引论文扩展和 related works 扩展
- Europe PMC 摘要、PMID、PMCID 和 DOI 补充
- Crossref 更正、撤稿、表达关注及其他 DOI 更新关系核对
- 可解释的 relevance 与 turning-point 评分
- 基于引用、主题、文本相似度和 bibliographic coupling 的加权图
- Louvain 社区发现，并把分支数量约束为 3–6 条
- Birth、Breakthrough、Branching、Revival、Translation、Challenge、Correction 规则事件
- Workers AI 输出 + 应用端二次严格校验 + 一次修复重试 + 规则回退
- D1 持久化、Cloudflare Queue 五阶段任务、失败状态与重试
- 中文首页、创建页、进度页、回放页、证据抽屉、Methodology、About，以及中英文切换
- 内置 KRAS G12D 交互演示

生成流程分五阶段（FETCH_WORKS → ENRICH_BIOMEDICAL → BUILD_TIMELINE → GENERATE_NARRATIVE → FINALIZE_REPLAY）。候选集最多保存 500 篇；为控制计算开销，评分和图分析最多选取相关性最高的 220 篇，最终默认展示最多 70 个关键节点。

## 界面风格

界面采用 `ydchen-portfolio` 的暖米白、浅灰与赤陶色视觉系统，使用衬线标题和扁平化信息卡片；时间线可视化、双语文案和证据抽屉保持不变。

## 本地运行

要求 Node.js 20 或更高版本。

```bash
npm ci
cp .dev.vars.example .dev.vars
# 在 .dev.vars 中填写 OPENALEX_API_KEY
npm run db:local
npm run dev
```

Wrangler 会输出本地地址。使用完整 `npm run dev` 才能测试 API、D1、Queue 和 AI binding；`npm run dev:static` 只预览静态页面和内置示例。

## 部署

```bash
npm exec -- wrangler login
npm exec -- wrangler d1 create oncoreplay-db
npm exec -- wrangler queues create oncoreplay-replay-jobs
npm exec -- wrangler queues create oncoreplay-replay-jobs-dlq
npm exec -- wrangler secret put OPENALEX_API_KEY
npm exec -- wrangler d1 migrations apply oncoreplay-db --remote
npm run deploy
```

创建 D1 后，把命令返回的 `database_id` 写入 `wrangler.jsonc`。同时把 `CONTACT_EMAIL` 和 `CROSSREF_MAILTO` 改为你自己的联系邮箱。

`package-lock.json` 固定稳定版 Wrangler 和已审计的间接依赖。安装或修复依赖时不要使用 `npm audit fix --force` 或预发布版本。

部署后访问 `https://oncoreplay.<你的子域>.workers.dev/api/health`，预期四个 binding 均为 `true`（d1、queue、ai、openAlex）。

## 责任边界

- 内置 KRAS G12D 数据是交互演示数据，界面会明确标识，不能引用
- 自定义回放使用开放学术元数据和来源约束的机器归纳，但仍可能受数据库覆盖、摘要缺失、引用偏差和聚类稳定性影响
- `Challenge` 是机器检测的待核查候选；`Correction` 只根据结构化来源展示，不推断学术不端
- 每个关键事件都应通过证据抽屉返回 DOI、PMID 或 OpenAlex 来源核查

完整部署、升级与排错步骤见 `SETUP_ZH.md`。

---

> AI 编程代理请阅读 [AGENTS.md](./AGENTS.md) 了解代码架构、测试策略与开发约定。

---

## AI 维护提醒

> **⚠️ 任何修改此项目的 AI 代理（Claude Code、Cursor、Copilot 等）都必须同步更新本文件与 [AGENTS.md](./AGENTS.md)。**
>
> - `Challenge` 与 `Correction` 必须保持机器检测候选的表述边界，不得推断学术不端
