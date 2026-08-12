const $ = (id) => document.getElementById(id);

/* Every flat profile field is just an input id — keeps load/save honest as the
   list grows, and the autofill rules key off exactly these names. */
const PROFILE_FIELDS = [
  'honorificPrefix', 'firstName', 'middleName', 'lastName', 'preferredName', 'honorificSuffix',
  'email', 'phoneCountryCode', 'phone', 'phoneExtension', 'phoneAreaCode', 'phoneLocalPrefix', 'phoneLocalSuffix',
  'addressLine1', 'addressLine2', 'addressLine3', 'district', 'city', 'state', 'postcode', 'country', 'countryCode',
  'linkedin', 'github', 'website', 'twitter', 'facebook', 'skype',
  'workRights', 'sponsorship', 'willingToRelocate', 'drivingLicence',
  'noticePeriod', 'availabilityDate', 'salary', 'salaryCurrency', 'source',
  'resume'
];

const WORK_FIELDS = [
  { key: 'title', label: 'Job title', placeholder: 'Software Engineer' },
  { key: 'company', label: 'Company', placeholder: '' },
  { key: 'location', label: 'Office location', placeholder: 'Auckland, New Zealand' },
  { key: 'start', label: 'From', placeholder: 'Feb 2024' },
  { key: 'end', label: 'To', placeholder: 'Present' },
  { key: 'current', label: 'I currently work here', type: 'checkbox' }
];

const EDU_FIELDS = [
  { key: 'qualification', label: 'Degree / qualification', placeholder: 'Bachelor of Science' },
  { key: 'major', label: 'Major / field of study', placeholder: 'Computer Science' },
  { key: 'school', label: 'Institution', placeholder: '' },
  { key: 'location', label: 'School location', placeholder: 'Auckland, New Zealand' },
  { key: 'start', label: 'From', placeholder: '2021' },
  { key: 'end', label: 'To', placeholder: '2024' },
  { key: 'current', label: 'I currently attend', type: 'checkbox' }
];

const LANGUAGE_FIELDS = [
  { key: 'language', label: 'Language', placeholder: 'English' },
  { key: 'proficiency', label: 'Proficiency', placeholder: 'Fluent' }
];

let templates = [];
let current = null;
let work = [];
let education = [];
let languages = [];
let pendingResumeImport = null;

/* ------------------------------------------------------------- repeaters -- */

function renderEntries(listId, entries, fields, extra) {
  const host = $(listId);
  host.innerHTML = '';

  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = listId === 'workList' ? 'No roles added yet.' : listId === 'eduList' ? 'No qualifications added yet.' : 'No languages added yet.';
    host.append(empty);
    return;
  }

  entries.forEach((entry, i) => {
    const box = document.createElement('div');
    box.className = 'entry';

    const head = document.createElement('div');
    head.className = 'head';
    const idx = document.createElement('span');
    idx.className = 'idx';
    const noun = listId === 'workList' ? 'Role' : listId === 'eduList' ? 'Qualification' : 'Language';
    idx.textContent = `${noun} ${i + 1}${entry.current ? ' · current' : ''}`;
    const up = button('↑', () => move(entries, i, -1, listId, fields, extra));
    const down = button('↓', () => move(entries, i, 1, listId, fields, extra));
    const del = button('Remove', () => {
      entries.splice(i, 1);
      renderEntries(listId, entries, fields, extra);
    });
    up.disabled = i === 0;
    down.disabled = i === entries.length - 1;
    head.append(idx, up, down, del);
    box.append(head);

    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const f of fields) {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const label = document.createElement('label');
      label.textContent = f.label;
      const input = document.createElement('input');
      input.type = f.type || 'text';
      if (input.type === 'checkbox') input.checked = !!entry[f.key];
      else input.value = entry[f.key] || '';
      input.placeholder = input.type === 'checkbox' ? '' : f.placeholder || '';
      input.autocomplete = 'off';
      input.addEventListener(input.type === 'checkbox' ? 'change' : 'input', () => {
        entry[f.key] = input.type === 'checkbox' ? input.checked : input.value;
      });
      label.htmlFor = input.id = `${listId}-${i}-${f.key}`;
      wrap.append(label, input);
      grid.append(wrap);
    }
    box.append(grid);

    if (extra) {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const label = document.createElement('label');
      label.textContent = extra.label;
      const ta = document.createElement('textarea');
      ta.rows = 3;
      ta.value = entry[extra.key] || '';
      ta.placeholder = extra.placeholder || '';
      ta.addEventListener('input', () => (entry[extra.key] = ta.value));
      label.htmlFor = ta.id = `${listId}-${i}-${extra.key}`;
      wrap.append(label, ta);
      box.append(wrap);
    }

    host.append(box);
  });
}

