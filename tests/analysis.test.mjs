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

test('correction events require targeted structured status and actual update date',()=>{
  const make=updates=>analyzeReplay('KRAS',[
    work('W1',2010,'KRAS',[],{updateStatus:updates}),work('W2',2012,'KRAS'),work('W3',2014,'KRAS')],[]).events.filter(e=>e.eventType==='correction');
  assert.equal(make([{type:'is-preprint-of',direction:'relation',date:'2025-03-04'}]).length,0);
  assert.equal(make([{type:'retraction',direction:'updates',date:'2025-03-04'}]).length,0);
  assert.equal(make([{type:'correction',direction:'updated-by',date:null}]).length,0);
  const events=make([{type:'correction',direction:'updated-by',date:'2025-03-04'}]);
  assert.equal(events.length,1);assert.equal(events[0].eventDate,'2025-03-04');assert.equal(events[0].year,2025);
});

test('actual Crossref fetch path normalizes complete dates and never invents partial or invalid dates', async () => {
  const {fetchCrossrefUpdates}=await import('../src/worker/lib/clients.js');
  const target='10.1234/target', noticeDoi='10.1234/notice';
  const dateCases=[
    [{ 'date-parts': [[2025,1,2]] },'2025-01-02'],
    [{ 'date-time': '2025-01-02T12:34:56Z' },'2025-01-02'],
    [{ timestamp: Date.UTC(2025,0,2,12) },'2025-01-02'],
    [{ date: { 'date-time': '2025-01-02T12:34:56Z' } },'2025-01-02'],
    [{ 'date-parts': [[2024,2,29]] },'2024-02-29'],
    [{ 'date-parts': [[2025]] },null],
    [{ 'date-parts': [[2025,1]] },null],
    [{ 'date-parts': [[2025,2,29]] },null],
    [{ 'date-time': '2025-02-30T00:00:00Z' },null],
    [{ 'date-parts': [[2025,13,2]] },null],
  ];
  const originalFetch=globalThis.fetch;
  try {
    for(const [date,expected] of dateCases){
      for(const route of ['metadata-updated-by','targeted-notice','published-notice']){
        const update={type:'correction',DOI:route==='metadata-updated-by'?noticeDoi:target,updated:date};
        const metadata=route==='metadata-updated-by'?{'updated-by':[update]}:{};
        const notice={DOI:noticeDoi,subtype:'correction',published:date,...(route==='targeted-notice'?{'update-to':[update]}:{})};
        globalThis.fetch=async input=>new Response(JSON.stringify({message:new URL(input).pathname==='/works'?{items:route==='metadata-updated-by'?[]:[notice]}:metadata}),{headers:{'content-type':'application/json'}});
        const updates=await fetchCrossrefUpdates({}, {doi:target});
        assert.equal(updates[0].date,expected,`${route} ${JSON.stringify(date)}`);
        const result=analyzeReplay('KRAS',[work('W1',2010,'KRAS',[],{updateStatus:updates}),work('W2',2012,'KRAS'),work('W3',2014,'KRAS')],[]);
        const events=result.events.filter(event=>event.eventType==='correction');
        assert.equal(events.length,expected?1:0);
        if(expected)assert.equal(events[0].eventDate,expected);
      }
    }
    // A later complete notice date must survive an earlier undated metadata relation.
    globalThis.fetch=async input=>new Response(JSON.stringify({message:new URL(input).pathname==='/works'
      ? {items:[{DOI:noticeDoi,subtype:'correction',published:{'date-parts':[[2025,1,2]]},'update-to':[{type:'correction',DOI:target}]}]}
      : {'updated-by':[{type:'correction',DOI:noticeDoi}]}}),{headers:{'content-type':'application/json'}});
    const deduped=await fetchCrossrefUpdates({}, {doi:target});
    assert.equal(deduped.length,1);assert.equal(deduped[0].date,'2025-01-02');
  } finally {globalThis.fetch=originalFetch;}
});
