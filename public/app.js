import {
  clamp,
  currentEvent,
  escapeHtml,
  nodeOpacity,
  nodeWeight,
  playbackStep,
  yearProgress,
} from './core.mjs';

const app = document.querySelector('#app');
const state = {
  replay: null,
  replaySlug: null,
  currentYear: 2006,
  playing: false,
  speed: 1,
  mode: 'momentum',
  selectedEventId: null,
  selectedWorkId: null,
  animationFrame: null,
  lastFrame: 0,
  resizeTimer: null,
  statusTimer: null,
  locale: localStorage.getItem('oncoreplay-locale') === 'en' ? 'en' : 'zh',
  pendingCreateData: null,
};

document.documentElement.lang = state.locale === 'zh' ? 'zh-CN' : 'en';

const L = (zh, en) => state.locale === 'zh' ? zh : en;
const icons = {
  arrow: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  play: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18"><path d="M5.7 3.7v10.6L14 9 5.7 3.7Z" fill="currentColor"/></svg>',
  pause: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18"><path d="M5 4h3v10H5V4Zm5 0h3v10h-3V4Z" fill="currentColor"/></svg>',
  close: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="m4 4 10 10M14 4 4 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  back: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M14 9H4m4-4L4 9l4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  share: '<svg aria-hidden="true" width="17" height="17" viewBox="0 0 18 18" fill="none"><circle cx="13.5" cy="4.5" r="2" stroke="currentColor"/><circle cx="4.5" cy="9" r="2" stroke="currentColor"/><circle cx="13.5" cy="13.5" r="2" stroke="currentColor"/><path d="m6.3 8.1 5.4-2.7M6.3 9.9l5.4 2.7" stroke="currentColor"/></svg>',
};

const palette = ['#70e2d1','#a6a0ff','#f1b96c','#8fdaa7','#ef8daa','#78aef0'];
const fixedBranchColors = { mechanism: palette[0], chemistry: palette[1], resistance: palette[2], translation: palette[3] };

const builtinTranslations = {
  branches: {
    mechanism: ['分子机制','结构生物学、信号依赖与等位基因特异性脆弱点。'],
    chemistry: ['药物发现','化合物设计、选择性、递送与药理学。'],
    resistance: ['耐药与联合策略','适应性信号、获得性耐药与联合治疗策略。'],
    translation: ['临床转化','生物标志物、试验、患者筛选与转化证据。'],
  },
  events: {
    'event-01': ['G12D 研究簇开始成形','早期机制研究开始把等位基因特异性信号与胰腺癌模型联系起来。研究簇仍然较小，但术语和实验体系逐渐趋于一致。','固定演示数据达到最小论文簇阈值，并出现重复的实体重叠。'],
    'event-02': ['结构线索打开药物发现窗口','机制研究与早期结构假说开始汇合。这里被标记为一个研究窗口，而不是“该靶点已经可成药”的证明。','机制节点开始桥接到第一批药物发现记录。'],
    'event-03': ['研究分为机制与干预两条轨道','一条分支继续描绘信号背景，另一条强调化学可行性。两条轨道仍有联系，但方法和发表场景逐渐不同。','图社区开始分离，同时保留若干跨分支引用。'],
    'event-04': ['适应性信号使故事变得复杂','联合筛选和反馈研究提示，通路抑制可能触发补偿反应。该节点是机器检测的挑战候选，不是已经确定的反例。','新形成的耐药研究簇出现较高争议信号。'],
    'event-05': ['结构指导的化学研究明显升温','药物发现记录变得更密集，也与早期机制工作连接得更紧。引用增长发生在多个相关节点，而非单篇论文。','引用增长和跨分支连接同时上升。'],
    'event-06': ['早期通路研究重新回到中心','当联合策略需要解释反馈和逃逸时，较早的机制研究重新受到关注。','旧节点从新的耐药研究中获得了异常多的后续连接。'],
    'event-07': ['临床转化成为独立可见轨道','早期临床活动与持续的临床前优化并行出现。界面将两者分开，以避免暗示临床测试已经解决机制不确定性。','临床类型记录形成持续分支，并出现靶点占有等语言。'],
    'event-08': ['多个项目并行加速','机制、化学和转化分支在短时间内同时加入高影响节点，形成领域级加速，而不是单线突破。','多个分支的论文密度和影响力同时增长。'],
    'event-09': ['联合策略分化出多种逃逸路径','耐药研究进一步分成通路再激活、谱系特异旁路和免疫环境假说等方向；这些分支可能在真实数据中相互重叠。','耐药节点形成桥接模式不同的子社区。'],
    'event-10': ['剂量与安全性约束重塑预期','转化记录引入了单看药效无法发现的现实约束。该节点提示实验室动量与临床可行性可能并不同步。','带有限制性语言的临床节点上升，而化学影响仍然较高。'],
    'event-11': ['来源更新进入时间线','一条记录带有结构化更正核查标记。生产环境中，该事件必须来自 Crossref 或其他结构化来源并直接链接。','演示记录中存在结构化更新状态。'],
    'event-12': ['研究进入拥挤但未解决的当下','多个临床项目、生物标志物方向和耐药假说并存。当前视图强调开放问题，而不是宣布赢家或科学共识。','四条分支仍然活跃，没有单一分支主导全部指标。'],
  },
};

function routePath() { return window.location.pathname.replace(/\/+$/, '') || '/'; }
function replaySlugFromPath(path = routePath()) { return path.match(/^\/replay\/([a-z0-9-]+)$/)?.[1] || null; }

