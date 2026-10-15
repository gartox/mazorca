import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/app.js';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

test('reintenta JSON roto dos veces y responde 502', async () => {
  const requests = [];
  const ollama = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push(JSON.parse(body));
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: { content: '{ roto' } }));
  });
  const dataDir = await mkdtemp(join(tmpdir(), 'mazorca-invalid-json-'));
  const ollamaUrl = await listen(ollama);
  const app = createApp({ ollamaUrl, dataDir, model: 'modelo-json-roto', ollamaTimeoutMs: 2000 });
  const baseUrl = await listen(app);
  const response = await fetch(`${baseUrl}/api/diagnose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: 'aGVsbG8=',
      loteId: (await (await fetch(`${baseUrl}/api/lotes`)).json())[0].id
    })
  });

  assert.equal(response.status, 502);
  assert.equal(requests.length, 2);
  app.closeAllConnections();
  ollama.closeAllConnections();
  await new Promise(resolve => app.close(resolve));
  await new Promise(resolve => ollama.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

test('reintenta sin format después de 501 y recuerda la capacidad', async () => {
  const requests = [];
  const ollama = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    requests.push(payload);
    if (payload.format) {
      response.writeHead(501);
      return response.end('Not Implemented');
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: { content: '{"subject":"pod"}' } }));
  });
  const dataDir = await mkdtemp(join(tmpdir(), 'mazorca-no-format-'));
  const ollamaUrl = await listen(ollama);
  const app = createApp({ ollamaUrl, dataDir, model: 'modelo-no-format', ollamaTimeoutMs: 2000 });
  const baseUrl = await listen(app);
  const loteId = (await (await fetch(`${baseUrl}/api/lotes`)).json())[0].id;
  const post = () => fetch(`${baseUrl}/api/diagnose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: 'aGVsbG8=', loteId })
  });

  assert.equal((await post()).status, 200);
  assert.equal(requests.length, 3);
  assert.ok(requests[0].format);
  assert.equal(requests[1].format, undefined);
  assert.equal((await post()).status, 200);
  assert.equal(requests.length, 5);
  assert.equal(requests[2].format, undefined);
  assert.equal(requests[3].format, undefined);
  app.closeAllConnections();
  ollama.closeAllConnections();
  await new Promise(resolve => app.close(resolve));
  await new Promise(resolve => ollama.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

test('Ollama apagado devuelve 503 con las instrucciones', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'mazorca-offline-'));
  const app = createApp({
    ollamaUrl: 'http://127.0.0.1:1',
    dataDir,
    model: 'modelo-prueba'
  });
  const baseUrl = await listen(app);
  const loteId = (await (await fetch(`${baseUrl}/api/lotes`)).json())[0].id;
  const response = await fetch(`${baseUrl}/api/diagnose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: 'aGVsbG8=', loteId })
  });
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.match(body.error, /ollama serve/);
  assert.match(body.error, /ollama pull modelo-prueba/);
  app.closeAllConnections();
  await new Promise(resolve => app.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});
