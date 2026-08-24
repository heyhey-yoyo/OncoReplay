import test from 'node:test';
import assert from 'node:assert/strict';
import { currentEvent, nodeWeight, playbackStep, slugify, visibleWorks, yearProgress } from '../public/core.mjs';

test('yearProgress clamps to the timeline', () => {
  assert.equal(yearProgress(2006, 2006, 2026), 0);
  assert.equal(yearProgress(2016, 2006, 2026), 50);
  assert.equal(yearProgress(2030, 2006, 2026), 100);
});

test('visibleWorks filters future records', () => {
  const works = [{ publicationYear: 2010 }, { publicationYear: 2018 }, { publicationYear: 2025 }];
  assert.equal(visibleWorks(works, 2018).length, 2);
});

test('currentEvent selects the latest eligible event', () => {
  const events = [{ id:'a', year:2010 }, { id:'b', year:2018 }, { id:'c', year:2024 }];
  assert.equal(currentEvent(events, 2020).id, 'b');
});

test('playbackStep respects speed and end year', () => {
  const mid = playbackStep(2010, 2006, 2026, 1000, 2);
  assert.ok(mid.year > 2013.5 && mid.year < 2013.7);
  const end = playbackStep(2025.5, 2006, 2026, 1000, 1);
  assert.deepEqual(end, { year:2026, finished:true });
});

test('nodeWeight changes with viewing mode', () => {
  const work = { normalizedImpact:.9, debateSignal:.2 };
  assert.ok(nodeWeight(work, 'momentum') > nodeWeight(work, 'debate'));
});

test('slugify creates stable URL text', () => {
  assert.equal(slugify(' KRAS G12D & Pancreatic Cancer '), 'kras-g12d-pancreatic-cancer');
});
