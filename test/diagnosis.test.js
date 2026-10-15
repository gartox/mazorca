import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/app.js';
import { enforceDiagnosisRules, normalizeObservation } from '../src/normalize.js';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

test('normaliza la observación y aplica las reglas de conteo', () => {
  assert.deepEqual(normalizeObservation({
    scene: '  troncos y pasto  ', people: -1, fruitsVisible: true,
    fruitCountEstimate: 1.5, closeUp: 1, notableColors: ['verde', 4]
  }), {
    scene: '  troncos y pasto  ', people: 0, fruitsVisible: true,
    fruitCountEstimate: 0, closeUp: false, notableColors: ['verde']
  });

  const noFruit = enforceDiagnosisRules({
    findings: [
      { issue: 'moniliasis' }, { issue: 'healthy' }, { issue: 'weeds' }
    ], podCounts: { healthy: 4, affected: 3 }
  }, normalizeObservation({ fruitsVisible: false }));
  assert.deepEqual(noFruit.podCounts, { healthy: 0, affected: 0 });
  assert.deepEqual(noFruit.findings.map(finding => finding.issue), ['weeds']);

  const capped = enforceDiagnosisRules({
    findings: [], podCounts: { healthy: 8, affected: 4 }
  }, normalizeObservation({ fruitsVisible: true, fruitCountEstimate: 4 }));
  assert.equal(capped.podCounts.healthy + capped.podCounts.affected, 8);
});

test('hace exactamente dos llamadas y mantiene neutral el prompt de observación', async () => {
  const prompts = [];
  const ollama = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    prompts.push(payload.messages[1].content);
    const result = prompts.length === 1
      ? { scene: 'pasto y troncos', people: 0, fruitsVisible: false, fruitCountEstimate: 0,
        closeUp: false, notableColors: ['verde'] }
      : { subject: 'pod', findings: [{ issue: 'moniliasis', confidence: 'high', evidence: 'manchas' }],
        podCounts: { healthy: 3, affected: 4 }, summary: 'Resumen.', actions: [], verify: 'Técnico.' };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: { content: JSON.stringify(result) } }));
  });
  const dataDir = await mkdtemp(join(tmpdir(), 'mazorca-diagnosis-'));
  const ollamaUrl = await listen(ollama);
  const app = createApp({ ollamaUrl, dataDir, model: 'modelo-prueba' });
  const baseUrl = await listen(app);
  try {
    const lotId = (await (await fetch(`${baseUrl}/api/lotes`)).json())[0].id;
    const response = await fetch(`${baseUrl}/api/diagnose`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: 'aGVsbG8=', loteId: lotId })
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(prompts.length, 2);
    assert.doesNotMatch(prompts[0].toLowerCase(), /cacao|cocoa|disease|pod|agriculture/);
    assert.deepEqual(result.observation, {
      scene: 'pasto y troncos', people: 0, fruitsVisible: false, fruitCountEstimate: 0,
      closeUp: false, notableColors: ['verde']
    });
    assert.deepEqual(result.podCounts, { healthy: 0, affected: 0 });
    assert.deepEqual(result.findings, []);
  } finally {
    app.closeAllConnections();
    ollama.closeAllConnections();
    await new Promise(resolve => app.close(resolve));
    await new Promise(resolve => ollama.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});
