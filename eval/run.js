// Evaluación del diagnóstico con el modelo local: compara un solo paso contra el diseño de dos pasos.
// Uso: node eval/run.js [salida.json]   (requiere Ollama con MAZORCA_MODEL descargado)
// EVAL_STEPS=two corre solo el diseño de dos pasos.
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chat, neutralSystemPrompt } from '../src/ollama.js';
import { diagnosisPrompt, observationPrompt } from '../src/app.js';
import {
  diagnosisSchema,
  enforceDiagnosisRules,
  normalizeDiagnosis,
  normalizeObservation,
  observationSchema
} from '../src/normalize.js';

const config = {
  ollamaUrl: process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434',
  model: process.env.MAZORCA_MODEL ?? 'gemma4:e4b-it-qat',
  ollamaTimeoutMs: 300000
};
const diseases = new Set(['moniliasis', 'black_pod', 'pod_disease', 'animal_damage', 'witches_broom']);
const podIssues = new Set(['moniliasis', 'black_pod', 'pod_disease', 'animal_damage', 'overripe', 'healthy']);
const singleStepPrompt =
  'Analyze this cacao plantation photo. Return visible findings only. Give a short two-sentence ' +
  'Spanish summary, up to four cultural actions, and when a technician should verify.';

// Igual que el navegador: lado mayor de 1024 px en JPEG, sin metadatos.
function prepare(file) {
  const out = `/tmp/mazorca-eval-${process.pid}.jpg`;
  execFileSync('sips', ['-Z', '1024', '-s', 'format', 'jpeg', file, '--out', out], { stdio: 'ignore' });
  return readFile(out, 'base64');
}

async function oneStep(image) {
  return normalizeDiagnosis(await chat(config, diagnosisSchema, singleStepPrompt, image));
}

async function twoStep(image) {
  const observation = normalizeObservation(
    await chat(config, observationSchema, observationPrompt, image, neutralSystemPrompt)
  );
  const result = enforceDiagnosisRules(
    normalizeDiagnosis(await chat(config, diagnosisSchema, diagnosisPrompt(observation, ''), image)),
    observation
  );
  return { ...result, observation };
}

function score(expect, result) {
  const found = result.findings.map(finding => finding.issue);
  const disease = found.some(issue => diseases.has(issue));
  const pods = result.podCounts.healthy + result.podCounts.affected;
  if (expect === 'no_pods') {
    return { found, ok: !found.some(issue => podIssues.has(issue)) && pods === 0, invented: pods > 0 || disease };
  }
  if (expect === 'healthy') return { found, ok: !disease, falseAlarm: disease };
  return { found, ok: disease, exact: found.includes(expect) };
}

const labels = JSON.parse(await readFile(new URL('./labels.json', import.meta.url), 'utf8'));
const rows = [];
for (const { file, expect } of labels) {
  const image = await prepare(file);
  const row = { file, expect };
  const variants = process.env.EVAL_STEPS === 'two' ? [['twoStep', twoStep]] : [['oneStep', oneStep], ['twoStep', twoStep]];
  for (const [name, run] of variants) {
    const started = Date.now();
    try {
      const result = await run(image);
      row[name] = { ...score(expect, result), seconds: Math.round((Date.now() - started) / 1000), result };
    } catch (error) {
      row[name] = { ok: false, error: error.message };
    }
  }
  rows.push(row);
  console.log(file, expect, 'one:', row.oneStep?.found ?? row.oneStep?.error, 'two:', row.twoStep.found ?? row.twoStep.error);
}

const output = process.argv[2] ?? 'eval/results.json';
await writeFile(output, JSON.stringify({ model: config.model, date: new Date().toISOString(), rows }, null, 2));
console.log(`Resultados en ${output}`);