function navigate(path) {
  window.history.pushState({}, '', path);
  renderRoute();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function switchLocale() {
  state.locale = state.locale === 'zh' ? 'en' : 'zh';
  localStorage.setItem('oncoreplay-locale', state.locale);
  document.documentElement.lang = state.locale === 'zh' ? 'zh-CN' : 'en';
  renderRoute();
}

function siteHeader() {
  return `<header class="site-header"><div class="container nav">
    <a class="brand" href="/" data-nav><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span>OncoReplay</span><span class="brand-tag">${L('肿瘤研究时光机','A research time machine')}</span></a>
    <nav class="nav-links" aria-label="${L('主导航','Primary navigation')}">
      <a class="nav-link" href="/explore" data-nav>${L('探索','Explore')}</a>
      <a class="nav-link" href="/methodology" data-nav>${L('方法','Methodology')}</a>
      <a class="nav-link" href="/about" data-nav>${L('关于','About')}</a>
      <button class="button small ghost" type="button" data-locale>${state.locale === 'zh' ? 'EN' : '中文'}</button>
      <a class="button primary nav-cta" href="/create" data-nav>${L('创建回放','Create replay')}</a>
    </nav>
  </div></header>`;
}

function footer() {
  return `<footer class="site-footer"><div class="container footer-inner">
    <div class="footer-note"><strong style="color:var(--text)">OncoReplay</strong><br />${L('科研探索与传播工具。它不提供医疗建议、临床推荐，也不等同于完整系统综述。','A research exploration and communication tool. It does not provide medical advice, clinical recommendations, or a complete systematic review.')}</div>
    <div class="footer-links"><a href="/methodology" data-nav>${L('方法','Methodology')}</a><a href="/about" data-nav>${L('局限','Limitations')}</a><a href="https://github.com/heyhey-yoyo/oncoreplay" target="_blank" rel="noreferrer">GitHub</a></div>
  </div></footer>`;
}

function heroNetwork() {
  const nodes = [[80,370,7,palette[0]],[145,310,5,palette[0]],[210,330,9,palette[1]],[290,245,6,palette[0]],[350,285,11,palette[2]],[430,205,6,palette[1]],[500,250,8,palette[0]],[565,165,5,palette[3]],[640,210,12,palette[1]],[725,120,7,palette[2]],[790,180,6,palette[3]],[860,96,10,palette[0]],[930,155,7,palette[1]],[1000,72,5,palette[3]],[1080,130,9,palette[2]],[1160,56,6,palette[0]]];
  const lines = nodes.slice(1).map((node,index) => { const prev=nodes[index]; return `<path class="hero-flow" d="M${prev[0]} ${prev[1]} C${prev[0]+38} ${prev[1]-20},${node[0]-42} ${node[1]+20},${node[0]} ${node[1]}" fill="none" stroke="rgba(194,225,219,.18)" stroke-width="1"/>`; }).join('');
  const circles = nodes.map((n) => `<circle class="hero-node" cx="${n[0]}" cy="${n[1]}" r="${n[2]}" fill="${n[3]}" opacity=".8"/>`).join('');
  return `<div class="hero-network" aria-hidden="true"><svg viewBox="0 0 1240 520" preserveAspectRatio="xMidYMid slice"><path d="M30 430C200 360 250 420 390 300S650 260 780 150s240 30 420-140" fill="none" stroke="rgba(112,226,209,.07)" stroke-width="90"/>${lines}${circles}</svg></div>`;
}

function renderHome() {
  document.title = L('OncoReplay — 肿瘤研究时光机','OncoReplay — Watch a cancer research idea evolve');
  app.innerHTML = `<div class="shell">${siteHeader()}<main id="main">
    <section class="hero">${heroNetwork()}<div class="container hero-content">
      <h1 class="display">${L('看一个肿瘤研究想法如何','Watch a cancer research idea')} <em>${L('演化。','evolve.')}</em></h1>
      <p class="lede">${L('把论文、引用、争议和临床转化串成一条互动时间线，随时暂停、点开核查、转发分享。','Turn papers, citations, controversies, and clinical translation into an interactive timeline you can pause, inspect, and share.')}</p>
      <form class="search-panel" id="home-search"><input id="home-query" name="query" autocomplete="off" aria-label="${L('研究主题','Research topic')}" placeholder='${L('试试“YAP1 与 EGFR-TKI 耐药”','Try “YAP1 and EGFR-TKI resistance”')}' /><button class="button primary" type="submit">${L('生成回放','Generate replay')} ${icons.arrow}</button></form>
      <div class="search-note">${L('请勿输入可识别患者身份或其他机密信息','No patient-identifiable or confidential information')}</div>
      <div class="hero-actions"><a class="button accent" href="/replay/kras-g12d" data-nav>${L('观看 KRAS G12D 示例','Watch the KRAS G12D example')}</a><a class="button ghost" href="/methodology" data-nav>${L('证据如何处理','How evidence is handled')}</a></div>
      <p class="hero-note">${L('科研探索与传播工具，不提供医疗建议或临床推荐，也不等同于完整系统综述。','A research exploration and communication tool — not medical advice, clinical recommendations, or a complete systematic review.')}</p>
    </div></section>
  </main></div>`;
  bindCommonNavigation();
  document.querySelector('#home-search')?.addEventListener('submit', (event) => { event.preventDefault(); const query=document.querySelector('#home-query').value.trim(); navigate(query ? `/create?query=${encodeURIComponent(query)}` : '/create'); });
}

function renderCreate() {
  document.title = L('创建回放 — OncoReplay','Create a replay — OncoReplay');
  const params = new URLSearchParams(window.location.search);
  const initialQuery = params.get('query') || '';
  app.innerHTML = `<div class="shell">${siteHeader()}<main id="main">
    <section class="page-hero"><div class="container"><span class="eyebrow">${L('创建回放','Create replay')}</span><h1>${L('先定义研究边界，再重建领域。','Define the field before reconstructing it.')}</h1><p>${L('生成前先预览主题词、同义词、年份范围和样本文献。自定义回放是真实生成：会实际检索 OpenAlex、Europe PMC 和 Crossref 等学术数据源，再经过多步整理后发布。','Review entities, synonyms, date coverage, and sample works. Custom generation uses OpenAlex, Europe PMC, Crossref, D1, Queues, and Workers AI.')}</p></div></section>
    <section class="container create-grid">
      <form class="form-card form-stack" id="create-form">
        <div class="field"><label for="topic">${L('研究主题','Research topic')}</label><textarea class="textarea" id="topic" name="topic" maxlength="240" required placeholder="KRAS G12D inhibitors in pancreatic cancer">${escapeHtml(initialQuery)}</textarea><span class="field-help">${L('当前版本使用英文主题检索通常更稳定；结果界面和叙事默认为中文。','English topics usually produce more stable scholarly retrieval; the interface can remain bilingual.')}</span></div>
        <div class="inline-fields"><div class="field"><label for="start-year">${L('开始年份','Start year')}</label><input class="input" id="start-year" name="startYear" type="number" min="1900" max="2026" placeholder="2006" /></div><div class="field"><label for="end-year">${L('结束年份','End year')}</label><input class="input" id="end-year" name="endYear" type="number" min="1900" max="2026" value="2026" /></div></div>
        <div class="field"><label for="cancer-type">${L('癌种（可选）','Cancer type (optional)')}</label><input class="input" id="cancer-type" name="cancerType" placeholder="Pancreatic cancer" /></div>
        <div class="field"><label>${L('关注角度','Viewing angle')}</label><div class="angle-picker"><label><input type="radio" name="angle" value="mechanism"><span>${L('机制','Mechanism')}</span></label><label><input type="radio" name="angle" value="translation"><span>${L('转化','Translation')}</span></label><label><input type="radio" name="angle" value="controversy"><span>${L('争议','Controversy')}</span></label><label><input type="radio" name="angle" value="all" checked><span>${L('全部','All')}</span></label></div></div>
        <div class="inline-fields"><div class="field"><label for="max-works">${L('最大论文量','Maximum works')}</label><select class="select" id="max-works" name="maxWorks"><option>100</option><option selected>200</option><option>300</option><option>500</option></select></div><div class="field"><label for="exclude">${L('排除词','Exclude terms')}</label><input class="input" id="exclude" name="exclude" placeholder="review, protocol" /></div></div>
        <div class="callout">${L('请勿输入可识别患者身份或其他机密信息。本工具面向研究主题，不进行患者级分析。','Do not enter patient-identifiable or confidential information. This tool is for research topics, not patient-level analysis.')}</div>
        <div class="form-actions"><button class="button primary" type="submit">${L('预览检索结果','Preview query')} ${icons.arrow}</button><a class="button ghost" href="/replay/kras-g12d" data-nav>${L('使用内置示例','Use the built-in example')}</a></div>
      </form>
      <aside class="preview-card" id="query-preview"><div class="preview-empty"><div><div class="orb"></div><strong>${L('检索预览','Query preview')}</strong><p>${L('主题词建议、年份范围和样本文献会显示在这里。','Entity suggestions, coverage, and sample works will appear here.')}</p></div></div></aside>
    </section>
  </main>${footer()}</div>`;
  bindCommonNavigation();
  const form = document.querySelector('#create-form');
  form?.addEventListener('submit', handleQueryPreview);
  if (initialQuery) setTimeout(() => form?.requestSubmit(), 180);
}

function formPayload(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  return { topic:data.topic, startYear:data.startYear ? Number(data.startYear) : undefined, endYear:data.endYear ? Number(data.endYear) : undefined, cancerType:data.cancerType || undefined, angle:data.angle, maxWorks:Number(data.maxWorks || 200), exclude:data.exclude || undefined, locale:state.locale };
}

async function handleQueryPreview(event) {
  event.preventDefault();
  const payload = formPayload(event.currentTarget);
  state.pendingCreateData = payload;
  const preview = document.querySelector('#query-preview');
  preview.innerHTML = `<div class="preview-loading"><span class="eyebrow">${L('检索预览','Query preview')}</span><h3 style="font-size:24px;margin:20px 0">${L('正在核对研究范围','Checking the research boundary')}</h3>${pipelineMarkup(0)}</div>`;
  let active=0;
  const interval=setInterval(()=>{ active=Math.min(3,active+1); const loading=preview.querySelector('.preview-loading'); if(loading) loading.innerHTML=`<span class="eyebrow">${L('检索预览','Query preview')}</span><h3 style="font-size:24px;margin:20px 0">${L('正在核对研究范围','Checking the research boundary')}</h3>${pipelineMarkup(active)}`; },320);
  try {
    const response=await fetch('/api/query/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    const result=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(result?.error?.message || L('检索预览不可用。','Preview service unavailable.'));
    clearInterval(interval); renderPreviewResult(preview,result,payload);
  } catch(error) {
    clearInterval(interval);
    preview.innerHTML=`<div class="preview-result"><span class="eyebrow">${L('检索失败','Preview failed')}</span><h3>${L('无法连接真实检索服务','Could not reach the live retrieval service')}</h3><div class="demo-banner" style="margin:0 0 18px">${escapeHtml(error.message)}</div><p class="field-help">${L('请检查 OPENALEX_API_KEY、Worker 日志和 /api/health。这里不会再用演示数据冒充真实预览。','Check OPENALEX_API_KEY, Worker logs, and /api/health. Demo data is no longer substituted for a live preview.')}</p><button class="button ghost" id="edit-query">${L('返回修改','Edit query')}</button></div>`;
    preview.querySelector('#edit-query')?.addEventListener('click',()=>document.querySelector('#topic')?.focus());
  }
}

function pipelineMarkup(active) {
  const steps = state.locale === 'zh' ? ['整理主题词','识别关键词和同义词','抽样样本文献','估算年份范围'] : ['Normalize topic','Identify entities and synonyms','Sample scholarly records','Estimate date coverage'];
  return steps.map((step,index)=>`<div class="pipeline-step ${index<active?'done':index===active?'active':''}"><span class="pipeline-dot"></span><span>${step}</span></div>`).join('');
}

function renderPreviewResult(container,result,payload) {
  container.innerHTML=`<div class="preview-result"><span class="eyebrow">${L('真实检索预览','Live query preview')}</span><h3>${escapeHtml(result.normalizedQuery || payload.topic)}</h3><div class="tag" style="display:inline-flex;margin-bottom:15px">OpenAlex</div><div class="tag-row">${(result.entities||[]).map(e=>`<span class="tag">${escapeHtml(e.label)} · ${escapeHtml(e.type||L('实体','entity'))}</span>`).join('')}</div><h4 style="font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:var(--faint);margin:24px 0 10px">${L('建议同义词','Suggested synonyms')}</h4><div class="tag-row">${(result.synonyms||[]).map(v=>`<span class="tag">${escapeHtml(v)}</span>`).join('') || `<span class="field-help">${L('暂无自动同义词建议','No automatic synonym suggestions')}</span>`}</div><div class="preview-metrics"><div class="metric-box"><strong>${escapeHtml(result.estimatedCount??'—')}</strong><span>${L('预计命中','Estimated hits')}</span></div><div class="metric-box"><strong>${escapeHtml(result.earliestYear??'—')}</strong><span>${L('样本最早年份','Sample earliest')}</span></div><div class="metric-box"><strong>${escapeHtml(result.latestYear??'—')}</strong><span>${L('样本最新年份','Sample latest')}</span></div></div><h4 style="font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:var(--faint);margin:24px 0 10px">${L('样本文献','Sample works')}</h4><div class="sample-list">${(result.samples||[]).map(sample=>`<div class="sample-item"><div class="sample-title">${escapeHtml(sample.title)}</div><div class="sample-meta">${escapeHtml(sample.year||'')} · ${escapeHtml(sample.source||sample.id||'')} · ${L('被引','cited')} ${escapeHtml(sample.citedByCount??0)}</div></div>`).join('')}</div><div class="form-actions" style="margin-top:22px"><button class="button primary" id="build-replay">${L('生成完整回放','Build full replay')}</button><button class="button ghost" id="edit-query">${L('修改检索','Edit query')}</button></div><p class="field-help" style="margin-top:14px">${L('生成过程在后台完成：查找论文、补齐摘要、核对更新、梳理脉络，再撰写叙事。','Generation runs citation expansion, enrichment, update checks, scoring, Louvain clustering, and source-bound AI narration asynchronously.')}</p></div>`;
  container.querySelector('#build-replay')?.addEventListener('click',(event)=>createCustomReplay(payload,event.currentTarget));
  container.querySelector('#edit-query')?.addEventListener('click',()=>document.querySelector('#topic')?.focus());
}

async function createCustomReplay(payload,button) {
  button.disabled=true; button.textContent=L('正在创建任务…','Creating job…');
  try {
    const response=await fetch('/api/replays',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...payload,locale:state.locale})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(result?.error?.message || L('无法创建回放。','Could not create replay.'));
    navigate(`/replay/${result.slug}`);
  } catch(error) {
    button.disabled=false; button.textContent=L('生成完整回放','Build full replay'); showToast(error.message);
  }
}

function localizeBuiltinReplay(raw) {
  const replay=structuredClone(raw);
  if(state.locale!=='zh') return replay;
  replay.title='胰腺癌 KRAS G12D 抑制剂';
  replay.subtitle='展示机制、药物发现、耐药与临床转化如何被组织成可回放的研究历史。';
  replay.disclaimer='这是用于展示产品交互的固定演示数据。标题、标识符、指标与事件均为示意内容，不得作为科学引用。';
  replay.branches=replay.branches.map(branch=>{const t=builtinTranslations.branches[branch.id];return t?{...branch,label:t[0],shortLabel:t[0],description:t[1]}:branch;});
  replay.events=replay.events.map(event=>{const t=builtinTranslations.events[event.id];return t?{...event,title:t[0],summary:t[1],selectionReason:t[2]}:event;});
  replay.works=replay.works.map(work=>({...work,abstract:'OncoReplay 交互原型的固定演示记录，用于展示来源绑定事件、证据抽屉和时间线行为；它不是科学引用。'}));
  return replay;
}

async function fetchStatus(slug) {
  const response=await fetch(`/api/replays/${slug}/status`,{cache:'no-store'});
  const result=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(result?.error?.message || L('无法读取生成状态。','Could not read generation status.'));
  return result;
}

async function loadReplay(slug) {
  if(state.replay && state.replaySlug===slug) return state.replay;
  const response=slug==='kras-g12d' ? await fetch('/data/kras-g12d.json') : await fetch(`/api/replays/${slug}`);
  const result=await response.json().catch(()=>({}));
  if(response.status===202) return null;
  if(!response.ok) throw new Error(result?.error?.message || L('回放数据无法加载。','Replay data could not be loaded.'));
  state.replay=slug==='kras-g12d' ? localizeBuiltinReplay(result) : result;
  state.replaySlug=slug;
  state.currentYear=state.replay.startYear;
  const requestedEvent=new URLSearchParams(window.location.search).get('event');
  state.selectedEventId=state.replay.events.find(item=>item.id===requestedEvent)?.id ?? state.replay.events[0]?.id ?? null;
  return state.replay;
}

const stageLabels={
  FETCH_WORKS:['查找论文，并顺着引用关系扩展检索','Finding works and expanding citations'],
  ENRICH_BIOMEDICAL:['补齐摘要，核对更正与撤稿信息','Enriching abstracts and checking updates'],
  BUILD_TIMELINE:['分析重要转折，划分研究方向','Scoring turning points and running Louvain clustering'],
  GENERATE_NARRATIVE:['基于来源证据撰写叙事','Writing schema-validated source-bound narratives'],
  FINALIZE_REPLAY:['整理数据，发布回放','Finalizing the replay'],
};

function stageLabel(stage) { const item=stageLabels[stage]; return item ? L(item[0],item[1]) : L('等待队列处理','Waiting for queue processing'); }

function generationMarkup(slug,status) {
  const keys=Object.keys(stageLabels); const activeIndex=Math.max(0,keys.indexOf(status.stage)); const total=keys.length;
  const current=Math.min(total,Math.max(0,Number(status.progressCurrent||activeIndex))); const pct=Math.max(6,Math.min(96,((activeIndex+0.35)/total)*100));
  const failed=status.status==='failed';
  return `<div class="shell">${siteHeader()}<main id="main"><section class="page-hero"><div class="container"><span class="eyebrow">${failed?L('生成失败','Generation failed'):L('正在生成回放','Building replay')}</span><h1>${failed?L('生成过程停在了可以恢复的阶段。','The pipeline stopped at a recoverable stage.'):L('正在重建研究时间线。','Reconstructing the research timeline.')}</h1><p>${failed?escapeHtml(status.error?.message||L('请查看 Worker 日志。','Check Worker logs.')):escapeHtml(stageLabel(status.stage))}</p></div></section><section class="container" style="padding-bottom:100px"><div class="form-card" style="max-width:820px"><div style="height:10px;border-radius:999px;background:rgba(255,255,255,.06);overflow:hidden"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--cyan),var(--violet));transition:width .4s"></div></div><div style="display:flex;justify-content:space-between;margin:14px 0 28px;color:var(--muted);font-size:13px"><span>${escapeHtml(stageLabel(status.stage))}</span><span>${Math.max(1,current)}/${total}</span></div>${Object.entries(stageLabels).map(([key,labels],index)=>`<div class="pipeline-step ${index<activeIndex?'done':index===activeIndex?'active':''}"><span class="pipeline-dot"></span><span>${L(labels[0],labels[1])}</span></div>`).join('')}${failed?`<div class="form-actions" style="margin-top:24px"><button class="button primary" id="retry-replay">${L('从头重试','Retry from start')}</button><a class="button ghost" href="/create" data-nav>${L('返回创建页','Back to create')}</a></div>`:`<p class="field-help" style="margin-top:22px">${L('页面会自动刷新。你也可以收藏这个网址稍后回来；已完成的部分不会丢失。','This page refreshes automatically. You can save the URL; completed stages are persisted in D1.')}</p>`}</div></section></main>${footer()}</div>`;
}

async function renderReplay() {
  const slug=replaySlugFromPath();
  if(!slug) return renderNotFound();
  document.title=L('研究回放 — OncoReplay','Research replay — OncoReplay');
  cancelPlayback();
  if(state.replaySlug!==slug){state.replay=null;state.replaySlug=slug;}
  if(slug!=='kras-g12d') {
    try {
      const status=await fetchStatus(slug);
      if(status.status!=='complete') {
        app.innerHTML=generationMarkup(slug,status); bindCommonNavigation();
        document.querySelector('#retry-replay')?.addEventListener('click',()=>retryReplay(slug));
        if(status.status!=='failed') state.statusTimer=setTimeout(renderReplay,2600);
        return;
      }
    } catch(error) { app.innerHTML=`<div class="replay-shell"><div class="empty-state"><h1>${L('回放不可用','Replay unavailable')}</h1><p>${escapeHtml(error.message)}</p><a class="button" href="/" data-nav>${L('返回首页','Return home')}</a></div></div>`; bindCommonNavigation(); return; }
  }
  app.innerHTML=`<div class="replay-shell"><div class="empty-state">${L('正在加载回放…','Loading replay…')}</div></div>`;
  try {
    const replay=await loadReplay(slug);
    if(!replay){state.statusTimer=setTimeout(renderReplay,1800);return;}
    document.title=`${replay.title} — OncoReplay`;
    app.innerHTML=replayMarkup(replay); bindReplay();
    if(window.innerWidth<=760 && replay.events[0]) state.currentYear=replay.events[0].year;
    updateReplayUI();
    setTimeout(()=>{if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches && window.innerWidth>760) startPlayback();},650);
  } catch(error) { app.innerHTML=`<div class="replay-shell"><div class="empty-state"><h1>${L('回放不可用','Replay unavailable')}</h1><p>${escapeHtml(error.message)}</p><a class="button" href="/" data-nav>${L('返回首页','Return home')}</a></div></div>`; bindCommonNavigation(); }
}

