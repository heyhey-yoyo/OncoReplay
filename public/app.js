import {
  clamp,
  currentEvent,
  escapeHtml,
  nodeOpacity,
  nodeWeight,
  playbackStep,
  slugify,
  yearProgress,
} from './core.mjs';

const app = document.querySelector('#app');
const state = {
  replay: null,
  currentYear: 2006,
  playing: false,
  speed: 1,
  mode: 'momentum',
  selectedEventId: null,
  selectedWorkId: null,
  animationFrame: null,
  lastFrame: 0,
  resizeTimer: null,
};

const icons = {
  arrow: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  play: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18"><path d="M5.7 3.7v10.6L14 9 5.7 3.7Z" fill="currentColor"/></svg>',
  pause: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18"><path d="M5 4h3v10H5V4Zm5 0h3v10h-3V4Z" fill="currentColor"/></svg>',
  close: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="m4 4 10 10M14 4 4 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  back: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M14 9H4m4-4L4 9l4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  share: '<svg aria-hidden="true" width="17" height="17" viewBox="0 0 18 18" fill="none"><circle cx="13.5" cy="4.5" r="2" stroke="currentColor"/><circle cx="4.5" cy="9" r="2" stroke="currentColor"/><circle cx="13.5" cy="13.5" r="2" stroke="currentColor"/><path d="m6.3 8.1 5.4-2.7M6.3 9.9l5.4 2.7" stroke="currentColor"/></svg>',
};

const branchColor = {
  mechanism: '#70e2d1',
  chemistry: '#a6a0ff',
  resistance: '#f1b96c',
  translation: '#8fdaa7',
};

function routePath() {
  return window.location.pathname.replace(/\/+$/, '') || '/';
}

function navigate(path) {
  window.history.pushState({}, '', path);
  renderRoute();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function siteHeader() {
  return `
    <header class="site-header">
      <div class="container nav">
        <a class="brand" href="/" data-nav>
          <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
          <span>OncoReplay</span>
        </a>
        <nav class="nav-links" aria-label="Primary navigation">
          <a class="nav-link" href="/explore" data-nav>Explore</a>
          <a class="nav-link" href="/methodology" data-nav>Methodology</a>
          <a class="nav-link" href="/about" data-nav>About</a>
          <a class="button primary nav-cta" href="/create" data-nav>Create replay</a>
        </nav>
      </div>
    </header>`;
}

function footer() {
  return `
    <footer class="site-footer">
      <div class="container footer-inner">
        <div class="footer-note">
          <strong style="color:var(--text)">OncoReplay</strong><br />
          A research exploration and communication prototype. It does not provide medical advice, clinical recommendations, or a complete systematic review.
        </div>
        <div class="footer-links">
          <a href="/methodology" data-nav>Methodology</a>
          <a href="/about" data-nav>Limitations</a>
          <a href="https://github.com/heyhey-yoyo/oncoreplay" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </div>
    </footer>`;
}

function heroNetwork() {
  const nodes = [
    [80,370,7,'#70e2d1'],[145,310,5,'#70e2d1'],[210,330,9,'#a6a0ff'],[290,245,6,'#70e2d1'],
    [350,285,11,'#f1b96c'],[430,205,6,'#a6a0ff'],[500,250,8,'#70e2d1'],[565,165,5,'#8fdaa7'],
    [640,210,12,'#a6a0ff'],[725,120,7,'#f1b96c'],[790,180,6,'#8fdaa7'],[860,96,10,'#70e2d1'],
    [930,155,7,'#a6a0ff'],[1000,72,5,'#8fdaa7'],[1080,130,9,'#f1b96c'],[1160,56,6,'#70e2d1'],
  ];
  const lines = nodes.slice(1).map((node, index) => {
    const prev = nodes[index];
    return `<path class="hero-flow" d="M${prev[0]} ${prev[1]} C${prev[0]+38} ${prev[1]-20},${node[0]-42} ${node[1]+20},${node[0]} ${node[1]}" fill="none" stroke="rgba(194,225,219,.18)" stroke-width="1"/>`;
  }).join('');
  const circles = nodes.map((n) => `<circle class="hero-node" cx="${n[0]}" cy="${n[1]}" r="${n[2]}" fill="${n[3]}" opacity=".8"/>`).join('');
  return `<div class="hero-network" aria-hidden="true"><svg viewBox="0 0 1240 520" preserveAspectRatio="xMidYMid slice"><path d="M30 430C200 360 250 420 390 300S650 260 780 150s240 30 420-140" fill="none" stroke="rgba(112,226,209,.07)" stroke-width="90"/>${lines}${circles}</svg></div>`;
}

function renderHome() {
  document.title = 'OncoReplay — Watch a cancer research idea evolve';
  app.innerHTML = `
    <div class="shell">
      ${siteHeader()}
      <main id="main">
        <section class="hero">
          ${heroNetwork()}
          <div class="container hero-content">
            <span class="eyebrow">A research time machine</span>
            <h1 class="display">Watch a cancer research idea <em>evolve.</em></h1>
            <p class="lede">Turn papers, citations, controversies, and clinical translation into an interactive timeline you can pause, inspect, and share.</p>
            <form class="search-panel" id="home-search">
              <input id="home-query" name="query" autocomplete="off" aria-label="Research topic" placeholder='Try “YAP1 and EGFR-TKI resistance”' />
              <button class="button primary" type="submit">Generate replay ${icons.arrow}</button>
            </form>
            <div class="search-note">No patient-identifiable or confidential information</div>
            <div class="hero-actions">
              <a class="button accent" href="/replay/kras-g12d" data-nav>Watch the KRAS G12D example</a>
              <a class="button ghost" href="/methodology" data-nav>How evidence is handled</a>
            </div>
          </div>
        </section>
        <section class="trust-strip" aria-label="Data sources">
          <div class="container trust-inner"><span>Designed around open scholarly metadata</span><div class="source-logos"><span>OpenAlex</span><span>Europe PMC</span><span>Crossref</span></div></div>
        </section>
        <section class="section">
          <div class="container">
            <div class="section-head"><div><span class="eyebrow">Curated replays</span><h2 class="section-title">Enter through a story, not a blank screen.</h2></div><p class="section-copy">The first release is built around a small set of checked examples. Each replay keeps narrative, source metadata, and uncertainty visually separate.</p></div>
            <div class="cards">
              ${exampleCard('KRAS G12D inhibitors','2006–2026','40','12','A field accelerates, branches, and meets the realities of translation.','/replay/kras-g12d')}
              ${exampleCard('HER2-low breast cancer','2013–2026','Preview','—','Watch a classification move from descriptive label toward clinical strategy.','/create?query=HER2-low%20breast%20cancer')}
              ${exampleCard('Ferroptosis in cancer therapy','2012–2026','Preview','—','Follow a mechanism as it spreads across tumor types and combination hypotheses.','/create?query=ferroptosis%20in%20cancer%20therapy')}
            </div>
          </div>
        </section>
        <section class="section" style="padding-top:20px">
          <div class="container">
            <div class="section-head"><div><span class="eyebrow">The product loop</span><h2 class="section-title">Find. Reconstruct. Replay.</h2></div><p class="section-copy">AI is used to organize source-bound material, not to invent identifiers, change publication dates, or declare scientific consensus.</p></div>
            <div class="steps">
              <article class="step"><span class="step-index">01 / Find the papers</span><h3>Start from a checked query.</h3><p>Preview entities, synonyms, date range, and sample works before a replay is built.</p></article>
              <article class="step"><span class="step-index">02 / Reconstruct the timeline</span><h3>Score change, not just citation totals.</h3><p>Combine time, normalized influence, graph bridges, branch formation, revival, and structured corrections.</p></article>
              <article class="step"><span class="step-index">03 / Replay the field</span><h3>See the story, then inspect evidence.</h3><p>Pause at any year, switch lenses, and open the source drawer behind every event.</p></article>
            </div>
          </div>
        </section>
      </main>
      ${footer()}
    </div>`;
  bindCommonNavigation();
  document.querySelector('#home-search')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = document.querySelector('#home-query').value.trim();
    navigate(query ? `/create?query=${encodeURIComponent(query)}` : '/create');
  });
}

