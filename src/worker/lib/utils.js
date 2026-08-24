export const CURRENT_YEAR = 2026;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeTopic(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 240);
}

export function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
}

export function shortOpenAlexId(value) {
  const match = String(value || '').match(/W\d+/i);
  return match ? match[0].toUpperCase() : String(value || '');
}

export function normalizeDoi(value) {
  if (!value) return null;
  const doi = String(value)
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .toLowerCase();
  return doi.startsWith('10.') ? doi : null;
}

export function chunk(values, size = 50) {
  const output = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== 'object') return null;
  const positions = [];
  for (const [word, indexes] of Object.entries(invertedIndex)) {
    for (const index of indexes || []) positions.push([Number(index), word]);
  }
  if (!positions.length) return null;
  positions.sort((a, b) => a[0] - b[0]);
  return positions.map((item) => item[1]).join(' ');
}

const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','been','being','by','for','from','has','have','in','into','is','it','its','of','on','or','that','the','their','this','to','was','were','with','using','use','used','study','studies','research','cancer','tumor','tumour','therapy','treatment','patients','patient','cell','cells','human','mouse','mice','model','models','analysis','role','effect','effects','results','associated','via','we','our','between','after','before','during','new','novel'
]);

export function tokenize(value) {
  return unique(String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9+.-]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/^[-.]+|[-.]+$/g, ''))
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)));
}

export function tokenCounts(value) {
  const counts = new Map();
  for (const token of String(value || '').toLowerCase().replace(/[^a-z0-9+.-]+/g, ' ').split(/\s+/)) {
    if (token.length < 3 || STOP_WORDS.has(token)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return counts;
}

export function jaccard(a, b) {
  const left = a instanceof Set ? a : new Set(a || []);
  const right = b instanceof Set ? b : new Set(b || []);
  if (!left.size && !right.size) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / (left.size + right.size - intersection || 1);
}

export function cosineFromCounts(a, b) {
  const left = a instanceof Map ? a : new Map();
  const right = b instanceof Map ? b : new Map();
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const value of left.values()) leftNorm += value * value;
  for (const value of right.values()) rightNorm += value * value;
  for (const [key, value] of left) dot += value * (right.get(key) || 0);
  if (!leftNorm || !rightNorm) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export function percentileRank(values, value) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  let below = 0;
  for (const current of sorted) {
    if (current <= value) below += 1;
    else break;
  }
  return below / sorted.length;
}

export function dateToYear(date, fallback = null) {
  const year = Number(String(date || '').slice(0, 4));
  return Number.isFinite(year) ? year : fallback;
}

export function htmlToText(value) {
  return String(value || '')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export async function sha256(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function fetchJson(url, options = {}) {
  const {
    timeoutMs = 12000,
    retries = 2,
    retryBaseMs = 350,
    headers = {},
    ...fetchOptions
  } = options;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...fetchOptions, headers, signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const error = new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 160)}` : ''}`);
        error.status = response.status;
        if (![408, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt === retries) throw error;
        lastError = error;
      } else {
        return await response.json();
      }
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt === retries) throw error;
    }
    const jitter = Math.floor(Math.random() * 120);
    await new Promise((resolve) => setTimeout(resolve, retryBaseMs * (2 ** attempt) + jitter));
  }
  throw lastError || new Error('Request failed');
}

export async function mapWithConcurrency(values, limit, mapper) {
  const output = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return output;
}

export function safeJsonParse(value, fallback) {
  if (value == null || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function truncate(value, length = 800) {
  const text = String(value || '').trim();
  return text.length <= length ? text : `${text.slice(0, Math.max(0, length - 1)).trim()}…`;
}

export function nowIso() {
  return new Date().toISOString();
}
