import {
  fetchCrossrefUpdates,
  fetchEuropePmcRecord,
  fetchOpenAlexByIds,
  fetchWorksCiting,
  searchOpenAlex,
} from './clients.js';
import { analyzeReplay, makeWorkText, publicWorkType } from './analysis.js';
import {
  chunk,
  cosineFromCounts,
  mapWithConcurrency,
  nowIso,
  safeJsonParse,
  sha256,
  shortOpenAlexId,
  tokenCounts,
  truncate,
  unique,
} from './utils.js';

export const STAGES = {
  FETCH_WORKS: { progress: 1, total: 5 },
  ENRICH_BIOMEDICAL: { progress: 2, total: 5 },
  BUILD_TIMELINE: { progress: 3, total: 5 },
  GENERATE_NARRATIVE: { progress: 4, total: 5 },
  FINALIZE_REPLAY: { progress: 5, total: 5 },
};

const NEXT_STAGE = {
  FETCH_WORKS: 'ENRICH_BIOMEDICAL',
  ENRICH_BIOMEDICAL: 'BUILD_TIMELINE',
  BUILD_TIMELINE: 'GENERATE_NARRATIVE',
  GENERATE_NARRATIVE: 'FINALIZE_REPLAY',
};

function dbRows(result) {
  return result?.results || [];
}

async function batchStatements(env, statements, size = 75) {
  for (const group of chunk(statements, size)) if (group.length) await env.DB.batch(group);
}

async function replayContext(env, replayId) {
  const replay = await env.DB.prepare('SELECT * FROM replays WHERE id=?').bind(replayId).first();
  if (!replay) throw Object.assign(new Error('Replay not found.'), { code: 'REPLAY_NOT_FOUND', fatal: true });
  const query = await env.DB.prepare('SELECT * FROM replay_queries WHERE replay_id=? ORDER BY created_at DESC LIMIT 1').bind(replayId).first();
  return {
    replay,
    query,
    filters: safeJsonParse(query?.filters_json, {}),
    entities: safeJsonParse(query?.entities_json, []),
    synonyms: safeJsonParse(query?.synonyms_json, []),
  };
}

async function updateJob(env, jobId, replayId, stage, status = 'running', extra = {}) {
  const info = STAGES[stage] || { progress: 0, total: 5 };
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(`UPDATE jobs SET job_type=?, status=?, progress_current=?, progress_total=?, attempts=attempts+?, error_code=?, error_message=?, updated_at=? WHERE id=?`)
      .bind(stage, status, extra.progressCurrent ?? info.progress, extra.progressTotal ?? info.total, extra.incrementAttempt ? 1 : 0, extra.errorCode || null, extra.errorMessage || null, now, jobId),
    env.DB.prepare('UPDATE replays SET status=?, updated_at=? WHERE id=?').bind(status === 'complete' ? 'complete' : status === 'failed' ? 'failed' : 'processing', now, replayId),
  ]);
}

async function enqueueNext(env, body, stage) {
  const next = NEXT_STAGE[stage];
  if (!next) return;
  await env.REPLAY_QUEUE.send({ ...body, type: next });
}

function candidatePriority(topic, work) {
  const similarity = cosineFromCounts(tokenCounts(topic), tokenCounts(makeWorkText(work)));
  const layer = work.layer === 'seed' ? 0.55 : work.layer === 'citing' ? 0.28 : work.layer === 'reference' ? 0.2 : 0.16;
  return similarity * 0.55 + layer + Math.min(0.2, Math.log1p(work.citedByCount || 0) / 60);
}

export function namespaceAnalysis(rawAnalysis, replayId) {
  const branchPrefix = `br-${String(replayId).slice(0, 12)}`;
  const branchIdMap = new Map(rawAnalysis.branches.map((branch) => [branch.id, `${branchPrefix}-${branch.id}`]));
  return {
    ...rawAnalysis,
    branches: rawAnalysis.branches.map((branch) => ({ ...branch, id: branchIdMap.get(branch.id) })),
    scoredWorks: rawAnalysis.scoredWorks.map((work) => ({ ...work, branchId: branchIdMap.get(work.branchId) || work.branchId })),
    events: rawAnalysis.events.map((event) => ({
      ...event,
      branchIds: (event.branchIds || []).map((id) => branchIdMap.get(id) || id),
    })),
  };
}