function exampleCard(title, span, works, events, copy, path) {
  return `<article class="card example-card"><div class="card-glow"></div><span class="card-kicker">Featured replay</span><h3 class="card-title">${escapeHtml(title)}</h3><p class="card-copy">${escapeHtml(copy)}</p><div class="mini-timeline"><i></i><i></i><i></i><i></i><i></i></div><div class="card-stats"><div class="stat"><strong>${escapeHtml(span)}</strong><span>Timeline</span></div><div class="stat"><strong>${escapeHtml(works)}</strong><span>Works</span></div><div class="stat"><strong>${escapeHtml(events)}</strong><span>Events</span></div></div><a class="card-link" href="${path}" data-nav>Open replay ${icons.arrow}</a></article>`;
}

function renderCreate() {
  document.title = 'Create a replay — OncoReplay';
  const params = new URLSearchParams(window.location.search);
  const initialQuery = params.get('query') || '';
  app.innerHTML = `
    <div class="shell">${siteHeader()}<main id="main">
      <section class="page-hero"><div class="container"><span class="eyebrow">Create replay</span><h1>Define the field before reconstructing it.</h1><p>Review entities, synonyms, date coverage, and sample works before the pipeline starts. The preview can use OpenAlex when the Worker secret is configured; otherwise it falls back to a clearly labeled local demonstration.</p></div></section>
      <section class="container create-grid">
        <form class="form-card form-stack" id="create-form">
          <div class="field"><label for="topic">Research topic</label><textarea class="textarea" id="topic" name="topic" maxlength="240" required placeholder="KRAS G12D inhibitors in pancreatic cancer">${escapeHtml(initialQuery)}</textarea><span class="field-help">English topics produce the most reliable scholarly search results in the current MVP.</span></div>
          <div class="inline-fields"><div class="field"><label for="start-year">Start year</label><input class="input" id="start-year" name="startYear" type="number" min="1900" max="2026" placeholder="2006" /></div><div class="field"><label for="end-year">End year</label><input class="input" id="end-year" name="endYear" type="number" min="1900" max="2026" value="2026" /></div></div>
          <div class="field"><label for="cancer-type">Cancer type <span style="color:var(--faint);font-weight:400">(optional)</span></label><input class="input" id="cancer-type" name="cancerType" placeholder="Pancreatic cancer" /></div>
          <div class="field"><label>Viewing angle</label><div class="angle-picker"><label><input type="radio" name="angle" value="mechanism"><span>Mechanism</span></label><label><input type="radio" name="angle" value="translation"><span>Translation</span></label><label><input type="radio" name="angle" value="controversy"><span>Controversy</span></label><label><input type="radio" name="angle" value="all" checked><span>All</span></label></div></div>
          <div class="inline-fields"><div class="field"><label for="max-works">Maximum works</label><select class="select" id="max-works" name="maxWorks"><option>100</option><option selected>200</option><option>300</option><option>500</option></select></div><div class="field"><label for="exclude">Exclude terms</label><input class="input" id="exclude" name="exclude" placeholder="review, protocol" /></div></div>
          <div class="callout">Do not enter patient-identifiable or confidential information. The public MVP is designed for research topics, not patient-level analysis.</div>
          <div class="form-actions"><button class="button primary" type="submit">Preview query ${icons.arrow}</button><a class="button ghost" href="/replay/kras-g12d" data-nav>Use the built-in example</a></div>
        </form>
        <aside class="preview-card" id="query-preview"><div class="preview-empty"><div><div class="orb"></div><strong>Query preview</strong><p>Entity suggestions, coverage, and sample works will appear here.</p></div></div></aside>
      </section>
    </main>${footer()}</div>`;
  bindCommonNavigation();
  const form = document.querySelector('#create-form');
  form?.addEventListener('submit', handleQueryPreview);
  if (initialQuery) setTimeout(() => form?.requestSubmit(), 180);
}

