import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeReplay, buildWeightedGraph, louvainCommunities, scoreWorks } from '../src/worker/lib/analysis.js';

function work(id, year, branchText, refs = [], extra = {}) {
  return {
    id,
    title: `${branchText} study ${id}`,
    abstract: `${branchText} cancer mechanism inhibitor response`,
    publicationYear: year,
    publicationDate: `${year}-01-01`,
    workType: extra.workType || 'article',
    citedByCount: extra.citedByCount || 10,
    countsByYear: extra.countsByYear || [{ year: 2023, citedByCount: 1 }, { year: 2024, citedByCount: 3 }, { year: 2025, citedByCount: 7 }],
    topics: [{ id: branchText, displayName: branchText, score: 0.8 }],
    primaryTopic: { id: branchText, displayName: branchText },
    keywords: [], mesh: [], authors: [], referencedWorks: refs, relatedWorks: [], layer: extra.layer || 'seed',
    fwci: extra.fwci || 1, citationPercentile: extra.citationPercentile || 0.5, updateStatus: extra.updateStatus || [], isRetracted: false,
  };
}

const works = [
  work('W1', 2010, 'mechanism', [], { citedByCount: 100 }),
  work('W2', 2012, 'mechanism', ['W1'], { citedByCount: 80 }),
  work('W3', 2016, 'drug inhibitor', ['W1']),
  work('W4', 2018, 'drug inhibitor', ['W2','W3'], { citedByCount: 90 }),
  work('W5', 2020, 'resistance escape', ['W2','W4']),
  work('W6', 2022, 'clinical trial patient', ['W4'], { workType: 'clinical-trial' }),
  work('W7', 2024, 'clinical trial safety', ['W6'], { workType: 'clinical-trial' }),
  work('W8', 2025, 'resistance toxicity', ['W5','W6'], { updateStatus: [{ type: 'correction' }] }),
];
const relations = works.flatMap((item) => item.referencedWorks.map((ref) => ({ source: ref, target: item.id, type: 'citation' })));

test('weighted graph includes citation and similarity connections', () => {
  const graph = buildWeightedGraph(works, relations);
  assert.equal(graph.size, works.length);
  assert.ok((graph.get('W1').get('W2') || 0) >= 2.4);
});

test('Louvain assigns every node to a community', () => {
  const graph = buildWeightedGraph(works, relations);
  const communities = louvainCommunities(graph);
  assert.equal(communities.size, works.length);
  assert.ok(new Set(communities.values()).size >= 1);
});

test('scoring returns bounded real scores', () => {
  const graph = buildWeightedGraph(works, relations);
  const assignments = new Map(works.map((item, index) => [item.id, `b${Math.floor(index / 3)}`]));
  const scored = scoreWorks('KRAS inhibitor cancer', works, graph, assignments);
  for (const item of scored) {
    assert.ok(item.relevanceScore >= 0 && item.relevanceScore <= 1);
    assert.ok(item.turningPointScore >= 0 && item.turningPointScore <= 1);
    assert.ok(item.normalizedImpact >= 0 && item.normalizedImpact <= 1);
  }
});

test('full analysis produces readable branches and events', () => {
  const result = analyzeReplay('KRAS inhibitor cancer', works, relations, { locale: 'zh', minBranches: 3, maxBranches: 6 });
  assert.ok(result.branches.length >= 3 && result.branches.length <= 6);
  assert.ok(result.events.length >= 8 && result.events.length <= 15);
  assert.ok(result.events.every((event) => event.sourceWorkIds.length >= 1));
  assert.ok(result.scoredWorks.every((item) => item.branchId));
});