async function fetchWorksStage(env, body) {
  const context = await replayContext(env, body.replayId);
  const topic = context.replay.normalized_query;
  const focusTerms = context.filters.angle === 'translation' ? 'clinical trial patient biomarker' : context.filters.angle === 'controversy' ? 'resistance limitation toxicity challenge' : context.filters.angle === 'mechanism' ? 'mechanism signaling pathway' : '';
  const searchTopic = [topic, context.filters.cancerType, focusTerms].filter(Boolean).join(' ');
  const excludedTerms = String(context.filters.exclude || '').split(/[,;，；]/).map((value) => value.trim().toLowerCase()).filter(Boolean);
  const maxWorks = Math.min(500, Math.max(40, Number(context.filters.maxWorks || body.maxWorks || 200)));
  const result = await searchOpenAlex(env, {
    topic: searchTopic,
    startYear: context.replay.start_year,
    endYear: context.replay.end_year,
    perPage: Math.min(100, maxWorks),
  });
  const seeds = result.works.filter((work) => work.id);
  if (!seeds.length) throw Object.assign(new Error('OpenAlex did not return any matching works.'), { code: 'NO_WORKS_FOUND', fatal: true });

  const coreSeeds = [...seeds]
    .sort((a, b) => candidatePriority(searchTopic, b) - candidatePriority(searchTopic, a))
    .slice(0, Math.min(16, seeds.length));
  const referenceIds = unique(coreSeeds.flatMap((work) => work.referencedWorks)).slice(0, Math.min(90, maxWorks));
  const relatedIds = unique(coreSeeds.flatMap((work) => work.relatedWorks)).slice(0, Math.min(50, maxWorks));
  const [references, related, citing] = await Promise.all([
    fetchOpenAlexByIds(env, referenceIds, 'reference'),
    fetchOpenAlexByIds(env, relatedIds, 'related'),
    fetchWorksCiting(env, coreSeeds.slice(0, 10).map((work) => work.id), {
      perSeed: 10,
      startYear: context.replay.start_year,
      endYear: context.replay.end_year,
    }),
  ]);
  const byId = new Map();
  for (const work of [...seeds, ...references, ...related, ...citing]) {
    if (!work.id) continue;
    if (context.replay.start_year && work.publicationYear && work.publicationYear < context.replay.start_year) continue;
    if (context.replay.end_year && work.publicationYear && work.publicationYear > context.replay.end_year) continue;
    const current = byId.get(work.id);
    if (!current || candidatePriority(topic, work) > candidatePriority(topic, current)) byId.set(work.id, work);
  }
  const candidates = [...byId.values()]
    .filter((work) => Number.isFinite(work.publicationYear))
    .filter((work) => !excludedTerms.some((term) => makeWorkText(work).toLowerCase().includes(term)))
    .sort((a, b) => candidatePriority(searchTopic, b) - candidatePriority(searchTopic, a))
    .slice(0, maxWorks);
  if (candidates.length < 3) throw Object.assign(new Error('Too few dated works remained after filtering.'), { code: 'INSUFFICIENT_WORKS', fatal: true });
  const candidateIds = new Set(candidates.map((work) => work.id));
  const relations = [];
  const relationKeys = new Set();
  for (const work of candidates) {
    for (const ref of work.referencedWorks || []) {
      if (!candidateIds.has(ref)) continue;
      const key = `${ref}|${work.id}|citation`;
      if (!relationKeys.has(key)) { relationKeys.add(key); relations.push({ source: ref, target: work.id, type: 'citation' }); }
    }
    for (const relatedId of (work.relatedWorks || []).slice(0, 8)) {
      if (!candidateIds.has(relatedId)) continue;
      const [left, right] = [work.id, relatedId].sort();
      const key = `${left}|${right}|related`;
      if (!relationKeys.has(key)) { relationKeys.add(key); relations.push({ source: left, target: right, type: 'related' }); }
    }
  }

  await env.DB.batch([
    env.DB.prepare('DELETE FROM work_relations WHERE replay_id=?').bind(body.replayId),
    env.DB.prepare('DELETE FROM replay_works WHERE replay_id=?').bind(body.replayId),
  ]);
  const workStatements = candidates.map((work) => env.DB.prepare(`INSERT INTO works
    (openalex_id,doi,pmid,pmcid,title,abstract,publication_date,publication_year,work_type,source_name,cited_by_count,counts_by_year_json,topics_json,authorships_json,is_retracted,update_status_json,raw_hash,fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(openalex_id) DO UPDATE SET doi=excluded.doi,pmid=COALESCE(excluded.pmid,works.pmid),pmcid=COALESCE(excluded.pmcid,works.pmcid),title=excluded.title,abstract=COALESCE(excluded.abstract,works.abstract),publication_date=excluded.publication_date,publication_year=excluded.publication_year,work_type=excluded.work_type,source_name=excluded.source_name,cited_by_count=excluded.cited_by_count,counts_by_year_json=excluded.counts_by_year_json,topics_json=excluded.topics_json,authorships_json=excluded.authorships_json,is_retracted=excluded.is_retracted,fetched_at=excluded.fetched_at`)
    .bind(work.id, work.doi, work.pmid, work.pmcid, work.title, work.abstract, work.publicationDate, work.publicationYear, work.workType, work.sourceName, work.citedByCount, JSON.stringify(work.countsByYear || []), JSON.stringify({ topics: work.topics || [], primaryTopic: work.primaryTopic || null, keywords: work.keywords || [], mesh: work.mesh || [], fwci: work.fwci, citationPercentile: work.citationPercentile, referencedWorks: work.referencedWorks || [], relatedWorks: work.relatedWorks || [], layer: work.layer }), JSON.stringify(work.authors || []), work.isRetracted ? 1 : 0, JSON.stringify([]), null, nowIso()));
  await batchStatements(env, workStatements);
  await batchStatements(env, candidates.map((work) => env.DB.prepare(`INSERT INTO replay_works (replay_id,work_id,relevance_score,turning_point_score,branch_id,is_key_work,selection_reasons_json,analysis_json) VALUES (?,?,0,0,NULL,0,'[]','{}')`).bind(body.replayId, work.id)));
  await batchStatements(env, relations.map((relation) => env.DB.prepare(`INSERT OR IGNORE INTO work_relations (source_work_id,target_work_id,relation_type,replay_id) VALUES (?,?,?,?)`).bind(relation.source, relation.target, relation.type, body.replayId)));
  await env.DB.prepare(`UPDATE replays SET work_count=?, start_year=COALESCE(start_year,?), end_year=COALESCE(end_year,?), updated_at=? WHERE id=?`)
    .bind(candidates.length, Math.min(...candidates.map((work) => work.publicationYear || 9999)), Math.max(...candidates.map((work) => work.publicationYear || 0)), nowIso(), body.replayId).run();
}

