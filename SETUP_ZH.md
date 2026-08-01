# OncoReplay 外部设置与部署教程

> 核对日期：2026-08-01  
> 本教程对应本仓库当前文件。Cloudflare、OpenAlex 的产品规则和额度可能变化，正式上线前请再次查看文末官方资料。

## 1. 先选择部署目标

### 路线 A：先把视觉原型上线

适合先展示页面、收集反馈，不接真实查询和生成管线。

能够使用：

- 首页、Explore、Methodology、About；
- `/replay/kras-g12d` 完整固定数据回放；
- 播放、拖动年份、Momentum/Debate、证据抽屉、移动端布局；
- `/api/health`。

暂不启用：

- OpenAlex 实时查询预览；
- D1；
- Queues；
- Workers AI；
- 自定义回放生成。

执行：

```bash
npm install
npx wrangler login
npm run deploy:demo
```

部署使用 `wrangler.demo.jsonc`，不会要求你先创建数据库或密钥。

### 路线 B：部署完整后端骨架

适合继续开发真实数据 MVP。它会启用：

- OpenAlex 实时查询预览；
- D1 数据模型；
- Queue 生产者和消费者；
- Workers AI binding；
- 自定义生成任务的创建与状态记录。

注意：真实的候选论文扩展、评分、聚类、Crossref 核对和 AI 叙事尚未实现。Queue 消费者会诚实地把任务标为 `needs_implementation`，不会伪造生成完成。

---

## 2. 本地环境

### 2.1 安装软件

建议：

- Node.js 20 或更高版本；
- Git；
- 一个 Cloudflare 账号；
- 一个 GitHub 账号（可选，但推荐用于版本管理和持续部署）。

检查：

```bash
node -v
git --version
```

### 2.2 安装 Wrangler

在项目根目录执行：

```bash
npm install
```

`package.json` 已把 Wrangler 设为开发依赖。以后使用：

```bash
npx wrangler --version
```

### 2.3 登录 Cloudflare

```bash
npx wrangler login
```

浏览器会打开 Cloudflare 授权页面。完成后回到终端。

检查登录状态：

```bash
npx wrangler whoami
```

---

## 3. 获取 OpenAlex API Key

OpenAlex 目前要求 API key；免费 key 当前提供每日 1 美元的免费用量预算。不同操作消耗不同，正式产品必须缓存与限流。

步骤：

1. 打开 `https://openalex.org/` 并创建账号；
2. 进入 API 设置页：`https://openalex.org/settings/api`；
3. 创建或复制 API key；
4. 不要把 key 写入 Git、`wrangler.jsonc` 或前端 JavaScript。

### 3.1 本地开发密钥

复制示例文件：

```bash
cp .dev.vars.example .dev.vars
```

编辑 `.dev.vars`：

```dotenv
OPENALEX_API_KEY=你的真实_key
```

`.dev.vars` 已在 `.gitignore` 中。

### 3.2 线上密钥

执行：

```bash
npx wrangler secret put OPENALEX_API_KEY
```

按提示粘贴 key。不要把 key 直接写在命令参数里，避免留在 shell 历史。

本项目在 `wrangler.jsonc` 中声明了必需 secret。完整部署时如果缺失，Wrangler 会给出明确错误。

---

## 4. 创建 Cloudflare D1 数据库

### 4.1 创建数据库

```bash
npx wrangler d1 create oncoreplay-db
```

终端会返回类似：

```json
{
  "binding": "DB",
  "database_name": "oncoreplay-db",
  "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

### 4.2 写入 database_id

打开 `wrangler.jsonc`，找到：

```jsonc
"database_id": "REPLACE_WITH_D1_DATABASE_ID"
```

替换成命令返回的真实 ID。

保持 binding 名称为：

```jsonc
"binding": "DB"
```

Worker 代码通过 `env.DB` 访问数据库。

### 4.3 应用本地迁移

```bash
npm run db:local
```

### 4.4 应用线上迁移

```bash
npm run db:remote
```

迁移文件为：

```text
migrations/0001_init.sql
```

它创建：

- `replays`；
- `replay_queries`；
- `works`；
- `replay_works`；
- `work_relations`；
- `branches`；
- `events`；
- `jobs`；
- `ai_runs`；
- `feedback`；
- 必要索引。

### 4.5 验证数据库

本地：

```bash
npx wrangler d1 execute oncoreplay-db --local --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

