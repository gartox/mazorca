# Mazorca

Mazorca is a local, mobile-first cacao-plantation walk assistant for small producers in Tabasco. A producer photographs pods, leaves and trees, and an open model running through Ollama on a laptop returns a cautious, confidence-labeled observation by lot.

It is designed for places without signal: images stay local, farm data stays private, there is no cloud service and no per-photo cost. The model is replaceable. Mazorca never gives agrochemical doses and does not replace a technician, a laboratory or a definitive diagnosis.

## Run it

Install Ollama separately, then download the default model:

```text
ollama pull gemma4:e4b-it-qat
npm start
```

Open `http://127.0.0.1:3000` on the laptop, or open the laptop's local network IP from a phone connected to the same hotspot. Use `OLLAMA_URL`, `MAZORCA_MODEL`, `DATA_DIR`, `PORT` and `OLLAMA_TIMEOUT_MS` to configure the local setup. The default Ollama timeout is 180 seconds.

Kestra is optional. `kestra/mazorca-weekly-plan.yaml` is disabled by default and can request weekly reports/plans for a JSON list of lots. Its Slack notification requires the `SLACK_WEBHOOK_URL` secret.

## Audio

Mazorca can read the weekly plan aloud with ElevenLabs. Set `ELEVENLABS_API_KEY` in the environment and optionally set `ELEVENLABS_VOICE_ID` to choose a voice. Only audio generation needs internet access; diagnosis and farm data remain local. Never commit the key or store it in the repository.

## How reliable is it?

In tests with real photos from the parcel, Gemma described the scenes well: people, buckets with grain, piles of harvested pods, understory vegetation and shade. Pod counts are approximate estimates, not an inventory. There were no photos showing active moniliasis because the parcel was in its post-harvest period, so disease detection has not been validated with the author's own photos.

That is why Mazorca uses two steps: first it produces a neutral observation, “What the AI sees,” which the producer can verify at a glance; then it produces a diagnosis that cannot contradict that observation. This is transparency, not a patch. Mazorca is an observation aid and does not replace a technician or a laboratory.

An evaluation on 23 photos ([eval/](eval/README.md)) found that the first prompt called 6 of 7 diseased pods "moniliasis", including black pod and insect damage. The prompt now contrasts the visible differences, and when the model is not highly confident between moniliasis and black pod, Mazorca reports "Mazorca enferma (posible moniliasis o mazorca negra)", since the action is the same. Wrong disease names dropped from 7 of 7 to 1 of 7, with no false alarms on 14 healthy pods.

The author's parcel is 3 hectares in Cárdenas, Tabasco, where moniliasis is the main problem.

## Limits

Visual observations can be wrong, especially when a photo is dark, distant or ambiguous. Confirm uncertain findings with a trained technician. For any product decision, consult a qualified technician; this project intentionally provides no chemical product or dose.

## Sección breve en español (México)

Mazorca ayuda a recorrer una plantación de cacao sin internet y con un modelo abierto local. Guarda observaciones por lote, ofrece reportes semanales y muestra la confianza. No sustituye a un técnico ni a un laboratorio: son observaciones visuales aproximadas y nunca recomienda dosis de agroquímicos.