async function loadPipelineWorks(env, replayId) {
  const rows = dbRows(await env.DB.prepare(`SELECT w.*,rw.branch_id,rw.relevance_score,rw.turning_point_score,rw.is_key_work,rw.selection_reasons_json,rw.analysis_json
    FROM replay_works rw JOIN works w ON w.openalex_id=rw.work_id WHERE rw.replay_id=?`).bind(replayId).all());
  return rows.map((row) => {
    const topicData = safeJsonParse(row.topics_json, {});
    const analysis = safeJsonParse(row.analysis_json, {});
    return {
      id: row.openalex_id,
      openalexId: row.openalex_id,
      doi: row.doi,
      pmid: row.pmid,
      pmcid: row.pmcid,
      title: row.title,
      abstract: row.abstract,
      publicationDate: row.publication_date,
      publicationYear: row.publication_year,
      workType: row.work_type,
      sourceName: row.source_name,
      citedByCount: row.cited_by_count,
      countsByYear: safeJsonParse(row.counts_by_year_json, []),
      authors: safeJsonParse(row.authorships_json, []),
      isRetracted: Boolean(row.is_retracted),
      updateStatus: safeJsonParse(row.update_status_json, []),
      topics: topicData.topics || [],
      primaryTopic: topicData.primaryTopic || null,
      keywords: topicData.keywords || [],
      mesh: topicData.mesh || [],
      fwci: topicData.fwci ?? null,
      citationPercentile: topicData.citationPercentile ?? null,
      referencedWorks: topicData.referencedWorks || [],
      relatedWorks: topicData.relatedWorks || [],
      layer: topicData.layer || 'seed',
      branchId: row.branch_id,
      relevanceScore: row.relevance_score,
      turningPointScore: row.turning_point_score,
      ...analysis,
    };
  });
}

async function enrichStage(env, body) {
  const works = await loadPipelineWorks(env, body.replayId);
  const ranked = [...works].sort((a, b) => candidatePriority(body.topic || '', b) - candidatePriority(body.topic || '', a));
  const epmcTargets = ranked.filter((work) => !work.abstract && (work.pmid || work.doi)).slice(0, 35);
  const crossrefTargets = ranked.filter((work) => work.doi).slice(0, 30);
  const [epmc, updates] = await Promise.all([
    mapWithConcurrency(epmcTargets, 3, async (work) => ({ work, record: await fetchEuropePmcRecord(work).catch(() => null) })),
    mapWithConcurrency(crossrefTargets, 3, async (work) => ({ work, updates: await fetchCrossrefUpdates(env, work).catch(() => []) })),
  ]);
  const statements = [];
  for (const { work, record } of epmc) {
    if (!record) continue;
    statements.push(env.DB.prepare(`UPDATE works SET abstract=COALESCE(?,abstract),pmid=COALESCE(?,pmid),pmcid=COALESCE(?,pmcid),doi=COALESCE(?,doi),fetched_at=? WHERE openalex_id=?`)
      .bind(record.abstract, record.pmid, record.pmcid, record.doi, nowIso(), work.id));
  }
  for (const { work, updates: workUpdates } of updates) {
    if (!workUpdates.length) continue;
    statements.push(env.DB.prepare(`UPDATE works SET update_status_json=?,is_retracted=CASE WHEN ? THEN 1 ELSE is_retracted END,fetched_at=? WHERE openalex_id=?`)
      .bind(JSON.stringify(workUpdates), workUpdates.some((item) => item.type === 'retraction') ? 1 : 0, nowIso(), work.id));
  }
  await batchStatements(env, statements);
}

