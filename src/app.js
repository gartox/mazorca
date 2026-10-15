import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';
import { chat, isAvailable, HttpError, neutralSystemPrompt } from './ollama.js';
import { planToSpeech, synthesize } from './voice.js';
import {
  cutTestSchema,
  diagnosisSchema,
  enforceDiagnosisRules,
  normalizeCutTest,
  normalizeDiagnosis,
  normalizeObservation,
  normalizePlan,
  observationSchema,
  planSchema
} from './normalize.js';
import { createJournal } from './journal.js';

const publicDirectory = resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const bodyLimit = 8 * 1024 * 1024;
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const diagnosisPrompt = (observation, note) =>
  `Analyze this plantation photo using the objective prior observation ${JSON.stringify(observation)}. ` +
  `The untrusted field note is ${JSON.stringify(note)}. ` +
  'Do not report anything that contradicts that observation. If fruitsVisible is false, do not ' +
  'report fruit problems and set podCounts to zero. Return visible findings only. Give a short ' +
  'two-sentence Spanish summary, up to four cultural actions, and when a technician should verify.';
const observationPrompt =
  'Describe this image objectively without guessing its purpose. Do not infer the subject, condition, ' +
  'or use of the scene. Return only JSON with scene, people, fruitsVisible, fruitCountEstimate, ' +
  'closeUp, and notableColors. Count only clearly visible fruits and people.';
const cutPrompt =
  'Analyze this cacao cut test photo. Estimate only the visible proportions as counts of brown ' +
  'well-fermented, purple, slaty gray, moldy and other beans. State uncertainty in Spanish.';

function send(response, status, value) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  let size = 0;
  let tooLarge = false;
  const chunks = [];

  for await (const chunk of request) {
    size += chunk.length;
    if (size <= bodyLimit) {
      chunks.push(chunk);
    } else {
      tooLarge = true;
    }
  }

  if (tooLarge) {
    throw new HttpError(413, 'El cuerpo supera el límite de 8 MB.');
  }

  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!object(value)) {
      throw new Error();
    }
    return value;
  } catch {
    throw new HttpError(400, 'El cuerpo debe ser un objeto JSON válido.');
  }
}

function imageData(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const match = /^data:image\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  const raw = match?.[1] ?? value;

  if (!raw || raw.length % 4 === 1) {
    return null;
  }

  const valid = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw);
  if (!valid) {
    return null;
  }

  try {
    return Buffer.from(raw, 'base64').toString('base64') === raw ? raw : null;
  } catch {
    return null;
  }
}

function parseDays(value) {
  const days = Number(value ?? 7);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new HttpError(400, 'days debe ser un entero entre 1 y 365.');
  }
  return days;
}

