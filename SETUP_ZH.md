# OncoReplay 中文部署、升级与外部设置教程

> 对应版本：0.3.0  
> 核对日期：2026-08-01  
> 目标平台：Cloudflare Workers + Static Assets + D1 + Queues + Workers AI

本教程分为两条路径：

- **A. 你已经部署了旧版**：原地升级，解决 `Custom generation pipeline is scaffolded...`。
- **B. 你从零开始部署**：创建所有外部资源并上线完整自定义生成。

---

## 1. 先解释旧提示

旧版出现：

```text
Custom generation pipeline is scaffolded. Configure D1, Queue, and Workers AI to continue.
```

这不是因为你少配置了某个隐藏选项。旧版的按钮和 Queue consumer 本身就是占位实现：前端固定弹出该提示，队列任务固定停止。仅仅配置 D1、Queue 和 Workers AI 无法让旧代码继续运行。

本版本已经把占位逻辑替换为真实五阶段生成管线，并默认中文化。

---

# A. 已部署旧版：原地升级

## A1. 解压新版并保留你的配置

新版项目解压后，先打开旧项目的 `wrangler.jsonc`，记录：

- Worker 名称；
- D1 `database_id`；
- Queue 名称；
- 自定义域名配置（若有）；
- 其他你自己增加的变量。

把旧的真实 `database_id` 写入新版 `wrangler.jsonc`：

```jsonc
"database_id": "你的真实 D1 database_id"
```

如果你原来的 Worker 名称不是 `oncoreplay`，把新版：

```jsonc
"name": "oncoreplay"
```

改回旧名称，这样会覆盖升级原 Worker，而不是新建另一个站点。

## A2. 设置联系邮箱

打开 `wrangler.jsonc`：

```jsonc
"vars": {
  "AI_MODEL": "@cf/meta/llama-3.1-8b-instruct-fast",
  "CONTACT_EMAIL": "you@example.com",
  "CROSSREF_MAILTO": "you@example.com"
}
```

把两个示例邮箱改为你的有效联系邮箱。它们用于第三方 API 的礼貌标识，不是登录凭据，不需要设为 secret。

## A3. 安装依赖

```bash
npm install
```

检查 Wrangler：

```bash
npx wrangler --version
npx wrangler whoami
```

尚未登录时：

```bash
npx wrangler login
```

## A4. 确认 OpenAlex secret

查看当前 Worker secrets：

```bash
npx wrangler secret list
```

列表里应有：

```text
OPENALEX_API_KEY
```

没有时重新设置：

```bash
npx wrangler secret put OPENALEX_API_KEY
```

按提示粘贴真实 key。不要把 key 写进 `wrangler.jsonc`、前端代码或 Git。

## A5. 应用新增 D1 迁移

旧版一般已经应用 `0001_init.sql`。新版新增：

```text
migrations/0002_full_pipeline.sql
```

执行：

```bash
npx wrangler d1 migrations list oncoreplay-db --remote
npx wrangler d1 migrations apply oncoreplay-db --remote
```

正常情况下只会应用待执行的 `0002_full_pipeline.sql`，不会重新执行已经记录的 `0001_init.sql`。

迁移新增：

- `replays.subtitle`；
- `replays.locale`；
- `replays.data_status`；
- `replays.open_questions_json`；
- `replay_works.analysis_json`。

验证：

```bash
npx wrangler d1 execute oncoreplay-db --remote --command="PRAGMA table_info(replays)"
npx wrangler d1 execute oncoreplay-db --remote --command="PRAGMA table_info(replay_works)"
```

你应能看到上述新增字段。

## A6. 确认两个 Queue 存在

```bash
npx wrangler queues list
```

应包含：

```text
oncoreplay-replay-jobs
oncoreplay-replay-jobs-dlq
```

缺少时创建：

```bash
npx wrangler queues create oncoreplay-replay-jobs
npx wrangler queues create oncoreplay-replay-jobs-dlq
```

若提示队列已经存在，无需重复创建。

## A7. 重新构建和部署

```bash
npm run check
npm test
npm run build
npm run deploy
```

`wrangler.jsonc` 中已经声明：

- `DB`：D1 binding；
- `REPLAY_QUEUE`：Queue producer；
- `oncoreplay-replay-jobs`：Queue consumer；
- `AI`：Workers AI binding；
- `ASSETS`：静态资源。

