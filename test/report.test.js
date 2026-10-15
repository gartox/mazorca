import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../src/app.js';

const at = days => new Date(Date.UTC(2026, 0, 15 - days)).toISOString();
const observation = (createdAt, affected, healthy = 0) => ({
  loteId: 'a',
  createdAt,
  result: {
    findings: [{ issue: 'black_pod' }],
    podCounts: { healthy, affected }
  }
});

test('calcula tendencia subió, bajó, igual y sin datos', () => {
  const now = new Date(Date.UTC(2026, 0, 15));
  assert.equal(
    buildReport([observation(at(1), 8, 2), observation(at(8), 1, 9)], 'a', 7, now).trend,
    'subió'
  );
  assert.equal(
    buildReport([observation(at(1), 1, 9), observation(at(8), 8, 2)], 'a', 7, now).trend,
    'bajó'
  );
  assert.equal(
    buildReport([observation(at(1), 1, 9), observation(at(8), 1, 9)], 'a', 7, now).trend,
    'igual'
  );
  assert.equal(buildReport([], 'a', 7, now).trend, 'sin datos');
});

test('no divide entre cero al calcular porcentaje', () => {
  const now = new Date(Date.UTC(2026, 0, 15));
  assert.equal(buildReport([observation(at(1), 0, 0)], 'a', 7, now).affectedPercentage, null);
});