async function buildTimelineStage(env, body) {
  const context = await replayContext(env, body.replayId);
  const allWorks = await loadPipelineWorks(env, body.replayId);
  const focusTerms = context.filters.angle === 'translation' ? 'clinical trial patient biomarker' : context.filters.angle === 'controversy' ? 'resistance limitation toxicity challenge' : context.filters.angle === 'mechanism' ? 'mechanism signaling pathway' : '';
  const analysisTopic = [context.replay.normalized_query, context.filters.cancerType, focusTerms].filter(Boolean).join(' ');

  // Keep the retrievable candidate pool as large as requested, but bound the O(n²)
  // graph analysis to the most relevant 220 works so it remains viable on Workers.
  const works = [...allWorks]
    .sort((a, b) => candidatePriority(analysisTopic, b) - candidatePriority(analysisTopic, a))
    .slice(0, 220);
  if (works.length < 3) throw Object.assign(new Error('Not enough relevant works to build a timeline.'), { code: 'INSUFFICIENT_WORKS', fatal: true });
  const analysisIds = new Set(works.map((work) => work.id));
  const relations = dbRows(await env.DB.prepare('SELECT source_work_id,target_work_id,relation_type FROM work_relations WHERE replay_id=?').bind(body.replayId).all())
    .map((row) => ({ source: row.source_work_id, target: row.target_work_id, type: row.relation_type }))
    .filter((relation) => analysisIds.has(relation.source) && analysisIds.has(relation.target));

  const rawAnalysis = analyzeReplay(analysisTopic, works, relations, { locale: context.replay.locale || 'zh' });
  // branches.id is globally unique in the MVP schema. Prefix community IDs per replay
  // so multiple custom replays can coexist in the same D1 database.
  const analysis = namespaceAnalysis(rawAnalysis, body.replayId);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM branches WHERE replay_id=?').bind(body.replayId),
    env.DB.prepare('DELETE FROM events WHERE replay_id=?').bind(body.replayId),
    env.DB.prepare(`UPDATE replay_works SET relevance_score=0,turning_point_score=0,branch_id=NULL,is_key_work=0,selection_reasons_json='[]',analysis_json='{}' WHERE replay_id=?`).bind(body.replayId),
  ]);
  await batchStatements(env, analysis.branches.map((branch) => env.DB.prepare(`INSERT INTO branches (id,replay_id,label,description,color_token,sort_order,source_work_ids_json,ai_generated) VALUES (?,?,?,?,?,?,?,0)`)
    .bind(branch.id, body.replayId, branch.label, branch.description, branch.colorToken, branch.sortOrder, JSON.stringify(branch.sourceWorkIds))));
  const topIds = new Set([...analysis.scoredWorks].sort((a, b) => b.turningPointScore - a.turningPointScore).slice(0, 70).map((work) => work.id));
  for (const event of analysis.events) for (const workId of event.sourceWorkIds) topIds.add(workId);
  await batchStatements(env, analysis.scoredWorks.map((work) => env.DB.prepare(`UPDATE replay_works SET relevance_score=?,turning_point_score=?,branch_id=?,is_key_work=?,selection_reasons_json=?,analysis_json=? WHERE replay_id=? AND work_id=?`)
    .bind(work.relevanceScore, work.turningPointScore, work.branchId, topIds.has(work.id) ? 1 : 0, JSON.stringify(work.selectionReasons || []), JSON.stringify({ normalizedImpact: work.normalizedImpact, debateSignal: work.debateSignal, momentum: work.momentum, bridgeScore: work.bridgeScore, clinicalSignal: work.clinicalSignal, challengeSignal: work.challengeSignal, revivalSignal: work.revivalSignal }), body.replayId, work.id)));
  await batchStatements(env, analysis.events.map((event) => env.DB.prepare(`INSERT INTO events (id,replay_id,event_type,event_date,title,summary,selection_reason,confidence,requires_review,source_work_ids_json,metrics_json,sort_order,ai_generated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`)
    .bind(event.id, body.replayId, event.eventType, event.eventDate, event.title, event.summary, event.selectionReason, event.confidence, event.requiresReview ? 1 : 0, JSON.stringify(event.sourceWorkIds), JSON.stringify({ ...event.metrics, branchIds: event.branchIds }), event.sortOrder)));
  await env.DB.prepare('UPDATE replays SET event_count=?,updated_at=? WHERE id=?').bind(analysis.events.length, nowIso(), body.replayId).run();
}

const NARRATIVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    branches: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { branch_id: { type: 'string' }, label: { type: 'string' }, description: { type: 'string' } },
        required: ['branch_id','label','description'],
      },
    },
    events: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          event_id: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' }, selection_reason: { type: 'string' },
          source_work_ids: { type: 'array', items: { type: 'string' } }, confidence: { type: 'number' }, requires_review: { type: 'boolean' },
        },
        required: ['event_id','title','summary','selection_reason','source_work_ids','confidence','requires_review'],
      },
    },
    open_questions: { type: 'array', items: { type: 'string' } },
  },
  required: ['branches','events','open_questions'],
};

// Narrative generation is split into small independent AI calls (branches /
// events batches / open questions) so no single inference has to produce a
// long output — keeps each call far below Workers AI latency limits and lets
// a failed batch fall back without discarding the rest.
const BRANCHES_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { branches: { type: 'array', items: NARRATIVE_SCHEMA.properties.branches.items } },
  required: ['branches'],
};
const EVENTS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { events: { type: 'array', items: NARRATIVE_SCHEMA.properties.events.items } },
  required: ['events'],
};
const QUESTIONS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { open_questions: NARRATIVE_SCHEMA.properties.open_questions },
  required: ['open_questions'],
};

function parseAiResponse(result) {
  const value = result?.response ?? result;
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string') return JSON.parse(value);
  throw new Error('Workers AI returned an empty response.');
}

