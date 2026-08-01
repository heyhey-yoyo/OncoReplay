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

function error(code, message, status = 400, requestId = crypto.randomUUID()) {
  return json({ error: { code, message, requestId } }, { status, headers: { 'x-request-id': requestId } });
}

function normalizeTopic(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 240);
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
}

function extractEntities(topic) {
  const tokens = topic.match(/[A-Za-z][A-Za-z0-9+.-]{2,}/g) || [];
  const unique = [...new Set(tokens.map((token) => token.replace(/[.,]$/, '')))];
  return unique.slice(0, 8).map((label, index) => ({
    label,
    type: /cancer|carcinoma|lymphoma|leukemia|melanoma/i.test(label)
      ? 'cancer term'
      : /inhibitor|agonist|antibody|drug|therapy/i.test(label)
        ? 'intervention term'
        : index === 0
          ? 'core term'
          : 'query term',
  }));
}

function suggestSynonyms(topic) {
  const suggestions = [];
  if (/KRAS\s*G12D/i.test(topic)) suggestions.push('KRAS p.G12D', 'G12D-mutant KRAS', 'allele-specific KRAS inhibition');
  if (/pancrea/i.test(topic)) suggestions.push('pancreatic ductal adenocarcinoma', 'PDAC');
  if (/ferroptosis/i.test(topic)) suggestions.push('iron-dependent cell death', 'lipid peroxidation');
  if (/HER2[- ]?low/i.test(topic)) suggestions.push('ERBB2-low', 'HER2-low expression');
  return [...new Set(suggestions)].slice(0, 6);
}

function validatePreviewInput(body) {
  const topic = normalizeTopic(body?.topic);
  if (topic.length < 3) return { ok: false, message: 'Topic must contain at least 3 characters.' };
  const startYear = body?.startYear ? Number(body.startYear) : undefined;
  const endYear = body?.endYear ? Number(body.endYear) : undefined;
  if (startYear && (startYear < 1900 || startYear > 2026)) return { ok: false, message: 'Start year is outside the supported range.' };
  if (endYear && (endYear < 1900 || endYear > 2026)) return { ok: false, message: 'End year is outside the supported range.' };
  if (startYear && endYear && startYear > endYear) return { ok: false, message: 'Start year must be earlier than end year.' };
  return { ok: true, topic, startYear, endYear };
}

async function openAlexPreview(env, input, requestId) {
  if (!env.OPENALEX_API_KEY) return error('OPENALEX_NOT_CONFIGURED', 'Set the OPENALEX_API_KEY secret to enable live query previews.', 503, requestId);
  const url = new URL('https://api.openalex.org/works');
  url.searchParams.set('search', input.topic);
  url.searchParams.set('api_key', env.OPENALEX_API_KEY);
  url.searchParams.set('per-page', '5');
  url.searchParams.set('sort', 'cited_by_count:desc');
  const filters = [];
  if (input.startYear) filters.push(`from_publication_date:${input.startYear}-01-01`);
  if (input.endYear) filters.push(`to_publication_date:${input.endYear}-12-31`);
  if (filters.length) url.searchParams.set('filter', filters.join(','));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'OncoReplay/0.1 (research visualization prototype)' },
    });
  } catch (cause) {
    clearTimeout(timeout);
    return error('OPENALEX_UNAVAILABLE', cause?.name === 'AbortError' ? 'OpenAlex preview timed out.' : 'OpenAlex could not be reached.', 502, requestId);
  }
  clearTimeout(timeout);
  if (!response.ok) return error('OPENALEX_ERROR', `OpenAlex returned HTTP ${response.status}.`, 502, requestId);
  const payload = await response.json();
  const results = Array.isArray(payload.results) ? payload.results : [];
  const years = results.map((work) => work.publication_year).filter(Number.isFinite);
  return json({
    source: 'openalex',
    normalizedQuery: input.topic,
    entities: extractEntities(input.topic),
    synonyms: suggestSynonyms(input.topic),
    estimatedCount: payload.meta?.count ?? results.length,
    earliestYear: years.length ? Math.min(...years) : input.startYear ?? null,
    latestYear: years.length ? Math.max(...years) : input.endYear ?? null,
    samples: results.map((work) => ({
      id: work.id,
      title: work.display_name,
      year: work.publication_year,
      source: work.primary_location?.source?.display_name || 'OpenAlex',
      doi: work.doi || null,
      citedByCount: work.cited_by_count || 0,
    })),
    requestId,
  }, { headers: { 'x-request-id': requestId } });
}

async function readExample(env, request) {
  const assetUrl = new URL('/data/kras-g12d.json', request.url);
  const assetResponse = await env.ASSETS.fetch(new Request(assetUrl, request));
  if (!assetResponse.ok) return error('EXAMPLE_NOT_FOUND', 'Built-in replay data is unavailable.', 500);
  const headers = new Headers(assetResponse.headers);
  headers.set('cache-control', 'public, max-age=3600, s-maxage=86400');
  return new Response(assetResponse.body, { status: assetResponse.status, headers });
}