Workers AI binding 不需要单独申请 API key；它通过当前 Cloudflare 账号的 binding 调用。

## A8. 清除旧前端缓存

部署后若页面仍出现英文 scaffold 提示，通常是旧静态资源缓存，而不是新代码仍有占位逻辑。

依次执行：

1. 使用无痕窗口打开站点；
2. 浏览器强制刷新：Windows/Linux `Ctrl + Shift + R`，macOS `Cmd + Shift + R`；
3. 确认终端刚刚部署的是新版目录；
4. 在本地项目运行：

```bash
grep -R "Custom generation pipeline is scaffolded" public src
```

新版应无匹配结果。

## A9. 验证绑定

访问：

```text
https://你的域名/api/health
```

应看到：

```json
{
  "ok": true,
  "bindings": {
    "d1": true,
    "queue": true,
    "ai": true,
    "openAlex": true
  }
}
```

任一项为 `false` 时，不要先测试生成，先按第 8 节排错。

## A10. 测试真实自定义生成

建议先使用较小参数：

```text
主题：KRAS G12D inhibitors in pancreatic cancer
最大论文量：100
关注角度：全部
```

流程应为：

```text
检索预览
→ 生成完整回放
→ 检索论文并扩展引用网络
→ Europe PMC / Crossref 补充
→ turning-point 评分与 Louvain 聚类
→ Workers AI Schema 叙事
→ 完成回放
```

---

# B. 从零部署完整版本

## B1. 准备环境

需要：

- Node.js 20 或更高；
- Cloudflare 账号；
- OpenAlex 账号和 API key；
- Git 可选。

检查：

```bash
node -v
npm -v
```

安装并登录：

```bash
npm install
npx wrangler login
npx wrangler whoami
```

## B2. 获取 OpenAlex API key

1. 登录 OpenAlex；
2. 打开 OpenAlex API 设置页面；
3. 创建或复制 API key；
4. 不要提交到 Git。

本地开发：

```bash
cp .dev.vars.example .dev.vars
```

编辑 `.dev.vars`：

```dotenv
OPENALEX_API_KEY=你的真实_key
```

线上：

```bash
npx wrangler secret put OPENALEX_API_KEY
```

项目使用 `secrets.required` 声明必需 secret；缺少该值时，新的 Wrangler 会在开发或部署阶段给出明确警告或阻止部署。

## B3. 创建 D1

```bash
npx wrangler d1 create oncoreplay-db
```

复制返回的 `database_id`，写入 `wrangler.jsonc`：

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "oncoreplay-db",
    "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "migrations_dir": "migrations"
  }
]
```

不要修改 binding 名称 `DB`，Worker 代码通过 `env.DB` 访问。

## B4. 创建 Queues

```bash
npx wrangler queues create oncoreplay-replay-jobs
npx wrangler queues create oncoreplay-replay-jobs-dlq
```

主队列负责五阶段生成；DLQ 接收超过重试上限的消息。

`wrangler.jsonc` 中必须保持：

```jsonc
"queues": {
  "producers": [
    {
      "binding": "REPLAY_QUEUE",
      "queue": "oncoreplay-replay-jobs"
    }
  ],
  "consumers": [
    {
      "queue": "oncoreplay-replay-jobs",
      "max_batch_size": 1,
      "max_batch_timeout": 5,
      "max_retries": 3,
      "dead_letter_queue": "oncoreplay-replay-jobs-dlq"
    }
  ]
}
```

`max_batch_size: 1` 是刻意设置：每个任务阶段包含外部 API 与 D1 写入，单条消费更容易控制资源和恢复错误。

## B5. 配置 Workers AI

`wrangler.jsonc` 已包含：

```jsonc
"ai": {
  "binding": "AI"
}
```

默认模型：

```jsonc
"AI_MODEL": "@cf/meta/llama-3.1-8b-instruct-fast"
```

该模型支持 Workers AI JSON Mode。代码仍会在应用端验证：

- 所有 branch ID 必须来自规则聚类；
- 所有 event ID 必须来自规则事件；
- 每个 source work ID 必须属于该事件原始证据集合；
- 置信度范围必须为 0–1；
- 输出不能遗漏或重复分支和事件；
- Schema 失败后只重试一次；
- 再次失败时使用规则叙事，回放仍可完成。

## B6. 设置 API 联系邮箱

打开 `wrangler.jsonc`：

```jsonc
"CONTACT_EMAIL": "you@example.com",
"CROSSREF_MAILTO": "you@example.com"
```

改为你的邮箱。不要保留示例地址。

## B7. 应用迁移

本地：

```bash
npm run db:local
```

线上：

```bash
npm run db:remote
```

等价于：

```bash
npx wrangler d1 migrations apply oncoreplay-db --local
npx wrangler d1 migrations apply oncoreplay-db --remote
```

验证表：

```bash
npx wrangler d1 execute oncoreplay-db --remote --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