export function validateNarrative(payload, branches, events, works) {
  if (!payload || !Array.isArray(payload.branches) || !Array.isArray(payload.events) || !Array.isArray(payload.open_questions)) throw new Error('Schema root is invalid.');
  const expectedBranchIds = new Set(branches.map((item) => item.id));
  const expectedEventIds = new Set(events.map((item) => item.id));
  const eventMap = new Map(events.map((item) => [item.id, item]));
  const workIds = new Set(works.map((item) => item.id));
  const seenBranches = new Set();
  const seenEvents = new Set();

  for (const branch of payload.branches) {
    if (!expectedBranchIds.has(branch.branch_id) || seenBranches.has(branch.branch_id)) throw new Error(`Invalid or duplicate branch output: ${branch.branch_id}`);
    if (![branch.label, branch.description].every((value) => typeof value === 'string' && value.trim() && value.length <= 240)) throw new Error(`Incomplete branch output: ${branch.branch_id}`);
    seenBranches.add(branch.branch_id);
  }
  if (seenBranches.size !== expectedBranchIds.size) throw new Error('AI omitted one or more supplied branches.');

  for (const event of payload.events) {
    const original = eventMap.get(event.event_id);
    if (!original || seenEvents.has(event.event_id)) throw new Error(`Unknown or duplicate event id: ${event.event_id}`);
    if (![event.title,event.summary,event.selection_reason].every((value) => typeof value === 'string' && value.trim() && value.length <= 600)) throw new Error(`Incomplete event output: ${event.event_id}`);
    if (!Array.isArray(event.source_work_ids) || event.source_work_ids.length < 1 || event.source_work_ids.length > 5 || event.source_work_ids.some((id) => !workIds.has(id) || !original.sourceWorkIds.includes(id))) throw new Error(`Event cited work outside its supplied evidence: ${event.event_id}`);
    if (!Number.isFinite(event.confidence) || event.confidence < 0 || event.confidence > 1 || typeof event.requires_review !== 'boolean') throw new Error(`Invalid confidence: ${event.event_id}`);
    seenEvents.add(event.event_id);
  }
  if (seenEvents.size !== expectedEventIds.size) throw new Error('AI omitted one or more supplied events.');
  if (payload.open_questions.length > 5 || payload.open_questions.some((value) => typeof value !== 'string' || !value.trim() || value.length > 300)) throw new Error('Open questions are invalid.');
  return payload;
}

export function validateChunk(payload, type, events, works, expectedIds) {
  if (type === 'branches') {
    const branches = payload?.branches;
    if (!Array.isArray(branches)) throw new Error('Schema root is invalid.');
    const expected = new Set(expectedIds);
    const seen = new Set();
    for (const branch of branches) {
      if (!expected.has(branch.branch_id) || seen.has(branch.branch_id)) throw new Error(`Invalid or duplicate branch output: ${branch.branch_id}`);
      if (![branch.label, branch.description].every((value) => typeof value === 'string' && value.trim() && value.length <= 240)) throw new Error(`Incomplete branch output: ${branch.branch_id}`);
      seen.add(branch.branch_id);
    }
    if (seen.size !== expected.size) throw new Error('AI omitted one or more supplied branches.');
    return branches;
  }
  if (type === 'events') {
    const output = payload?.events;
    if (!Array.isArray(output)) throw new Error('Schema root is invalid.');
    const eventMap = new Map(events.map((item) => [item.id, item]));
    const workIds = new Set(works.map((item) => item.id));
    const expected = new Set(expectedIds);
    const seen = new Set();
    for (const event of output) {
      const original = eventMap.get(event.event_id);
      if (!original || !expected.has(event.event_id) || seen.has(event.event_id)) throw new Error(`Unknown or duplicate event id: ${event.event_id}`);
      if (![event.title,event.summary,event.selection_reason].every((value) => typeof value === 'string' && value.trim() && value.length <= 600)) throw new Error(`Incomplete event output: ${event.event_id}`);
      if (!Array.isArray(event.source_work_ids) || event.source_work_ids.length < 1 || event.source_work_ids.length > 5 || event.source_work_ids.some((id) => !workIds.has(id) || !original.sourceWorkIds.includes(id))) throw new Error(`Event cited work outside its supplied evidence: ${event.event_id}`);
      if (!Number.isFinite(event.confidence) || event.confidence < 0 || event.confidence > 1 || typeof event.requires_review !== 'boolean') throw new Error(`Invalid confidence: ${event.event_id}`);
      seen.add(event.event_id);
    }
    if (seen.size !== expected.size) throw new Error('AI omitted one or more supplied events.');
    return output;
  }
  if (type === 'questions') {
    const questions = payload?.open_questions;
    if (!Array.isArray(questions) || questions.length > 5 || questions.some((value) => typeof value !== 'string' || !value.trim() || value.length > 300)) throw new Error('Open questions are invalid.');
    return questions;
  }
  throw new Error('Unknown chunk type.');
}

async function loadNarrativeContext(env, replayId) {
  const context = await replayContext(env, replayId);
  const branches = dbRows(await env.DB.prepare('SELECT * FROM branches WHERE replay_id=? ORDER BY sort_order').bind(replayId).all())
    .map((row) => ({ id: row.id, label: row.label, description: row.description, sourceWorkIds: safeJsonParse(row.source_work_ids_json, []) }));
  const events = dbRows(await env.DB.prepare('SELECT * FROM events WHERE replay_id=? ORDER BY sort_order').bind(replayId).all())
    .map((row) => ({ id: row.id, eventType: row.event_type, eventDate: row.event_date, title: row.title, summary: row.summary, selectionReason: row.selection_reason, sourceWorkIds: safeJsonParse(row.source_work_ids_json, []), confidence: row.confidence, requiresReview: Boolean(row.requires_review) }));
  const works = await loadPipelineWorks(env, replayId);
  return { context, branches, events, works };
}