async function createReplay(env, request, requestId) {
  if (!env.DB || !env.REPLAY_QUEUE) return error('PIPELINE_NOT_CONFIGURED', 'Create and bind D1 and Queues before enabling custom replay generation.', 503, requestId);
  let body;
  try { body = await request.json(); } catch { return error('INVALID_JSON', 'Request body must be valid JSON.', 400, requestId); }
  const validation = validatePreviewInput(body);
  if (!validation.ok) return error('INVALID_INPUT', validation.message, 422, requestId);
  const id = crypto.randomUUID();
  const slug = `${slugify(validation.topic) || 'replay'}-${id.slice(0, 7)}`;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO replays (id, slug, title, original_query, normalized_query, status, visibility, start_year, end_year, work_count, event_count, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'queued', 'unlisted', ?, ?, 0, 0, 1, ?, ?)`)
    .bind(id, slug, validation.topic, validation.topic, validation.topic, validation.startYear || null, validation.endYear || null, now, now)
    .run();
  const jobId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO jobs (id, replay_id, job_type, status, progress_current, progress_total, attempts, created_at, updated_at)
    VALUES (?, ?, 'FETCH_WORKS', 'queued', 0, 1, 0, ?, ?)`)
    .bind(jobId, id, now, now)
    .run();
  await env.REPLAY_QUEUE.send({ type: 'FETCH_WORKS', replayId: id, jobId, topic: validation.topic });
  return json({ replayId: id, slug, status: 'queued', requestId }, { status: 202, headers: { 'x-request-id': requestId } });
}

async function replayStatus(env, slug, requestId) {
  if (slug === 'kras-g12d') return json({ slug, status: 'complete', stage: 'FINALIZE_REPLAY', progressCurrent: 5, progressTotal: 5, requestId });
  if (!env.DB) return error('DB_NOT_CONFIGURED', 'D1 is not configured.', 503, requestId);
  const row = await env.DB.prepare(`SELECT r.slug, r.status, j.job_type, j.progress_current, j.progress_total, j.error_code, j.error_message
    FROM replays r LEFT JOIN jobs j ON j.replay_id = r.id
    WHERE r.slug = ? ORDER BY j.updated_at DESC LIMIT 1`).bind(slug).first();
  if (!row) return error('REPLAY_NOT_FOUND', 'Replay not found.', 404, requestId);
  return json({
    slug: row.slug,
    status: row.status,
    stage: row.job_type,
    progressCurrent: row.progress_current,
    progressTotal: row.progress_total,
    error: row.error_code ? { code: row.error_code, message: row.error_message } : null,
    requestId,
  });
}

async function handleApi(request, env) {
  const requestId = request.headers.get('cf-ray') || crypto.randomUUID();
  const url = new URL(request.url);
  if (url.pathname === '/api/health' && request.method === 'GET') {
    return json({ ok: true, service: 'oncoreplay', timestamp: new Date().toISOString(), bindings: { d1: Boolean(env.DB), queue: Boolean(env.REPLAY_QUEUE), ai: Boolean(env.AI), openAlex: Boolean(env.OPENALEX_API_KEY) }, requestId }, { headers: { 'x-request-id': requestId } });
  }
  if (url.pathname === '/api/query/preview' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return error('INVALID_JSON', 'Request body must be valid JSON.', 400, requestId); }
    const validation = validatePreviewInput(body);
    if (!validation.ok) return error('INVALID_INPUT', validation.message, 422, requestId);
    return openAlexPreview(env, validation, requestId);
  }
  if (url.pathname === '/api/replays' && request.method === 'POST') return createReplay(env, request, requestId);
  if (url.pathname === '/api/replays/kras-g12d' && request.method === 'GET') return readExample(env, request);
  const statusMatch = url.pathname.match(/^\/api\/replays\/([a-z0-9-]+)\/status$/);
  if (statusMatch && request.method === 'GET') return replayStatus(env, statusMatch[1], requestId);
  return error('NOT_FOUND', 'API route not found.', 404, requestId);
}

async function processQueueMessage(env, message) {
  const body = message.body || {};
  if (!env.DB || !body.jobId || !body.replayId) {
    message.ack();
    return;
  }
  const now = new Date().toISOString();
  try {
    // Deliberately bounded scaffold: it records an honest state instead of pretending
    // that citation expansion, clustering, and narrative generation are complete.
    await env.DB.batch([
      env.DB.prepare(`UPDATE jobs SET status='needs_implementation', attempts=attempts+1, error_code='PIPELINE_SCAFFOLD', error_message='Implement OpenAlex expansion and timeline builder before production use.', updated_at=? WHERE id=?`).bind(now, body.jobId),
      env.DB.prepare(`UPDATE replays SET status='needs_implementation', updated_at=? WHERE id=?`).bind(now, body.replayId),
    ]);
    message.ack();
  } catch {
    message.retry({ delaySeconds: 60 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
  async queue(batch, env) {
    for (const message of batch.messages) await processQueueMessage(env, message);
  },
};
