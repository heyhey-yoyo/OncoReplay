import {
  clamp,
  cosineFromCounts,
  dateToYear,
  jaccard,
  percentileRank,
  tokenCounts,
  tokenize,
  unique,
} from './utils.js';

const CLINICAL_TERMS = /clinical|trial|patient|phase\s*[1-4ivx]|cohort|safety|efficacy|dose|response rate|progression-free|overall survival|biomarker/i;
const CHALLENGE_TERMS = /resistance|limitation|limited|failed|failure|negative|no benefit|not associated|lack of|escape|heterogeneity|toxicity|adverse|challenge|controvers|discordant|contradict/i;
const DRUG_TERMS = /inhibitor|agonist|antibody|drug|compound|molecule|degrader|therapy|therapeutic|pharmacologic|pharmacological/i;

export function makeWorkText(work) {
  const topics = (work.topics || []).map((item) => item.displayName).join(' ');
  const keywords = (work.keywords || []).map((item) => item.displayName).join(' ');
  return `${work.title || ''} ${work.abstract || ''} ${topics} ${keywords} ${(work.mesh || []).join(' ')}`;
}

function addWeightedEdge(graph, left, right, weight) {
  if (!left || !right || left === right || !Number.isFinite(weight) || weight <= 0) return;
  if (!graph.has(left)) graph.set(left, new Map());
  if (!graph.has(right)) graph.set(right, new Map());
  graph.get(left).set(right, (graph.get(left).get(right) || 0) + weight);
  graph.get(right).set(left, (graph.get(right).get(left) || 0) + weight);
}

export function buildWeightedGraph(works, relations = []) {
  const graph = new Map(works.map((work) => [work.id, new Map()]));
  const byId = new Map(works.map((work) => [work.id, work]));
  const tokenMap = new Map(works.map((work) => [work.id, tokenCounts(makeWorkText(work))]));
  const topicMap = new Map(works.map((work) => [work.id, new Set((work.topics || []).map((item) => item.id || item.displayName).filter(Boolean))]));
  const refsMap = new Map(works.map((work) => [work.id, new Set((work.referencedWorks || []).filter((id) => byId.has(id)))]));

  for (const relation of relations) {
    if (!byId.has(relation.source) || !byId.has(relation.target)) continue;
    addWeightedEdge(graph, relation.source, relation.target, relation.type === 'citation' ? 2.4 : 1.1);
  }

  for (let i = 0; i < works.length; i += 1) {
    const left = works[i];
    for (let j = i + 1; j < works.length; j += 1) {
      const right = works[j];
      const topicSimilarity = jaccard(topicMap.get(left.id), topicMap.get(right.id));
      const textSimilarity = cosineFromCounts(tokenMap.get(left.id), tokenMap.get(right.id));
      const coupling = jaccard(refsMap.get(left.id), refsMap.get(right.id));
      let weight = 0;
      if (topicSimilarity >= 0.18) weight += topicSimilarity * 1.1;
      if (textSimilarity >= 0.24) weight += textSimilarity * 0.8;
      if (coupling >= 0.08) weight += coupling * 1.4;
      if (weight >= 0.32) addWeightedEdge(graph, left.id, right.id, weight);
    }
  }
  return graph;
}

function graphStats(graph) {
  const degree = new Map();
  let totalWeight = 0;
  for (const [id, neighbors] of graph) {
    let sum = 0;
    for (const weight of neighbors.values()) sum += weight;
    degree.set(id, sum);
    totalWeight += sum;
  }
  return { degree, m2: totalWeight || 1 };
}