async function handleQueryPreview(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  const preview = document.querySelector('#query-preview');
  preview.innerHTML = `<div class="preview-loading"><span class="eyebrow">Query preview</span><h3 style="font-size:24px;margin:20px 0">Checking the research boundary</h3>${pipelineMarkup(0)}</div>`;
  let active = 0;
  const interval = setInterval(() => {
    active = Math.min(3, active + 1);
    const loading = preview.querySelector('.preview-loading');
    if (loading) loading.innerHTML = `<span class="eyebrow">Query preview</span><h3 style="font-size:24px;margin:20px 0">Checking the research boundary</h3>${pipelineMarkup(active)}`;
  }, 320);
  try {
    const response = await fetch('/api/query/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        topic: data.topic,
        startYear: data.startYear ? Number(data.startYear) : undefined,
        endYear: data.endYear ? Number(data.endYear) : undefined,
        cancerType: data.cancerType || undefined,
        angle: data.angle,
        maxWorks: Number(data.maxWorks || 200),
        exclude: data.exclude || undefined,
      }),
    });
    if (!response.ok) throw new Error('Preview service unavailable');
    const result = await response.json();
    clearInterval(interval);
    renderPreviewResult(preview, result, data.topic);
  } catch {
    clearInterval(interval);
    const fallback = mockPreview(String(data.topic));
    renderPreviewResult(preview, fallback, data.topic);
  }
}

function pipelineMarkup(active) {
  const steps = ['Normalize topic', 'Identify entities and synonyms', 'Sample scholarly records', 'Estimate date coverage'];
  return steps.map((step, index) => `<div class="pipeline-step ${index < active ? 'done' : index === active ? 'active' : ''}"><span class="pipeline-dot"></span><span>${step}</span></div>`).join('');
}

function mockPreview(topic) {
  const words = topic.split(/\s+/).filter((word) => word.length > 2).slice(0, 5);
  return {
    source: 'local-demonstration',
    normalizedQuery: topic.trim(),
    entities: words.map((word, index) => ({ label: word.replace(/[.,]/g, ''), type: index === 0 ? 'topic' : 'term' })),
    synonyms: ['allele-specific inhibition', 'targeted therapy', 'tumor signaling'],
    estimatedCount: 184,
    earliestYear: 2008,
    latestYear: 2026,
    samples: [
      { title: 'Illustrative sample: early mechanism study', year: 2012, source: 'OpenAlex preview placeholder' },
      { title: 'Illustrative sample: structure-guided drug discovery', year: 2022, source: 'OpenAlex preview placeholder' },
      { title: 'Illustrative sample: translational biomarker report', year: 2025, source: 'OpenAlex preview placeholder' },
    ],
  };
}

function renderPreviewResult(container, result, topic) {
  const isDemo = result.source !== 'openalex';
  container.innerHTML = `<div class="preview-result"><span class="eyebrow">Query preview</span><h3>${escapeHtml(result.normalizedQuery || topic)}</h3>${isDemo ? '<div class="demo-banner" style="margin:0 0 18px">Local demonstration data is shown because the OpenAlex Worker integration is not configured or reachable.</div>' : '<div class="tag" style="display:inline-flex;margin-bottom:15px">Live OpenAlex preview</div>'}<div class="tag-row">${(result.entities || []).map((entity) => `<span class="tag">${escapeHtml(entity.label)} · ${escapeHtml(entity.type || 'entity')}</span>`).join('')}</div><h4 style="font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:var(--faint);margin:24px 0 10px">Suggested synonyms</h4><div class="tag-row">${(result.synonyms || []).map((value) => `<span class="tag">${escapeHtml(value)}</span>`).join('')}</div><div class="preview-metrics"><div class="metric-box"><strong>${escapeHtml(result.estimatedCount ?? '—')}</strong><span>Estimated hits</span></div><div class="metric-box"><strong>${escapeHtml(result.earliestYear ?? '—')}</strong><span>Earliest year</span></div><div class="metric-box"><strong>${escapeHtml(result.latestYear ?? '—')}</strong><span>Latest year</span></div></div><h4 style="font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:var(--faint);margin:24px 0 10px">Sample works</h4><div class="sample-list">${(result.samples || []).map((sample) => `<div class="sample-item"><div class="sample-title">${escapeHtml(sample.title)}</div><div class="sample-meta">${escapeHtml(sample.year || '')} · ${escapeHtml(sample.source || sample.id || '')}</div></div>`).join('')}</div><div class="form-actions" style="margin-top:22px"><button class="button primary" id="generate-placeholder">Build replay</button><button class="button ghost" id="edit-query">Edit query</button></div><p class="field-help" style="margin-top:14px">In this delivered prototype, custom generation is scaffolded but the complete citation-expansion and clustering queue is intentionally not presented as finished.</p></div>`;
  container.querySelector('#generate-placeholder')?.addEventListener('click', () => showToast('Custom generation pipeline is scaffolded. Configure D1, Queue, and Workers AI to continue.'));
  container.querySelector('#edit-query')?.addEventListener('click', () => document.querySelector('#topic')?.focus());
}

