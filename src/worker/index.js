import { expandCancerType } from './lib/cancer-types.js';
import { searchOpenAlex } from './lib/clients.js';
import { cleanupExpiredReplays, getReplayPayload, processPipelineMessage } from './lib/pipeline.js';
import { CURRENT_YEAR, nowIso, normalizeTopic, sha256, slugify } from './lib/utils.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers || {}) },
  });
}

function error(code, message, status = 400, requestId = crypto.randomUUID(), details) {
  return json({ error: { code, message, requestId, ...(details ? { details } : {}) } }, { status, headers: { 'x-request-id': requestId } });
}

function extractEntities(topic) {
  const tokens = topic.match(/[A-Za-z][A-Za-z0-9+.-]{2,}|[\u4e00-\u9fff]{2,}/g) || [];
  const unique = [...new Set(tokens.map((token) => token.replace(/[.,，。]$/, '')))];
  return unique.slice(0, 8).map((label, index) => ({
    label,
    type: /cancer|carcinoma|lymphoma|leukemia|melanoma|癌|瘤/i.test(label)
      ? '肿瘤相关词'
      : /inhibitor|agonist|antibody|drug|therapy|抑制剂|激动剂|抗体|药物|治疗/i.test(label)
        ? '干预相关词'
        : index === 0 ? '核心词' : '查询词',
  }));
}

function suggestSynonyms(topic) {
  const suggestions = [];
  if (/KRAS\s*G12D/i.test(topic)) suggestions.push('KRAS p.G12D', 'G12D-mutant KRAS', 'allele-specific KRAS inhibition');
  if (/pancrea|胰腺/i.test(topic)) suggestions.push('pancreatic ductal adenocarcinoma', 'PDAC');
  if (/ferroptosis|铁死亡/i.test(topic)) suggestions.push('iron-dependent cell death', 'lipid peroxidation');
  if (/HER2[- ]?low/i.test(topic)) suggestions.push('ERBB2-low', 'HER2-low expression');
  return [...new Set(suggestions)].slice(0, 6);
}

function validateInput(body) {
  const topic = normalizeTopic(body?.topic);
  if (topic.length < 3) return { ok: false, message: '研究主题至少需要 3 个字符。' };
  const startYear = body?.startYear ? Number(body.startYear) : undefined;
  const endYear = body?.endYear ? Number(body.endYear) : undefined;
  if (startYear && (startYear < 1900 || startYear > CURRENT_YEAR)) return { ok: false, message: '开始年份超出支持范围。' };
  if (endYear && (endYear < 1900 || endYear > CURRENT_YEAR)) return { ok: false, message: '结束年份超出支持范围。' };
  if (startYear && endYear && startYear > endYear) return { ok: false, message: '开始年份不能晚于结束年份。' };
  const maxWorks = Math.min(500, Math.max(40, Number(body?.maxWorks || 200)));
  const angle = ['mechanism','translation','controversy','all'].includes(body?.angle) ? body.angle : 'all';
  const locale = body?.locale === 'en' ? 'en' : 'zh';
  return {
    ok: true,
    topic,
    startYear,
    endYear,
    maxWorks,
    angle,
    locale,
    cancerType: normalizeTopic(body?.cancerType),
    exclude: normalizeTopic(body?.exclude),
  };
}

async function openAlexPreview(env, input, requestId) {
  if (!env.OPENALEX_API_KEY) return error('OPENALEX_NOT_CONFIGURED', '尚未设置 OPENALEX_API_KEY，无法执行真实检索预览。', 503, requestId);
  try {
    const previewTopic = [input.topic, expandCancerType(input.cancerType)].filter(Boolean).join(' ');
    const result = await searchOpenAlex(env, { topic: previewTopic, startYear: input.startYear, endYear: input.endYear, perPage: 5 });
    const years = result.works.map((work) => work.publicationYear).filter(Number.isFinite);
    return json({
      source: 'openalex',
      normalizedQuery: input.topic,
      entities: extractEntities(input.topic),
      synonyms: suggestSynonyms(input.topic),
      estimatedCount: result.count,
      earliestYear: years.length ? Math.min(...years) : input.startYear ?? null,
      latestYear: years.length ? Math.max(...years) : input.endYear ?? null,
      samples: result.works.map((work) => ({ id: work.id, title: work.title, year: work.publicationYear, source: work.sourceName || 'OpenAlex', doi: work.doi, citedByCount: work.citedByCount })),
      requestId,
    }, { headers: { 'x-request-id': requestId } });
  } catch (cause) {
    const message = cause?.name === 'AbortError' ? 'OpenAlex 检索超时。' : `OpenAlex 检索失败：${cause?.message || '未知错误'}`;
    return error('OPENALEX_ERROR', message, 502, requestId);
  }
}

