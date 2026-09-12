import test from 'node:test';
import assert from 'node:assert/strict';
import { RATE_LIMIT_DEFAULTS, checkRateLimit, clientIp, resolveRateLimit, windowStartOf } from '../src/worker/lib/rate-limit.js';

// 模拟 D1：按本模块实际使用的两条语句（upsert + read）实现固定窗口计数语义。
function fakeD1() {
  const rows = new Map();
  return {
    prepare(sql) {
      return { bind: (...args) => ({ sql, args }) };
    },
    async batch(stmts) {
      const [upsert, read] = stmts;
      const [key, windowStart] = upsert.args;
      const current = rows.get(key);
      const next = current && current.window_start === windowStart
        ? { window_start: windowStart, count: current.count + 1 }
        : { window_start: windowStart, count: 1 };
      rows.set(key, next);
      assert.equal(read.args[0], key);
      return [{}, { results: [{ count: next.count }] }];
    },
  };
}

test('resolveRateLimit 非法配置回退默认值', () => {
  assert.equal(resolveRateLimit({}, 'RATE_LIMIT_CREATE_PER_HOUR'), RATE_LIMIT_DEFAULTS.RATE_LIMIT_CREATE_PER_HOUR);
  assert.equal(resolveRateLimit({ RATE_LIMIT_CREATE_PER_HOUR: '20' }, 'RATE_LIMIT_CREATE_PER_HOUR'), 20);
  assert.equal(resolveRateLimit({ RATE_LIMIT_CREATE_PER_HOUR: '-3' }, 'RATE_LIMIT_CREATE_PER_HOUR'), RATE_LIMIT_DEFAULTS.RATE_LIMIT_CREATE_PER_HOUR);
  assert.equal(resolveRateLimit({ RATE_LIMIT_CREATE_PER_HOUR: 'abc' }, 'RATE_LIMIT_CREATE_PER_HOUR'), RATE_LIMIT_DEFAULTS.RATE_LIMIT_CREATE_PER_HOUR);
  for (const value of ['1.5', '5garbage', 'Infinity', '0']) {
    assert.equal(resolveRateLimit({ RATE_LIMIT_CREATE_PER_HOUR: value }, 'RATE_LIMIT_CREATE_PER_HOUR'), RATE_LIMIT_DEFAULTS.RATE_LIMIT_CREATE_PER_HOUR);
  }
});

test('clientIp 优先 CF-Connecting-IP，缺失归入 unknown', () => {
  assert.equal(clientIp(new Request('https://example.com', { headers: { 'cf-connecting-ip': '1.2.3.4' } })), '1.2.3.4');
  assert.equal(clientIp(new Request('https://example.com')), 'unknown');
});

test('windowStartOf 对齐小时窗口起点', () => {
  assert.equal(windowStartOf(new Date('2026-09-12T15:42:31Z')), '2026-09-12T15:00:00.000Z');
});

test('checkRateLimit 固定窗口内计数并在超限时拒绝', async () => {
  const env = { DB: fakeD1() };
  const now = new Date('2026-09-12T15:10:00Z');
  const r1 = await checkRateLimit(env, 'replay-create:1.2.3.4', 2, now);
  const r2 = await checkRateLimit(env, 'replay-create:1.2.3.4', 2, now);
  const r3 = await checkRateLimit(env, 'replay-create:1.2.3.4', 2, now);
  assert.equal(r1.allowed, true);
  assert.equal(r1.count, 1);
  assert.equal(r2.allowed, true);
  assert.equal(r3.allowed, false);
  assert.equal(r3.count, 3);
  assert.ok(r3.retryAfterSeconds > 0 && r3.retryAfterSeconds <= 3600);
  // 窗口滚动后重新计数
  const nextWindow = await checkRateLimit(env, 'replay-create:1.2.3.4', 2, new Date('2026-09-12T16:05:00Z'));
  assert.equal(nextWindow.allowed, true);
  assert.equal(nextWindow.count, 1);
});

test('checkRateLimit 存储故障时 fail-open 放行', async () => {
  const broken = { DB: { prepare: () => { throw new Error('D1 down'); }, batch: async () => { throw new Error('D1 down'); } } };
  const result = await checkRateLimit(broken, 'k', 5);
  assert.deepEqual(result, { allowed: true, count: 0, retryAfterSeconds: 0 });
  const noDb = await checkRateLimit({}, 'k', 5);
  assert.equal(noDb.allowed, true);
});