async function runNarrativeAI(env, narrative, priorError = '') {
  const locale = narrative.context.replay.locale || 'zh';
  const relevantIds = new Set(narrative.events.flatMap((event) => event.sourceWorkIds));
  const suppliedWorks = narrative.works.filter((work) => relevantIds.has(work.id)).map((work) => ({
    id: work.id, year: work.publicationYear, title: work.title, abstract: truncate(work.abstract || '摘要缺失', 500),
    branch_id: work.branchId, cited_by_count: work.citedByCount, update_status: work.updateStatus,
  }));
  const system = locale === 'en'
    ? 'You write neutral, source-grounded oncology research timeline copy. Use only supplied work IDs. Never invent facts, identifiers, consensus, causality, efficacy, or misconduct. Distinguish structured facts from interpretation. Rewrite every branch label/description and every event title/summary/reason in your own words — never echo or rephrase the supplied scaffolding. Return only JSON matching the schema.'
    : '你负责撰写中性、可追溯的肿瘤研究时间线叙事。只能使用输入中的 work ID，不得添加外部事实、论文、标识符、共识、因果、疗效结论或学术不端推断。必须区分结构化事实与解释；摘要不足时明确保守表达。必须用自己的话重写每个分支的标签/描述与每个事件的标题/摘要/选择理由，禁止复述或回显输入中的任何现成文案。仅返回符合 Schema 的 JSON。';
  const user = JSON.stringify({
    language: locale === 'en' ? 'English' : '简体中文',
    topic: narrative.context.replay.normalized_query,
    constraints: { event_title: '8-24 Chinese characters or 5-14 English words', event_summary: '45-100 Chinese characters or 40-80 English words', source_ids_must_be_subset: true },
    branches: narrative.branches.map((branch) => ({ id: branch.id, source_work_ids: branch.sourceWorkIds })),
    events: narrative.events.map((event) => ({ id: event.id, type: event.eventType, date: event.eventDate, source_work_ids: event.sourceWorkIds, confidence: event.confidence })),
    works: suppliedWorks,
    prior_validation_error: priorError || undefined,
  });
  const model = env.AI_MODEL || AI_MODEL_DEFAULT;
  const result = await env.AI.run(model, {
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_schema', json_schema: NARRATIVE_SCHEMA },
    temperature: 0.2,
    max_tokens: 8192,
  });
  return { model, payload: validateNarrative(parseAiResponse(result), narrative.branches, narrative.events, narrative.works) };
}

const AI_MODEL_DEFAULT = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