async function loadReplay() {
  if (state.replay) return state.replay;
  const response = await fetch('/data/kras-g12d.json');
  if (!response.ok) throw new Error('Replay data could not be loaded');
  state.replay = await response.json();
  state.currentYear = state.replay.startYear;
  state.selectedEventId = state.replay.events[0]?.id ?? null;
  return state.replay;
}

async function renderReplay() {
  document.title = 'KRAS G12D replay — OncoReplay';
  cancelPlayback();
  app.innerHTML = `<div class="replay-shell"><div class="empty-state">Loading replay…</div></div>`;
  try {
    const replay = await loadReplay();
    app.innerHTML = replayMarkup(replay);
    bindReplay();
    if (window.innerWidth <= 760 && replay.events[0]) state.currentYear = replay.events[0].year;
    updateReplayUI();
    setTimeout(() => {
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && window.innerWidth > 760) startPlayback();
    }, 650);
  } catch (error) {
    app.innerHTML = `<div class="replay-shell"><div class="empty-state"><h1>Replay unavailable</h1><p>${escapeHtml(error.message)}</p><a class="button" href="/" data-nav>Return home</a></div></div>`;
    bindCommonNavigation();
  }
}

function replayMarkup(replay) {
  return `<div class="replay-shell"><header class="replay-header"><button class="icon-button" id="replay-back" aria-label="Return home">${icons.back}</button><div class="replay-header-title"><strong>${escapeHtml(replay.title)}</strong><span>${replay.startYear}–${replay.endYear} · ${replay.events.length} turning-point events</span></div><div class="replay-actions"><div class="mode-switch" aria-label="Viewing mode"><button data-mode="momentum" class="active">Momentum</button><button data-mode="debate">Debate</button></div><button class="button small" id="share-replay">${icons.share} Share</button></div></header><main id="main" class="replay-main"><section class="replay-stage"><div class="replay-meta"><div><h1>${escapeHtml(replay.title)}</h1><p>${escapeHtml(replay.subtitle)}</p></div><div class="replay-metrics"><div><strong>${replay.works.length}</strong><span>Works</span></div><div><strong>${replay.branches.length}</strong><span>Branches</span></div><div><strong>${replay.events.length}</strong><span>Events</span></div></div></div><div class="demo-banner">${escapeHtml(replay.disclaimer)}</div><div class="viz-wrap"><div class="viz-toolbar"><div class="legend">${replay.branches.map((branch) => `<span class="legend-item"><i class="legend-swatch" style="background:${branchColor[branch.id]}"></i>${escapeHtml(branch.shortLabel || branch.label)}</span>`).join('')}</div><span class="viz-note">Node size = ${state.mode === 'debate' ? 'debate signal' : 'normalized impact'} · shape = work type</span></div><svg id="timeline-svg" role="img" aria-label="Timeline and research branch graph"></svg></div><div class="mobile-story" id="mobile-story">${mobileStoryMarkup(replay)}</div><div class="playback"><div class="play-group"><button class="play-button" id="play-toggle" aria-label="Play replay">${icons.play}</button></div><div class="timeline-control"><div class="year-row"><span class="current-year" id="current-year">${replay.startYear}</span><span class="year-range">${replay.startYear} — ${replay.endYear}</span></div><input class="range" id="year-slider" aria-label="Current year" type="range" min="${replay.startYear}" max="${replay.endYear}" step="0.05" value="${replay.startYear}" /></div><div class="speed-control" aria-label="Playback speed"><button data-speed="0.5">0.5×</button><button data-speed="1" class="active">1×</button><button data-speed="2">2×</button></div></div></section><aside class="narrative-panel"><div class="narrative-head"><span>Director mode</span><h2>Field narrative</h2></div><div class="narrative-body" id="event-list">${eventListMarkup(replay)}</div></aside></main>${drawerMarkup()}</div>`;
}

function eventListMarkup(replay) {
  return replay.events.map((event) => eventCardMarkup(event)).join('');
}

function eventCardMarkup(event) {
  return `<article class="event-card" data-event-id="${event.id}" tabindex="0"><div class="event-top"><span class="event-type">${escapeHtml(event.eventType)}</span><span class="event-year">${event.year}</span></div><h3>${escapeHtml(event.title)}</h3><p>${escapeHtml(event.summary)}</p><div class="event-meta"><span>${event.sourceWorkIds.length} source works</span><span class="confidence"><i style="--confidence:${Math.round(event.confidence * 100)}%"></i>${Math.round(event.confidence * 100)}%</span></div></article>`;
}

function mobileStoryMarkup(replay) {
  return replay.events.map((event) => `<article class="mobile-event" data-mobile-event="${event.id}"><span class="event-type">${escapeHtml(event.eventType)}</span><span class="event-year" style="float:right">${event.year}</span><h3>${escapeHtml(event.title)}</h3><p>${escapeHtml(event.summary)}</p><button class="button small" data-open-event="${event.id}">View evidence</button></article>`).join('');
}

function drawerMarkup() {
  return `<div class="drawer-backdrop" id="drawer-backdrop"></div><aside class="drawer" id="evidence-drawer" aria-hidden="true" aria-labelledby="drawer-title"><div class="drawer-head"><strong id="drawer-title">Evidence</strong><button class="icon-button" id="drawer-close" aria-label="Close evidence drawer">${icons.close}</button></div><div class="drawer-content" id="drawer-content"></div></aside>`;
}

