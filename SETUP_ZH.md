# OncoReplay 中文部署、升级与排错

日常维护采用 GitHub main → Cloudflare Git 集成自动部署。使用说明见 [README.md](./README.md)，模块与测试约定见 [AGENTS.md](./AGENTS.md)。

## 现有部署升级

核对本地修改与 origin/main，审查代码、依赖、配置和 migrations 差异。保留现有数据库标识、Queue 名称、域名及 Cloudflare 环境变量，不能用示例配置覆盖真实部署。

```bash
npm ci
npm run check
npm test
npm run test:database
npm run build
```

完整验证推荐 Node.js 22.13+（test:database 使用内置 SQLite）；基础构建最低要求见 package.json。数据库测试使用内存库和替代队列，不读取生产数据。

如果 migrations 有新增，先备份并查看待执行迁移，再应用。0003_query_hash_unique.sql 会清理重复查询及关联记录，0004_rate_limits.sql 创建限流表；不能将去重迁移当作无数据影响的普通建表。具体保留顺序见本文件“查询去重与写入限流”。纯文档修改不需再次迁移。

```bash
npx wrangler d1 migrations list oncoreplay-db --remote
```

完成备份与差异核对后，再执行 npm run db:remote。通过适用验收后提交并推送 main，等待 Cloudflare 部署成功，核对部署 commit。不要只因前端能打开就判定生成服务正常。

## 首次部署资源

本仓库 wrangler.jsonc 包含现有部署的数据库标识；仅部署到新账户时替换为新建资源，已有实例不要重建。

```bash
npm ci
npx wrangler login
npx wrangler d1 create oncoreplay-db
npx wrangler queues create oncoreplay-replay-jobs
npx wrangler queues create oncoreplay-replay-jobs-dlq
npx wrangler secret put OPENALEX_API_KEY
```