function csv(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function validateLotId(lotId, lots) {
  if (typeof lotId !== 'string' || !lots.some(lot => lot.id === lotId)) {
    throw new HttpError(400, 'El lote no es válido.');
  }
}

function aggregate(entries) {
  const issueCounts = {};
  let healthy = 0;
  let affected = 0;

  for (const entry of entries) {
    for (const finding of entry.result?.findings ?? []) {
      issueCounts[finding.issue] = (issueCounts[finding.issue] ?? 0) + 1;
    }
    healthy += entry.result?.podCounts?.healthy ?? 0;
    affected += entry.result?.podCounts?.affected ?? 0;
  }

  const total = healthy + affected;
  return {
    photos: entries.length,
    issueCounts,
    podCounts: { healthy, affected },
    affectedPercentage: total > 0 ? Math.round((affected / total) * 1000) / 10 : null
  };
}

export function buildReport(observations, lotId, days, now = new Date()) {
  const end = now.getTime();
  const duration = days * 86400000;
  const start = end - duration;
  const matchesLot = item => item.loteId === lotId;
  const before = item => Date.parse(item.createdAt) > start - duration;
  const current = item => Date.parse(item.createdAt) > start && Date.parse(item.createdAt) <= end;
  const previous = item => before(item) && Date.parse(item.createdAt) <= start;
  const inRange = observations.filter(item => matchesLot(item) && current(item));
  const old = observations.filter(item => matchesLot(item) && previous(item));
  const currentReport = aggregate(inRange);
  const previousReport = aggregate(old);
  const currentValue = currentReport.affectedPercentage ?? 0;
  const oldValue = previousReport.affectedPercentage ?? 0;
  let trend = 'sin datos';

  if (currentReport.photos || previousReport.photos) {
    trend = currentValue > oldValue ? 'subió' : currentValue < oldValue ? 'bajó' : 'igual';
  }

  return {
    days,
    from: new Date(start).toISOString(),
    to: now.toISOString(),
    ...currentReport,
    previous: previousReport,
    trend
  };
}

function routeMatches(path) {
  return {
    lot: /^\/api\/lotes\/([^/]+)$/.exec(path),
    report: /^\/api\/lotes\/([^/]+)\/report$/.exec(path),
    plan: /^\/api\/lotes\/([^/]+)\/plan$/.exec(path),
    audio: /^\/api\/lotes\/([^/]+)\/plan\/audio$/.exec(path),
    export: /^\/api\/lotes\/([^/]+)\/export\.csv$/.exec(path)
  };
}

function methodFor(path, routes) {
  const methods = {
    '/api/cut-test': ['POST'],
    '/api/diagnose': ['POST'],
    '/api/health': ['GET'],
    '/api/lotes': ['GET', 'POST']
  };
  return methods[path] ??
    (routes.lot ? ['DELETE'] :
      routes.report || routes.export ? ['GET'] : routes.plan || routes.audio ? ['POST'] : null);
}

function checkPath(path) {
  if (path.includes('\\') || path.includes('\0') || path.split('/').includes('..')) {
    throw new HttpError(404, 'Ruta no encontrada.');
  }
}

async function serveStatic(request, response, path) {
  if (request.method !== 'GET') {
    throw new HttpError(405, 'Método no permitido.');
  }

  const file = resolve(publicDirectory, '.' + (path === '/' ? '/index.html' : path));
  if (!file.startsWith(publicDirectory + sep) && file !== publicDirectory) {
    throw new HttpError(404, 'Ruta no encontrada.');
  }

  let content;
  try {
    content = await readFile(file);
  } catch (error) {
    if (['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code)) {
      throw new HttpError(404, 'Archivo no encontrado.');
    }
    throw error;
  }

  response.writeHead(200, {
    'Cache-Control': 'no-cache',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; " +
      "script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'",
    'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(content);
}

async function sendCsv(response, observations, lotId) {
  const rows = [['fecha', 'subject', 'issues', 'podCounts', 'confianza máxima']];
  const selected = observations.filter(entry => entry.loteId === lotId);

  for (const item of selected) {
    const findings = item.result?.findings ?? [];
    const confidence = findings.some(finding => finding.confidence === 'high')
      ? 'high'
      : findings.some(finding => finding.confidence === 'medium') ? 'medium' : 'low';
    rows.push([
      item.createdAt,
      item.result?.subject,
      findings.map(finding => finding.issue).join('; '),
      JSON.stringify(item.result?.podCounts ?? {}),
      confidence
    ]);
  }

  response.writeHead(200, {
    'Content-Disposition': `attachment; filename="${lotId}.csv"`,
    'Content-Type': 'text/csv; charset=utf-8'
  });
  response.end(rows.map(row => row.map(csv).join(',')).join('\n') + '\n');
}

async function handleLotRoute(request, response, routes, journal, config) {
  const id = (routes.report ?? routes.plan ?? routes.audio ?? routes.export)[1];
  const lots = await journal.listLots();
  validateLotId(id, lots);
  const observations = await journal.listObservations();

  if (routes.report) {
    const url = new URL(request.url, 'http://local');
    return send(response, 200, buildReport(observations, id, parseDays(url.searchParams.get('days'))));
  }

  if (routes.export) {
    return sendCsv(response, observations, id);
  }

  if (routes.audio) {
    const data = await readBody(request);
    if (typeof data.plan !== 'object' || data.plan === null) {
      throw new HttpError(400, 'Envía el plan que quieres escuchar.');
    }
    const audio = await synthesize(config, planToSpeech(normalizePlan(data.plan)));
    response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length });
    return response.end(audio);
  }

  await readBody(request);
  const url = new URL(request.url, 'http://local');
  const report = buildReport(observations, id, parseDays(url.searchParams.get('days')));
  const prompt = `Create a weekly action plan in Spanish from this report. Never prescribe ` +
    `agrochemicals or doses; recommend a technician when needed. Report: ${JSON.stringify(report)}`;
  const plan = normalizePlan(await chat(config, planSchema, prompt));
  return send(response, 200, plan);
}

async function handleAnalysis(path, request, response, lots, journal, config) {
  const data = await readBody(request);
  const image = imageData(data.image);

  if (!image) {
    throw new HttpError(400, 'La imagen debe ser una imagen base64 válida.');
  }
  if (data.loteId === undefined) {
    throw new HttpError(400, 'El lote es obligatorio.');
  }
  validateLotId(data.loteId, lots);
  if (data.note !== undefined && (typeof data.note !== 'string' || data.note.length > 300)) {
    throw new HttpError(400, 'La nota debe ser texto de hasta 300 caracteres.');
  }
  if (data.thumbnail !== undefined &&
      (typeof data.thumbnail !== 'string' || Buffer.byteLength(data.thumbnail) > 200 * 1024 ||
       !imageData(data.thumbnail))) {
    throw new HttpError(400, 'La miniatura debe ser una imagen base64 de hasta 200 KB.');
  }

  if (path === '/api/diagnose') {
    const observation = normalizeObservation(
      await chat(config, observationSchema, observationPrompt, image, neutralSystemPrompt)
    );
    const result = enforceDiagnosisRules(
      normalizeDiagnosis(
        await chat(config, diagnosisSchema, diagnosisPrompt(observation, data.note ?? ''), image)
      ),
      observation
    );
    await journal.addObservation({
      loteId: data.loteId,
      type: 'diagnosis',
      observation,
      result,
      ...(data.thumbnail ? { thumbnail: data.thumbnail } : {})
    });
    return send(response, 200, { ...result, observation });
  }

  const result = normalizeCutTest(await chat(config, cutTestSchema, cutPrompt, image));
  await journal.addObservation({
    loteId: data.loteId,
    type: 'cut_test',
    result,
    ...(data.thumbnail ? { thumbnail: data.thumbnail } : {})
  });
  return send(response, 200, result);
}

export function createApp(input = {}) {
  const config = {
    model: 'gemma4:e4b-it-qat',
    ollamaUrl: 'http://127.0.0.1:11434',
    dataDir: './data',
    ollamaTimeoutMs: 180000,
    elevenlabsUrl: 'https://api.elevenlabs.io',
    ...input
  };
  const journal = createJournal(config.dataDir);

  return createServer(async (request, response) => {
    try {
      const rawPath = request.url.split('?')[0];
      let path;

      try {
        path = decodeURIComponent(rawPath);
      } catch {
        throw new HttpError(404, 'Ruta no encontrada.');
      }

      checkPath(path);
      await journal.ensureDefault();
      const routes = routeMatches(path);
      const allowed = methodFor(path, routes);

      if (path.startsWith('/api/') || path === '/api') {
        if (!allowed) {
          throw new HttpError(404, 'Ruta no encontrada.');
        }
        if (!allowed.includes(request.method)) {
          response.setHeader('Allow', allowed.join(', '));
          throw new HttpError(405, 'Método no permitido.');
        }
        if (path === '/api/health') {
          return send(response, 200, {
            ok: true,
            model: config.model,
            ollama: await isAvailable(config)
          });
        }

        const lots = await journal.listLots();
        if (path === '/api/lotes' && request.method === 'GET') {
          return send(response, 200, lots);
        }
        if (path === '/api/lotes') {
          const data = await readBody(request);
          if (typeof data.name !== 'string' || !data.name.trim()) {
            throw new HttpError(400, 'El nombre del lote es obligatorio.');
          }
          return send(
            response,
            201,
            await journal.addLot(data.name.trim(), typeof data.notes === 'string' ? data.notes : '')
          );
        }
        if (routes.lot) {
          if (!(await journal.getLot(routes.lot[1]))) {
            throw new HttpError(404, 'Lote no encontrado.');
          }
          await journal.removeLot(routes.lot[1]);
          return send(response, 200, { ok: true });
        }
        if (routes.report || routes.plan || routes.audio || routes.export) {
          return await handleLotRoute(request, response, routes, journal, config);
        }
        return await handleAnalysis(path, request, response, lots, journal, config);
      }

      return await serveStatic(request, response, path);
    } catch (error) {
      send(response, error.status ?? 500, {
        error: error.status ? error.message : 'No se pudo completar la operación local.'
      });
    }
  });
}