function bindReplay() {
  document.querySelector('#replay-back')?.addEventListener('click', () => navigate('/'));
  document.querySelector('#play-toggle')?.addEventListener('click', () => state.playing ? pausePlayback() : startPlayback());
  document.querySelector('#year-slider')?.addEventListener('input', (event) => {
    state.currentYear = Number(event.target.value);
    pausePlayback();
    updateReplayUI();
  });
  document.querySelectorAll('[data-speed]').forEach((button) => button.addEventListener('click', () => {
    state.speed = Number(button.dataset.speed);
    document.querySelectorAll('[data-speed]').forEach((item) => item.classList.toggle('active', item === button));
  }));
  document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => {
    state.mode = button.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach((item) => item.classList.toggle('active', item === button));
    updateReplayUI(true);
  }));
  document.querySelectorAll('[data-event-id]').forEach((card) => {
    const open = () => selectEvent(card.dataset.eventId, true);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  });
  document.querySelectorAll('[data-open-event]').forEach((button) => button.addEventListener('click', () => selectEvent(button.dataset.openEvent, true)));
  document.querySelector('#drawer-close')?.addEventListener('click', closeDrawer);
  document.querySelector('#drawer-backdrop')?.addEventListener('click', closeDrawer);
  document.querySelector('#share-replay')?.addEventListener('click', shareReplay);
  document.addEventListener('keydown', replayKeyHandler);
  window.addEventListener('resize', handleReplayResize);
}

function handleReplayResize() {
  clearTimeout(state.resizeTimer);
  state.resizeTimer = setTimeout(() => state.replay && renderTimeline(state.replay), 130);
}

function replayKeyHandler(event) {
  if (!state.replay || document.body.classList.contains('drawer-open')) {
    if (event.key === 'Escape') closeDrawer();
    return;
  }
  if (event.key === ' ') { event.preventDefault(); state.playing ? pausePlayback() : startPlayback(); }
  if (event.key === 'ArrowRight') { state.currentYear = clamp(state.currentYear + 1, state.replay.startYear, state.replay.endYear); pausePlayback(); updateReplayUI(); }
  if (event.key === 'ArrowLeft') { state.currentYear = clamp(state.currentYear - 1, state.replay.startYear, state.replay.endYear); pausePlayback(); updateReplayUI(); }
}

function cancelPlayback() {
  state.playing = false;
  state.lastFrame = 0;
  if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
  state.animationFrame = null;
  document.removeEventListener('keydown', replayKeyHandler);
  window.removeEventListener('resize', handleReplayResize);
}

function startPlayback() {
  if (!state.replay) return;
  if (state.currentYear >= state.replay.endYear) state.currentYear = state.replay.startYear;
  state.playing = true;
  state.lastFrame = performance.now();
  updatePlayButton();
  state.animationFrame = requestAnimationFrame(playbackFrame);
}

function pausePlayback() {
  state.playing = false;
  if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
  state.animationFrame = null;
  updatePlayButton();
}

function playbackFrame(timestamp) {
  if (!state.playing || !state.replay) return;
  const elapsed = timestamp - state.lastFrame;
  state.lastFrame = timestamp;
  const next = playbackStep(state.currentYear, state.replay.startYear, state.replay.endYear, elapsed, state.speed);
  state.currentYear = next.year;
  updateReplayUI();
  if (next.finished) pausePlayback();
  else state.animationFrame = requestAnimationFrame(playbackFrame);
}

function updatePlayButton() {
  const button = document.querySelector('#play-toggle');
  if (!button) return;
  button.innerHTML = state.playing ? icons.pause : icons.play;
  button.setAttribute('aria-label', state.playing ? 'Pause replay' : 'Play replay');
}

function updateReplayUI(forceRender = false) {
  const replay = state.replay;
  if (!replay) return;
  const roundedYear = Math.floor(state.currentYear);
  const slider = document.querySelector('#year-slider');
  const yearLabel = document.querySelector('#current-year');
  if (slider) {
    slider.value = String(state.currentYear);
    slider.style.setProperty('--progress', `${yearProgress(state.currentYear, replay.startYear, replay.endYear)}%`);
  }
  if (yearLabel) yearLabel.textContent = String(roundedYear);
  const activeEvent = currentEvent(replay.events, state.currentYear);
  if (activeEvent) state.selectedEventId = activeEvent.id;
  document.querySelectorAll('.event-card').forEach((card) => {
    const event = replay.events.find((item) => item.id === card.dataset.eventId);
    card.classList.toggle('future', event.year > state.currentYear);
    card.classList.toggle('active', event.id === state.selectedEventId);
  });
  document.querySelectorAll('.mobile-event').forEach((card) => {
    const event = replay.events.find((item) => item.id === card.dataset.mobileEvent);
    card.classList.toggle('visible', event.year <= state.currentYear);
    card.classList.toggle('current', event.id === state.selectedEventId);
  });
  renderTimeline(replay, forceRender);
}

