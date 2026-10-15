import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/app.js';
import { createJournal } from '../src/journal.js';

let app;
let ollama;
let baseUrl;
let dataDir;
let lotId;
const plan = {
  headline: 'Revisar el lote',
  priorities: ['Observar'],
  thisWeek: ['Registrar'],
  watch: ['Humedad'],
  disclaimer: 'Confirmá con un técnico.'
};
const diagnosis = {
  subject: 'pod',
  findings: [{ issue: 'healthy', confidence: 'medium', evidence: 'Coloración normal.' }],
  podCounts: { healthy: 2, affected: 1 },
  summary: 'Se observan dos mazorcas sanas y una por revisar.',
  actions: ['Revisar de nuevo'],
  verify: 'Confirmar con un técnico.'
};
const cutTest = {
  counts: { brown: 3, purple: 1, slaty: 0, moldy: 0, other: 0 },
  fermentationNote: 'Predomina la fermentación.',
  confidence: 'medium'
};

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

async function call(path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { response, body };
}

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'mazorca-http-'));
  ollama = createServer(async (request, response) => {
    if (request.url === '/api/tags') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      return response.end('{"models":[]}');
    }
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    const content = payload.messages[1].content.includes('weekly action')
      ? plan
      : payload.messages[1].content.includes('cut test') ? cutTest : diagnosis;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: { content: JSON.stringify(content) } }));
  });
  const ollamaUrl = await listen(ollama);
  app = createApp({ ollamaUrl, dataDir, model: 'modelo-prueba', ollamaTimeoutMs: 500 });
  baseUrl = await listen(app);
  lotId = (await call('/api/lotes')).body[0].id;
});

after(async () => {
  app?.closeAllConnections();
  ollama?.closeAllConnections();
  if (app) await new Promise(resolve => app.close(resolve));
  if (ollama) await new Promise(resolve => ollama.close(resolve));
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

test('diagnostica y ejecuta las rutas de plan y corte con el modelo simulado', async () => {
  const diagnosed = await call('/api/diagnose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: 'data:image/jpeg;base64,aGVsbG8=', loteId: lotId })
  });
  assert.equal(diagnosed.response.status, 200);
  assert.equal(diagnosed.body.subject, 'pod');

  const planned = await call(`/api/lotes/${lotId}/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(planned.response.status, 200);
  assert.equal(planned.body.headline, plan.headline);

  const cut = await call('/api/cut-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: 'aGVsbG8=', loteId: lotId })
  });
  assert.equal(cut.response.status, 200);
  assert.deepEqual(cut.body.counts, cutTest.counts);
});

test('escapa CSV con comas, comillas y saltos de línea', async () => {
  const journal = createJournal(dataDir);
  await journal.addObservation({
    loteId: lotId,
    result: {
      subject: 'hoja, "revisar"',
      findings: [{ issue: 'línea\nsegunda' }],
      podCounts: { healthy: 2, affected: 1 }
    }
  });
  const exported = await call(`/api/lotes/${lotId}/export.csv`);
  assert.equal(exported.response.status, 200);
  assert.match(exported.body, /fecha,subject,issues/);
  assert.match(exported.body, /"\{""healthy"":2,""affected"":1\}"/);
  assert.match(exported.body, /"hoja, ""revisar"""/);
  assert.match(exported.body, /"línea\nsegunda"/);
});

test('devuelve 404 al borrar un lote inexistente y 405 para método no permitido', async () => {
  const missing = await call('/api/lotes/no-existe', { method: 'DELETE' });
  assert.equal(missing.response.status, 404);

  const method = await call('/api/health', { method: 'POST' });
  assert.equal(method.response.status, 405);
  assert.equal(method.response.headers.get('allow'), 'GET');
});
