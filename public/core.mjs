export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function yearProgress(year, startYear, endYear) {
  if (endYear <= startYear) return 0;
  return clamp(((year - startYear) / (endYear - startYear)) * 100, 0, 100);
}

export function visibleWorks(works, currentYear) {
  return works.filter((work) => Number(work.publicationYear) <= Number(currentYear));
}

export function currentEvent(events, currentYear) {
  const eligible = events
    .filter((event) => Number(event.year) <= Number(currentYear))
    .sort((a, b) => Number(a.year) - Number(b.year));
  return eligible.at(-1) ?? events[0] ?? null;
}

export function nodeWeight(work, mode = 'momentum') {
  if (mode === 'debate') {
    return 4 + Math.max(0, Math.min(1, Number(work.debateSignal ?? 0))) * 7;
  }
  return 4 + Math.max(0, Math.min(1, Number(work.normalizedImpact ?? 0))) * 8;
}

export function nodeOpacity(work, mode = 'momentum') {
  const signal = mode === 'debate' ? Number(work.debateSignal ?? 0) : Number(work.normalizedImpact ?? 0);
  return 0.35 + Math.max(0, Math.min(1, signal)) * 0.65;
}

export function playbackStep(currentYear, startYear, endYear, elapsedMs, speed = 1) {
  const yearsPerSecond = 1.8 * speed;
  const next = currentYear + (elapsedMs / 1000) * yearsPerSecond;
  if (next >= endYear) return { year: endYear, finished: true };
  return { year: clamp(next, startYear, endYear), finished: false };
}

export function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