function renderTimeline(replay) {
  const svg = document.querySelector('#timeline-svg');
  if (!svg || svg.clientWidth === 0) return;
  const width = Math.max(740, svg.clientWidth);
  const height = Math.max(480, svg.clientHeight || 480);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const margin = { left: 135, right: 40, top: 70, bottom: 54 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const x = (year) => margin.left + ((year - replay.startYear) / (replay.endYear - replay.startYear)) * plotW;
  const branchGap = plotH / replay.branches.length;
  const y = (branchId) => margin.top + branchGap * (replay.branches.findIndex((b) => b.id === branchId) + 0.5);
  const workMap = new Map(replay.works.map((work) => [work.id, work]));
  const years = [];
  for (let year = replay.startYear; year <= replay.endYear; year += 2) years.push(year);
  const axis = `<line class="axis-line" x1="${margin.left}" y1="${height-margin.bottom}" x2="${width-margin.right}" y2="${height-margin.bottom}"/>${years.map((year) => `<line class="axis-tick" x1="${x(year)}" y1="${height-margin.bottom-5}" x2="${x(year)}" y2="${height-margin.bottom+5}"/><text class="axis-label" x="${x(year)}" y="${height-margin.bottom+22}" text-anchor="middle">${year}</text>`).join('')}`;
  const guides = replay.branches.map((branch) => `<line class="branch-guide" x1="${margin.left}" y1="${y(branch.id)}" x2="${width-margin.right}" y2="${y(branch.id)}"/><text class="branch-label" x="${margin.left-18}" y="${y(branch.id)+4}" text-anchor="end">${escapeHtml(branch.shortLabel || branch.label)}</text>`).join('');
  const edges = replay.edges.map((edge) => {
    const source = workMap.get(edge.source); const target = workMap.get(edge.target);
    if (!source || !target) return '';
    const visible = source.publicationYear <= state.currentYear && target.publicationYear <= state.currentYear;
    const x1=x(source.publicationYear),y1=y(source.branchId),x2=x(target.publicationYear),y2=y(target.branchId);
    const cx=(x1+x2)/2;
    return `<path class="citation-edge ${edge.type === 'bridges' ? 'bridge' : ''}" style="opacity:${visible ? (state.mode === 'debate' && edge.type !== 'bridges' ? .25 : 1) : 0}" d="M${x1} ${y1} C${cx} ${y1},${cx} ${y2},${x2} ${y2}"/>`;
  }).join('');
  const nodes = replay.works.map((work, index) => {
    const offset = ((index % 5) - 2) * 8;
    const px=x(work.publicationYear), py=y(work.branchId)+offset;
    const size=nodeWeight(work,state.mode);
    const future = work.publicationYear > state.currentYear;
    const signal = state.mode === 'debate' ? work.debateSignal : work.normalizedImpact;
    const dimmed = state.mode === 'debate' ? signal < .55 : signal < .45;
    const color=branchColor[work.branchId] || '#eef6f4';
    const shape = nodeShape(work.workType, px, py, size, color);
    return `<g class="work-node ${future ? 'hidden-future' : ''} ${dimmed ? 'dimmed' : ''}" data-work-id="${work.id}" style="opacity:${future ? .03 : nodeOpacity(work,state.mode)}"><title>${escapeHtml(work.title)}</title>${shape}${work.updateStatus ? `<path d="M${px+size*.55} ${py-size*.7}h5l-2.5 4.5Z" fill="#ff776e"/>` : ''}</g>`;
  }).join('');
  const eventMarkers = replay.events.map((event) => {
    const px=x(event.year); const visible=event.year<=state.currentYear; const color=event.eventType==='correction'?'#ff776e': event.eventType==='challenge'?'#f1b96c':'#70e2d1';
    return `<g class="event-marker" data-svg-event="${event.id}" style="opacity:${visible ? 1 : .13}"><line x1="${px}" y1="${margin.top-10}" x2="${px}" y2="${height-margin.bottom}" stroke="${color}"/><circle cx="${px}" cy="${margin.top-22}" r="4" fill="${color}"/>${event.id===state.selectedEventId && visible ? `<circle class="event-ring" cx="${px}" cy="${margin.top-22}" r="9" stroke="${color}"/>` : ''}${event.id === state.selectedEventId ? `<text x="${px+7}" y="${margin.top-18}">${escapeHtml(event.eventType)}</text>` : ''}</g>`;
  }).join('');
  const playX=x(state.currentYear);
  const playhead=`<line class="playhead" x1="${playX}" y1="${margin.top-40}" x2="${playX}" y2="${height-margin.bottom}"/><circle class="playhead-dot" cx="${playX}" cy="${height-margin.bottom}" r="3"/>`;
  svg.innerHTML = `${guides}${axis}${edges}${eventMarkers}${nodes}${playhead}`;
  svg.querySelectorAll('[data-work-id]').forEach((node) => node.addEventListener('click', () => openWorkDrawer(node.dataset.workId)));
  svg.querySelectorAll('[data-svg-event]').forEach((marker) => marker.addEventListener('click', () => selectEvent(marker.dataset.svgEvent, true)));
}

function nodeShape(type, x, y, size, color) {
  if (type === 'clinical') return `<rect x="${x-size}" y="${y-size*.68}" width="${size*2}" height="${size*1.36}" rx="${size*.45}" fill="${color}"/>`;
  if (type === 'review') return `<path d="M${x} ${y-size} L${x+size} ${y} L${x} ${y+size} L${x-size} ${y}Z" fill="${color}"/>`;
  if (type === 'resource') {
    const points = Array.from({length:6},(_,i)=>{const a=Math.PI/3*i-Math.PI/2;return `${x+Math.cos(a)*size},${y+Math.sin(a)*size}`}).join(' ');
    return `<polygon points="${points}" fill="${color}"/>`;
  }
  return `<circle cx="${x}" cy="${y}" r="${size}" fill="${color}"/>`;
}

function selectEvent(eventId, open = false) {
  const event = state.replay.events.find((item) => item.id === eventId);
  if (!event) return;
  state.selectedEventId = event.id;
  state.currentYear = event.year;
  pausePlayback();
  updateReplayUI();
  if (open) openEventDrawer(event.id);
}

function openEventDrawer(eventId) {
  const event = state.replay.events.find((item) => item.id === eventId);
  if (!event) return;
  const works = event.sourceWorkIds.map((id) => state.replay.works.find((work) => work.id === id)).filter(Boolean);
  openDrawer(`<span class="drawer-kicker">${escapeHtml(event.eventType)} · ${event.year}</span><h2>${escapeHtml(event.title)}</h2><span class="machine-badge">Machine-organized narrative</span><p class="drawer-summary">${escapeHtml(event.summary)}</p><section class="evidence-section"><h3>Why this event was selected</h3><p class="drawer-summary">${escapeHtml(event.selectionReason)}</p><div class="key-value"><span>Confidence</span><span>${Math.round(event.confidence*100)}%</span></div><div class="key-value"><span>Human review</span><span>${event.requiresReview ? 'Required before publication' : 'Recommended'}</span></div></section><section class="evidence-section"><h3>Source-bound works</h3><div class="evidence-list">${works.map(workEvidenceMarkup).join('')}</div></section>`);
}

function openWorkDrawer(workId) {
  const work = state.replay.works.find((item) => item.id === workId);
  if (!work) return;
  state.selectedWorkId = workId;
  openDrawer(`<span class="drawer-kicker">${escapeHtml(work.workType)} · ${work.publicationYear}</span><h2>${escapeHtml(work.title)}</h2><div class="demo-banner" style="margin:0 0 18px">Illustrative evidence record. Do not cite this prototype entry.</div><p class="drawer-summary">${escapeHtml(work.abstract)}</p><section class="evidence-section"><h3>Structured fields</h3><div class="key-value"><span>OpenAlex ID</span><span>${escapeHtml(work.openalexId)}</span></div><div class="key-value"><span>Publication date</span><span>${escapeHtml(work.publicationDate)}</span></div><div class="key-value"><span>Source</span><span>${escapeHtml(work.sourceName)}</span></div><div class="key-value"><span>Authors</span><span>${escapeHtml(work.authors.join(', '))}</span></div><div class="key-value"><span>DOI</span><span>${escapeHtml(work.doi)}</span></div><div class="key-value"><span>Cited by</span><span>${escapeHtml(work.citedByCount)}</span></div><div class="key-value"><span>Update status</span><span>${work.updateStatus ? escapeHtml(work.updateStatus.label) : 'No structured update in demo data'}</span></div></section><section class="evidence-section"><h3>Data status</h3><p class="drawer-summary">In production, identifiers, dates, citation relationships, and update status must come from structured sources. AI is not allowed to overwrite them.</p></section>`);
}

function workEvidenceMarkup(work) {
  return `<button class="evidence-work" data-drawer-work="${work.id}" style="text-align:left;color:inherit;background:transparent;cursor:pointer"><strong>${escapeHtml(work.title)}</strong><small>${work.publicationYear} · ${escapeHtml(work.sourceName)} · ${escapeHtml(work.openalexId)}</small></button>`;
}

function openDrawer(content) {
  const drawer = document.querySelector('#evidence-drawer');
  const backdrop = document.querySelector('#drawer-backdrop');
  const body = document.querySelector('#drawer-content');
  if (!drawer || !backdrop || !body) return;
  body.innerHTML = content;
  drawer.classList.add('open'); backdrop.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false'); document.body.classList.add('drawer-open');
  body.querySelectorAll('[data-drawer-work]').forEach((button) => button.addEventListener('click', () => openWorkDrawer(button.dataset.drawerWork)));
  setTimeout(() => document.querySelector('#drawer-close')?.focus(), 50);
}

function closeDrawer() {
  const drawer = document.querySelector('#evidence-drawer');
  const backdrop = document.querySelector('#drawer-backdrop');
  drawer?.classList.remove('open'); backdrop?.classList.remove('open'); drawer?.setAttribute('aria-hidden', 'true'); document.body.classList.remove('drawer-open');
}

async function shareReplay() {
  const event = state.replay.events.find((item) => item.id === state.selectedEventId);
  const url = new URL(window.location.href);
  if (event) url.searchParams.set('event', event.id);
  try {
    if (navigator.share) await navigator.share({ title: state.replay.title, text: event?.title || state.replay.subtitle, url: url.toString() });
    else { await navigator.clipboard.writeText(url.toString()); showToast('Replay link copied'); }
  } catch (error) {
    if (error?.name !== 'AbortError') showToast('Could not share this link');
  }
}

function renderExplore() {
  document.title = 'Explore — OncoReplay';
  app.innerHTML = `<div class="shell">${siteHeader()}<main id="main"><section class="page-hero"><div class="container"><span class="eyebrow">Explore</span><h1>Curated research stories.</h1><p>The public MVP publishes only precomputed replays that have been manually checked. Community publishing, rankings, and social features are intentionally out of scope.</p></div></section><section class="section" style="padding-top:20px"><div class="container"><div class="cards">${exampleCard('KRAS G12D inhibitors','2006–2026','40','12','A complete interaction prototype with four branches and evidence drawers.','/replay/kras-g12d')}${exampleCard('HER2-low breast cancer','Coming next','—','—','A future curated replay for concept formation and clinical translation.','/create?query=HER2-low%20breast%20cancer')}${exampleCard('Ferroptosis in cancer therapy','Coming next','—','—','A future replay focused on discovery, branch expansion, and debate.','/create?query=ferroptosis%20in%20cancer%20therapy')}</div></div></section></main>${footer()}</div>`;
  bindCommonNavigation();
}

function renderMethodology() {
  document.title = 'Methodology — OncoReplay';
  app.innerHTML = `<div class="shell">${siteHeader()}<main id="main"><section class="page-hero"><div class="container"><span class="eyebrow">Methodology</span><h1>Story first. Evidence always reachable.</h1><p>This page separates structured source facts, rule-based analysis, and machine-generated language so users can see what the interface knows, infers, and cannot establish.</p></div></section><div class="container content-grid"><nav class="toc" aria-label="Methodology sections"><a href="#sources">Data sources</a><a href="#timeline">Timeline method</a><a href="#ai">AI boundary</a><a href="#uncertainty">Uncertainty</a><a href="#limits">Known limits</a></nav><article class="prose"><section id="sources"><h2>Data sources</h2><p>OpenAlex is designed as the main graph source for work metadata, dates, authorship, topics, references, and annual citation counts. Europe PMC can enrich biomedical abstracts and identifiers. Crossref can provide DOI metadata and structured update relationships.</p><table class="data-table"><thead><tr><th>Source</th><th>Primary role</th><th>Not treated as</th></tr></thead><tbody><tr><td>OpenAlex</td><td>Citation graph and scholarly metadata</td><td>A complete or quality-ranked literature universe</td></tr><tr><td>Europe PMC</td><td>Biomedical abstracts and identifier alignment</td><td>A source of automatic clinical conclusions</td></tr><tr><td>Crossref</td><td>DOI metadata and update relationships</td><td>Permission to infer misconduct</td></tr></tbody></table></section><section id="timeline"><h2>Timeline reconstruction</h2><p>The intended scoring model combines text relevance, entity overlap, topic consistency, network proximity, normalized citation growth, graph bridges, branch formation, revival signals, and structured update status. Citation totals are never presented as a direct measure of scientific quality.</p><div class="callout">Event labels such as Birth, Breakthrough, Branching, Revival, Challenge, Translation, and Correction are product narrative labels. They do not establish scientific truth.</div><h3>Branching</h3><p>The MVP can combine source topics, title and abstract features, co-citation, and bibliographic coupling. A graph clustering algorithm proposes 3–6 readable branches; AI may name the clusters only from their member works.</p></section><section id="ai"><h2>AI boundary</h2><p>AI may suggest synonyms, name clusters, write short event narratives, summarize branches, and organize unresolved questions. Every output must use a strict schema and cite only work IDs supplied in its input.</p><ul><li>AI cannot invent DOI, PMID, PMCID, or OpenAlex IDs.</li><li>AI cannot change publication dates, citation relationships, or structured correction status.</li><li>AI cannot declare a scientific consensus, prove causality, or independently rank scientific quality.</li></ul></section><section id="uncertainty"><h2>Uncertainty as interface</h2><p>Structured facts use stable shapes and solid lines. Machine-organized language uses a visible badge and may use dashed visual treatment. Challenge candidates require review. Missing abstract or update checks must remain visible rather than being silently filled.</p></section><section id="limits"><h2>Known limitations</h2><p>OncoReplay is not a systematic review, clinical decision support system, truth arbiter, or paper generator. Database coverage is incomplete, citation counts depend on the source, topic clustering may be unstable, and a visually persuasive story can still omit relevant work. The fixed KRAS G12D dataset in this delivered prototype is illustrative and cannot be cited.</p></section></article></div></main>${footer()}</div>`;
  bindCommonNavigation();
}

function renderAbout() {
  document.title = 'About — OncoReplay';
  app.innerHTML = `<div class="shell">${siteHeader()}<main id="main"><section class="page-hero"><div class="container"><span class="eyebrow">About the project</span><h1>A visual narrative interface for research evolution.</h1><p>OncoReplay is designed for researchers, journal clubs, educators, and scientific communicators who need a fast, inspectable way to understand how a topic appeared, expanded, divided, encountered challenges, and approached translation.</p></div></section><section class="section" style="padding-top:20px"><div class="container"><div class="steps"><article class="step"><span class="step-index">Product boundary</span><h3>Not a complete review.</h3><p>It helps orient a user and expose source paths. It does not promise exhaustive retrieval or replace systematic review methods.</p></article><article class="step"><span class="step-index">Scientific boundary</span><h3>Not a truth machine.</h3><p>It visualizes patterns in retrieved data and flags candidates for inspection without claiming consensus or causal proof.</p></article><article class="step"><span class="step-index">Clinical boundary</span><h3>Not medical advice.</h3><p>It does not provide patient-level recommendations, treatment selection, or clinical decision support.</p></article></div></div></section></main>${footer()}</div>`;
  bindCommonNavigation();
}

function bindCommonNavigation() {
  document.querySelectorAll('[data-nav]').forEach((link) => link.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(link.getAttribute('href'));
  }));
}

function showToast(message) {
  const root = document.querySelector('#toast-root');
  if (!root) return;
  root.innerHTML = `<div class="toast">${escapeHtml(message)}</div>`;
  requestAnimationFrame(() => root.firstElementChild?.classList.add('show'));
  setTimeout(() => root.firstElementChild?.classList.remove('show'), 2200);
}

function renderNotFound() {
  document.title = 'Page not found — OncoReplay';
  app.innerHTML = `<div class="shell">${siteHeader()}<main id="main"><div class="empty-state"><span class="eyebrow">404</span><h1>That part of the timeline is missing.</h1><p>The requested page is not available in this prototype.</p><a class="button primary" href="/" data-nav>Return home</a></div></main>${footer()}</div>`;
  bindCommonNavigation();
}

function renderRoute() {
  cancelPlayback();
  closeDrawer();
  const path = routePath();
  if (path === '/') renderHome();
  else if (path === '/create') renderCreate();
  else if (path === '/explore') renderExplore();
  else if (path === '/methodology') renderMethodology();
  else if (path === '/about') renderAbout();
  else if (path === '/replay/kras-g12d') renderReplay();
  else renderNotFound();
}

window.addEventListener('popstate', renderRoute);
renderRoute();
