const state = { lots: [], selectedFile: null };
const $ = id => document.getElementById(id);

function addText(parent, value) {
  const node = document.createTextNode(String(value ?? ''));
  parent.append(node);
  return node;
}

const nextPhoto = document.createElement('button');
nextPhoto.type = 'button';
addText(nextPhoto, 'Siguiente foto');
nextPhoto.addEventListener('click', () => {
  $('camera').value = '';
  $('gallery').value = '';
  $('diagnosis').replaceChildren();
  $('walkMessage').textContent = 'Elegí la siguiente foto.';
});
$('walk').insertBefore(nextPhoto, $('walkMessage'));

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'No se pudo completar la operación.');
  }
  return data;
}

function optionList(select) {
  select.replaceChildren();
  for (const lot of state.lots) {
    const option = document.createElement('option');
    option.value = lot.id;
    addText(option, lot.name);
    select.append(option);
  }
}

function renderLots() {
  optionList($('walkLot'));
  optionList($('reportLot'));
  optionList($('cutLot'));
  const list = $('lotList');
  list.replaceChildren();

  for (const lot of state.lots) {
    const item = document.createElement('li');
    addText(item, lot.name);
    const remove = document.createElement('button');
    remove.type = 'button';
    addText(remove, 'Borrar');
    remove.addEventListener('click', async () => {
      if (confirm(`¿Borrar ${lot.name}?`)) {
        await api(`/api/lotes/${lot.id}`, { method: 'DELETE' });
        await loadLots();
      }
    });
    item.append(remove);
    list.append(item);
  }
}

async function loadLots() {
  state.lots = await api('/api/lotes');
  renderLots();
  if (state.lots.length) {
    $('export').href = `/api/lotes/${state.lots[0].id}/export.csv`;
  }
}

async function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

async function reencode(file) {
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error(
        'El navegador no puede decodificar esta imagen. Si es HEIC, convertíla a JPEG o elegí otra foto.'
      ));
    });
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return {
      image: canvas.toDataURL('image/jpeg', 0.84),
      thumbnail: canvas.toDataURL('image/jpeg', 0.62)
    };
  } finally {
    URL.revokeObjectURL(source);
  }
}

function showDiagnosis(result) {
  const box = $('diagnosis');
  box.replaceChildren();
  const card = document.createElement('article');
  card.className = 'card';
  const observation = document.createElement('p');
  const observationLabel = document.createElement('strong');
  addText(observationLabel, 'Lo que la IA ve: ');
  observation.append(observationLabel);
  addText(observation, result.observation?.scene || 'No se pudo describir la escena.');
  card.append(observation);
  const heading = document.createElement('h3');
  addText(heading, `${result.subject} · diagnóstico orientativo`);
  card.append(heading);
  const summary = document.createElement('p');
  addText(summary, result.summary);
  card.append(summary);

  for (const finding of result.findings) {
    const paragraph = document.createElement('p');
    addText(paragraph, `${finding.issue}: ${finding.evidence} `);
    const confidence = document.createElement('span');
    confidence.className = 'confidence';
    addText(confidence, `(${finding.confidence})`);
    paragraph.append(confidence);
    card.append(paragraph);
  }

  const actions = document.createElement('p');
  addText(actions, `Acciones: ${result.actions.join(' · ')}`);
  card.append(actions);
  const verify = document.createElement('p');
  addText(verify, `Confirmación: ${result.verify}`);
  card.append(verify);
  box.append(card);
}

async function diagnose(file) {
  $('walkMessage').textContent = 'Procesando la foto localmente…';
  try {
    const encoded = await reencode(file);
    const result = await api('/api/diagnose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: encoded.image,
        thumbnail: encoded.thumbnail,
        loteId: $('walkLot').value,
        note: $('note').value
      })
    });
    showDiagnosis(result);
    $('walkMessage').textContent = 'Listo. Revisa la confianza y, ante la duda, pide confirmación a un técnico.';
  } catch (error) {
    $('walkMessage').textContent = error.message;
  }
}

function displayReport(report) {
  const box = $('reportView');
  box.replaceChildren();
  const paragraph = document.createElement('p');
  const percentage = report.affectedPercentage === null ? 'sin datos' : `${report.affectedPercentage}%`;
  addText(paragraph, `${report.photos} fotos · ${report.podCounts.affected} afectadas · ` +
    `porcentaje: ${percentage} · tendencia: ${report.trend}`);
  box.append(paragraph);
  const list = document.createElement('ul');
  for (const [issue, count] of Object.entries(report.issueCounts)) {
    const item = document.createElement('li');
    addText(item, `${issue}: ${count}`);
    list.append(item);
  }
  box.append(list);
}

async function loadReport() {
  const id = $('reportLot').value;
  if (!id) return;
  try {
    const report = await api(`/api/lotes/${id}/report`);
    displayReport(report);
    $('export').href = `/api/lotes/${id}/export.csv`;
  } catch (error) {
    $('reportView').textContent = error.message;
  }
}

let lastPlan = null;

async function listenPlan() {
  if (!lastPlan) return;
  const status = $('audioStatus');
  status.textContent = 'Preparando audio…';
  try {
    const response = await fetch(`/api/lotes/${$('reportLot').value}/plan/audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: lastPlan })
    });
    if (!response.ok) throw new Error((await response.json()).error || 'No se pudo generar el audio.');
    const player = $('planAudio');
    player.src = URL.createObjectURL(await response.blob());
    player.hidden = false;
    await player.play();
    status.textContent = '';
  } catch (error) {
    status.textContent = error.message;
  }
}

async function makePlan() {
  try {
    const result = await api(`/api/lotes/${$('reportLot').value}/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    lastPlan = result;
    $('listenPlan').hidden = false;
    const box = $('plan');
    box.replaceChildren();
    const heading = document.createElement('h3');
    addText(heading, result.headline);
    box.append(heading);
    for (const group of ['priorities', 'thisWeek', 'watch']) {
      const list = document.createElement('ul');
      for (const value of result[group]) {
        const item = document.createElement('li');
        addText(item, value);
        list.append(item);
      }
      box.append(list);
    }
  } catch (error) {
    $('plan').textContent = error.message;
  }
}

$('listenPlan').addEventListener('click', listenPlan);

for (const button of document.querySelectorAll('[data-tab]')) {
  button.addEventListener('click', () => {
    for (const section of document.querySelectorAll('.tab')) {
      section.hidden = section.id !== button.dataset.tab;
    }
  });
}

$('camera').addEventListener('change', event => {
  if (event.target.files[0]) diagnose(event.target.files[0]);
});
$('gallery').addEventListener('change', event => {
  if (event.target.files[0]) diagnose(event.target.files[0]);
});
$('cutImage').addEventListener('change', async event => {
  try {
    const encoded = await reencode(event.target.files[0]);
    const result = await api('/api/cut-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: encoded.image, thumbnail: encoded.thumbnail, loteId: $('cutLot').value })
    });
    $('cutView').textContent = JSON.stringify(result);
  } catch (error) {
    $('cutView').textContent = error.message;
  }
});

$('lotForm').addEventListener('submit', async event => {
  event.preventDefault();
  await api('/api/lotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: $('lotName').value, notes: $('lotNotes').value })
  });
  event.target.reset();
  await loadLots();
});

$('loadReport').addEventListener('click', loadReport);
$('makePlan').addEventListener('click', makePlan);
loadLots().catch(error => {
  $('walkMessage').textContent = error.message;
});