async function retryReplay(slug) {
  try { const response=await fetch(`/api/replays/${slug}/retry`,{method:'POST'}); const result=await response.json().catch(()=>({})); if(!response.ok) throw new Error(result?.error?.message||L('重试失败','Retry failed')); renderReplay(); }
  catch(error){showToast(error.message);}
}

function getBranchColor(branch,index,replay=state.replay) {
  if(fixedBranchColors[branch?.id]) return fixedBranchColors[branch.id];
  const tokenIndex={cyan:0,violet:1,amber:2,green:3,rose:4,blue:5}[branch?.colorToken];
  if(Number.isInteger(tokenIndex)) return palette[tokenIndex];
  const branchIndex=index ?? replay?.branches?.findIndex(item=>item.id===branch?.id) ?? 0;
  return palette[Math.max(0,branchIndex)%palette.length];
}

function eventTypeLabel(type) {
  const labels={birth:['形成','Birth'],breakthrough:['转折','Breakthrough'],branching:['分叉','Branching'],revival:['复兴','Revival'],translation:['转化','Translation'],challenge:['挑战候选','Challenge'],correction:['更新核查','Correction']};
  return labels[type]?L(labels[type][0],labels[type][1]):type;
}

function replayMarkup(replay) {
  return `<div class="replay-shell"><header class="replay-header"><button class="icon-button" id="replay-back" aria-label="${L('返回首页','Return home')}">${icons.back}</button><div class="replay-header-title"><strong>${escapeHtml(replay.title)}</strong><span>${replay.startYear}–${replay.endYear} · ${replay.events.length} ${L('个转折事件','turning-point events')}</span></div><div class="replay-actions"><div class="mode-switch" aria-label="${L('观看模式','Viewing mode')}"><button data-mode="momentum" class="active">${L('动量','Momentum')}</button><button data-mode="debate">${L('争议','Debate')}</button></div><button class="button small ghost" type="button" data-locale>${state.locale==='zh'?'EN':'中文'}</button><button class="button small" id="share-replay">${icons.share} ${L('分享','Share')}</button></div></header><main id="main" class="replay-main"><section class="replay-stage"><div class="replay-meta"><div><h1>${escapeHtml(replay.title)}</h1><p>${escapeHtml(replay.subtitle)}</p></div><div class="replay-metrics"><div><strong>${replay.works.length}</strong><span>${L('论文','Works')}</span></div><div><strong>${replay.branches.length}</strong><span>${L('分支','Branches')}</span></div><div><strong>${replay.events.length}</strong><span>${L('事件','Events')}</span></div></div></div><div class="demo-banner">${escapeHtml(replay.disclaimer)}</div><div class="viz-wrap"><div class="viz-toolbar"><div class="legend">${replay.branches.map((branch,index)=>`<span class="legend-item"><i class="legend-swatch" style="background:${getBranchColor(branch,index,replay)}"></i>${escapeHtml(branch.shortLabel||branch.label)}</span>`).join('')}</div><span class="viz-note">${L('节点大小','Node size')} = ${state.mode==='debate'?L('争议信号','debate signal'):L('影响力','normalized impact')} · ${L('形状','shape')} = ${L('论文类型','work type')}</span></div><svg id="timeline-svg" role="img" aria-label="${L('时间线与研究分支图','Timeline and research branch graph')}"></svg></div><div class="mobile-story" id="mobile-story">${mobileStoryMarkup(replay)}</div><div class="playback"><div class="play-group"><button class="play-button" id="play-toggle" aria-label="${L('播放回放','Play replay')}">${icons.play}</button></div><div class="timeline-control"><div class="year-row"><span class="current-year" id="current-year">${replay.startYear}</span><span class="year-range">${replay.startYear} — ${replay.endYear}</span></div><input class="range" id="year-slider" aria-label="${L('当前年份','Current year')}" type="range" min="${replay.startYear}" max="${replay.endYear}" step="0.05" value="${replay.startYear}" /></div><div class="speed-control" aria-label="${L('播放速度','Playback speed')}"><button data-speed="0.5">0.5×</button><button data-speed="1" class="active">1×</button><button data-speed="2">2×</button></div></div></section><aside class="narrative-panel"><div class="narrative-head"><span>${L('导演模式','Director mode')}</span><h2>${L('领域叙事','Field narrative')}</h2></div><div class="narrative-body" id="event-list">${eventListMarkup(replay)}${openQuestionsMarkup(replay)}</div></aside></main>${drawerMarkup()}</div>`;
}