线上：

```bash
npx wrangler d1 execute oncoreplay-db --remote --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

---

## 5. 创建 Cloudflare Queues

本项目使用一个主队列和一个死信队列。

### 5.1 创建主队列

```bash
npx wrangler queues create oncoreplay-replay-jobs
```

### 5.2 创建死信队列

```bash
npx wrangler queues create oncoreplay-replay-jobs-dlq
```

`wrangler.jsonc` 已包含：

- producer binding：`REPLAY_QUEUE`；
- consumer：`oncoreplay-replay-jobs`；
- `max_batch_size: 5`；
- `max_retries: 3`；
- dead-letter queue：`oncoreplay-replay-jobs-dlq`。

Worker 通过：

```js
await env.REPLAY_QUEUE.send(message)
```

发送任务。

Queues 免费计划当前提供每日 10,000 次操作，免费层最大消息保留期为 24 小时。一个成功消息通常会产生写、读、删等多次操作，因此不要把一篇论文拆成一个微任务。

---

## 6. 启用 Workers AI

Workers AI 不需要你创建普通 API key。本项目已经在 `wrangler.jsonc` 中配置：

```jsonc
"ai": {
  "binding": "AI"
}
```

部署后 Worker 可通过：

```js
env.AI.run(modelName, input)
```

调用模型。

当前代码没有执行真实 AI 推理，因为叙事 schema、来源约束、重试和降级逻辑需要在下一开发阶段实现后再开放。

截至 2026-08-01：

- Workers AI 免费分配为每日 10,000 Neurons；
- 部分模型只允许 Workers Paid；
- 模型名不应写死，应使用环境变量或配置表；
- 超额或模型不可用时，必须返回规则模板，不应让整个回放失败。

建议以后增加一个非敏感变量：

```jsonc
"vars": {
  "AI_MODEL": "选择的免费计划可用模型"
}
```

不要把真正的 secret 放在 `vars`。

---

## 7. 本地运行方式

### 7.1 最稳定的界面预览

无需 Wrangler：

```bash
npm run dev
```

打开：

```text
http://localhost:4173
```

这个本地服务器：

- 支持 SPA 路由回退；
- 提供本地 `/api/health`；
- 对 `/api/query/preview` 返回明确标记的演示数据。

### 7.2 用 Wrangler 测试完整 binding

先构建：

```bash
npm run build
```

然后：

```bash
npx wrangler dev
```

这时可测试：

```text
http://localhost:8787/api/health
```

返回的 `bindings` 字段会显示 D1、Queue、AI 和 OpenAlex 是否存在。

如果只想用 demo 配置：

```bash
npx wrangler dev --config wrangler.demo.jsonc
```

---

## 8. 构建与质量检查

执行：

```bash
npm run check
npm test
npm run build
```

说明：

- `check` 检查 JavaScript 语法；
- `test` 使用 Node 内置测试器验证年份过滤、播放步进、事件选择、节点权重和 slug；
- `build` 把 `public/` 复制到 `dist/`。

建议在正式接入真实数据后增加：

- OpenAlex abstract inverted index 重建测试；
- DOI、PMID 标准化测试；
- 相关性与 turning-point 评分测试；
- D1 集成测试；
- Queue 幂等测试；
- Playwright 桌面与移动端 E2E；
- reduced-motion E2E。

---

## 9. 部署

### 9.1 视觉 Demo

```bash
npm run deploy:demo
```

部署结束后 Wrangler 会输出 `*.workers.dev` 地址。

### 9.2 完整后端骨架

确认以下项目全部完成：

- `OPENALEX_API_KEY` 已设置；
- `wrangler.jsonc` 中 D1 ID 已替换；
- 主队列和死信队列已创建；
- 远程 D1 migration 已应用。

然后：

```bash
npm run deploy
```

### 9.3 部署后检查

访问：

```text
https://你的域名/api/health
```

应返回：

```json
{
  "ok": true,
  "service": "oncoreplay",
  "bindings": {
    "d1": true,
    "queue": true,
    "ai": true,
    "openAlex": true
  }
}
```

测试实时查询预览：

```bash
curl -X POST "https://你的域名/api/query/preview" \
  -H "content-type: application/json" \
  -d '{"topic":"KRAS G12D inhibitors in pancreatic cancer","startYear":2006,"endYear":2026}'
