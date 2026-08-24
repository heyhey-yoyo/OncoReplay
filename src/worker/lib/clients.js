import {
  chunk,
  fetchJson,
  htmlToText,
  mapWithConcurrency,
  normalizeDoi,
  reconstructAbstract,
  shortOpenAlexId,
  unique,
} from './utils.js';

const OPENALEX_FIELDS = [
  'id','doi','display_name','publication_year','publication_date','type','language','cited_by_count',
  'is_retracted','primary_location','ids','authorships','abstract_inverted_index','referenced_works',
  'related_works','topics','primary_topic','keywords','fwci','citation_normalized_percentile',
  'counts_by_year','mesh'
].join(',');

function openAlexUrl(env, path = '/works') {
  const url = new URL(`https://api.openalex.org${path}`);
  if (env.OPENALEX_API_KEY) url.searchParams.set('api_key', env.OPENALEX_API_KEY);
  return url;
}

function apiHeaders(env) {
  const contact = env.CONTACT_EMAIL || env.CROSSREF_MAILTO || 'unknown@example.invalid';
  return { 'user-agent': `OncoReplay/0.2 (${contact})` };
}

export function normalizeOpenAlexWork(raw, layer = 'seed') {
  const id = shortOpenAlexId(raw?.id);
  const ids = raw?.ids || {};
  const primary = raw?.primary_location || {};
  const topics = (raw?.topics || []).map((topic) => ({
    id: topic?.id || null,
    displayName: topic?.display_name || '',
    score: Number(topic?.score || 0),
    subfield: topic?.subfield?.display_name || null,
    field: topic?.field?.display_name || null,
    domain: topic?.domain?.display_name || null,
  }));
  const authors = (raw?.authorships || []).slice(0, 12).map((authorship) => ({
    id: authorship?.author?.id || null,
    name: authorship?.author?.display_name || '',
    position: authorship?.author_position || null,
    institutions: (authorship?.institutions || []).slice(0, 3).map((institution) => institution?.display_name).filter(Boolean),
  }));
  return {
    id,
    openalexId: id,
    rawOpenAlexId: raw?.id || null,
    doi: normalizeDoi(raw?.doi || ids?.doi),
    pmid: ids?.pmid ? String(ids.pmid).replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//i, '').replace(/\/$/, '') : null,
    pmcid: ids?.pmcid ? String(ids.pmcid).replace(/^https?:\/\/www\.ncbi\.nlm\.nih\.gov\/pmc\/articles\//i, '').replace(/\/$/, '') : null,
    title: raw?.display_name || raw?.title || 'Untitled work',
    publicationYear: Number(raw?.publication_year || 0) || null,
    publicationDate: raw?.publication_date || (raw?.publication_year ? `${raw.publication_year}-01-01` : null),
    workType: raw?.type || 'article',
    language: raw?.language || null,
    citedByCount: Number(raw?.cited_by_count || 0),
    isRetracted: Boolean(raw?.is_retracted),
    sourceName: primary?.source?.display_name || null,
    sourceUrl: primary?.landing_page_url || raw?.doi || raw?.id || null,
    abstract: reconstructAbstract(raw?.abstract_inverted_index),
    authors,
    referencedWorks: unique((raw?.referenced_works || []).map(shortOpenAlexId)),
    relatedWorks: unique((raw?.related_works || []).map(shortOpenAlexId)),
    topics,
    primaryTopic: raw?.primary_topic ? {
      id: raw.primary_topic.id || null,
      displayName: raw.primary_topic.display_name || '',
      score: Number(raw.primary_topic.score || 0),
      subfield: raw.primary_topic.subfield?.display_name || null,
      field: raw.primary_topic.field?.display_name || null,
      domain: raw.primary_topic.domain?.display_name || null,
    } : null,
    keywords: (raw?.keywords || []).map((keyword) => ({
      id: keyword?.id || null,
      displayName: keyword?.display_name || '',
      score: Number(keyword?.score || 0),
    })),
    mesh: (raw?.mesh || []).map((entry) => entry?.descriptor_name || entry?.descriptor_ui || entry).filter(Boolean),
    fwci: Number.isFinite(Number(raw?.fwci)) ? Number(raw.fwci) : null,
    citationPercentile: Number.isFinite(Number(raw?.citation_normalized_percentile?.value))
      ? Number(raw.citation_normalized_percentile.value)
      : null,
    countsByYear: (raw?.counts_by_year || []).map((item) => ({ year: Number(item?.year), citedByCount: Number(item?.cited_by_count || 0) })).filter((item) => Number.isFinite(item.year)),
    layer,
  };
}

export async function searchOpenAlex(env, { topic, startYear, endYear, perPage = 100 }) {
  if (!env.OPENALEX_API_KEY) throw new Error('OPENALEX_API_KEY is not configured.');
  const url = openAlexUrl(env, '/works');
  url.searchParams.set('search', topic);
  url.searchParams.set('per_page', String(Math.min(100, Math.max(1, perPage))));
  url.searchParams.set('select', OPENALEX_FIELDS);
  const filters = ['is_paratext:false'];
  if (startYear) filters.push(`from_publication_date:${startYear}-01-01`);
  if (endYear) filters.push(`to_publication_date:${endYear}-12-31`);
  url.searchParams.set('filter', filters.join(','));
  const payload = await fetchJson(url, { timeoutMs: 14000, retries: 2, headers: apiHeaders(env) });
  return {
    count: Number(payload?.meta?.count || 0),
    costUsd: Number(payload?.meta?.cost_usd || 0),
    works: (payload?.results || []).map((raw) => normalizeOpenAlexWork(raw, 'seed')),
  };
}

export async function fetchOpenAlexByIds(env, ids, layer = 'reference') {
  if (!ids.length) return [];
  const batches = chunk(unique(ids.map(shortOpenAlexId)), 100);
  const output = [];
  for (const batch of batches) {
    const url = openAlexUrl(env, '/works');
    url.searchParams.set('filter', `openalex:${batch.join('|')}`);
    url.searchParams.set('per_page', '100');
    url.searchParams.set('select', OPENALEX_FIELDS);
    const payload = await fetchJson(url, { timeoutMs: 14000, retries: 2, headers: apiHeaders(env) });
    output.push(...(payload?.results || []).map((raw) => normalizeOpenAlexWork(raw, layer)));
  }
  return output;
}

export async function fetchWorksCiting(env, ids, { perSeed = 12, startYear, endYear } = {}) {
  const seedIds = unique(ids.map(shortOpenAlexId)).slice(0, 12);
  const groups = await mapWithConcurrency(seedIds, 3, async (id) => {
    const url = openAlexUrl(env, '/works');
    const filters = [`cites:${id}`, 'is_paratext:false'];
    if (startYear) filters.push(`from_publication_date:${startYear}-01-01`);
    if (endYear) filters.push(`to_publication_date:${endYear}-12-31`);
    url.searchParams.set('filter', filters.join(','));
    url.searchParams.set('sort', 'cited_by_count:desc');
    url.searchParams.set('per_page', String(Math.min(25, Math.max(1, perSeed))));
    url.searchParams.set('select', OPENALEX_FIELDS);
    const payload = await fetchJson(url, { timeoutMs: 14000, retries: 2, headers: apiHeaders(env) });
    return (payload?.results || []).map((raw) => normalizeOpenAlexWork(raw, 'citing'));
  });
  const byId = new Map();
  for (const group of groups) for (const work of group) byId.set(work.id, work);
  return [...byId.values()];
}

export async function fetchEuropePmcRecord(work) {
  let query;
  if (work.pmid) query = `EXT_ID:${work.pmid} AND SRC:MED`;
  else if (work.doi) query = `DOI:"${work.doi}"`;
  else return null;
  const url = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
  url.searchParams.set('query', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('resultType', 'core');
  url.searchParams.set('pageSize', '1');
  const payload = await fetchJson(url, {
    timeoutMs: 12000,
    retries: 1,
    headers: { 'user-agent': 'OncoReplay/0.2' },
  });
  const record = payload?.resultList?.result?.[0];
  if (!record) return null;
  return {
    pmid: record.pmid || work.pmid || null,
    pmcid: record.pmcid || work.pmcid || null,
    doi: normalizeDoi(record.doi) || work.doi || null,
    abstract: record.abstractText ? htmlToText(record.abstractText) : null,
    publicationTypes: Array.isArray(record.pubTypeList?.pubType) ? record.pubTypeList.pubType : [],
    firstPublicationDate: record.firstPublicationDate || null,
    source: 'europe-pmc',
  };
}

function normalizeUpdateType(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('retract') || text.includes('withdraw')) return 'retraction';
  if (text.includes('expression') || text.includes('concern')) return 'expression-of-concern';
  if (text.includes('reinstate')) return 'reinstatement';
  if (text.includes('correct') || text.includes('errat') || text.includes('corrigend')) return 'correction';
  return text.replace(/\s+/g, '-') || 'update';
}

function collectCrossrefUpdates(message, targetDoi) {
  const updates = [];
  for (const item of message?.['update-to'] || []) {
    updates.push({
      type: normalizeUpdateType(item?.type || item?.label),
      label: item?.label || item?.type || 'Update',
      doi: normalizeDoi(item?.DOI),
      date: item?.updated?.['date-time'] || item?.updated?.date?.['date-time'] || null,
      source: item?.source || 'publisher',
      direction: 'updates',
    });
  }
  for (const item of message?.['updated-by'] || []) {
    updates.push({
      type: normalizeUpdateType(item?.type || item?.label),
      label: item?.label || item?.type || 'Update',
      doi: normalizeDoi(item?.DOI),
      date: item?.updated?.['date-time'] || item?.updated?.date?.['date-time'] || null,
      source: item?.source || 'publisher',
      direction: 'updated-by',
    });
  }
  const relation = message?.relation || {};
  for (const [relationType, entries] of Object.entries(relation)) {
    for (const entry of entries || []) {
      const relatedDoi = normalizeDoi(entry?.id);
      if (!relatedDoi) continue;
      updates.push({
        type: normalizeUpdateType(relationType),
        label: relationType,
        doi: relatedDoi,
        date: null,
        source: 'crossref-relation',
        direction: 'relation',
      });
    }
  }
  const normalizedTarget = normalizeDoi(targetDoi);
  return updates.filter((item, index, all) => {
    const key = `${item.type}|${item.doi || normalizedTarget}|${item.direction}`;
    return all.findIndex((candidate) => `${candidate.type}|${candidate.doi || normalizedTarget}|${candidate.direction}` === key) === index;
  });
}

export async function fetchCrossrefUpdates(env, work) {
  if (!work.doi) return [];
  const mailto = env.CROSSREF_MAILTO || env.CONTACT_EMAIL || '';
  const headers = apiHeaders(env);
  const singleUrl = new URL(`https://api.crossref.org/works/${encodeURIComponent(work.doi)}`);
  if (mailto) singleUrl.searchParams.set('mailto', mailto);
  let metadata = null;
  try {
    const payload = await fetchJson(singleUrl, { timeoutMs: 12000, retries: 1, headers });
    metadata = payload?.message || null;
  } catch (error) {
    if (error?.status !== 404) throw error;
  }
  const updates = collectCrossrefUpdates(metadata, work.doi);

  // Crossref's `updates` filter returns correction/retraction notices whose target is this DOI.
  const listUrl = new URL('https://api.crossref.org/works');
  listUrl.searchParams.set('filter', `updates:${work.doi}`);
  listUrl.searchParams.set('rows', '20');
  if (mailto) listUrl.searchParams.set('mailto', mailto);
  try {
    const payload = await fetchJson(listUrl, { timeoutMs: 12000, retries: 1, headers });
    for (const notice of payload?.message?.items || []) {
      const noticeUpdates = collectCrossrefUpdates(notice, work.doi);
      if (noticeUpdates.length) updates.push(...noticeUpdates);
      else {
        updates.push({
          type: normalizeUpdateType(notice?.subtype || notice?.type || notice?.title?.[0]),
          label: notice?.title?.[0] || notice?.subtype || 'Update notice',
          doi: normalizeDoi(notice?.DOI),
          date: notice?.published?.['date-parts']?.[0]?.join('-') || null,
          source: notice?.source || 'crossref',
          direction: 'notice',
        });
      }
    }
  } catch (error) {
    if (![400, 404].includes(error?.status)) throw error;
  }

  return updates.filter((item, index, all) => {
    const key = `${item.type}|${item.doi || ''}|${item.label}`;
    return all.findIndex((candidate) => `${candidate.type}|${candidate.doi || ''}|${candidate.label}` === key) === index;
  });
}
