# OncoReplay｜肿瘤研究时光机

> 输入一个肿瘤研究主题，观看论文、引用、研究分支、争议候选和临床转化如何随时间演化。

OncoReplay 是一个面向科研探索与传播的中文互动网页。界面与新建回放叙事使用简体中文，论文标题等来源内容保留原文。它不是系统综述、临床决策工具、科学真伪裁判或医疗建议。

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
- 中文首页、创建页、进度页、回放页、证据抽屉、方法和关于页面
- 内置 KRAS G12D 交互演示

生成流程分五阶段（FETCH_WORKS → ENRICH_BIOMEDICAL → BUILD_TIMELINE → GENERATE_NARRATIVE → FINALIZE_REPLAY）。候选集最多保存 500 篇；为控制计算开销，评分和图分析最多选取相关性最高的 220 篇，最终默认展示最多 70 个关键节点。

## 界面风格

采用暖米白、浅灰与赤陶色，衬线标题与系统无衬线正文保持统一层级，图表与状态提示保留必要的颜色区别。

页眉内容区居中，品牌与标题靠左，操作靠右；页眉位于文档顶部，随页面正常滚走，窄屏允许换行。页眉背景与分隔线铺满页面宽度。

手机回放操作可折叠，模式和分享入口均可使用。重复查询复用已有回放，失败任务可以显式重试；超出创建或重试额度时显示提示。

## 数据与隐私

回放默认非公开列出（unlisted），链接含随机标识，只有知道网址的人才能看到。无登录、无 Cookie。生成的回放与运行记录保存在 Cloudflare D1 数据库中：失败任务保留 7 天、成功回放保留 90 天后自动删除。请勿在主题中输入可识别患者身份的信息。

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

项目已接入 Cloudflare Git 集成：推送 `main` 分支即自动构建部署。首次接入前需手动创建资源（完整部署、升级与排错步骤见 `SETUP_ZH.md`）：

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

部署后访问 `https://oncoreplay.<你的子域>.workers.dev/api/health`，预期四个 binding 均为 `true`。

## 责任边界

- 内置 KRAS G12D 数据是交互演示数据，界面会明确标识，不能引用
- 自定义回放使用开放学术元数据和来源约束的机器归纳，但仍可能受数据库覆盖、摘要缺失、引用偏差和聚类稳定性影响
- `Challenge` 是机器检测的待核查候选；`Correction` 只根据结构化来源展示，不推断学术不端
- 每个关键事件都应通过证据抽屉返回 DOI、PMID 或 OpenAlex 来源核查

完整部署、升级与排错步骤见 `SETUP_ZH.md`。

## License

MIT

---

> AI 编程代理请阅读 [AGENTS.md](./AGENTS.md) 了解代码架构、测试与开发约定。

---

## AI 维护提醒

> **⚠️ 任何修改此项目的 AI 代理（Claude Code、Cursor、Copilot 等）都必须同步更新本文件与 [AGENTS.md](./AGENTS.md)。**
>
> - `Challenge` 与 `Correction` 必须保持机器检测候选的表述边界，不得推断学术不端