应至少看到：

```text
ai_runs
branches
events
feedback
jobs
replay_queries
replay_works
replays
work_relations
works
```

## B8. 本地完整开发

```bash
npm run dev
```

这会先构建静态资源，再启动 Wrangler 本地 Worker。

只看前端演示：

```bash
npm run dev:static
```

注意：静态模式没有 `/api/query/preview`、D1、Queue 或 Workers AI，不可用于验证自定义生成。

## B9. 部署

```bash
npm run check
npm test
npm run build
npm run deploy
```

部署后先检查：

```text
/api/health
```

然后再提交自定义主题。

---

# 2. 真实生成管线说明

## 2.1 OpenAlex 多层扩展

第一阶段执行：

1. 主题全文检索，最多获取 100 篇 seed works；
2. 对高优先级核心论文扩展参考文献；
3. 查询引用核心论文的后续论文；
4. 有界扩展 OpenAlex related works；
5. 按年份、排除词、文本相关性和层级优先级去重裁剪；
6. 把论文和引用/相关关系写入 D1。

候选集最多 500 篇。为避免在 Worker 中对 500 篇执行昂贵的全对全图计算，第二阶段之后会选择相关性最高的最多 220 篇进入加权图分析，其他候选仍保存在 D1。

## 2.2 Europe PMC 摘要补充

对缺少摘要且具有 PMID 或 DOI 的高优先级论文查询 Europe PMC `resultType=core`，补充：

- abstract；
- PMID；
- PMCID；
- DOI；
- 首次发表日期线索。

Europe PMC 失败不会让整条回放失败；系统继续使用 OpenAlex 数据。

## 2.3 Crossref 更新核对

对具有 DOI 的高优先级论文：

- 查询单篇 Crossref metadata；
- 读取 `update-to`、`updated-by` 和 relation；
- 使用 `updates:<doi>` 查询更新该 DOI 的更正/撤稿记录；
- 规范化为 correction、retraction、expression-of-concern、reinstatement 等状态；
- 只展示结构化状态，不从标题推断学术不端。

## 2.4 turning-point 评分

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

## 2.5 Louvain 聚类

系统构造无向加权图，边来自：

- 引用关系；
- OpenAlex related 关系；
- topic Jaccard；
- 标题与摘要 token cosine；
- bibliographic coupling。

随后执行确定性的 Louvain 局部模块度优化，并通过合并或拆分把社区数量约束到 3–6 条，以保证可视化可读性。AI 只负责给已有社区命名，不负责改变论文归属。

## 2.6 Workers AI 严格 Schema

AI 输入只包含：

- 已生成的分支；
- 已生成的规则事件；
- 与事件绑定的论文 ID、标题、年份和截断摘要；
- 结构化更新状态。

AI 无权生成新 work ID、DOI、PMID、日期、引用关系或撤稿状态。

## 2.7 完整自定义回放

任务完成后 `/api/replays/:slug` 返回：

- 分支；
- 关键论文；
- 可视化边；
- 8–15 个事件；
- 来源 work IDs；
- 置信度与人工核查标记；
- 当前开放问题；
- 中英文界面需要的字段。

---

# 3. 中文化说明

默认语言由浏览器本地存储控制，首次访问默认为简体中文。

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

导航中的 `EN` 可切换英文；切换结果保存到 `localStorage`。

英文研究主题通常比纯中文主题更容易匹配开放学术数据库，因此创建页会建议使用英文主题，但输出界面和 AI 叙事可保持中文。

---

# 4. API 验证

## 4.1 Health

```bash
curl https://你的域名/api/health
```

## 4.2 Query preview

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

## 4.3 创建回放

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

# 5. 日志和数据库检查

## 5.1 实时 Worker 日志

```bash
npx wrangler tail
```