function eventListMarkup(replay) { return replay.events.map(eventCardMarkup).join(''); }
function eventCardMarkup(event) { return `<article class="event-card" data-event-id="${event.id}" tabindex="0"><div class="event-top"><span class="event-type">${escapeHtml(eventTypeLabel(event.eventType))}</span><span class="event-year">${event.year}</span></div><h3>${escapeHtml(event.title)}</h3><p>${escapeHtml(event.summary)}</p><div class="event-meta"><span>${event.sourceWorkIds.length} ${L('篇来源论文','source works')}</span><span class="confidence"><i style="--confidence:${Math.round(event.confidence*100)}%"></i>${Math.round(event.confidence*100)}%</span></div></article>`; }
function mobileStoryMarkup(replay) { return replay.events.map(event=>`<article class="mobile-event" data-mobile-event="${event.id}"><span class="event-type">${escapeHtml(eventTypeLabel(event.eventType))}</span><span class="event-year" style="float:right">${event.year}</span><h3>${escapeHtml(event.title)}</h3><p>${escapeHtml(event.summary)}</p><button class="button small" data-open-event="${event.id}">${L('查看证据','View evidence')}</button></article>`).join(''); }
function openQuestionsMarkup(replay) { if(!replay.openQuestions?.length) return ''; return `<section class="evidence-section" style="margin:18px 0 40px"><h3>${L('当前开放问题','Current open questions')}</h3>${replay.openQuestions.map(q=>`<p class="drawer-summary">• ${escapeHtml(q)}</p>`).join('')}</section>`; }
function drawerMarkup() { return `<div class="drawer-backdrop" id="drawer-backdrop"></div><aside class="drawer" id="evidence-drawer" aria-hidden="true" aria-labelledby="drawer-title"><div class="drawer-head"><strong id="drawer-title">${L('证据','Evidence')}</strong><button class="icon-button" id="drawer-close" aria-label="${L('关闭证据抽屉','Close evidence drawer')}">${icons.close}</button></div><div class="drawer-content" id="drawer-content"></div></aside>`; }