```

---

## 10. 绑定自定义域名

在 Cloudflare Dashboard：

1. 进入 **Workers & Pages**；
2. 选择 `oncoreplay` 或 `oncoreplay-demo`；
3. 打开 **Settings / Domains & Routes**；
4. 选择 **Add / Custom Domain**；
5. 输入例如 `oncoreplay.example.com`；
6. 按提示确认 DNS。

如果域名已经托管在同一个 Cloudflare 账号，一般可直接添加。

部署后检查：

- 首页；
- `/replay/kras-g12d`；
- `/methodology`；
- `/api/health`；
- 手机视口；
- 分享链接；
- 浏览器控制台错误。

---

## 11. GitHub 仓库设置

目标仓库建议：

```text
heyhey-yoyo/oncoreplay
```

初始化并提交：

```bash
git init
git add .
git commit -m "Build OncoReplay visual prototype and Cloudflare scaffold"
git branch -M main
git remote add origin git@github.com:heyhey-yoyo/oncoreplay.git
git push -u origin main
```

确认这些文件没有提交：

- `.dev.vars`；
- `.env`；
- `.wrangler/`；
- `node_modules/`；
- 任何 API key。

### 11.1 GitHub Actions 建议

最小 CI：

```yaml
name: CI
on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run check
      - run: npm test
      - run: npm run build
