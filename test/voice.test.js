import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/app.js';
import { planToSpeech } from '../src/voice.js';

function listen(server) {
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

const plan = {
  headline: 'Semana de retiro de mazorcas',
  priorities: ['Retirar mazorcas con monilia'],
  thisWeek: ['Recorrer el lote 2'],
  watch: ['Mazorcas jóvenes'],
  disclaimer: 'Confirma con un técnico.'
};

async function withApp(options, run) {
  const dataDir = await mkdtemp(join(tmpdir(), 'mazorca-voice-'));
  const app = createApp({ dataDir, ...options });
  const baseUrl = await listen(app);
  const lotId = (await (await fetch(`${baseUrl}/api/lotes`)).json())[0].id;
  try {
    await run(baseUrl, lotId);
  } finally {
    app.closeAllConnections();
    await new Promise(resolve => app.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
}

const postAudio = (baseUrl, lotId, body) => fetch(`${baseUrl}/api/lotes/${lotId}/plan/audio`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

test('convierte el plan en un texto hablado en orden', () => {
  const text = planToSpeech(plan);
  assert.match(text, /^Semana de retiro de mazorcas Prioridades: Retirar mazorcas con monilia\./);
  assert.match(text, /Confirma con un técnico\.$/);
});

test('sin clave de ElevenLabs responde 503 con instrucciones', async () => {
  await withApp({}, async (baseUrl, lotId) => {
    const response = await postAudio(baseUrl, lotId, { plan });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /ELEVENLABS_API_KEY/);
  });
});

test('envía el plan a ElevenLabs y devuelve el MP3', async () => {
  const requests = [];
  const eleven = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ url: request.url, key: request.headers['xi-api-key'], body: JSON.parse(body) });
    response.writeHead(200, { 'Content-Type': 'audio/mpeg' });
    response.end(Buffer.from('ID3-audio-falso'));
  });
  const elevenlabsUrl = await listen(eleven);
  try {
    await withApp({ elevenlabsUrl, elevenlabsApiKey: 'clave-prueba', elevenlabsVoiceId: 'voz1' },
      async (baseUrl, lotId) => {
        const response = await postAudio(baseUrl, lotId, { plan });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'audio/mpeg');
        assert.equal(Buffer.from(await response.arrayBuffer()).toString(), 'ID3-audio-falso');
        assert.equal(requests.length, 1);
        assert.equal(requests[0].key, 'clave-prueba');
        assert.match(requests[0].url, /^\/v1\/text-to-speech\/voz1\?output_format=mp3_44100_128$/);
        assert.equal(requests[0].body.model_id, 'eleven_multilingual_v2');
        assert.match(requests[0].body.text, /Retirar mazorcas con monilia/);
      });
  } finally {
    eleven.closeAllConnections();
    await new Promise(resolve => eleven.close(resolve));
  }
});

test('un error de ElevenLabs se reporta como 502 y un plan ausente como 400', async () => {
  const eleven = createServer((request, response) => {
    response.writeHead(401);
    response.end('{}');
  });
  const elevenlabsUrl = await listen(eleven);
  try {
    await withApp({ elevenlabsUrl, elevenlabsApiKey: 'mala' }, async (baseUrl, lotId) => {
      assert.equal((await postAudio(baseUrl, lotId, { plan })).status, 502);
      assert.equal((await postAudio(baseUrl, lotId, {})).status, 400);
    });
  } finally {
    eleven.closeAllConnections();
    await new Promise(resolve => eleven.close(resolve));
  }
});