function bindReplay() {
  document.querySelector('#replay-back')?.addEventListener('click',()=>navigate('/'));
  document.querySelector('#play-toggle')?.addEventListener('click',()=>state.playing?pausePlayback():startPlayback());
  document.querySelector('#year-slider')?.addEventListener('input',event=>{state.currentYear=Number(event.target.value);pausePlayback();updateReplayUI();});
  document.querySelectorAll('[data-speed]').forEach(button=>button.addEventListener('click',()=>{state.speed=Number(button.dataset.speed);document.querySelectorAll('[data-speed]').forEach(item=>item.classList.toggle('active',item===button));}));
  document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{state.mode=button.dataset.mode;document.querySelectorAll('[data-mode]').forEach(item=>item.classList.toggle('active',item===button));updateReplayUI(true);}));
  document.querySelectorAll('[data-event-id]').forEach(card=>{const open=()=>selectEvent(card.dataset.eventId,true);card.addEventListener('click',open);card.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}});});
  document.querySelectorAll('[data-open-event]').forEach(button=>button.addEventListener('click',()=>selectEvent(button.dataset.openEvent,true)));
  document.querySelector('#drawer-close')?.addEventListener('click',closeDrawer); document.querySelector('#drawer-backdrop')?.addEventListener('click',closeDrawer); document.querySelector('#share-replay')?.addEventListener('click',shareReplay);
  document.querySelectorAll('[data-locale]').forEach(button=>button.addEventListener('click',switchLocale));
  document.addEventListener('keydown',replayKeyHandler); window.addEventListener('resize',handleReplayResize);
}

