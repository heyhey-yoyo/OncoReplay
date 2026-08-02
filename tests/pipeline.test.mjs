import test from 'node:test';
import assert from 'node:assert/strict';
import { namespaceAnalysis, topicAffinity, buildSearchTopics, validateChunk, validateNarrative } from '../src/worker/lib/pipeline.js';

test('community IDs are namespaced per replay', () => {
  const raw = {
    branches: [{ id: 'c0' }, { id: 'c1' }],
    scoredWorks: [{ id: 'W1', branchId: 'c0' }, { id: 'W2', branchId: 'c1' }],
    events: [{ id: 'E1', branchIds: ['c0', 'c1'] }],
  };
  const left = namespaceAnalysis(raw, 'aaaaaaaa-1111');
  const right = namespaceAnalysis(raw, 'bbbbbbbb-2222');
  assert.notEqual(left.branches[0].id, right.branches[0].id);
  assert.equal(left.scoredWorks[0].branchId, left.branches[0].id);
  assert.deepEqual(left.events[0].branchIds, left.branches.map((branch) => branch.id));
});

test('narrative validation accepts exact source-bound output', () => {
  const branches = [{ id: 'b1' }];
  const events = [{ id: 'e1', sourceWorkIds: ['W1', 'W2'] }];
  const works = [{ id: 'W1' }, { id: 'W2' }];
  const payload = {
    branches: [{ branch_id: 'b1', label: '机制', description: '机制研究分支。' }],
    events: [{ event_id: 'e1', title: '事件', summary: '来源约束的摘要。', selection_reason: '规则评分选择。', source_work_ids: ['W1'], confidence: 0.7, requires_review: false }],
    open_questions: ['仍需核查什么？'],
  };
  assert.equal(validateNarrative(payload, branches, events, works), payload);
});

test('narrative validation rejects invented evidence IDs', () => {
  const branches = [{ id: 'b1' }];
  const events = [{ id: 'e1', sourceWorkIds: ['W1'] }];
  const works = [{ id: 'W1' }, { id: 'W9' }];
  const payload = {
    branches: [{ branch_id: 'b1', label: '机制', description: '机制研究分支。' }],
    events: [{ event_id: 'e1', title: '事件', summary: '摘要。', selection_reason: '原因。', source_work_ids: ['W9'], confidence: 0.7, requires_review: false }],
    open_questions: [],
  };
  assert.throws(() => validateNarrative(payload, branches, events, works), /outside its supplied evidence/);
});

test('chunk validation accepts a valid event batch', () => {
  const batch = [{ id: 'e1', sourceWorkIds: ['W1', 'W2'] }];
  const works = [{ id: 'W1' }, { id: 'W2' }];
  const payload = {
    events: [{ event_id: 'e1', title: '事件', summary: '来源约束的摘要。', selection_reason: '规则评分选择。', source_work_ids: ['W1'], confidence: 0.7, requires_review: false }],
  };
  assert.equal(validateChunk(payload, 'events', batch, works, ['e1'])[0].event_id, 'e1');
});

test('chunk validation rejects an event outside its batch', () => {
  const batch = [{ id: 'e1', sourceWorkIds: ['W1'] }];
  const works = [{ id: 'W1' }];
  const payload = {
    events: [{ event_id: 'e9', title: '事件', summary: '摘要。', selection_reason: '原因。', source_work_ids: ['W1'], confidence: 0.7, requires_review: false }],
  };
  assert.throws(() => validateChunk(payload, 'events', batch, works, ['e1']), /Unknown or duplicate event id/);
});

test('chunk validation requires full branch coverage', () => {
  const works = [];
  const payload = { branches: [{ branch_id: 'b1', label: '机制', description: '机制研究分支。' }] };
  assert.throws(() => validateChunk(payload, 'branches', [], works, ['b1', 'b2']), /omitted one or more supplied branches/);
});

