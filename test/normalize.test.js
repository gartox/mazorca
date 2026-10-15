import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCutTest, normalizeDiagnosis, normalizePlan } from '../src/normalize.js';

test('normaliza salida adversaria y descarta campos extra', () => {
  const result = normalizeDiagnosis({
    subject: 'palmera',
    findings: [
      { issue: 'dragon', confidence: 'certain', evidence: 'x'.repeat(400) },
      { issue: 'healthy', confidence: 'high', evidence: 'ok' }
    ],
    podCounts: { healthy: -4, affected: 2.5 },
    summary: 'x'.repeat(700),
    actions: ['a', 4, 'b', 'c', 'd', 'e'],
    verify: 5,
    extra: true
  });

  assert.equal(result.subject, 'unknown');
  assert.equal(result.findings[0].issue, 'unknown');
  assert.equal(result.findings[0].confidence, 'low');
  assert.equal(result.findings[0].evidence.length, 300);
  assert.deepEqual(result.podCounts, { healthy: 0, affected: 0 });
  assert.equal(result.actions.length, 4);
  assert.equal(result.verify, '');
});

test('normaliza conteos negativos, enums inválidos y campos extra', () => {
  assert.deepEqual(
    normalizeCutTest({
      counts: { brown: 2, purple: -1, extra: 99 },
      confidence: 'certain',
      extra: '<script>'
    }),
    {
      counts: { brown: 2, purple: 0, slaty: 0, moldy: 0, other: 0 },
      fermentationNote: '',
      confidence: 'low'
    }
  );
});

test('completa una misión y limita sus listas', () => {
  const result = normalizePlan({ priorities: ['a', 'b', 'c', 'd', 'e'] });
  assert.equal(result.priorities.length, 4);
  assert.deepEqual(result.thisWeek, []);
});
