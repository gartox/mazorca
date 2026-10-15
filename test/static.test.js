import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractJson } from '../src/ollama.js';

test('extrae JSON envuelto y conserva el flujo de Kestra', async () => {
  assert.deepEqual(extractJson('texto\n```json\n{"ok":true}\n```'), { ok: true });
  const yaml = await readFile(new URL('../kestra/mazorca-weekly-plan.yaml', import.meta.url), 'utf8');

  for (const word of ['Loop', 'If', 'Schedule', 'SlackIncomingWebhook', 'messageText']) {
    assert.match(yaml, new RegExp(word));
  }
});