```

自动部署需要 Cloudflare API Token 和 Account ID。把它们放入 GitHub repository secrets，不要写入 YAML：

- `CLOUDFLARE_API_TOKEN`；
- `CLOUDFLARE_ACCOUNT_ID`。

Token 最小权限应只覆盖需要部署的 Workers、D1 和 Queues 资源。

---

## 12. Cloudflare Dashboard 建议设置

### 12.1 Web Analytics

可以启用 Cloudflare Web Analytics，首发只收集匿名、聚合指标：

- 首页到示例回放点击率；
- 自定义预览启动率；
- 事件点击率；
- 证据抽屉打开率；
- 分享率；
- LCP、INP、CLS。

MVP 不应建立细粒度个人画像。

### 12.2 Logs / Observability

`wrangler.jsonc` 已启用 observability。建议观察：

- `/api/query/preview` 错误率；
- OpenAlex HTTP 状态与超时；
- Queue 重试；
- D1 rows read / rows written；
- Worker CPU；
- AI JSON 校验失败率（实现后）；
- 免费额度使用率。

### 12.3 限流

当前 Worker 只做了输入长度和外部域名固定，尚未实现持久限流。上线自定义生成前建议增加：

- Cloudflare Rate Limiting Rules，或；
- KV/D1 基于 IP 哈希和匿名 session 的每日计数；
- 查询文本最大 240 字符；
- 每日匿名生成次数；
- 同一 query hash 复用结果。

不要永久保存原始 IP；可保存按日加盐哈希。

---

## 13. 必须继续实现的真实数据管线

目前 Queue 消费者只标记 `needs_implementation`。下一阶段按以下顺序开发：

1. `FETCH_WORKS`
   - OpenAlex 搜索；
   - 核心论文、参考文献、引用论文、related works 分层获取；
   - 候选上限 500。
2. `EXPAND_NETWORK`
   - 引用关系子图；
   - 固定域名、超时、重试和缓存。
3. `ENRICH_BIOMEDICAL`
   - 对关键候选通过 PMID/DOI 查询 Europe PMC；
   - 不批量抓取全文。
4. `CHECK_UPDATES`
   - 通过 Crossref 的结构化关系核对 correction、retraction、expression of concern；
   - 禁止根据标题自行推断。
5. `BUILD_TIMELINE`
   - relevance score；
   - normalized citation growth；
   - bridge score；
   - clustering；
   - Birth / Breakthrough / Branching / Revival / Translation / Challenge / Correction 规则。
6. `GENERATE_NARRATIVE`
   - Workers AI；
   - 严格 JSON Schema；
   - 只允许输入 work IDs；
   - 一次修复重试；
   - 规则模板降级。
7. `FINALIZE_REPLAY`
   - 只读快照；
   - CDN cache；
   - 分享 slug；
   - OG metadata。

每个任务必须幂等，并在 `jobs` 表持续写进度。

---

## 14. 安全检查

上线前逐项确认：

- [ ] API key 只存在于 Cloudflare secret 或本地 `.dev.vars`；
- [ ] Worker 只 fetch 固定的 OpenAlex、Europe PMC、Crossref 域名；
- [ ] 用户不能传入任意 URL；
- [ ] D1 全部使用绑定参数；
- [ ] 输出 HTML 经过转义；
- [ ] 分享 slug 随机且不可预测；
- [ ] 生成接口有速率限制；
- [ ] 页面固定显示医疗免责声明；
- [ ] 不收集患者数据；
- [ ] 不公开未授权全文 PDF；
- [ ] correction / retraction 必须链接结构化来源；
- [ ] AI 不能新增输入集合之外的论文 ID。

---

## 15. 常见问题

### 部署报 `REPLACE_WITH_D1_DATABASE_ID` 错误

你使用了完整 `wrangler.jsonc`，但没有替换 D1 ID。先完成第 4 节，或改用：

```bash
npm run deploy:demo
```

### 部署提示缺少 `OPENALEX_API_KEY`

执行：

```bash
npx wrangler secret put OPENALEX_API_KEY
```

### Queue 找不到

先创建两个队列：

```bash
npx wrangler queues create oncoreplay-replay-jobs
npx wrangler queues create oncoreplay-replay-jobs-dlq
```

### 自定义回放为什么没有真正生成

本仓库完成的是高质量 Phase 0 前端和完整后端骨架。真实 citation expansion、聚类、事件算法和 AI schema 仍需要实现。代码刻意返回 `needs_implementation`，避免把占位结果冒充真实科学分析。

### 首页查询预览显示 Local demonstration

说明：

- 当前使用 `npm run dev` 的依赖-free 本地服务器；或
- Worker 没有配置 OpenAlex key；或
- OpenAlex 请求失败/超时。

用 `npx wrangler dev` 并设置 `.dev.vars` 可测试实时预览。

---

## 16. 官方资料

Cloudflare React / Vite：

- https://developers.cloudflare.com/workers/framework-guides/web-apps/react/
- https://developers.cloudflare.com/workers/vite-plugin/

Cloudflare Static Assets / SPA：

- https://developers.cloudflare.com/workers/static-assets/
- https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/

Cloudflare D1：

- https://developers.cloudflare.com/d1/get-started/
- https://developers.cloudflare.com/d1/wrangler-commands/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/

Cloudflare Queues：

- https://developers.cloudflare.com/queues/get-started/
- https://developers.cloudflare.com/queues/configuration/configure-queues/
- https://developers.cloudflare.com/queues/platform/pricing/

Cloudflare Workers AI：

- https://developers.cloudflare.com/workers-ai/
- https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers-ai/models/

Cloudflare Secrets：

- https://developers.cloudflare.com/workers/configuration/secrets/
- https://developers.cloudflare.com/workers/local-development/environment-variables/

OpenAlex：

- https://developers.openalex.org/
- https://developers.openalex.org/api-reference/authentication
- https://developers.openalex.org/api-reference/works/list-works

Europe PMC：

- https://europepmc.org/developers
- https://europepmc.org/RestfulWebService

Crossref / Retraction Watch：

- https://www.crossref.org/documentation/retrieve-metadata/rest-api/
- https://www.crossref.org/documentation/retrieve-metadata/retraction-watch/
