import { networkInterfaces } from 'node:os';
import { createApp } from './src/app.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error('PORT debe ser un puerto válido.');
}

const app = createApp({
  model: process.env.MAZORCA_MODEL ?? 'gemma4:e4b-it-qat',
  ollamaUrl: process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434',
  dataDir: process.env.DATA_DIR ?? './data',
  ollamaTimeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS ?? 180000),
  elevenlabsApiKey: process.env.ELEVENLABS_API_KEY ?? '',
  elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID ?? ''
});

app.on('request', (request, response) => {
  const started = Date.now();

  response.on('finish', () => {
    if (request.url.startsWith('/api/')) {
      console.log(
        `${new Date().toLocaleTimeString()} ${request.method} ${request.url} ` +
          `${response.statusCode} ${Date.now() - started} ms`
      );
    }
  });
});

app.on('error', error => {
  console.error('No se pudo iniciar Mazorca:', error.message);
  process.exitCode = 1;
});

app.listen(port, host, () => {
  const actualPort = app.address().port;
  console.log(`Mazorca: http://localhost:${actualPort}`);

  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (!address.internal && address.family === 'IPv4') {
        console.log(`Red local: http://${address.address}:${actualPort}`);
      }
    }
  }
});