将新数据库 ID 回填 wrangler.jsonc；保留 DB、REPLAY_QUEUE、AI、ASSETS 绑定以及 /api/* 优先路由。OPENALEX_API_KEY 是必需 secret，不写入 Git。CONTACT_EMAIL、CROSSREF_MAILTO 可在部署环境配置为维护者联系邮箱；先查看现有环境配置，避免覆盖已有值。

首次资源初始化后运行 npm run db:remote，再运行 npm run deploy 完成初次部署；后续接入 Cloudflare Git 集成并使用 main 自动部署。定时清理由 wrangler.jsonc 的 0 2 * * *（UTC 每日 02:00）触发，处理过期回放与任务；保持该配置与 scheduled() 实现一致。

## 本地开发

复制 .dev.vars.example 为 .dev.vars 并填写本地 secret，执行 npm run db:local 和 npm run dev。完整 dev 使用 Wrangler 的 API/绑定环境；npm run dev:static 只提供静态页面与内置演示。前端修改后重新 build/dev，dist 是构建产物，不手动编辑。

## 发布后核对

访问正式站点 [健康接口](https://oncoreplay.ydchen.com/api/health)，核对 d1、queue、ai、openAlex 绑定状态。使用浏览器禁用缓存/硬刷新，并核对实际加载的资源版本。涉及生成管线时，再按下文验证小规模真实任务、状态轮询、证据来源和失败重试。真实生成会消耗上游额度，静态和数据库测试通过不代表已经执行真实生成。

## 真实生成管线说明

### OpenAlex 多层扩展

第一阶段执行：

1. 主题全文检索，最多获取 100 篇 seed works；
2. 对高优先级核心论文扩展参考文献；
3. 查询引用核心论文的后续论文；
4. 有界扩展 OpenAlex related works；
5. 按年份、排除词、文本相关性和层级优先级去重裁剪；
6. 把论文和引用/相关关系写入 D1。

候选集最多 500 篇。为避免在 Worker 中对 500 篇执行昂贵的全对全图计算，第二阶段之后会选择相关性最高的最多 220 篇进入加权图分析，其他候选仍保存在 D1。

### Europe PMC 摘要补充

对缺少摘要且具有 PMID 或 DOI 的高优先级论文查询 Europe PMC `resultType=core`，补充：

- abstract；
- PMID；
- PMCID；
- DOI；
- 首次发表日期线索。

Europe PMC 失败不会让整条回放失败；系统继续使用 OpenAlex 数据。

### Crossref 更新核对

对具有 DOI 的高优先级论文：

- 查询单篇 Crossref metadata；
- 读取 `update-to`、`updated-by` 和 relation；
- 使用 `updates:<doi>` 查询更新该 DOI 的更正/撤稿记录；
- 规范化为 correction、retraction、expression-of-concern、reinstatement 等状态；
- 只展示结构化状态，不从标题推断学术不端。

### turning-point 评分

评分组合：

- 文本与实体相关性；
- OpenAlex topic 一致性；
- 与核心论文的网络距离；
- citation normalized percentile、FWCI 和同候选集引用分位；
- 年度引用动量；
- 跨社区桥接；
- 新分支首次出现；
- 临床信号；
- 挑战/限制性语言候选；
- 复兴信号；
- Crossref/OpenAlex 结构化更新。

每篇关键论文的分项会写入 `replay_works.analysis_json`，前端用归一化影响和争议信号控制节点视觉。

### Louvain 聚类

系统构造无向加权图，边来自：

- 引用关系；
- OpenAlex related 关系；
- topic Jaccard；
- 标题与摘要 token cosine；
- bibliographic coupling。

随后执行确定性的 Louvain 局部模块度优化，并通过合并或拆分把社区数量约束到 3–6 条，以保证可视化可读性。AI 只负责给已有社区命名，不负责改变论文归属。

### Workers AI 严格 Schema

AI 输入只包含：

- 已生成的分支；
- 已生成的规则事件；
- 与事件绑定的论文 ID、标题、年份和截断摘要；
- 结构化更新状态。

AI 无权生成新 work ID、DOI、PMID、日期、引用关系或撤稿状态。

### 完整自定义回放

任务完成后 `/api/replays/:slug` 返回：

- 分支；
- 关键论文；
- 可视化边；
- 8–15 个事件；
- 来源 work IDs；
- 置信度与人工核查标记；
- 当前开放问题；
- 回放叙事与历史数据兼容所需的语言字段。

---

## 中文化说明

网页固定使用简体中文，旧本地语言偏好不影响界面；新建回放请求使用 zh。

已中文化：

- 首页与导航；
- 创建表单；
- 检索预览；
- 五阶段生成状态；
- API 错误；
- 回放控制；
- Momentum / Debate；
- 事件类型；
- 证据抽屉；
- Methodology；
- About 与免责声明；
- 规则叙事；
- Workers AI 中文 Prompt。

导航提供探索、方法与关于入口；界面不提供语言切换。后端保留语言字段兼容历史回放，论文来源内容保留原文。

英文研究主题通常比纯中文主题更容易匹配开放学术数据库，因此创建页会建议使用英文主题，但输出界面和 AI 叙事可保持中文。

---

## API 验证

### Health

```bash
curl https://你的域名/api/health
```

### Query preview

```bash
curl -X POST https://你的域名/api/query/preview \
  -H 'content-type: application/json' \
  -d '{
    "topic":"KRAS G12D inhibitors in pancreatic cancer",
    "startYear":2006,
    "endYear":2026,
    "maxWorks":100,
    "angle":"all",
    "locale":"zh"
  }'
```

### 创建回放

```bash
curl -X POST https://你的域名/api/replays \
  -H 'content-type: application/json' \
  -d '{
    "topic":"KRAS G12D inhibitors in pancreatic cancer",
    "startYear":2006,
    "endYear":2026,
    "maxWorks":100,
    "angle":"all",
    "locale":"zh"
  }'
```

返回 `slug` 后：

```bash
curl https://你的域名/api/replays/返回的slug/status
curl https://你的域名/api/replays/返回的slug
```

---

## 日志和数据库检查

### 实时 Worker 日志

```bash
npx wrangler tail
```

保持终端打开，再从网页提交主题。

### 查看任务状态

```bash
npx wrangler d1 execute oncoreplay-db --remote --command="SELECT id,replay_id,job_type,status,progress_current,progress_total,error_code,error_message,updated_at FROM jobs ORDER BY updated_at DESC LIMIT 10"
```

### 查看回放状态

```bash
npx wrangler d1 execute oncoreplay-db --remote --command="SELECT slug,status,work_count,event_count,updated_at FROM replays ORDER BY updated_at DESC LIMIT 10"
```

### 查看 AI 回退情况

```bash
npx wrangler d1 execute oncoreplay-db --remote --command="SELECT task_type,model,status,validation_errors_json,created_at FROM ai_runs ORDER BY created_at DESC LIMIT 10"
```

`status='fallback'` 表示 Schema 或模型调用失败，但规则版回放仍应完成。

---

## 常见错误

### 仍显示 scaffolded 英文提示

原因：仍在使用旧 `public/app.js` 或 CDN/浏览器缓存。

处理：

```bash
npm run build
npm run deploy
```

然后无痕窗口打开。确认新版代码中不存在旧字符串：

```bash
grep -R "Custom generation pipeline is scaffolded" public src
```

### `/api/health` 中 `openAlex: false`

```bash
npx wrangler secret put OPENALEX_API_KEY
npm run deploy
```

如果改变过 Worker `name` 或环境，需要在对应 Worker/环境重新设置 secret。

### `no such column: subtitle` 或 `analysis_json`

新版迁移未应用：

```bash
npx wrangler d1 migrations apply oncoreplay-db --remote
```

确认 `wrangler.jsonc` 指向你实际使用的 D1 database ID。

### 状态一直停在 `queued`

检查：

1. `/api/health` 的 `queue` 是否为 `true`；
2. `wrangler.jsonc` producer binding 是否为 `REPLAY_QUEUE`；
3. consumer queue 名是否和实际队列一致；
4. Cloudflare Dashboard → Queues → 主队列 → Consumers 是否绑定当前 Worker；
5. `npx wrangler tail` 是否有 consumer 错误。

重新部署通常会同步 consumer 配置：

```bash
npm run deploy
```

### `OPENALEX_ERROR` 或 401/403

- 检查 key 是否有效；
- 检查 Worker secret 名必须精确为 `OPENALEX_API_KEY`；
- 不要在 key 前后加入引号或空格；
- 检查 OpenAlex 账户额度与状态。

### `NO_WORKS_FOUND`

- 使用英文主题；
- 去掉过窄的癌种或年份；
- 删除排除词；
- 先确认 query preview 有样本文献。

### Crossref 或 Europe PMC 暂时失败

补充源失败会被局部降级，不会必然终止整条回放。结果会保留 OpenAlex 元数据；更新状态未核对时，不会凭标题推断撤稿。

### Workers AI 失败但回放完成

这是预期降级行为。查看 `ai_runs`：

- `complete`：Schema 叙事成功；
- `fallback`：模型调用或验证失败，使用规则标题和摘要。

### Queue 进入 DLQ

查看 Cloudflare Dashboard 的 `oncoreplay-replay-jobs-dlq`，并用 D1 `jobs.error_code/error_message` 定位失败阶段。修复配置后，在回放失败页点击“从头重试”，或调用：

```bash
curl -X POST https://你的域名/api/replays/slug/retry
```

### 第二个自定义回放出现 branch 主键冲突

本版本已给每个 replay 的 Louvain community ID 增加 replay 前缀，避免多个回放在同一 D1 中共享 `c0/c1` 造成冲突。请确认部署的是 0.3.0 新版，而不是中间构建。

---

## 自定义域名

部署完成后可在 Cloudflare Dashboard：

```text
Workers & Pages
→ 选择 oncoreplay
→ Settings / Domains & Routes
→ Add Custom Domain
```

前后端使用同源 `/api/*`，不需要额外配置 CORS。

---

## 发布前检查清单

```text
[ ] wrangler.jsonc 中 database_id 已替换
[ ] CONTACT_EMAIL / CROSSREF_MAILTO 已替换
[ ] OPENALEX_API_KEY secret 已设置
[ ] 两个 Queue 已创建
[ ] migrations/ 中所有待执行迁移已核对并应用（包括查询去重和限流表）
[ ] /api/health 四个 binding 均为 true
[ ] query preview 返回真实 OpenAlex 样本
[ ] 100 篇小任务能完成五阶段生成
[ ] 证据抽屉能打开 DOI/OpenAlex 来源
[ ] 手机端可拖动年份和打开证据
[ ] 页面默认中文，EN 切换正常
[ ] 页面固定显示研究工具和非医疗建议声明
```

---

## 质量命令

```bash
npm run check
npm test
npm run test:database
npm run build
```

本仓库不把 AI 成功作为回放完成的必要条件：结构化检索、评分、聚类和规则事件是核心，AI 仅增强命名与短叙事。

## 查询去重与写入限流

现有部署升级时需应用 `0003_query_hash_unique.sql` 和 `0004_rate_limits.sql`。先备份数据库并核对重复查询：第三个迁移会删除重复回放及关联记录，优先保留 complete，其次 processing、queued，最后其他终态，同级保留最早记录；第四个迁移创建限流表。

`RATE_LIMIT_CREATE_PER_HOUR` 默认 5，`RATE_LIMIT_RETRY_PER_HOUR` 默认 10。超限返回 429 和 Retry-After。缺少 Cloudflare 客户端 IP 的本地请求共用 unknown 桶；D1 限流存储故障时告警并放行。配置值必须为正的安全整数，非法值使用默认值。

新环境先完成所需迁移，再部署依赖对应数据结构的代码。现有环境先查询迁移记录，只应用待执行项。