function button(text, onClick) {
  const b = document.createElement('button');
  b.className = 'mini';
  b.type = 'button';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function move(entries, i, delta, listId, fields, extra) {
  const j = i + delta;
  if (j < 0 || j >= entries.length) return;
  [entries[i], entries[j]] = [entries[j], entries[i]];
  renderEntries(listId, entries, fields, extra);
}

const WORK_EXTRA = { key: 'summary', label: 'What you did there', placeholder: 'One or two lines — what you built, what changed as a result.' };
const EDU_EXTRA = { key: 'summary', label: 'Education description', placeholder: 'Relevant coursework, activities, honours or results.' };

function drawWork() {
  renderEntries('workList', work, WORK_FIELDS, WORK_EXTRA);
}
function drawEdu() {
  renderEntries('eduList', education, EDU_FIELDS, EDU_EXTRA);
}
function drawLanguages() {
  renderEntries('languageList', languages, LANGUAGE_FIELDS, null);
}

/* --------------------------------------------------------- résumé import -- */

function importMessage(text, ok = true, sticky = false) {
  const el = $('resumeImportMsg');
  el.textContent = text;
  el.className = `io-msg on ${ok ? 'ok' : 'err'}`;
  clearTimeout(importMessage.timer);
  if (!sticky) importMessage.timer = setTimeout(() => (el.className = 'io-msg'), 5000);
}

function normalizeIdentity(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function recordIdentity(kind, entry) {
  if (kind === 'work') return normalizeIdentity([entry.title, entry.company, entry.start].join('|'));
  if (kind === 'education') return normalizeIdentity([entry.qualification, entry.school, entry.start].join('|'));
  return normalizeIdentity(entry.language);
}

function flatLabel(key) {
  const label = document.querySelector(`label[for="${CSS.escape(key)}"]`);
  return label ? label.textContent : key;
}

function suggestionRow({ kind, key = '', index = -1, label, value, conflict = '' }) {
  const row = document.createElement('label');
  row.className = 'suggestion';
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = !conflict;
  check.dataset.kind = kind;
  check.dataset.key = key;
  check.dataset.index = String(index);
  const name = document.createElement('span');
  name.className = 'key';
  name.textContent = label;
  const proposed = document.createElement('span');
  proposed.className = 'value';
  proposed.textContent = String(value || '').slice(0, 1200);
  if (conflict) {
    const warning = document.createElement('span');
    warning.className = 'conflict';
    warning.textContent = conflict;
    proposed.append(warning);
  }
  row.append(check, name, proposed);
  return row;
}

function recordSummary(kind, entry) {
  if (kind === 'work') {
    return [
      [entry.title, entry.company].filter(Boolean).join(' at '),
      [entry.start, entry.end].filter(Boolean).join(' – '),
      entry.location,
      entry.summary
    ].filter(Boolean).join('\n');
  }
  if (kind === 'education') {
    return [
      [entry.qualification, entry.major].filter(Boolean).join(' — '),
      entry.school,
      [entry.start, entry.end].filter(Boolean).join(' – '),
      entry.location,
      entry.summary
    ].filter(Boolean).join('\n');
  }
  return [entry.language, entry.proficiency].filter(Boolean).join(' — ');
}

function renderResumeSuggestions(suggested) {
  pendingResumeImport = suggested;
  const host = $('resumeSuggestions');
  host.innerHTML = '';
  let count = 0;
  let conflicts = 0;

  for (const [key, value] of Object.entries(suggested.profile || {})) {
    if (!PROFILE_FIELDS.includes(key) || key === 'resume' || !value) continue;
    const existing = $(key).value.trim();
    const conflict = existing && normalizeIdentity(existing) !== normalizeIdentity(value)
      ? `Existing value kept unless selected: ${existing}`
      : '';
    if (conflict) conflicts++;
    host.append(suggestionRow({ kind: 'flat', key, label: flatLabel(key), value, conflict }));
    count++;
  }

  const groups = [
    ['work', suggested.work || [], work],
    ['education', suggested.education || [], education],
    ['language', suggested.languages || [], languages]
  ];
  for (const [kind, entries, existingEntries] of groups) {
    const existingIds = new Set(existingEntries.map((entry) => recordIdentity(kind, entry)).filter(Boolean));
    entries.forEach((entry, index) => {
      const duplicate = existingIds.has(recordIdentity(kind, entry));
      if (duplicate) conflicts++;
      const label = kind === 'work' ? `Work role ${index + 1}` : kind === 'education' ? `Education ${index + 1}` : `Language ${index + 1}`;
      host.append(suggestionRow({
        kind,
        index,
        label,
        value: recordSummary(kind, entry),
        conflict: duplicate ? 'A matching saved record already exists.' : ''
      }));
      count++;
    });
  }

  if (suggested.resume) {
    const existing = $('resume').value.trim();
    const conflict = existing ? 'Résumé text is already present and will be kept unless selected.' : '';
    if (conflict) conflicts++;
    host.append(suggestionRow({
      kind: 'resume',
      label: 'Full résumé text',
      value: `${suggested.resume.length.toLocaleString()} characters extracted`,
      conflict
    }));
    count++;
  }

  $('resumeReviewSummary').textContent = `${count} suggestion${count === 1 ? '' : 's'} found${conflicts ? `; ${conflicts} existing-value conflict${conflicts === 1 ? '' : 's'} left unchecked` : ''}.`;
  $('resumeReview').hidden = false;
}

function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

async function importResume(file) {
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) return importMessage('Résumé must be 8 MB or smaller.', false);
  const ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  if (!['.pdf', '.docx', '.txt', '.md'].includes(ext)) return importMessage('Use a PDF, DOCX, TXT, or MD file.', false);
  const button = $('resumeImportBtn');
  button.disabled = true;
  importMessage('Reading and extracting suggestions…', true, true);
  try {
    const base = $('server').value.trim().replace(/\/$/, '') || 'http://127.0.0.1:8787';
    const response = await fetch(`${base}/parse-resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, type: file.type, data: await fileAsBase64(file) })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Local server returned ${response.status}.`);
    renderResumeSuggestions(data.suggested || {});
    importMessage(`Read ${file.name}. Review the suggestions below.`, true);
  } catch (e) {
    importMessage(e.message === 'Failed to fetch' ? 'Cannot reach the local server. Start it, then try again.' : e.message, false, true);
  } finally {
    button.disabled = false;
  }
}

function applyResumeSuggestions() {
  if (!pendingResumeImport) return;
  let applied = 0;
  for (const check of $('resumeSuggestions').querySelectorAll('input[type="checkbox"]:checked')) {
    const { kind, key } = check.dataset;
    const index = Number(check.dataset.index);
    if (kind === 'flat' && PROFILE_FIELDS.includes(key) && pendingResumeImport.profile[key]) {
      $(key).value = pendingResumeImport.profile[key];
    } else if (kind === 'resume') {
      $('resume').value = pendingResumeImport.resume || '';
    } else if (kind === 'work' && pendingResumeImport.work[index]) {
      work.push({ ...pendingResumeImport.work[index] });
    } else if (kind === 'education' && pendingResumeImport.education[index]) {
      education.push({ ...pendingResumeImport.education[index] });
    } else if (kind === 'language' && pendingResumeImport.languages[index]) {
      languages.push({ ...pendingResumeImport.languages[index] });
    } else {
      continue;
    }
    applied++;
  }
  drawWork();
  drawEdu();
  drawLanguages();
  $('resumeReview').hidden = true;
  pendingResumeImport = null;
  importMessage(`Applied ${applied} suggestion${applied === 1 ? '' : 's'} to the form. Review them, then press Save settings.`, true, true);
}

/* ---------------------------------------------------------------- load -- */

async function load() {
  const s = await chrome.storage.local.get(['profile', 'templates', 'serverUrl', 'defaultTemplate']);
  const p = s.profile || {};
  for (const key of PROFILE_FIELDS) $(key).value = p[key] || '';
  work = Array.isArray(p.work) ? p.work : [];
  education = Array.isArray(p.education) ? p.education : [];
  languages = Array.isArray(p.languages) ? p.languages : [];
  for (const entry of work) {
    if (entry.current == null) entry.current = /present|current|now/i.test(entry.end || '');
  }
  for (const entry of education) {
    if (entry.current == null) entry.current = /present|current|now/i.test(entry.end || '');
  }
  drawWork();
  drawEdu();
  drawLanguages();

  $('server').value = s.serverUrl || 'http://127.0.0.1:8787';
  templates = Array.isArray(s.templates) ? s.templates : [];
  /* An imported file can name a template that isn't in this list; fall back
     rather than leaving the editor bound to nothing. */
  current = s.defaultTemplate;
  if (!templates.some((t) => t.id === current)) current = templates[0] && templates[0].id;
  renderPicker();
  showTemplate();
}

/* ----------------------------------------------------------- templates -- */

function renderPicker() {
  $('tplPick').innerHTML = templates
    .map((t) => `<option value="${esc(t.id)}"${t.id === current ? ' selected' : ''}>${esc(t.name)}</option>`)
    .join('');
}

function showTemplate() {
  const t = templates.find((x) => x.id === current);
  if (!t) return;
  $('tplName').value = t.name || '';
  $('tplWords').value = t.maxWords || 250;
  $('tplTone').value = t.tone || '';
  $('tplSkeleton').value = t.skeleton || '';
  $('tplRules').value = t.rules || '';
}

function readTemplate() {
  const t = templates.find((x) => x.id === current);
  if (!t) return;
  Object.assign(t, {
    name: $('tplName').value.trim() || 'Untitled',
    maxWords: Number($('tplWords').value) || 250,
    tone: $('tplTone').value,
    skeleton: $('tplSkeleton').value,
    rules: $('tplRules').value
  });
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* --------------------------------------------------------------- wiring -- */

$('resumeImportBtn').addEventListener('click', () => $('resumeImportFile').click());
$('resumeImportFile').addEventListener('change', (event) => {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  importResume(file);
});
$('resumeApply').addEventListener('click', applyResumeSuggestions);
$('resumeDiscard').addEventListener('click', () => {
  pendingResumeImport = null;
  $('resumeReview').hidden = true;
  $('resumeSuggestions').innerHTML = '';
  importMessage('Import suggestions discarded.');
});

$('workAdd').addEventListener('click', () => {
  work.push({});
  drawWork();
});
$('eduAdd').addEventListener('click', () => {
  education.push({});
  drawEdu();
});
$('languageAdd').addEventListener('click', () => {
  languages.push({});
  drawLanguages();
});

$('tplPick').addEventListener('change', (e) => {
  readTemplate();
  current = e.target.value;
  showTemplate();
});

$('tplNew').addEventListener('click', () => {
  readTemplate();
  const t = { id: 'tpl_' + Date.now(), name: 'New template', maxWords: 250, tone: '', skeleton: '', rules: '' };
  templates.push(t);
  current = t.id;
  renderPicker();
  showTemplate();
});

$('tplDelete').addEventListener('click', () => {
  if (templates.length <= 1) return;
  templates = templates.filter((t) => t.id !== current);
  current = templates[0].id;
  renderPicker();
  showTemplate();
});

/* Reading the form into storage is shared: Export runs it first so you get
   what's on screen, not whatever was saved the last time you remembered to
   press the button. */
async function persist() {
  readTemplate();
  renderPicker();

  const profile = {};
  for (const key of PROFILE_FIELDS) profile[key] = $(key).value.trim();
  profile.fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  profile.work = work.filter((w) => w.company || w.title);
  profile.education = education.filter((e) => e.school || e.qualification);
  profile.languages = languages.filter((entry) => entry.language);

  await chrome.storage.local.set({
    profile,
    templates,
    defaultTemplate: current,
    serverUrl: $('server').value.trim().replace(/\/$/, '')
  });
}

$('save').addEventListener('click', async () => {
  await persist();
  $('saved').classList.add('on');
  setTimeout(() => $('saved').classList.remove('on'), 1400);
});

/* ---------------------------------------------------------------- backup -- */

/* lastJob is deliberately absent: it's a cached ad, not a setting, and it
   would bloat the file with whatever you last looked at. */
const BACKUP_KEYS = ['profile', 'templates', 'defaultTemplate', 'serverUrl', 'fieldPaths'];
const BACKUP_FORMAT = 2;

let ioTimer = null;
function ioMessage(text, ok = true) {
  const el = $('ioMsg');
  el.textContent = text;
  el.className = `io-msg on ${ok ? 'ok' : 'err'}`;
  clearTimeout(ioTimer);
  ioTimer = setTimeout(() => (el.className = 'io-msg'), 4000);
}

$('exportBtn').addEventListener('click', async () => {
  try {
    await persist();
    const data = await chrome.storage.local.get(BACKUP_KEYS);
    const payload = { format: BACKUP_FORMAT, exportedAt: new Date().toISOString(), data };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cover-letter-copilot-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    ioMessage('Saved a backup file.');
  } catch (e) {
    ioMessage(`Export failed: ${e.message}`, false);
  }
});

$('importBtn').addEventListener('click', () => $('importFile').click());

$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = ''; // so picking the same file twice still fires
  if (!file) return;

  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (err) {
    return ioMessage("That file isn't valid JSON.", false);
  }

  /* Accept both the wrapped export and a bare settings object, so a
     hand-edited file still imports. */
  const data = parsed && typeof parsed.data === 'object' && parsed.data ? parsed.data : parsed;
  if (!data || typeof data !== 'object' || !BACKUP_KEYS.some((k) => k in data)) {
    return ioMessage("That file isn't a Copilot backup.", false);
  }

  if (!confirm('Replace your current settings with this file?\n\nWhat is saved now will be overwritten.')) return;

  const clean = {};
  for (const k of BACKUP_KEYS) if (k in data) clean[k] = data[k];
  /* A backup with an empty or malformed template list would leave the editor
     with nothing to edit — keep the existing templates in that case. */
  if ('templates' in clean && (!Array.isArray(clean.templates) || !clean.templates.length)) delete clean.templates;
  if ('profile' in clean && (typeof clean.profile !== 'object' || !clean.profile)) delete clean.profile;

  try {
    await chrome.storage.local.set(clean);
    await load();
    ioMessage(`Imported ${Object.keys(clean).length} setting group(s).`);
  } catch (err) {
    ioMessage(`Import failed: ${err.message}`, false);
  }
});

load();