function handleReplayResize(){clearTimeout(state.resizeTimer);state.resizeTimer=setTimeout(()=>state.replay&&renderTimeline(state.replay),130);}
function replayKeyHandler(event){if(!state.replay||document.body.classList.contains('drawer-open')){if(event.key==='Escape')closeDrawer();return;}if(event.key===' '){event.preventDefault();state.playing?pausePlayback():startPlayback();}if(event.key==='ArrowRight'){state.currentYear=clamp(state.currentYear+1,state.replay.startYear,state.replay.endYear);pausePlayback();updateReplayUI();}if(event.key==='ArrowLeft'){state.currentYear=clamp(state.currentYear-1,state.replay.startYear,state.replay.endYear);pausePlayback();updateReplayUI();}}
function cancelPlayback(){state.playing=false;state.lastFrame=0;if(state.animationFrame)cancelAnimationFrame(state.animationFrame);state.animationFrame=null;if(state.statusTimer)clearTimeout(state.statusTimer);state.statusTimer=null;document.removeEventListener('keydown',replayKeyHandler);window.removeEventListener('resize',handleReplayResize);}
function startPlayback(){if(!state.replay)return;if(state.currentYear>=state.replay.endYear)state.currentYear=state.replay.startYear;state.playing=true;state.lastFrame=performance.now();updatePlayButton();state.animationFrame=requestAnimationFrame(playbackFrame);}
function pausePlayback(){state.playing=false;if(state.animationFrame)cancelAnimationFrame(state.animationFrame);state.animationFrame=null;updatePlayButton();}
function playbackFrame(timestamp){if(!state.playing||!state.replay)return;const elapsed=timestamp-state.lastFrame;state.lastFrame=timestamp;const next=playbackStep(state.currentYear,state.replay.startYear,state.replay.endYear,elapsed,state.speed);state.currentYear=next.year;updateReplayUI();if(next.finished)pausePlayback();else state.animationFrame=requestAnimationFrame(playbackFrame);}
function updatePlayButton(){const button=document.querySelector('#play-toggle');if(!button)return;button.innerHTML=state.playing?icons.pause:icons.play;button.setAttribute('aria-label',state.playing?L('暂停回放','Pause replay'):L('播放回放','Play replay'));}
function updateReplayUI(){const replay=state.replay;if(!replay)return;const roundedYear=Math.floor(state.currentYear);const slider=document.querySelector('#year-slider');const yearLabel=document.querySelector('#current-year');if(slider){slider.value=String(state.currentYear);slider.style.setProperty('--progress',`${yearProgress(state.currentYear,replay.startYear,replay.endYear)}%`);}if(yearLabel)yearLabel.textContent=String(roundedYear);const activeEvent=currentEvent(replay.events,state.currentYear);if(activeEvent)state.selectedEventId=activeEvent.id;document.querySelectorAll('.event-card').forEach(card=>{const event=replay.events.find(item=>item.id===card.dataset.eventId);if(!event)return;card.classList.toggle('future',event.year>state.currentYear);card.classList.toggle('active',event.id===state.selectedEventId);});document.querySelectorAll('.mobile-event').forEach(card=>{const event=replay.events.find(item=>item.id===card.dataset.mobileEvent);if(!event)return;card.classList.toggle('visible',event.year<=state.currentYear);card.classList.toggle('current',event.id===state.selectedEventId);});renderTimeline(replay);}

function renderTimeline(replay) {
  const svg=document.querySelector('#timeline-svg'); if(!svg||svg.clientWidth===0)return;
  const width=Math.max(740,svg.clientWidth),height=Math.max(480,svg.clientHeight||480);svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
  const margin={left:135,right:40,top:70,bottom:54},plotW=width-margin.left-margin.right,plotH=height-margin.top-margin.bottom;
  const x=year=>margin.left+((year-replay.startYear)/Math.max(1,replay.endYear-replay.startYear))*plotW;
  const branchGap=plotH/Math.max(1,replay.branches.length); const y=branchId=>margin.top+branchGap*(Math.max(0,replay.branches.findIndex(b=>b.id===branchId))+.5);
  const workMap=new Map(replay.works.map(work=>[work.id,work]));const years=[];for(let year=replay.startYear;year<=replay.endYear;year+=Math.max(1,Math.ceil((replay.endYear-replay.startYear)/10)))years.push(year);
  const axis=`<line class="axis-line" x1="${margin.left}" y1="${height-margin.bottom}" x2="${width-margin.right}" y2="${height-margin.bottom}"/>${years.map(year=>`<line class="axis-tick" x1="${x(year)}" y1="${height-margin.bottom-5}" x2="${x(year)}" y2="${height-margin.bottom+5}"/><text class="axis-label" x="${x(year)}" y="${height-margin.bottom+22}" text-anchor="middle">${year}</text>`).join('')}`;
  const guides=replay.branches.map(branch=>`<line class="branch-guide" x1="${margin.left}" y1="${y(branch.id)}" x2="${width-margin.right}" y2="${y(branch.id)}"/><text class="branch-label" x="${margin.left-18}" y="${y(branch.id)+4}" text-anchor="end">${escapeHtml(branch.shortLabel||branch.label)}</text>`).join('');
  const edges=(replay.edges||[]).map(edge=>{const source=workMap.get(edge.source),target=workMap.get(edge.target);if(!source||!target)return'';const visible=source.publicationYear<=state.currentYear&&target.publicationYear<=state.currentYear;const x1=x(source.publicationYear),y1=y(source.branchId),x2=x(target.publicationYear),y2=y(target.branchId),cx=(x1+x2)/2;return `<path class="citation-edge ${edge.type==='related'?'bridge':''}" style="opacity:${visible ? (state.mode === 'debate' && edge.type !== 'related' ? .25 : 1) : 0}" d="M${x1} ${y1} C${cx} ${y1},${cx} ${y2},${x2} ${y2}"/>`;}).join('');
  const nodes=replay.works.map((work,index)=>{const offset=((index%5)-2)*8,px=x(work.publicationYear),py=y(work.branchId)+offset,size=nodeWeight(work,state.mode),future=work.publicationYear>state.currentYear,signal=state.mode==='debate'?work.debateSignal:work.normalizedImpact,dimmed=signal<.45,branch=replay.branches.find(b=>b.id===work.branchId),color=getBranchColor(branch,replay.branches.indexOf(branch),replay),shape=nodeShape(work.workType,px,py,size,color);return `<g class="work-node ${future?'hidden-future':''} ${dimmed?'dimmed':''}" data-work-id="${work.id}" style="opacity:${future ? .03 : nodeOpacity(work,state.mode)}"><title>${escapeHtml(work.title)}</title>${shape}${work.updateStatus||work.isRetracted?`<path d="M${px+size*.55} ${py-size*.7}h5l-2.5 4.5Z" fill="#ff776e"/>`:''}</g>`;}).join('');
  const markers=replay.events.map(event=>{const px=x(event.year),visible=event.year<=state.currentYear,color=event.eventType==='correction'?'#ff776e':event.eventType==='challenge'?palette[2]:palette[0];return `<g class="event-marker" data-svg-event="${event.id}" style="opacity:${visible?1:.13}"><line x1="${px}" y1="${margin.top-10}" x2="${px}" y2="${height-margin.bottom}" stroke="${color}"/><circle cx="${px}" cy="${margin.top-22}" r="4" fill="${color}"/>${event.id===state.selectedEventId&&visible?`<circle class="event-ring" cx="${px}" cy="${margin.top-22}" r="9" stroke="${color}"/>`:''}${event.id===state.selectedEventId?`<text x="${px+7}" y="${margin.top-18}">${escapeHtml(eventTypeLabel(event.eventType))}</text>`:''}</g>`;}).join('');
  const playX=x(state.currentYear),playhead=`<line class="playhead" x1="${playX}" y1="${margin.top-40}" x2="${playX}" y2="${height-margin.bottom}"/><circle class="playhead-dot" cx="${playX}" cy="${height-margin.bottom}" r="3"/>`;
  svg.innerHTML=`${guides}${axis}${edges}${markers}${nodes}${playhead}`;
  svg.querySelectorAll('[data-work-id]').forEach(node=>node.addEventListener('click',()=>openWorkDrawer(node.dataset.workId)));svg.querySelectorAll('[data-svg-event]').forEach(marker=>marker.addEventListener('click',()=>selectEvent(marker.dataset.svgEvent,true)));
}

