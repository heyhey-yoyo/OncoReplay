import test from 'node:test';
import assert from 'node:assert/strict';
import { namespaceAnalysis, validateNarrative } from '../src/worker/lib/pipeline.js';

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