保持终端打开，再从网页提交主题。

## 5.2 查看任务状态

```bash
npx wrangler d1 execute oncoreplay-db --remote --command="SELECT id,replay_id,job_type,status,progress_current,progress_total,error_code,error_message,updated_at FROM jobs ORDER BY updated_at DESC LIMIT 10"
```

## 5.3 查看回放状态

```bash
npx wrangler d1 execute oncoreplay-db --remote --command="SELECT slug,status,work_count,event_count,updated_at FROM replays ORDER BY updated_at DESC LIMIT 10"
```

## 5.4 查看 AI 回退情况

```bash
npx wrangler d1 execute oncoreplay-db --remote --command="SELECT task_type,model,status,validation_errors_json,created_at FROM ai_runs ORDER BY created_at DESC LIMIT 10"
```

`status='fallback'` 表示 Schema 或模型调用失败，但规则版回放仍应完成。

---

# 6. 常见错误

## 6.1 仍显示 scaffolded 英文提示

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

## 6.2 `/api/health` 中 `openAlex: false`

```bash
npx wrangler secret put OPENALEX_API_KEY
npm run deploy
```

如果改变过 Worker `name` 或环境，需要在对应 Worker/环境重新设置 secret。

## 6.3 `no such column: subtitle` 或 `analysis_json`

新版迁移未应用：

```bash
npx wrangler d1 migrations apply oncoreplay-db --remote
```

确认 `wrangler.jsonc` 指向你实际使用的 D1 database ID。

## 6.4 状态一直停在 `queued`

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

## 6.5 `OPENALEX_ERROR` 或 401/403

- 检查 key 是否有效；
- 检查 Worker secret 名必须精确为 `OPENALEX_API_KEY`；
- 不要在 key 前后加入引号或空格；
- 检查 OpenAlex 账户额度与状态。

## 6.6 `NO_WORKS_FOUND`

- 使用英文主题；
- 去掉过窄的癌种或年份；
- 删除排除词；
- 先确认 query preview 有样本文献。

## 6.7 Crossref 或 Europe PMC 暂时失败

补充源失败会被局部降级，不会必然终止整条回放。结果会保留 OpenAlex 元数据；更新状态未核对时，不会凭标题推断撤稿。

## 6.8 Workers AI 失败但回放完成

这是预期降级行为。查看 `ai_runs`：

- `complete`：Schema 叙事成功；
- `fallback`：模型调用或验证失败，使用规则标题和摘要。

## 6.9 Queue 进入 DLQ

查看 Cloudflare Dashboard 的 `oncoreplay-replay-jobs-dlq`，并用 D1 `jobs.error_code/error_message` 定位失败阶段。修复配置后，在回放失败页点击“从头重试”，或调用：

```bash
curl -X POST https://你的域名/api/replays/slug/retry
```

## 6.10 第二个自定义回放出现 branch 主键冲突

本版本已给每个 replay 的 Louvain community ID 增加 replay 前缀，避免多个回放在同一 D1 中共享 `c0/c1` 造成冲突。请确认部署的是 0.3.0 新版，而不是中间构建。

---

# 7. 自定义域名

部署完成后可在 Cloudflare Dashboard：

```text
Workers & Pages
→ 选择 oncoreplay
→ Settings / Domains & Routes
→ Add Custom Domain
```

前后端使用同源 `/api/*`，不需要额外配置 CORS。

---

# 8. 发布前检查清单

```text
[ ] wrangler.jsonc 中 database_id 已替换
[ ] CONTACT_EMAIL / CROSSREF_MAILTO 已替换
[ ] OPENALEX_API_KEY secret 已设置
[ ] 两个 Queue 已创建
[ ] 0001 和 0002 migration 已应用
[ ] /api/health 四个 binding 均为 true
[ ] query preview 返回真实 OpenAlex 样本
[ ] 100 篇小任务能完成五阶段生成
[ ] 证据抽屉能打开 DOI/OpenAlex 来源
[ ] 手机端可拖动年份和打开证据
[ ] 页面默认中文，EN 切换正常
[ ] 页面固定显示研究工具和非医疗建议声明
```

---

# 9. 质量命令

```bash
npm run check
npm test
npm run build
```

本仓库不把 AI 成功作为回放完成的必要条件：结构化检索、评分、聚类和规则事件是核心，AI 仅增强命名与短叙事。