async function logAiRun(env, runId, replayId, model, status, failures, output) {
  const inputHash = await sha256({ status, failures, ...(output ? { sample: output.branches?.[0] || output.events?.[0] } : {}) });
  await env.DB.prepare(`INSERT INTO ai_runs (id,replay_id,task_type,model,input_hash,output_json,status,validation_errors_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(runId, replayId, 'GENERATE_NARRATIVE', model, inputHash, output ? JSON.stringify(output) : null, status, JSON.stringify(failures.slice(0, 5)), nowIso()).run();
}

function chunkInstruction(type, locale) {
  const zh = {
    branches: '为每个分支撰写一个 4-12 字的中文标签和一句 20-60 字的中文描述，概括该分支的研究主线。用词要具体，禁止使用“临床转化”之类的通用模板语。',
    events: '为每个事件撰写一个 8-24 字的中文标题、一句 45-100 字的中文摘要和一句不超过 40 字的选择理由。内容必须针对该事件对应的具体论文与年份展开，不得写成通用模板句。',
    questions: '基于当前时间线提出 2-4 个该领域仍未解决、值得进一步核查的开放问题，每个 15-60 字。',
  };
  const en = {
    branches: 'Write a 3-8 word label and a 20-60 word description for each branch summarizing its research theme. Be specific; never use generic template phrasing.',
    events: 'For each event write a 5-14 word title, a 40-80 word summary, and a selection reason of at most 40 words. Reference the specific work and year of each event; never use generic template sentences.',
    questions: 'Pose 2-4 open questions (15-60 words each) about unresolved aspects of this field worth verifying.',
  };
  return (locale === 'en' ? en : zh)[type];
}

async function withRetry(run, failures, attempts = 2) {
  let lastError = '';
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await run(lastError); }
    catch (error) { lastError = error?.message || String(error); }
  }
  failures.push(lastError);
  return null;
}

async function runNarrativeChunk(env, chunk, model, priorError = '') {
  const { type, locale, topic } = chunk;
  const system = locale === 'en'
    ? `You write neutral, source-grounded oncology research timeline copy. Use only supplied work IDs. Never invent facts, identifiers, consensus, causality, efficacy, or misconduct. Rewrite everything in your own words — never echo or rephrase supplied scaffolding. ${chunkInstruction(type, locale)} Return only JSON matching the schema.`
    : `你负责撰写中性、可追溯的肿瘤研究时间线叙事。只能使用输入中的 work ID，不得添加外部事实、论文、标识符、共识、因果、疗效结论或学术不端推断。必须用自己的话撰写，禁止复述或回显输入内容。${chunkInstruction(type, locale)}仅返回符合 Schema 的 JSON。`;
  const relevantIds = new Set(chunk.events?.flatMap((event) => event.source_work_ids) || []);
  const works = chunk.works ? chunk.works.filter((work) => relevantIds.has(work.id)).map((work) => ({
    id: work.id, year: work.publicationYear, title: work.title, abstract: truncate(work.abstract || '摘要缺失', 500),
    branch_id: work.branchId, cited_by_count: work.citedByCount, update_status: work.updateStatus,
  })) : [];
  const user = JSON.stringify({
    language: locale === 'en' ? 'English' : '简体中文',
    topic,
    ...(type === 'branches' ? { branches: chunk.branches } : {}),
    ...(type === 'events' ? { events: chunk.events, works } : {}),
    prior_validation_error: priorError || undefined,
  });
  const schema = type === 'branches' ? BRANCHES_SCHEMA : type === 'events' ? EVENTS_SCHEMA : QUESTIONS_SCHEMA;
  const result = await env.AI.run(model, {
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_schema', json_schema: schema },
    temperature: 0.2,
    max_tokens: type === 'questions' ? 1024 : 2048,
  });
  return parseAiResponse(result);
}

async function narrativeStage(env, body) {
  if (!env.AI) return;
  const narrative = await loadNarrativeContext(env, body.replayId);
  const locale = narrative.context.replay.locale || 'zh';
  const topic = narrative.context.replay.normalized_query;
  const model = env.AI_MODEL || AI_MODEL_DEFAULT;
  const runId = crypto.randomUUID();
  const failures = [];
  const works = narrative.works;

  const branchOutput = await withRetry(async (prior) => {
    const payload = await runNarrativeChunk(env, {
      type: 'branches', locale, topic,
      branches: narrative.branches.map((branch) => ({ id: branch.id, source_work_ids: branch.sourceWorkIds })),
    }, model, prior);
    return validateChunk(payload, 'branches', [], works, narrative.branches.map((branch) => branch.id));
  }, failures);
  if (!branchOutput) {
    await logAiRun(env, runId, body.replayId, model, 'fallback', failures, null);
    return;
  }

  const eventOutput = [];
  let eventsOk = true;
  for (const batch of chunk(narrative.events, 4)) {
    const output = await withRetry(async (prior) => {
      const payload = await runNarrativeChunk(env, {
        type: 'events', locale, topic, works,
        events: batch.map((event) => ({ id: event.id, type: event.eventType, date: event.eventDate, source_work_ids: event.sourceWorkIds, confidence: event.confidence })),
      }, model, prior);
      return validateChunk(payload, 'events', batch, works, batch.map((event) => event.id));
    }, failures);
    if (!output) { eventsOk = false; break; }
    eventOutput.push(...output);
  }

  const questionsOutput = await withRetry(async (prior) => {
    const payload = await runNarrativeChunk(env, { type: 'questions', locale, topic }, model, prior);
    return validateChunk(payload, 'questions', [], works, []);
  }, failures);

  const statements = [];
  for (const branch of branchOutput) statements.push(env.DB.prepare('UPDATE branches SET label=?,description=?,ai_generated=1 WHERE id=? AND replay_id=?').bind(branch.label, branch.description, branch.branch_id, body.replayId));
  for (const event of eventOutput) statements.push(env.DB.prepare(`UPDATE events SET title=?,summary=?,selection_reason=?,confidence=?,requires_review=?,source_work_ids_json=?,ai_generated=1 WHERE id=? AND replay_id=?`)
    .bind(event.title, event.summary, event.selection_reason, event.confidence, event.requires_review ? 1 : 0, JSON.stringify(event.source_work_ids), event.event_id, body.replayId));
  if (questionsOutput && questionsOutput.length) statements.push(env.DB.prepare('UPDATE replays SET open_questions_json=? WHERE id=?').bind(JSON.stringify(questionsOutput.slice(0, 5)), body.replayId));
  await batchStatements(env, statements);

  await logAiRun(env, runId, body.replayId, model, eventsOk ? 'complete' : 'partial', failures, { branches: branchOutput, events: eventOutput, open_questions: questionsOutput || [] });
}

async function finalizeStage(env, body) {
  const counts = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM replay_works WHERE replay_id=?) work_count,(SELECT COUNT(*) FROM events WHERE replay_id=?) event_count`).bind(body.replayId, body.replayId).first();
  await env.DB.batch([
    env.DB.prepare(`UPDATE replays SET status='complete',work_count=?,event_count=?,updated_at=? WHERE id=?`).bind(counts?.work_count || 0, counts?.event_count || 0, nowIso(), body.replayId),
    env.DB.prepare(`UPDATE jobs SET job_type='FINALIZE_REPLAY',status='complete',progress_current=5,progress_total=5,error_code=NULL,error_message=NULL,updated_at=? WHERE id=?`).bind(nowIso(), body.jobId),
  ]);
}

async function markFailed(env, body, error) {
  const code = error?.code || 'PIPELINE_ERROR';
  const message = truncate(error?.message || String(error), 500);
  await updateJob(env, body.jobId, body.replayId, body.type || 'FETCH_WORKS', 'failed', { errorCode: code, errorMessage: message });
}