export function louvainCommunities(graph, maxPasses = 24) {
  const nodes = [...graph.keys()].sort();
  const communities = new Map(nodes.map((id) => [id, id]));
  const { degree, m2 } = graphStats(graph);
  const communityTotals = new Map(nodes.map((id) => [id, degree.get(id) || 0]));

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let moved = false;
    for (const node of nodes) {
      const nodeDegree = degree.get(node) || 0;
      const current = communities.get(node);
      const weightsToCommunity = new Map();
      for (const [neighbor, weight] of graph.get(node) || []) {
        const community = communities.get(neighbor);
        weightsToCommunity.set(community, (weightsToCommunity.get(community) || 0) + weight);
      }
      communityTotals.set(current, (communityTotals.get(current) || 0) - nodeDegree);
      let bestCommunity = current;
      let bestGain = 0;
      const candidates = new Set([current, ...weightsToCommunity.keys()]);
      for (const candidate of candidates) {
        const gain = (weightsToCommunity.get(candidate) || 0) - ((communityTotals.get(candidate) || 0) * nodeDegree) / m2;
        if (gain > bestGain + 1e-9 || (Math.abs(gain - bestGain) <= 1e-9 && String(candidate) < String(bestCommunity))) {
          bestGain = gain;
          bestCommunity = candidate;
        }
      }
      communities.set(node, bestCommunity);
      communityTotals.set(bestCommunity, (communityTotals.get(bestCommunity) || 0) + nodeDegree);
      if (bestCommunity !== current) moved = true;
    }
    if (!moved) break;
  }

  const remap = new Map();
  let index = 0;
  const normalized = new Map();
  for (const node of nodes) {
    const community = communities.get(node);
    if (!remap.has(community)) remap.set(community, `c${index++}`);
    normalized.set(node, remap.get(community));
  }
  return normalized;
}

function communityMembers(assignments) {
  const groups = new Map();
  for (const [id, community] of assignments) {
    if (!groups.has(community)) groups.set(community, []);
    groups.get(community).push(id);
  }
  return groups;
}

function interCommunityWeight(graph, leftMembers, rightMembers) {
  const right = new Set(rightMembers);
  let weight = 0;
  for (const id of leftMembers) {
    for (const [neighbor, edgeWeight] of graph.get(id) || []) if (right.has(neighbor)) weight += edgeWeight;
  }
  return weight;
}

function splitLargestCommunity(assignments, works) {
  const groups = communityMembers(assignments);
  const largest = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (!largest || largest[1].length < 4) return false;
  const members = largest[1].map((id) => works.find((work) => work.id === id)).filter(Boolean);
  const topicBuckets = new Map();
  for (const work of members) {
    const key = work.primaryTopic?.id || work.primaryTopic?.displayName || work.topics?.[0]?.id || work.topics?.[0]?.displayName || 'other';
    if (!topicBuckets.has(key)) topicBuckets.set(key, []);
    topicBuckets.get(key).push(work.id);
  }
  const buckets = [...topicBuckets.values()].sort((a, b) => b.length - a.length);
  let split = buckets[1];
  if (!split || split.length < 2) {
    const sorted = [...members].sort((a, b) => (a.publicationYear || 0) - (b.publicationYear || 0));
    split = sorted.slice(Math.ceil(sorted.length / 2)).map((work) => work.id);
  }
  const newCommunity = `split-${crypto.randomUUID().slice(0, 8)}`;
  for (const id of split) assignments.set(id, newCommunity);
  return true;
}

export function normalizeCommunityCount(assignments, graph, works, min = 3, max = 6) {
  while (communityMembers(assignments).size > max) {
    const groups = communityMembers(assignments);
    const [smallId, smallMembers] = [...groups.entries()].sort((a, b) => a[1].length - b[1].length)[0];
    let bestTarget = null;
    let bestWeight = -1;
    for (const [candidateId, candidateMembers] of groups) {
      if (candidateId === smallId) continue;
      const weight = interCommunityWeight(graph, smallMembers, candidateMembers);
      if (weight > bestWeight) { bestWeight = weight; bestTarget = candidateId; }
    }
    if (!bestTarget) break;
    for (const id of smallMembers) assignments.set(id, bestTarget);
  }
  while (communityMembers(assignments).size < min) {
    if (!splitLargestCommunity(assignments, works)) break;
  }
  const remap = new Map();
  let index = 0;
  for (const [id, community] of assignments) {
    if (!remap.has(community)) remap.set(community, `branch-${index++}`);
    assignments.set(id, remap.get(community));
  }
  return assignments;
}

