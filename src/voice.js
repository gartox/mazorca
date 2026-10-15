import { HttpError } from './ollama.js';

// Voz multilingüe de la biblioteca pública de ElevenLabs; habla español con eleven_multilingual_v2.
const defaultVoiceId = 'JBFqnCBsd6RMkjVDRZzb';
const maxCharacters = 2500;

export function planToSpeech(plan) {
  const lines = [plan.headline];
  if (plan.priorities?.length) lines.push(`Prioridades: ${plan.priorities.join('. ')}.`);
  if (plan.thisWeek?.length) lines.push(`Esta semana: ${plan.thisWeek.join('. ')}.`);
  if (plan.watch?.length) lines.push(`Vigila: ${plan.watch.join('. ')}.`);
  if (plan.disclaimer) lines.push(plan.disclaimer);
  return lines.filter(Boolean).join(' ').slice(0, maxCharacters);
}

export async function synthesize(config, text) {
  if (!config.elevenlabsApiKey) {
    throw new HttpError(
      503,
      'El audio necesita una clave de ElevenLabs. Define ELEVENLABS_API_KEY antes de iniciar Mazorca.'
    );
  }
  if (typeof text !== 'string' || !text.trim()) {
    throw new HttpError(400, 'No hay texto para convertir en audio.');
  }
  if (text.length > maxCharacters) {
    throw new HttpError(400, `El texto supera ${maxCharacters} caracteres.`);
  }

  const voiceId = config.elevenlabsVoiceId || defaultVoiceId;
  const url = new URL(`/v1/text-to-speech/${encodeURIComponent(voiceId)}`, config.elevenlabsUrl);
  url.searchParams.set('output_format', 'mp3_44100_128');

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(config.elevenlabsTimeoutMs ?? 60000),
      headers: { 'xi-api-key': config.elevenlabsApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' })
    });
  } catch {
    // El audio es lo único que necesita internet; el resto de Mazorca sigue funcionando sin él.
    throw new HttpError(503, 'No se pudo conectar con ElevenLabs. El audio requiere internet.');
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw new HttpError(502, `ElevenLabs respondió con error ${response.status}.`);
  }
  return Buffer.from(await response.arrayBuffer());
}