function nodeShape(type,x,y,size,color){if(type==='clinical')return`<rect x="${x-size}" y="${y-size*.68}" width="${size*2}" height="${size*1.36}" rx="${size*.45}" fill="${color}"/>`;if(type==='review')return`<path d="M${x} ${y-size} L${x+size} ${y} L${x} ${y+size} L${x-size} ${y}Z" fill="${color}"/>`;if(type==='resource'){const points=Array.from({length:6},(_,i)=>{const a=Math.PI/3*i-Math.PI/2;return`${x+Math.cos(a)*size},${y+Math.sin(a)*size}`}).join(' ');return`<polygon points="${points}" fill="${color}"/>`;}return`<circle cx="${x}" cy="${y}" r="${size}" fill="${color}"/>`;}
function selectEvent(eventId,open=false){const event=state.replay.events.find(item=>item.id===eventId);if(!event)return;state.selectedEventId=event.id;state.currentYear=event.year;pausePlayback();updateReplayUI();if(open)openEventDrawer(event.id);}
function openEventDrawer(eventId){const event=state.replay.events.find(item=>item.id===eventId);if(!event)return;const works=event.sourceWorkIds.map(id=>state.replay.works.find(work=>work.id===id)).filter(Boolean);openDrawer(`<span class="drawer-kicker">${escapeHtml(eventTypeLabel(event.eventType))} · ${event.year}</span><h2>${escapeHtml(event.title)}</h2><span class="machine-badge">${event.aiGenerated?L('AI 根据来源论文撰写','Source-bound AI narrative'):L('按规则生成的叙事','Rule-generated narrative')}</span><p class="drawer-summary">${escapeHtml(event.summary)}</p><section class="evidence-section"><h3>${L('为何选择该事件','Why this event was selected')}</h3><p class="drawer-summary">${escapeHtml(event.selectionReason)}</p><div class="key-value"><span>${L('置信度','Confidence')}</span><span>${Math.round(event.confidence*100)}%</span></div><div class="key-value"><span>${L('人工核查','Human review')}</span><span>${event.requiresReview?L('发布前必须核查','Required before publication'):L('建议核查','Recommended')}</span></div></section><section class="evidence-section"><h3>${L('来源论文','Source-bound works')}</h3><div class="evidence-list">${works.map(workEvidenceMarkup).join('')}</div></section>`);}
function openWorkDrawer(workId){const work=state.replay.works.find(item=>item.id===workId);if(!work)return;state.selectedWorkId=workId;const isDemo=state.replay.dataStatus==='illustrative';const updates=work.updateStatuses||[work.updateStatus].filter(Boolean);openDrawer(`<span class="drawer-kicker">${escapeHtml(work.workType)} · ${work.publicationYear}</span><h2>${escapeHtml(work.title)}</h2>${isDemo?`<div class="demo-banner" style="margin:0 0 18px">${L('演示证据记录，不得引用。','Illustrative evidence record. Do not cite it.')}</div>`:''}<p class="drawer-summary">${escapeHtml(work.abstract||L('摘要暂缺。','Abstract unavailable.'))}</p><section class="evidence-section"><h3>${L('结构化字段','Structured fields')}</h3><div class="key-value"><span>OpenAlex ID</span><span>${escapeHtml(work.openalexId)}</span></div><div class="key-value"><span>${L('发表日期','Publication date')}</span><span>${escapeHtml(work.publicationDate||'—')}</span></div><div class="key-value"><span>${L('来源','Source')}</span><span>${escapeHtml(work.sourceName||'—')}</span></div><div class="key-value"><span>${L('作者','Authors')}</span><span>${escapeHtml((work.authors||[]).join(', ')||'—')}</span></div><div class="key-value"><span>DOI</span><span>${escapeHtml(work.doi||'—')}</span></div><div class="key-value"><span>PMID</span><span>${escapeHtml(work.pmid||'—')}</span></div><div class="key-value"><span>${L('被引次数','Cited by')}</span><span>${escapeHtml(work.citedByCount??0)}</span></div><div class="key-value"><span>${L('更新状态','Update status')}</span><span>${updates.length?escapeHtml(updates.map(item=>item.label||item.type).join('；')):L('未发现结构化更新','No structured update found')}</span></div></section><section class="evidence-section"><h3>${L('原始来源','Original source')}</h3>${work.sourceUrl?`<a class="button small" href="${escapeHtml(work.sourceUrl)}" target="_blank" rel="noreferrer">${L('打开来源页面','Open source page')}</a>`:''}<p class="drawer-summary" style="margin-top:14px">${L('标识符、日期、引用关系和更新状态来自结构化来源；AI 不得覆盖这些字段。','Identifiers, dates, citation relations, and update status come from structured sources; AI cannot overwrite them.')}</p></section>`);}
function workEvidenceMarkup(work){return`<button class="evidence-work" data-drawer-work="${work.id}" style="text-align:left;color:inherit;background:transparent;cursor:pointer"><strong>${escapeHtml(work.title)}</strong><small>${work.publicationYear} · ${escapeHtml(work.sourceName||'OpenAlex')} · ${escapeHtml(work.openalexId)}</small></button>`;}
function openDrawer(content){const drawer=document.querySelector('#evidence-drawer'),backdrop=document.querySelector('#drawer-backdrop'),body=document.querySelector('#drawer-content');if(!drawer||!backdrop||!body)return;body.innerHTML=content;drawer.classList.add('open');backdrop.classList.add('open');drawer.setAttribute('aria-hidden','false');document.body.classList.add('drawer-open');body.querySelectorAll('[data-drawer-work]').forEach(button=>button.addEventListener('click',()=>openWorkDrawer(button.dataset.drawerWork)));setTimeout(()=>document.querySelector('#drawer-close')?.focus(),50);}
function closeDrawer(){const drawer=document.querySelector('#evidence-drawer'),backdrop=document.querySelector('#drawer-backdrop');drawer?.classList.remove('open');backdrop?.classList.remove('open');drawer?.setAttribute('aria-hidden','true');document.body.classList.remove('drawer-open');}
async function shareReplay(){const event=state.replay.events.find(item=>item.id===state.selectedEventId),url=new URL(window.location.href);if(event)url.searchParams.set('event',event.id);try{if(navigator.share)await navigator.share({title:state.replay.title,text:event?.title||state.replay.subtitle,url:url.toString()});else{await navigator.clipboard.writeText(url.toString());showToast(L('回放链接已复制','Replay link copied'));}}catch(error){if(error?.name!=='AbortError')showToast(L('无法分享该链接','Could not share this link'));}}

function renderExplore(){document.title=L('探索 — OncoReplay','Explore — OncoReplay');app.innerHTML=`<div class="shell">${siteHeader()}<main id="main"><section class="page-hero"><div class="container"><span class="eyebrow">${L('探索','Explore')}</span><h1>${L('精选研究故事。','Curated research stories.')}</h1><p>${L('这里展示已经预生成、经过人工核查的回放；也可以从下面直接启动一次真实生成。','Public pages prioritize precomputed, reviewed replays; you can also start live generation from the topics below.')}</p></div></section><section class="section" style="padding-top:20px"><div class="container"><div class="cards">${exampleCard('KRAS G12D inhibitors','2006–2026','40','12',L('完整交互示例，包含四条分支和证据抽屉。','A complete interaction example with four branches and evidence drawers.'),'/replay/kras-g12d')}${exampleCard('HER2-low breast cancer',L('实时生成','Live generation'),'—','—',L('聚焦概念形成与临床转化。','Focus on concept formation and clinical translation.'),'/create?query=HER2-low%20breast%20cancer')}${exampleCard('Ferroptosis in cancer therapy',L('实时生成','Live generation'),'—','—',L('聚焦发现、分支扩张和争议。','Focus on discovery, branch expansion, and debate.'),'/create?query=ferroptosis%20in%20cancer%20therapy')}</div></div></section></main>${footer()}</div>`;bindCommonNavigation();}