export async function processPipelineMessage(env, message) {
  const body = message.body || {};
  if (!env.DB || !env.REPLAY_QUEUE || !body.jobId || !body.replayId || !STAGES[body.type]) {
    message.ack();
    return;
  }
  try {
    await updateJob(env, body.jobId, body.replayId, body.type, 'running', { incrementAttempt: true });
    if (body.type === 'FETCH_WORKS') await fetchWorksStage(env, body);
    else if (body.type === 'ENRICH_BIOMEDICAL') await enrichStage(env, body);
    else if (body.type === 'BUILD_TIMELINE') await buildTimelineStage(env, body);
    else if (body.type === 'GENERATE_NARRATIVE') await narrativeStage(env, body);
    else if (body.type === 'FINALIZE_REPLAY') await finalizeStage(env, body);
    if (body.type !== 'FINALIZE_REPLAY') await enqueueNext(env, body, body.type);
    message.ack();
  } catch (error) {
    const attempts = Number(message.attempts || 1);
    if (!error?.fatal && attempts < 3) {
      message.retry({ delaySeconds: Math.min(300, 30 * (2 ** (attempts - 1))) });
      return;
    }
    await markFailed(env, body, error);
    message.ack();
  }
}

export async function getReplayPayload(env, slug) {
  const replay = await env.DB.prepare('SELECT * FROM replays WHERE slug=?').bind(slug).first();
  if (!replay) return null;
  if (replay.status !== 'complete') return { status: replay.status, slug: replay.slug };
  const [branchResult, worksResult, relationResult, eventResult] = await Promise.all([
    env.DB.prepare('SELECT * FROM branches WHERE replay_id=? ORDER BY sort_order').bind(replay.id).all(),
    env.DB.prepare(`SELECT w.*,rw.branch_id,rw.relevance_score,rw.turning_point_score,rw.is_key_work,rw.analysis_json FROM replay_works rw JOIN works w ON w.openalex_id=rw.work_id WHERE rw.replay_id=? AND rw.is_key_work=1 ORDER BY w.publication_year,rw.turning_point_score DESC LIMIT 100`).bind(replay.id).all(),
    env.DB.prepare('SELECT source_work_id,target_work_id,relation_type FROM work_relations WHERE replay_id=?').bind(replay.id).all(),
    env.DB.prepare('SELECT * FROM events WHERE replay_id=? ORDER BY sort_order,event_date').bind(replay.id).all(),
  ]);
  const works = dbRows(worksResult).map((row) => {
    const analysis = safeJsonParse(row.analysis_json, {});
    const authors = safeJsonParse(row.authorships_json, []).map((item) => typeof item === 'string' ? item : item.name).filter(Boolean);
    const updates = safeJsonParse(row.update_status_json, []);
    return {
      id: row.openalex_id,
      openalexId: row.openalex_id,
      title: row.title,
      publicationDate: row.publication_date,
      publicationYear: row.publication_year,
      workType: publicWorkType({ workType: row.work_type, title: row.title, abstract: row.abstract }),
      citedByCount: row.cited_by_count,
      branchId: row.branch_id,
      authors,
      sourceName: row.source_name || 'OpenAlex',
      doi: row.doi,
      pmid: row.pmid,
      pmcid: row.pmcid,
      abstract: row.abstract || '摘要暂缺。请通过 DOI、PMID 或 OpenAlex 链接查看原始来源。',
      isRetracted: Boolean(row.is_retracted),
      updateStatus: updates[0] || null,
      updateStatuses: updates,
      normalizedImpact: analysis.normalizedImpact ?? row.turning_point_score,
      debateSignal: analysis.debateSignal ?? 0,
      turningPointScore: row.turning_point_score,
      relevanceScore: row.relevance_score,
      sourceUrl: row.doi ? `https://doi.org/${row.doi}` : `https://openalex.org/${shortOpenAlexId(row.openalex_id)}`,
    };
  });
  const visibleIds = new Set(works.map((work) => work.id));
  const branches = dbRows(branchResult).map((row) => ({ id: row.id, label: row.label, shortLabel: row.label, description: row.description, colorToken: row.color_token, sortOrder: row.sort_order }));
  const events = dbRows(eventResult).map((row) => {
    const metrics = safeJsonParse(row.metrics_json, {});
    return {
      id: row.id, eventType: row.event_type, eventDate: row.event_date, year: Number(String(row.event_date).slice(0, 4)), title: row.title, summary: row.summary,
      selectionReason: row.selection_reason, branchIds: metrics.branchIds || [], sourceWorkIds: safeJsonParse(row.source_work_ids_json, []).filter((id) => visibleIds.has(id)),
      confidence: row.confidence, requiresReview: Boolean(row.requires_review), aiGenerated: Boolean(row.ai_generated), metrics,
    };
  }).filter((event) => event.sourceWorkIds.length);
  return {
    schemaVersion: 2,
    slug: replay.slug,
    title: replay.title,
    subtitle: replay.subtitle || `根据开放学术元数据重建的“${replay.original_query}”研究演化时间线。`,
    originalQuery: replay.original_query,
    startYear: replay.start_year || Math.min(...works.map((work) => work.publicationYear)),
    endYear: replay.end_year || Math.max(...works.map((work) => work.publicationYear)),
    generatedAt: replay.updated_at,
    dataStatus: replay.data_status || 'source-grounded',
    disclaimer: '本回放来自开放学术元数据、引用关系、规则分析与来源约束的机器归纳。它不是系统综述、临床建议或科学共识判断；请通过证据抽屉核查原始来源。',
    locale: replay.locale || 'zh',
    branches,
    works,
    edges: dbRows(relationResult).filter((row) => visibleIds.has(row.source_work_id) && visibleIds.has(row.target_work_id)).map((row) => ({ source: row.source_work_id, target: row.target_work_id, type: row.relation_type })),
    events,
    openQuestions: safeJsonParse(replay.open_questions_json, []),
  };
}