test('topicAffinity excludes fulltext-only strays for a gene-symbol topic', () => {
  const gate = topicAffinity('VAX2');
  assert.equal(gate({ title: 'FADD, a novel death domain-containing protein', abstract: 'Fas cytoplasmic domain, yeast two-hybrid, apoptosis.', topics: [], keywords: [] }), false);
  assert.equal(gate({ title: 'The homeodomain protein Vax2 patterns the eye', abstract: '', topics: [], keywords: [] }), true);
  assert.equal(gate({ title: 'Retinal development', abstract: '', topics: [{ displayName: 'Vax2 gene' }], keywords: [] }), true);
});

test('topicAffinity is disabled for pure CJK topics', () => {
  const gate = topicAffinity('肺癌 免疫治疗');
  assert.equal(gate({ title: 'anything at all', abstract: '', topics: [], keywords: [] }), true);
});

test('topicAffinity accepts any shared token for multi-token topics', () => {
  const gate = topicAffinity('YAP1 and EGFR-TKI resistance');
  assert.equal(gate({ title: 'Acquired resistance to EGFR-TKI in NSCLC', abstract: '', topics: [], keywords: [] }), true);
  assert.equal(gate({ title: 'A tale of two pathways', abstract: 'No overlapping vocabulary here.', topics: [], keywords: [] }), false);
});

test('buildSearchTopics narrows to broad in order and dedupes', () => {
  assert.deepEqual(buildSearchTopics('YWHAG', { cancerType: 'Stomach adenocarcinoma', angle: 'all' }), ['YWHAG (stomach adenocarcinoma OR gastric cancer OR gastric adenocarcinoma OR stomach cancer OR gastric carcinoma)', 'YWHAG']);
  assert.deepEqual(buildSearchTopics('YWHAG', { cancerType: 'Stomach adenocarcinoma', angle: 'mechanism' }), ['YWHAG (stomach adenocarcinoma OR gastric cancer OR gastric adenocarcinoma OR stomach cancer OR gastric carcinoma) mechanism signaling pathway', 'YWHAG (stomach adenocarcinoma OR gastric cancer OR gastric adenocarcinoma OR stomach cancer OR gastric carcinoma)', 'YWHAG']);
  assert.deepEqual(buildSearchTopics('KRAS', { cancerType: '', angle: 'all' }), ['KRAS']);
  assert.equal(buildSearchTopics('KRAS', { cancerType: 'KRAS', angle: 'all' })[1], 'KRAS');
});

test('expandCancerType covers every TCGA type with an OR group', async () => {
  const { expandCancerType } = await import('../src/worker/lib/cancer-types.js');
  const names = ['Pan-cancer', 'Adrenocortical carcinoma', 'Bladder urothelial carcinoma', 'Breast invasive carcinoma', 'Cervical squamous cell carcinoma and endocervical adenocarcinoma', 'Cholangiocarcinoma', 'Colon adenocarcinoma', 'Diffuse large B-cell lymphoma', 'Esophageal carcinoma', 'Glioblastoma multiforme', 'Head and neck squamous cell carcinoma', 'Kidney chromophobe', 'Kidney renal clear cell carcinoma', 'Kidney renal papillary cell carcinoma', 'Acute myeloid leukemia', 'Brain lower grade glioma', 'Liver hepatocellular carcinoma', 'Lung adenocarcinoma', 'Lung squamous cell carcinoma', 'Mesothelioma', 'Ovarian serous cystadenocarcinoma', 'Pancreatic adenocarcinoma', 'Pheochromocytoma and paraganglioma', 'Prostate adenocarcinoma', 'Rectum adenocarcinoma', 'Sarcoma', 'Skin cutaneous melanoma', 'Stomach adenocarcinoma', 'Testicular germ cell tumors', 'Thyroid carcinoma', 'Thymoma', 'Uterine corpus endometrial carcinoma', 'Uterine carcinosarcoma', 'Uveal melanoma'];
  for (const name of names) {
    const group = expandCancerType(name);
    assert.match(group, /^\(.+OR.+/i, `${name} should expand to an OR group`);
    assert.ok(group.toLowerCase().includes(name.toLowerCase().split(' ')[0]), `${name} group should keep the base name`);
  }
  assert.equal(expandCancerType(''), '');
  assert.equal(expandCancerType('Not a real type'), 'Not a real type');
});