function topTerms(works, limit = 4) {
  const counts = new Map();
  for (const work of works) {
    for (const token of tokenize(makeWorkText(work))) counts.set(token, (counts.get(token) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([token]) => token);
}

export function ruleBranchLabel(works, index = 0, locale = 'zh') {
  const text = works.map(makeWorkText).join(' ');
  let key = 'mechanism';
  if (CLINICAL_TERMS.test(text)) key = 'translation';
  else if (CHALLENGE_TERMS.test(text)) key = 'resistance';
  else if (DRUG_TERMS.test(text)) key = 'drug';
  else if (/biomarker|diagnostic|expression|signature|prognostic/i.test(text)) key = 'biomarker';
  const terms = topTerms(works, 3);
  const labels = {
    zh: {
      mechanism: '基础机制', translation: '临床转化', resistance: '耐药与挑战', drug: '药物开发', biomarker: '生物标志物',
    },
    en: {
      mechanism: 'Basic mechanism', translation: 'Clinical translation', resistance: 'Resistance and challenges', drug: 'Drug development', biomarker: 'Biomarkers',
    },
  };
  const base = labels[locale]?.[key] || labels.zh[key];
  return {
    label: base,
    shortLabel: base,
    description: locale === 'zh'
      ? `该分支主要由 ${terms.join('、') || `第 ${index + 1} 组主题`} 等高频特征组织。名称为规则生成，需结合成员论文核查。`
      : `This branch is organized around ${terms.join(', ') || `topic group ${index + 1}`}. The label is rule-generated and should be checked against member works.`,
  };
}

function annualMomentum(work) {
  const counts = [...(work.countsByYear || [])].sort((a, b) => a.year - b.year);
  if (counts.length < 2) return 0;
  const recent = counts.slice(-3).reduce((sum, item) => sum + item.citedByCount, 0);
  const previous = counts.slice(-6, -3).reduce((sum, item) => sum + item.citedByCount, 0);
  return clamp((recent - previous) / Math.max(1, previous + recent), -1, 1);
}

function bridgeScore(workId, graph, assignments) {
  const neighbors = graph.get(workId) || new Map();
  if (!neighbors.size) return 0;
  const own = assignments.get(workId);
  let total = 0;
  let cross = 0;
  for (const [neighbor, weight] of neighbors) {
    total += weight;
    if (assignments.get(neighbor) !== own) cross += weight;
  }
  return total ? cross / total : 0;
}

export function scoreWorks(topic, works, graph, assignments) {
  const queryCounts = tokenCounts(topic);
  const citedValues = works.map((work) => Math.log1p(work.citedByCount || 0));
  const fwciValues = works.map((work) => Number(work.fwci || 0)).filter((value) => value > 0);
  const degree = graphStats(graph).degree;
  const degreeValues = [...degree.values()];
  const earliestByBranch = new Map();
  for (const work of works) {
    const branch = assignments.get(work.id);
    const year = work.publicationYear || 9999;
    earliestByBranch.set(branch, Math.min(earliestByBranch.get(branch) || 9999, year));
  }

  return works.map((work) => {
    const text = makeWorkText(work);
    const textMatch = cosineFromCounts(queryCounts, tokenCounts(text));
    const queryTokens = new Set(tokenize(topic));
    const entityMatch = jaccard(queryTokens, new Set(tokenize(`${work.title || ''} ${(work.mesh || []).join(' ')}`)));
    const topicMatch = jaccard(queryTokens, new Set(tokenize((work.topics || []).map((item) => item.displayName).join(' '))));
    const networkProximity = work.layer === 'seed' ? 1 : work.layer === 'citing' ? 0.72 : work.layer === 'reference' ? 0.62 : 0.5;
    const recency = clamp(((work.publicationYear || 2000) - 1990) / 40, 0, 1);
    const relevanceScore = clamp(textMatch * 0.42 + entityMatch * 0.2 + topicMatch * 0.16 + networkProximity * 0.18 + recency * 0.04, 0, 1);

    const citationRank = percentileRank(citedValues, Math.log1p(work.citedByCount || 0));
    const fwciRank = work.fwci ? percentileRank(fwciValues, work.fwci) : 0;
    const normalizedImpact = clamp((work.citationPercentile || 0) * 0.35 + citationRank * 0.35 + fwciRank * 0.2 + percentileRank(degreeValues, degree.get(work.id) || 0) * 0.1, 0, 1);
    const momentum = annualMomentum(work);
    const bridge = bridgeScore(work.id, graph, assignments);
    const isBranchBirth = work.publicationYear === earliestByBranch.get(assignments.get(work.id));
    const updateSignal = work.isRetracted || (work.updateStatus || []).some((item) => ['retraction','expression-of-concern','correction'].includes(item.type)) ? 1 : 0;
    const clinicalSignal = CLINICAL_TERMS.test(text) || work.workType === 'clinical-trial' ? 1 : 0;
    const challengeSignal = CHALLENGE_TERMS.test(text) ? 1 : 0;
    const revivalSignal = (work.publicationYear || 2026) <= 2018 && momentum > 0.35 ? clamp(momentum, 0, 1) : 0;
    const debateSignal = clamp(challengeSignal * 0.45 + bridge * 0.2 + updateSignal * 0.35, 0, 1);
    const turningPointScore = clamp(
      relevanceScore * 0.18 + normalizedImpact * 0.32 + clamp((momentum + 1) / 2, 0, 1) * 0.16 + bridge * 0.14 +
      (isBranchBirth ? 0.08 : 0) + clinicalSignal * 0.05 + updateSignal * 0.05 + revivalSignal * 0.02,
      0,
      1,
    );
    return {
      ...work,
      branchId: assignments.get(work.id),
      relevanceScore,
      turningPointScore,
      normalizedImpact,
      debateSignal,
      momentum,
      bridgeScore: bridge,
      clinicalSignal,
      challengeSignal,
      revivalSignal,
      selectionReasons: unique([
        textMatch > 0.45 ? 'query-text-overlap' : null,
        normalizedImpact > 0.75 ? 'normalized-citation-impact' : null,
        momentum > 0.3 ? 'citation-momentum' : null,
        bridge > 0.35 ? 'cross-branch-bridge' : null,
        isBranchBirth ? 'early-branch-work' : null,
        clinicalSignal ? 'clinical-translation-signal' : null,
        updateSignal ? 'structured-update-status' : null,
      ]),
    };
  });
}

function eventText(locale, type, work, branchLabel) {
  const year = work.publicationYear;
  const zh = {
    birth: [`研究簇开始形成：${branchLabel}`, `在当前检索结果中，${year} 年前后出现了可辨认的连续论文簇，主题词和引用关系开始稳定。`, '该节点是分支中较早且相关性较高的论文之一。'],
    breakthrough: [`高影响节点推动研究升温`, `一篇在当前数据中具有较高归一化影响和后续连接度的论文出现，随后相关研究活动明显增加。`, '该论文的归一化影响、引用增长或网络桥接得分较高。'],
    branching: [`研究方向出现可见分叉`, `引用与主题关系显示研究开始沿多个相对独立的分支展开，机制、药物开发或临床转化之间的路径变得更清晰。`, '该时间点附近的社区结构和跨分支连接发生变化。'],
    revival: [`早期论文重新获得关注`, `一篇较早发表的论文在多年后出现新的引用增长，提示旧线索可能被新的技术或研究问题重新激活。`, '该论文发表时间较早，但近期引用增速高于其之前阶段。'],
    translation: [`临床转化活动增加`, `当前检索结果中开始出现更多患者、试验、剂量或疗效相关研究，研究轨迹从机制与药物开发进一步延伸到临床。`, '该节点包含结构化或文本可识别的临床转化信号。'],
    challenge: [`出现限制性或相反方向的证据`, `研究中出现耐药、异质性、毒性或结果不一致等信号。该事件仅是机器检测候选，需要研究者核查原文。`, '标题或摘要中出现挑战性语义，并伴随较高的争议或跨分支信号。'],
    correction: [`论文更新状态需要核查`, `结构化来源记录了更正、撤稿或关注表达等更新关系。界面只展示来源状态，不推断学术不端。`, 'Crossref 或 OpenAlex 返回了结构化更新或撤稿状态。'],
  };
  const en = {
    birth: [`A recognizable ${branchLabel} cluster emerges`, `Around ${year}, a recurring cluster of related papers becomes visible in the retrieved dataset.`, 'This is among the earliest relevant works in its branch.'],
    breakthrough: ['A high-impact node accelerates the field', 'A work with strong normalized influence and downstream connectivity appears, followed by increased activity.', 'The work has a high combined impact, momentum, or bridge score.'],
    branching: ['The field separates into visible branches', 'Topic and citation structure begins to divide into relatively distinct research tracks.', 'Community structure and cross-branch connectivity shift around this time.'],
    revival: ['An earlier paper returns to attention', 'An older work shows renewed citation growth years after publication.', 'Recent citation growth is unusually strong relative to its earlier period.'],
    translation: ['Clinical translation activity increases', 'Patient, trial, dose, or efficacy-related studies become more visible in the retrieved set.', 'The work contains structured or textual translation signals.'],
    challenge: ['A limiting or conflicting signal appears', 'Resistance, heterogeneity, toxicity, or discordant results appear. This is a machine-detected candidate requiring review.', 'Challenge language and debate-related graph signals are present.'],
    correction: ['A publication update requires inspection', 'Structured sources record a correction, retraction, or expression of concern. No misconduct inference is made.', 'Crossref or OpenAlex reports a structured update status.'],
  };
  const values = locale === 'en' ? en[type] : zh[type];
  return { title: values[0], summary: values[1], selectionReason: values[2] };
}

export function buildRuleEvents(scoredWorks, branches, locale = 'zh', minEvents = 8, maxEvents = 15) {
  const byBranch = new Map(branches.map((branch) => [branch.id, branch]));
  const sortedByYear = [...scoredWorks].sort((a, b) => (a.publicationYear || 9999) - (b.publicationYear || 9999));
  const candidates = [];
  const used = new Set();
  const add = (type, work, extra = {}) => {
    if (!work) return;
    const key = `${type}:${work.id}`;
    if (used.has(key)) return;
    used.add(key);
    const branch = byBranch.get(work.branchId);
    const text = eventText(locale, type, work, branch?.label || work.branchId || 'research');
    candidates.push({
      id: `event-${crypto.randomUUID().slice(0, 10)}`,
      eventType: type,
      eventDate: work.publicationDate || `${work.publicationYear}-01-01`,
      year: work.publicationYear,
      title: text.title,
      summary: text.summary,
      selectionReason: text.selectionReason,
      branchIds: unique([work.branchId, ...(extra.branchIds || [])]),
      sourceWorkIds: unique([work.id, ...(extra.sourceWorkIds || [])]).slice(0, 5),
      confidence: clamp(extra.confidence ?? (0.55 + work.turningPointScore * 0.35), 0.45, 0.94),
      requiresReview: extra.requiresReview ?? ['challenge','correction'].includes(type),
      metrics: {
        turningPointScore: work.turningPointScore,
        relevanceScore: work.relevanceScore,
        normalizedImpact: work.normalizedImpact,
        momentum: work.momentum,
        bridgeScore: work.bridgeScore,
      },
    });
  };

  for (const branch of branches) {
    const first = sortedByYear.find((work) => work.branchId === branch.id && work.relevanceScore >= 0.2);
    if (first) add('birth', first, { confidence: 0.68 });
  }

  const breakthroughs = [...scoredWorks]
    .filter((work) => work.turningPointScore >= 0.5)
    .sort((a, b) => b.turningPointScore - a.turningPointScore);
  for (const work of breakthroughs) {
    if (candidates.filter((item) => item.eventType === 'breakthrough').length >= 4) break;
    if (candidates.some((item) => Math.abs(item.year - work.publicationYear) < 2 && item.eventType === 'breakthrough')) continue;
    add('breakthrough', work);
  }

  const firstYears = [...new Set(sortedByYear.map((work) => work.publicationYear).filter(Boolean))].sort((a, b) => a - b);
  for (const year of firstYears) {
    const active = new Set(sortedByYear.filter((work) => work.publicationYear <= year).map((work) => work.branchId));
    if (active.size >= 2) {
      const work = scoredWorks.filter((item) => item.publicationYear === year).sort((a, b) => b.bridgeScore - a.bridgeScore)[0];
      add('branching', work, { confidence: 0.66, branchIds: [...active].slice(0, 4) });
      break;
    }
  }

  add('translation', scoredWorks.filter((work) => work.clinicalSignal).sort((a, b) => (a.publicationYear || 9999) - (b.publicationYear || 9999))[0], { confidence: 0.7 });
  add('challenge', scoredWorks.filter((work) => work.challengeSignal || work.debateSignal > 0.55).sort((a, b) => b.debateSignal - a.debateSignal)[0], { confidence: 0.58, requiresReview: true });
  add('revival', scoredWorks.filter((work) => work.revivalSignal > 0.2).sort((a, b) => b.revivalSignal - a.revivalSignal)[0], { confidence: 0.61 });
  for (const work of scoredWorks.filter((item) => item.isRetracted || (item.updateStatus || []).length).sort((a, b) => (a.publicationYear || 0) - (b.publicationYear || 0)).slice(0, 2)) {
    add('correction', work, { confidence: 0.92, requiresReview: true });
  }

  if (candidates.length < minEvents) {
    for (const work of breakthroughs) {
      if (candidates.length >= minEvents) break;
      if (candidates.some((item) => item.sourceWorkIds.includes(work.id))) continue;
      add('breakthrough', work, { confidence: 0.56 });
    }
  }

  return candidates
    .sort((a, b) => a.year - b.year || b.metrics.turningPointScore - a.metrics.turningPointScore)
    .slice(0, maxEvents)
    .map((event, index) => ({ ...event, sortOrder: index }));
}

export function analyzeReplay(topic, works, relations, { locale = 'zh', minBranches = 3, maxBranches = 6 } = {}) {
  const graph = buildWeightedGraph(works, relations);
  const assignments = normalizeCommunityCount(louvainCommunities(graph), graph, works, minBranches, maxBranches);
  const scoredWorks = scoreWorks(topic, works, graph, assignments);
  const groups = communityMembers(assignments);
  const branchColors = ['cyan','violet','amber','green','rose','blue'];
  const branches = [...groups.entries()]
    .map(([id, ids], index) => {
      const members = ids.map((workId) => scoredWorks.find((work) => work.id === workId)).filter(Boolean);
      const label = ruleBranchLabel(members, index, locale);
      return {
        id,
        label: label.label,
        shortLabel: label.shortLabel,
        description: label.description,
        colorToken: branchColors[index % branchColors.length],
        sortOrder: index,
        sourceWorkIds: ids,
        aiGenerated: false,
      };
    })
    .sort((a, b) => {
      const ay = Math.min(...a.sourceWorkIds.map((id) => scoredWorks.find((work) => work.id === id)?.publicationYear || 9999));
      const by = Math.min(...b.sourceWorkIds.map((id) => scoredWorks.find((work) => work.id === id)?.publicationYear || 9999));
      return ay - by;
    })
    .map((branch, index) => ({ ...branch, sortOrder: index }));
  const events = buildRuleEvents(scoredWorks, branches, locale);
  return { graph, assignments, scoredWorks, branches, events };
}

export function publicWorkType(work) {
  const text = makeWorkText(work);
  if (CLINICAL_TERMS.test(text)) return 'clinical';
  if (/review|meta-analysis|systematic review|perspective|commentary|editorial/i.test(work.workType || '') || /review|meta-analysis/i.test(work.title || '')) return 'review';
  if (/dataset|resource|database|atlas/i.test(`${work.workType || ''} ${work.title || ''}`)) return 'resource';
  return 'basic';
}

export function eventYear(event) {
  return event.year || dateToYear(event.eventDate, null);
}