function renderMethodology(){document.title=L('方法 — OncoReplay','Methodology — OncoReplay');app.innerHTML=`<div class="shell">${siteHeader()}<main id="main"><section class="page-hero"><div class="container"><span class="eyebrow">${L('方法','Methodology')}</span><h1>${L('先看故事，但证据始终可达。','Story first. Evidence always reachable.')}</h1><p>${L('事实、规则分析结果和机器生成的文字，会明确分开呈现。','Structured facts, rule-based analysis, and machine-generated language are kept distinct.')}</p></div></section><div class="container content-grid"><nav class="toc" aria-label="${L('方法章节','Methodology sections')}"><a href="#sources">${L('数据来源','Data sources')}</a><a href="#timeline">${L('时间线方法','Timeline method')}</a><a href="#ai">${L('AI 边界','AI boundary')}</a><a href="#limits">${L('已知局限','Known limits')}</a></nav><article class="prose"><section id="sources"><h2>${L('数据来源','Data sources')}</h2><p>${L('论文元数据来自 OpenAlex；生物医学摘要与标识符来自 Europe PMC；更正与撤稿信息来自 Crossref。','OpenAlex supplies works, topics, references, and citation relations; Europe PMC enriches biomedical abstracts and identifiers; Crossref supplies DOI update relations.')}</p></section><section id="timeline"><h2>${L('真实时间线重建','Timeline reconstruction')}</h2><p>${L('系统先收集与主题相关的核心论文，再纳入它们的参考文献和引用它们的新论文，组成候选集。评分综合这几方面：与主题的匹配程度、在研究网络中的位置、影响力的变化趋势、连接不同研究方向的桥接作用、临床相关的信号，以及论文的更正记录。','Candidates include text-relevant seeds, their references, relevant citing works, and bounded related works. Scoring combines text/entity/topic match, network proximity, normalized impact, annual citation momentum, cross-community bridges, branch birth, clinical signals, and structured updates.')}</p><div class="callout">${L('系统用社区检测算法（Louvain）把论文划分成几个研究方向，并控制在 3–6 条，保证看得清楚。事件上的标签是产品叙事用的说法，不代表科学结论。','Louvain discovers weighted graph communities; the system then constrains the result to 3–6 readable branches. Event labels are product narrative labels, not scientific conclusions.')}</div></section><section id="ai"><h2>${L('Workers AI 严格 Schema','Workers AI strict schema')}</h2><p>${L('AI 只负责为已有的分支和事件撰写标题、简介和待答问题：不发明论文，不改动日期。生成的内容会再次校验，引用的论文、事件和分支必须真实存在。校验不通过会重写一次，仍不通过就退回规则生成的版本。','AI only writes labels and short narratives for existing branches and events. Requests use JSON Schema; the application revalidates IDs, evidence subsets, field types, and confidence. One repair retry is attempted before falling back to rule-generated copy.')}</p></section><section id="limits"><h2>${L('已知局限','Known limitations')}</h2><p>${L('OncoReplay 不是系统综述，不是临床决策工具，不负责判断结论真假，也不是论文生成器。数据库覆盖面、引用统计、摘要缺失和分类方式，都会影响最终结果。','OncoReplay is not a systematic review, clinical decision support system, truth arbiter, or paper generator. Database coverage, citation counts, missing abstracts, and cluster stability affect results.')}</p></section></article></div></main>${footer()}</div>`;bindCommonNavigation();}

function renderAbout(){document.title=L('关于 — OncoReplay','About — OncoReplay');app.innerHTML=`<div class="shell">${siteHeader()}<main id="main"><section class="page-hero"><div class="container"><span class="eyebrow">${L('关于项目','About the project')}</span><h1>${L('研究演化的可视化叙事界面。','A visual narrative interface for research evolution.')}</h1><p>${L('面向研究者、期刊读书会、教师和科研传播者，快速看懂一个主题如何出现、扩散、分岔、遭遇挑战，并最终走向临床转化。','Designed for researchers, journal clubs, educators, and scientific communicators who need an inspectable view of how a topic emerges, expands, divides, is challenged, and approaches translation.')}</p></div></section><section class="section" style="padding-top:20px"><div class="container"><div class="steps"><article class="step"><span class="step-index">${L('产品边界','Product boundary')}</span><h3>${L('不是完整综述。','Not a complete review.')}</h3><p>${L('用于建立方向感和暴露来源路径，不承诺穷尽性检索。','It helps orientation and exposes source paths; it does not promise exhaustive retrieval.')}</p></article><article class="step"><span class="step-index">${L('科学边界','Scientific boundary')}</span><h3>${L('不是“真相机器”。','Not a truth machine.')}</h3><p>${L('展示检索数据中的模式并标记待核查候选，不宣称共识或因果。','It visualizes patterns and flags candidates for inspection without claiming consensus or causality.')}</p></article><article class="step"><span class="step-index">${L('临床边界','Clinical boundary')}</span><h3>${L('不是医疗建议。','Not medical advice.')}</h3><p>${L('不提供患者级治疗选择或临床决策支持。','It does not provide patient-level treatment selection or clinical decision support.')}</p></article></div></div></section></main>${footer()}</div>`;bindCommonNavigation();}

function bindCommonNavigation(){document.querySelectorAll('[data-nav]').forEach(link=>link.addEventListener('click',event=>{if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();navigate(link.getAttribute('href'));}));document.querySelectorAll('[data-locale]').forEach(button=>button.addEventListener('click',switchLocale));}
function showToast(message){const root=document.querySelector('#toast-root');if(!root)return;root.innerHTML=`<div class="toast">${escapeHtml(message)}</div>`;requestAnimationFrame(()=>root.firstElementChild?.classList.add('show'));setTimeout(()=>root.firstElementChild?.classList.remove('show'),2600);}
function renderNotFound(){document.title=L('页面不存在 — OncoReplay','Page not found — OncoReplay');app.innerHTML=`<div class="shell">${siteHeader()}<main id="main"><div class="empty-state"><span class="eyebrow">404</span><h1>${L('这段时间线不存在。','That part of the timeline is missing.')}</h1><p>${L('请求的页面不可用。','The requested page is unavailable.')}</p><a class="button primary" href="/" data-nav>${L('返回首页','Return home')}</a></div></main>${footer()}</div>`;bindCommonNavigation();}

function renderRoute(){cancelPlayback();closeDrawer();const path=routePath();if(path==='/')renderHome();else if(path==='/create')renderCreate();else if(path==='/explore')renderExplore();else if(path==='/methodology')renderMethodology();else if(path==='/about')renderAbout();else if(replaySlugFromPath(path))renderReplay();else renderNotFound();}
window.addEventListener('popstate',renderRoute);renderRoute();