async function readExample(env, request) {
  const assetUrl = new URL('/data/kras-g12d.json', request.url);
  const assetResponse = await env.ASSETS.fetch(new Request(assetUrl, request));
  if (!assetResponse.ok) return error('EXAMPLE_NOT_FOUND', '内置回放数据不可用。', 500);
  const headers = new Headers(assetResponse.headers);
  headers.set('cache-control', 'public, max-age=3600, s-maxage=86400');
  return new Response(assetResponse.body, { status: assetResponse.status, headers });
}

async function createReplay(env, request, requestId) {
  if (!env.DB || !env.REPLAY_QUEUE) return error('PIPELINE_NOT_CONFIGURED', '自定义生成需要同时绑定 D1 数据库和 Queue。请检查 wrangler.jsonc 后重新部署。', 503, requestId);
  if (!env.OPENALEX_API_KEY) return error('OPENALEX_NOT_CONFIGURED', '自定义生成需要 OPENALEX_API_KEY。请运行 npx wrangler secret put OPENALEX_API_KEY。', 503, requestId);
  let body;
  try { body = await request.json(); } catch { return error('INVALID_JSON', '请求正文必须是有效 JSON。', 400, requestId); }
  const input = validateInput(body);
  if (!input.ok) return error('INVALID_INPUT', input.message, 422, requestId);

  const queryHash = await sha256({ topic: input.topic.toLowerCase(), startYear: input.startYear || null, endYear: input.endYear || null, maxWorks: input.maxWorks, angle: input.angle, cancerType: input.cancerType, exclude: input.exclude, locale: input.locale });
  const cached = await env.DB.prepare(`SELECT r.slug,r.status FROM replay_queries q JOIN replays r ON r.id=q.replay_id WHERE q.query_hash=? AND r.status IN ('queued','processing','complete') ORDER BY r.updated_at DESC LIMIT 1`).bind(queryHash).first();
  if (cached) return json({ slug: cached.slug, status: cached.status, reused: true, requestId }, { status: cached.status === 'complete' ? 200 : 202, headers: { 'x-request-id': requestId } });

  const id = crypto.randomUUID();
  const slug = `${slugify(input.topic) || 'replay'}-${id.slice(0, 7)}`;
  const now = nowIso();
  const title = input.topic;
  const subtitle = input.locale === 'en'
    ? `A source-grounded reconstruction of how “${input.topic}” evolved.`
    : `基于开放学术元数据重建“${input.topic}”的研究演化轨迹。`;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO replays (id,slug,title,subtitle,original_query,normalized_query,status,visibility,start_year,end_year,work_count,event_count,version,locale,data_status,open_questions_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'queued','unlisted',?,?,0,0,2,?,'source-grounded','[]',?,?)`)
      .bind(id, slug, title, subtitle, input.topic, input.topic, input.startYear || null, input.endYear || null, input.locale, now, now),
    env.DB.prepare(`INSERT INTO replay_queries (id,replay_id,entities_json,synonyms_json,filters_json,openalex_query_json,query_hash,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), id, JSON.stringify(extractEntities(input.topic)), JSON.stringify(suggestSynonyms(input.topic)), JSON.stringify({ maxWorks: input.maxWorks, angle: input.angle, cancerType: input.cancerType, exclude: input.exclude }), JSON.stringify({ search: input.topic, startYear: input.startYear, endYear: input.endYear }), queryHash, now),
  ]);
  const jobId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO jobs (id,replay_id,job_type,status,progress_current,progress_total,attempts,created_at,updated_at) VALUES (?,?,'FETCH_WORKS','queued',0,5,0,?,?)`)
    .bind(jobId, id, now, now).run();
  await env.REPLAY_QUEUE.send({ type: 'FETCH_WORKS', replayId: id, jobId, topic: input.topic, maxWorks: input.maxWorks, locale: input.locale });
  return json({ replayId: id, slug, status: 'queued', requestId }, { status: 202, headers: { 'x-request-id': requestId } });
}

async function replayStatus(env, slug, requestId) {
  if (slug === 'kras-g12d') return json({ slug, status: 'complete', stage: 'FINALIZE_REPLAY', progressCurrent: 5, progressTotal: 5, requestId });
  if (!env.DB) return error('DB_NOT_CONFIGURED', 'D1 未配置。', 503, requestId);
  const row = await env.DB.prepare(`SELECT r.slug,r.status,j.job_type,j.progress_current,j.progress_total,j.error_code,j.error_message,j.updated_at
    FROM replays r LEFT JOIN jobs j ON j.replay_id=r.id WHERE r.slug=? ORDER BY j.updated_at DESC LIMIT 1`).bind(slug).first();
  if (!row) return error('REPLAY_NOT_FOUND', '未找到该回放。', 404, requestId);
  return json({
    slug: row.slug,
    status: row.status,
    stage: row.job_type,
    progressCurrent: row.progress_current,
    progressTotal: row.progress_total,
    updatedAt: row.updated_at,
    error: row.error_code ? { code: row.error_code, message: row.error_message } : null,
    requestId,
  });
}

async function readReplay(env, request, slug, requestId) {
  if (slug === 'kras-g12d') return readExample(env, request);
  if (!env.DB) return error('DB_NOT_CONFIGURED', 'D1 未配置。', 503, requestId);
  const payload = await getReplayPayload(env, slug);
  if (!payload) return error('REPLAY_NOT_FOUND', '未找到该回放。', 404, requestId);
  if (payload.status && payload.status !== 'complete') return json(payload, { status: 202, headers: { 'retry-after': '3' } });
  return json(payload, { headers: { 'cache-control': 'public, max-age=60, s-maxage=86400', 'x-request-id': requestId } });
}

async function retryReplay(env, slug, requestId) {
  if (!env.DB || !env.REPLAY_QUEUE) return error('PIPELINE_NOT_CONFIGURED', 'D1 或 Queue 未配置。', 503, requestId);
  const row = await env.DB.prepare(`SELECT r.id,r.normalized_query,r.locale,j.id job_id FROM replays r LEFT JOIN jobs j ON j.replay_id=r.id WHERE r.slug=? ORDER BY j.updated_at DESC LIMIT 1`).bind(slug).first();
  if (!row) return error('REPLAY_NOT_FOUND', '未找到该回放。', 404, requestId);
  const jobId = row.job_id || crypto.randomUUID();
  if (!row.job_id) await env.DB.prepare(`INSERT INTO jobs (id,replay_id,job_type,status,progress_current,progress_total,attempts,created_at,updated_at) VALUES (?,?,'FETCH_WORKS','queued',0,5,0,?,?)`).bind(jobId, row.id, nowIso(), nowIso()).run();
  else await env.DB.prepare(`UPDATE jobs SET job_type='FETCH_WORKS',status='queued',progress_current=0,progress_total=5,error_code=NULL,error_message=NULL,updated_at=? WHERE id=?`).bind(nowIso(), jobId).run();
  await env.DB.prepare(`UPDATE replays SET status='queued',updated_at=? WHERE id=?`).bind(nowIso(), row.id).run();
  await env.REPLAY_QUEUE.send({ type: 'FETCH_WORKS', replayId: row.id, jobId, topic: row.normalized_query, locale: row.locale || 'zh' });
  return json({ slug, status: 'queued', requestId }, { status: 202 });
}

async function handleApi(request, env) {
  const requestId = request.headers.get('cf-ray') || crypto.randomUUID();
  const url = new URL(request.url);
  if (url.pathname === '/api/health' && request.method === 'GET') {
    return json({ ok: true, service: 'oncoreplay', timestamp: nowIso(), bindings: { d1: Boolean(env.DB), queue: Boolean(env.REPLAY_QUEUE), ai: Boolean(env.AI), openAlex: Boolean(env.OPENALEX_API_KEY) }, requestId }, { headers: { 'x-request-id': requestId } });
  }
  if (url.pathname === '/api/query/preview' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return error('INVALID_JSON', '请求正文必须是有效 JSON。', 400, requestId); }
    const input = validateInput(body);
    if (!input.ok) return error('INVALID_INPUT', input.message, 422, requestId);
    return openAlexPreview(env, input, requestId);
  }
  if (url.pathname === '/api/replays' && request.method === 'POST') return createReplay(env, request, requestId);
  const statusMatch = url.pathname.match(/^\/api\/replays\/([a-z0-9-]+)\/status$/);
  if (statusMatch && request.method === 'GET') return replayStatus(env, statusMatch[1], requestId);
  const retryMatch = url.pathname.match(/^\/api\/replays\/([a-z0-9-]+)\/retry$/);
  if (retryMatch && request.method === 'POST') return retryReplay(env, retryMatch[1], requestId);
  const replayMatch = url.pathname.match(/^\/api\/replays\/([a-z0-9-]+)$/);
  if (replayMatch && request.method === 'GET') return readReplay(env, request, replayMatch[1], requestId);
  return error('NOT_FOUND', 'API 路由不存在。', 404, requestId);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
  async queue(batch, env) {
    for (const message of batch.messages) await processPipelineMessage(env, message);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanupExpiredReplays(env));
  },
};
