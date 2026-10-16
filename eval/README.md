# Diagnosis evaluation

`node eval/run.js` sends every photo in `labels.json` through the same prompts and normalization the app uses, with `gemma4:e4b-it-qat` in Ollama on a 16 GB M1 Pro, and saves every answer. `EVAL_STEPS=two` runs only the two-step design.

## The set (23 photos)

- 4 pods with black pod rot and 3 with insect damage, from Wikimedia Commons ([credits](ATTRIBUTION.md)). The insect-damage photos are old black-and-white museum plates, which makes them harder.
- 10 healthy pods on the tree, from Wikimedia Commons.
- 6 photos from my own plot in Cárdenas, Tabasco: 4 with healthy pods (on the tree and in a harvest pile) and 2 with no pods at all.

There is no moniliasis photo: the only one on Commons is a microscope slide, and my plot is post-harvest. This set measures whether the model **invents** moniliasis, not whether it finds it.

## Results

| Version | Flags the problem (7 diseased) | Names the wrong disease (7 diseased) | False alarms (14 healthy) | Pod findings with no pods (2) | Seconds per photo |
|---|---|---|---|---|---|
| v1, one step | 7/7 | 7/7 | 1/14 | 0/2 | 45 |
| v1, two steps | 7/7 | 6/7 | 0/14 | 0/2 | 52 |
| v2, two steps + rule | 6/7 | 1/7 | 0/14 | 0/2 | 46 |

"Flags the problem" counts any disease finding or an `other` finding on a diseased pod. "Names the wrong disease" counts a specific moniliasis, black pod or animal damage label that does not match the photo.

## What I learned

**v1 called almost everything moniliasis.** Black pod with a white mould layer, insect scars, a moth-eaten pod: 6 of the 7 diseased pods got "moniliasis". The prompt listed moniliasis first and the app is about moniliasis, and a small model leans on what it reads first. For a farmer that matters: telling someone they have moniliasis when it is black pod sends them looking for the wrong signs.

**v2 describes the differences, not just the diseases.** The prompt now says "do not assume moniliasis", contrasts a firm dark lesion with an even edge (black pod) against deformity, swelling and a thick powder mat (moniliasis) and many separate small scars (insects), and asks for `other` with low confidence when it can't tell. Wrong "moniliasis" answers dropped from 6 to 4 and it got one insect-damage pod right, but it still could not reliably separate black pod from moniliasis.

**So the app stopped pretending it can.** When the model says moniliasis or black pod without high confidence, the server reports `pod_disease`: "Mazorca enferma (posible moniliasis o mazorca negra)". The action is the same for both (remove and bury the diseased pod this week), so the farmer loses nothing and is never told a confident wrong name. The report, the CSV and the Kestra summary all use the same label.

**What is still wrong:** one black pod photo was called moniliasis with *high* confidence, so it passes the rule, and one moth-damaged pod (a black-and-white plate) got no finding at all. Seven diseased photos is a small set and v2 was written after reading these same answers, so treat the numbers as a direction, not a benchmark. The next step is my own photos of diseased pods when the new season starts.

Raw answers: `results-v1.json` (one and two steps) and `results-v2.json` (v2 prompt; the rule is applied on top when scoring).
