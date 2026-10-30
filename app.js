// Force the frontend to use the real Express backend (not GitHub Pages static hosting)
window.MARGIN_API_BASE = window.MARGIN_API_BASE || (
  location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? ''
    : 'https://studybuddy2-r2i6.onrender.com'
);

const DB_NAME = 'margin-db';
const STORE = 'kv';
const QUERY_API_BASE = new URLSearchParams(location.search).get('api') || '';
const CONFIGURED_API_BASE = window.MARGIN_API_BASE || QUERY_API_BASE || localStorage.getItem('margin-api-base') || '';
const DEPLOYED_API_BASE = 'https://studybuddy2-r2i6.onrender.com';
const API_TIMEOUT_MS = 75000;
const ACCESS_TOKEN_KEY = 'studybuddy-access-token';
let dbPromise = null;

let documents = [];
let cards = [];
let notes = [];
let quizResults = [];
let timerSessions = [];
let activeSubject = 'all';
let editingNoteId = null;
let currentPreviewDocId = null;
let chatHistory = [];
let studyDeck = [];
let studyIndex = 0;
let studyFlipped = false;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function idbSet(key, value) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ key, value });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) { console.warn('Could not save', key, e); return false; }
}
async function idbGet(key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : undefined);
      req.onerror = () => reject(req.error);
    });
  } catch (e) { console.warn('Could not load', key, e); return undefined; }
}

const $ = id => document.getElementById(id);
function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes, i = 0;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(size >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
function normalizeAnswer(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function courseUnitKey(course, unit) { return `${course || 'General'}|${unit || 'General'}`; }
function truncateText(text, max = 12000) { return String(text || '').slice(0, max); }
function setStatus(id, text) { $(id).textContent = text; }
function cleanApiBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}
function apiBaseCandidates() {
  // Prefer the forced backend base (set at top of file) and ignore other heuristics
  // to avoid accidentally falling back to localhost when running on a static host.
  const forced = cleanApiBase(window.MARGIN_API_BASE);
  if (forced) return [forced];

  const configured = cleanApiBase(CONFIGURED_API_BASE);
  if (configured) return [configured];

  // Fallback (dev-only) if nothing is configured
  return ['http://localhost:3000'];
}
async function apiFetch(path, options = {}) {
  const bases = apiBaseCandidates();
  if (bases.length === 0) {
    throw new Error('Set your backend URL first. Define window.MARGIN_API_BASE or deploy the Express server and update DEPLOYED_API_BASE.');
  }

  let lastError = null;
  for (const base of bases) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
      const accessToken = $('access-token-input')?.value || localStorage.getItem(ACCESS_TOKEN_KEY) || '';
      const res = await fetch(`${base}${path}`, {
        ...options,
        headers: { ...options.headers, 'x-access-token': accessToken },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (res.status !== 404) {
        localStorage.setItem('margin-api-base', base);
        return res;
      }
      lastError = new Error(`No API route at ${base}`);
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
    }
  }

  const tried = bases.join(', ');
  const last = lastError?.message || String(lastError || 'Unknown error');
  if (lastError?.name === 'AbortError') {
    throw new Error(`Backend timeout calling ${path}. Tried: ${tried}. Last error: ${last}`);
  }
  throw new Error(`Could not reach backend for ${path}. Tried: ${tried}. Last error: ${last}`);
}

function persistAll() {
  idbSet('documents', documents);
  idbSet('cards', cards);
  idbSet('notes', notes);
  idbSet('quizResults', quizResults);
  idbSet('timerSessions', timerSessions);
}

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => { x.classList.remove('active'); x.setAttribute('aria-selected', 'false'); });
  tab.classList.add('active');
  tab.setAttribute('aria-selected', 'true');
  document.querySelectorAll('.panel').forEach(panel => panel.classList.add('hidden'));
  $(`panel-${tab.dataset.tab}`).classList.remove('hidden');
  if (tab.dataset.tab === 'progress') renderProgress();
}));

async function parseDocumentFile(file) {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    if (!window.pdfjsLib) throw new Error('PDF parser did not load. Check your connection and try again.');
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    let chunks = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      chunks.push(content.items.map(item => item.str).join(' '));
    }
    return chunks.join('\n\n').trim();
  }
  if (file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt')) {
    return await file.text();
  }
  throw new Error('Only PDF and TXT files are supported in v1.');
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [meta, body] = dataUrl.split(',');
  const mime = (meta.match(/data:(.*?);base64/) || [, 'application/octet-stream'])[1];
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function addDocument() {
  const file = $('doc-file').files[0];
  if (!file) return setStatus('doc-status', 'Choose a PDF or TXT file first.');
  setStatus('doc-status', 'Extracting text...');
  try {
    const extractedText = await parseDocumentFile(file);
    if (!extractedText.trim()) throw new Error('No readable text was found.');
    const now = Date.now();
    const title = $('doc-title').value.trim() || file.name.replace(/\.[^.]+$/, '');
    const doc = {
      id: uid(),
      title,
      course: $('doc-course').value.trim(),
      unit: $('doc-unit').value.trim(),
      favorite: $('doc-favorite').value === 'yes',
      fileName: file.name,
      fileType: file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'text/plain'),
      fileSize: file.size,
      fileData: await blobToDataUrl(file),
      extractedText,
      uploadedAt: now,
      lastOpened: null,
      readingProgress: 0
    };
    documents.push(doc);
    $('doc-file').value = '';
    $('doc-title').value = '';
    setStatus('doc-status', 'Document saved.');
    await idbSet('documents', documents);
    renderEverything();
    previewDocument(doc.id);
  } catch (err) {
    setStatus('doc-status', err.message || 'Could not upload document.');
  }
}

function filteredDocuments() {
  const q = $('doc-search').value.trim().toLowerCase();
  const filter = $('doc-filter').value;
  let list = documents.filter(doc => {
    const hay = `${doc.title} ${doc.course} ${doc.unit} ${doc.fileName}`.toLowerCase();
    return (!q || hay.includes(q)) && (filter !== 'favorites' || doc.favorite);
  });
  const sort = $('doc-sort').value;
  list.sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    if (sort === 'course') return `${a.course}${a.unit}${a.title}`.localeCompare(`${b.course}${b.unit}${b.title}`);
    return (b.lastOpened || b.uploadedAt) - (a.lastOpened || a.uploadedAt);
  });
  return list;
}

function renderDocuments() {
  const list = $('doc-list');
  const empty = $('docs-empty');
  const docs = filteredDocuments();
  if (docs.length === 0) { list.innerHTML = ''; empty.classList.remove('hidden'); }
  else {
    empty.classList.add('hidden');
    list.innerHTML = docs.map(doc => `
      <div class="list-row">
        <div>
          <h4>${escapeHtml(doc.title)}</h4>
          <p>${escapeHtml(doc.fileName)} - ${formatBytes(doc.fileSize)}</p>
          <div class="meta-line">
            <span class="pill">${escapeHtml(doc.course || 'General')}</span>
            <span class="pill">${escapeHtml(doc.unit || 'General')}</span>
            ${doc.favorite ? '<span class="pill good">favorite</span>' : ''}
            <span class="pill">${new Date(doc.uploadedAt).toLocaleDateString()}</span>
          </div>
          <div class="progress-line"><span style="width:${doc.readingProgress || 0}%"></span></div>
        </div>
        <div class="row">
          <button class="btn btn-sm" data-preview-doc="${doc.id}">Preview</button>
          <button class="btn btn-sm" data-open-raw="${doc.id}">File</button>
          <button class="icon-btn btn-danger" data-delete-doc="${doc.id}" title="Delete" aria-label="Delete document">x</button>
        </div>
      </div>
    `).join('');
  }
  list.querySelectorAll('[data-preview-doc]').forEach(btn => btn.addEventListener('click', () => previewDocument(btn.dataset.previewDoc)));
  list.querySelectorAll('[data-open-raw]').forEach(btn => btn.addEventListener('click', () => openRawDocument(btn.dataset.openRaw)));
  list.querySelectorAll('[data-delete-doc]').forEach(btn => btn.addEventListener('click', () => {
    if (!confirm('Delete this document from this browser?')) return;
    documents = documents.filter(doc => doc.id !== btn.dataset.deleteDoc);
    if (currentPreviewDocId === btn.dataset.deleteDoc) currentPreviewDocId = null;
    idbSet('documents', documents);
    renderEverything();
  }));
  renderDocumentSelects();
}

function renderDocumentSelects() {
  const options = documents.length
    ? documents.map(doc => `<option value="${doc.id}">${escapeHtml(doc.title)}</option>`).join('')
    : '<option value="">No documents</option>';
  ['active-doc-select', 'flashcard-doc-select', 'quiz-doc-select', 'notes-doc-select'].forEach(id => {
    const previous = $(id).value;
    $(id).innerHTML = options;
    if (documents.some(doc => doc.id === previous)) $(id).value = previous;
  });
}

function previewDocument(id) {
  const doc = documents.find(d => d.id === id);
  if (!doc) return;
  currentPreviewDocId = id;
  doc.lastOpened = Date.now();
  $('active-doc-select').value = id;
  $('doc-preview').textContent = doc.extractedText.slice(0, 6000) || 'No extracted text available.';
  $('doc-progress').value = doc.readingProgress || 0;
  idbSet('documents', documents);
  renderDocuments();
}

function openRawDocument(id) {
  const doc = documents.find(d => d.id === id);
  if (!doc || !doc.fileData) return;
  doc.lastOpened = Date.now();
  const url = URL.createObjectURL(dataUrlToBlob(doc.fileData));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  idbSet('documents', documents);
  renderDocuments();
}

function renderTaxonomy() {
  const courses = [...new Set([
    ...documents.map(d => d.course),
    ...cards.map(c => c.subject),
    ...notes.map(n => n.tag),
    ...timerSessions.map(s => s.course)
  ].filter(Boolean))].sort();
  const units = [...new Set([
    ...documents.map(d => d.unit),
    ...cards.map(c => c.unit),
    ...notes.map(n => n.unit),
    ...timerSessions.map(s => s.unit)
  ].filter(Boolean))].sort();
  $('course-list').innerHTML = courses.map(c => `<option value="${escapeHtml(c)}">`).join('');
  $('subject-list').innerHTML = courses.map(c => `<option value="${escapeHtml(c)}">`).join('');
  $('unit-list').innerHTML = units.map(u => `<option value="${escapeHtml(u)}">`).join('');
  const courseOptions = ['<option value="">General course</option>', ...courses.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)].join('');
  const unitOptions = ['<option value="">General unit</option>', ...units.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`)].join('');
  const prevCourse = $('timer-course').value;
  const prevUnit = $('timer-unit').value;
  $('timer-course').innerHTML = courseOptions;
  $('timer-unit').innerHTML = unitOptions;
  if (courses.includes(prevCourse)) $('timer-course').value = prevCourse;
  if (units.includes(prevUnit)) $('timer-unit').value = prevUnit;
}

function addMsg(role, text) {
  const empty = $('chat-empty');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  div.textContent = text;
  $('chat-log').appendChild(div);
  $('chat-log').scrollTop = $('chat-log').scrollHeight;
  return div;
}
async function sendChat() {
  const q = $('chat-input').value.trim();
  if (!q) return;
  $('chat-input').value = '';
  $('chat-send').disabled = true;
  addMsg('user', q);
  chatHistory.push({ role: 'user', content: q });
  const loadingEl = addMsg('assistant loading', 'Thinking...');
  try {
    const res = await apiFetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: q, history: chatHistory.slice(0, -1) })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || `The AI request failed (${res.status}). Please try again.`);
    const textBlock = data.reply || 'The AI did not return a response. Please try again.';
    loadingEl.remove();
    addMsg('assistant', textBlock);
    chatHistory.push({ role: 'assistant', content: textBlock });
    if (chatHistory.length > 40) chatHistory = chatHistory.slice(-40);
  } catch (err) {
    loadingEl.remove();
    addMsg('assistant', err.message || 'Could not reach the tutor. Check the backend server and try again.');
    chatHistory.pop();
  } finally {
    $('chat-send').disabled = false;
  }
}

function cardLabel(card) {
  if (card.format === 'definition') return 'Definition';
  if (card.format === 'fill_blank') return 'Fill blank';
  return 'Basic';
}
function renderDeckBar() {
  const subs = [...new Set(cards.map(c => c.subject || 'General'))].sort();
  const bar = $('deck-bar');
  if (subs.length === 0) { bar.innerHTML = ''; return; }
  let html = `<button class="deck-chip ${activeSubject === 'all' ? 'active' : ''}" data-subj="all">All (${cards.length})</button>`;
  subs.forEach(s => {
    const count = cards.filter(c => (c.subject || 'General') === s).length;
    html += `<button class="deck-chip ${activeSubject === s ? 'active' : ''}" data-subj="${escapeHtml(s)}">${escapeHtml(s)} (${count})</button>`;
  });
  bar.innerHTML = html;
  bar.querySelectorAll('.deck-chip').forEach(btn => btn.addEventListener('click', () => {
    activeSubject = btn.dataset.subj;
    renderDeckBar();
    renderCardList();
  }));
}
function filteredCards() {
  return activeSubject === 'all' ? cards : cards.filter(c => (c.subject || 'General') === activeSubject);
}
function renderCardList() {
  const list = $('card-list');
  const empty = $('cards-empty');
  const fc = filteredCards();
  if (fc.length === 0) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  list.innerHTML = fc.map(c => `
    <div class="card-row">
      <div class="meta-line">
        <span class="pill">${escapeHtml(c.subject || 'General')}</span>
        <span class="pill">${escapeHtml(c.unit || 'General')}</span>
        <span class="pill">${cardLabel(c)}</span>
        ${c.aiGenerated ? '<span class="pill ai">AI generated</span>' : ''}
      </div>
      <div class="front">${escapeHtml(c.front)}</div>
      <div class="back">${escapeHtml(c.back)}</div>
      <div class="card-actions">
        <span class="hint">Mastery: ${c.mastered ? 'got it' : 'learning'}</span>
        <button class="icon-btn btn-danger" data-del-card="${c.id}" title="Delete" aria-label="Delete card">x</button>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('[data-del-card]').forEach(btn => btn.addEventListener('click', () => {
    if (!confirm('Delete this flashcard?')) return;
    cards = cards.filter(c => c.id !== btn.dataset.delCard);
    idbSet('cards', cards);
    renderEverything();
  }));
}
function addManualCard() {
  const front = $('card-front').value.trim();
  const back = $('card-back').value.trim();
  if (!front || !back) return;
  cards.push({
    id: uid(),
    front,
    back,
    subject: $('card-subject').value.trim(),
    unit: $('card-unit').value.trim(),
    format: $('card-format').value,
    aiGenerated: false,
    mastered: false,
    createdAt: Date.now()
  });
  $('card-front').value = '';
  $('card-back').value = '';
  idbSet('cards', cards);
  renderEverything();
}
async function generateFlashcardsFromDocument() {
  const doc = documents.find(d => d.id === $('flashcard-doc-select').value);
  if (!doc) return setStatus('cards-ai-status', 'Upload a document first. (No document selected)');

  setStatus('cards-ai-status', 'Generating cards...');
  $('generate-cards-btn').disabled = true;
  try {
    const data = await callAI('/api/generate-flashcards', { document: aiDocumentPayload(doc) });
    const incoming = Array.isArray(data.cards) ? data.cards : Array.isArray(data) ? data : [];
    incoming.forEach(card => {
      cards.push({
        id: uid(),
        front: card.front || card.question || card.term || '',
        back: card.back || card.answer || card.definition || '',
        subject: doc.course,
        unit: doc.unit,
        format: card.format || 'basic',
        aiGenerated: true,
        sourceDocumentId: doc.id,
        mastered: false,
        createdAt: Date.now()
      });
    });
    await idbSet('cards', cards);
    setStatus('cards-ai-status', `Added ${incoming.length} cards.`);
    renderEverything();
  } catch (err) {
    setStatus('cards-ai-status', err.message || 'Could not generate cards.');
  } finally {
    $('generate-cards-btn').disabled = false;
  }
}

function startCardStudy() {
  studyDeck = shuffle([...filteredCards()]);
  if (studyDeck.length === 0) return;
  studyIndex = 0;
  $('cards-study').classList.remove('hidden');
  renderStudyCard();
}
function renderStudyCard() {
  if (studyIndex >= studyDeck.length) {
    $('card-study-progress').textContent = 'Session complete.';
    $('flip-card').textContent = 'Nice work. The deck is cleared for now.';
    $('flip-card').classList.remove('flipped');
    return;
  }
  studyFlipped = false;
  $('card-study-progress').textContent = `Card ${studyIndex + 1} of ${studyDeck.length}`;
  $('flip-card').classList.remove('flipped');
  $('flip-card').textContent = studyDeck[studyIndex].front;
}
function markStudyCard(mastered) {
  if (studyIndex >= studyDeck.length) return;
  const card = cards.find(c => c.id === studyDeck[studyIndex].id);
  if (card) card.mastered = mastered;
  studyIndex++;
  idbSet('cards', cards);
  renderStudyCard();
  renderProgress();
}
function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function renderNotes() {
  const grid = $('note-grid');
  const empty = $('notes-empty');
  const q = $('notes-search').value.trim().toLowerCase();
  const filtered = notes.filter(n => {
    const hay = `${n.title} ${n.body} ${n.tag} ${n.unit}`.toLowerCase();
    return !q || hay.includes(q);
  }).sort((a, b) => b.updatedAt - a.updatedAt);
  if (filtered.length === 0) { grid.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  grid.innerHTML = filtered.map(n => `
    <div class="note-card">
      <div class="meta-line">
        <span class="pill">${escapeHtml(n.tag || 'General')}</span>
        <span class="pill">${escapeHtml(n.unit || 'General')}</span>
        ${n.aiGenerated ? '<span class="pill ai">AI generated</span>' : ''}
      </div>
      <h4>${escapeHtml(n.title || 'Untitled')}</h4>
      <div class="body">${escapeHtml(n.body)}</div>
      <div class="note-meta">
        <span class="hint">${new Date(n.updatedAt).toLocaleDateString()}</span>
        <span>
          <button class="icon-btn" data-edit-note="${n.id}" title="Edit" aria-label="Edit note">edit</button>
          <button class="icon-btn btn-danger" data-del-note="${n.id}" title="Delete" aria-label="Delete note">x</button>
        </span>
      </div>
    </div>
  `).join('');
  grid.querySelectorAll('[data-edit-note]').forEach(btn => btn.addEventListener('click', () => openNoteForm(btn.dataset.editNote)));
  grid.querySelectorAll('[data-del-note]').forEach(btn => btn.addEventListener('click', () => {
    if (!confirm('Delete this note?')) return;
    notes = notes.filter(n => n.id !== btn.dataset.delNote);
    idbSet('notes', notes);
    renderNotes();
  }));
}
function openNoteForm(id) {
  $('note-form').classList.remove('hidden');
  editingNoteId = id || null;
  const n = notes.find(note => note.id === id);
  $('note-title').value = n?.title || '';
  $('note-tag').value = n?.tag || '';
  $('note-unit').value = n?.unit || '';
  $('note-body').value = n?.body || '';
  $('note-title').focus();
}
function saveNote() {
  const title = $('note-title').value.trim();
  const tag = $('note-tag').value.trim();
  const unit = $('note-unit').value.trim();
  const body = $('note-body').value.trim();
  if (!title && !body) return;
  if (editingNoteId) {
    const n = notes.find(note => note.id === editingNoteId);
    if (n) { n.title = title; n.tag = tag; n.unit = unit; n.body = body; n.updatedAt = Date.now(); }
  } else {
    notes.push({ id: uid(), title, tag, unit, body, aiGenerated: false, createdAt: Date.now(), updatedAt: Date.now() });
  }
  $('note-form').classList.add('hidden');
  idbSet('notes', notes);
  renderEverything();
}
async function generateNotesFromDocument() {
  const doc = documents.find(d => d.id === $('notes-doc-select').value);
  if (!doc) return setStatus('notes-ai-status', 'Upload a document first. (No document selected)');

  setStatus('notes-ai-status', 'Generating notes...');
  $('generate-notes-btn').disabled = true;
  try {
    const data = await callAI('/api/generate-notes', { document: aiDocumentPayload(doc) });
    const bodyParts = [
      data.summary ? `Summary\n${data.summary}` : '',
      Array.isArray(data.keyConcepts) && data.keyConcepts.length ? `\nKey concepts\n${data.keyConcepts.map(x => `- ${x}`).join('\n')}` : '',
      data.body || ''
    ].filter(Boolean);
    notes.push({
      id: uid(),
      title: data.title || `${doc.title} notes`,
      tag: doc.course,
      unit: doc.unit,
      body: bodyParts.join('\n\n'),
      aiGenerated: true,
      sourceDocumentId: doc.id,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    await idbSet('notes', notes);
    setStatus('notes-ai-status', 'AI note added.');
    renderEverything();
  } catch (err) {
    setStatus('notes-ai-status', err.message || 'Could not generate notes.');
  } finally {
    $('generate-notes-btn').disabled = false;
  }
}

function aiDocumentPayload(doc) {
  return {
    id: doc.id,
    title: doc.title,
    course: doc.course,
    unit: doc.unit,
    text: truncateText(doc.extractedText, 14000)
  };
}
async function callAI(path, payload) {
  const res = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `Server error: ${res.status}`);
  return data;
}

async function generateQuiz() {
  const doc = documents.find(d => d.id === $('quiz-doc-select').value);
  if (!doc) return setStatus('quiz-status', 'Upload a document first. (No document selected)');

  setStatus('quiz-status', 'Generating quiz...');
  $('generate-quiz-btn').disabled = true;
  try {
    const data = await callAI('/api/generate-quiz', { document: aiDocumentPayload(doc) });
    const questions = Array.isArray(data.questions) ? data.questions : [];
    renderQuiz(doc, questions);
    setStatus('quiz-status', `Ready: ${questions.length} questions.`);
  } catch (err) {
    setStatus('quiz-status', err.message || 'Could not generate quiz.');
  } finally {
    $('generate-quiz-btn').disabled = false;
  }
}
function renderQuiz(doc, questions) {
  $('quiz-empty').classList.add('hidden');
  const area = $('quiz-area');
  if (questions.length === 0) { area.innerHTML = '<div class="empty-state">The AI did not return usable questions.</div>'; return; }
  area.innerHTML = questions.map((q, i) => {
    const type = q.type || 'multiple_choice';
    const options = Array.isArray(q.options) ? q.options : (type === 'true_false' ? ['True', 'False'] : []);
    const input = options.length ? options.map(opt => `
      <label class="quiz-option">
        <input type="radio" name="quiz-${i}" value="${escapeHtml(opt)}">
        <span>${escapeHtml(opt)}</span>
      </label>
    `).join('') : `<input type="text" data-free-answer="${i}" placeholder="Your answer">`;
    return `
      <div class="quiz-question" data-q-index="${i}">
        <div class="meta-line"><span class="pill">${escapeHtml(type.replace(/_/g, ' '))}</span></div>
        <strong>${i + 1}. ${escapeHtml(q.question)}</strong>
        <div>${input}</div>
        <div class="status" data-feedback="${i}"></div>
      </div>
    `;
  }).join('') + '<div class="row"><button class="btn btn-primary" id="grade-quiz-btn">Grade quiz</button></div>';
  $('grade-quiz-btn').addEventListener('click', () => gradeQuiz(doc, questions));
}
function gradeQuiz(doc, questions) {
  let correct = 0;
  questions.forEach((q, i) => {
    const chosen = document.querySelector(`input[name="quiz-${i}"]:checked`)?.value;
    const free = document.querySelector(`[data-free-answer="${i}"]`)?.value;
    const answer = chosen ?? free ?? '';
    const ok = normalizeAnswer(answer) === normalizeAnswer(q.correctAnswer || q.answer);
    if (ok) correct++;
    const feedback = document.querySelector(`[data-feedback="${i}"]`);
    feedback.textContent = `${ok ? 'Correct' : 'Incorrect'} - answer: ${q.correctAnswer || q.answer || 'Not provided'}. ${q.explanation || ''}`;
    document.querySelectorAll(`[name="quiz-${i}"]`).forEach(input => {
      const label = input.closest('.quiz-option');
      label.classList.toggle('correct', normalizeAnswer(input.value) === normalizeAnswer(q.correctAnswer || q.answer));
      label.classList.toggle('wrong', input.checked && !ok);
    });
  });
  const score = questions.length ? Math.round((correct / questions.length) * 100) : 0;
  quizResults.push({ id: uid(), documentId: doc.id, course: doc.course, unit: doc.unit, score, correct, total: questions.length, takenAt: Date.now() });
  idbSet('quizResults', quizResults);
  setStatus('quiz-status', `Score: ${correct}/${questions.length} (${score}%).`);
  renderProgress();
}

const RING_CIRC = 2 * Math.PI * 98;
$('ring-progress').setAttribute('stroke-dasharray', RING_CIRC.toFixed(2));
let timer = { mode: 'work', remaining: 25 * 60, total: 25 * 60, running: false, cyclesDone: 0, intervalId: null };
function getDurations() {
  return {
    work: Math.max(1, parseInt($('work-min').value) || 25) * 60,
    brk: Math.max(1, parseInt($('break-min').value) || 5) * 60,
    long: Math.max(1, parseInt($('long-min').value) || 15) * 60
  };
}
function renderTimer() {
  const m = Math.floor(timer.remaining / 60).toString().padStart(2, '0');
  const s = Math.floor(timer.remaining % 60).toString().padStart(2, '0');
  $('ring-time').textContent = `${m}:${s}`;
  $('ring-mode').textContent = timer.mode === 'work' ? 'Work session' : (timer.mode === 'long' ? 'Long break' : 'Short break');
  $('ring-progress').setAttribute('stroke-dashoffset', (RING_CIRC * (1 - timer.remaining / timer.total)).toFixed(2));
  $('ring-progress').style.stroke = timer.mode === 'work' ? 'var(--pen-green)' : 'var(--pen-blue)';
  $('timer-start-btn').textContent = timer.running ? 'Pause' : 'Start';
}
function logWorkSession(seconds) {
  timerSessions.push({
    id: uid(),
    course: $('timer-course').value,
    unit: $('timer-unit').value,
    seconds,
    completedAt: Date.now()
  });
  idbSet('timerSessions', timerSessions);
}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 660;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch (e) { }
}
function timerTick() {
  timer.remaining--;
  if (timer.remaining <= 0) {
    beep();
    const d = getDurations();
    if (timer.mode === 'work') {
      logWorkSession(timer.total);
      timer.cyclesDone++;
      const isLong = timer.cyclesDone % 4 === 0;
      timer.mode = isLong ? 'long' : 'break';
      timer.total = isLong ? d.long : d.brk;
    } else {
      timer.mode = 'work';
      timer.total = d.work;
    }
    timer.remaining = timer.total;
  }
  renderTimer();
}

function renderProgress() {
  const totalSeconds = timerSessions.reduce((sum, s) => sum + (s.seconds || 0), 0);
  const completedDocs = documents.filter(d => (d.readingProgress || 0) >= 100).length;
  const quizAvg = quizResults.length ? Math.round(quizResults.reduce((sum, r) => sum + r.score, 0) / quizResults.length) : 0;
  const mastery = cards.length ? Math.round((cards.filter(c => c.mastered).length / cards.length) * 100) : 0;
  $('stat-hours').textContent = `${(totalSeconds / 3600).toFixed(totalSeconds >= 36000 ? 0 : 1)}h`;
  $('stat-docs').textContent = completedDocs;
  $('stat-quiz').textContent = `${quizAvg}%`;
  $('stat-cards').textContent = `${mastery}%`;
  const groups = new Map();
  documents.forEach(d => {
    const key = courseUnitKey(d.course, d.unit);
    if (!groups.has(key)) groups.set(key, { course: d.course || 'General', unit: d.unit || 'General', docs: [], cards: [], quizzes: [], sessions: [] });
    groups.get(key).docs.push(d);
  });
  cards.forEach(c => {
    const key = courseUnitKey(c.subject, c.unit);
    if (!groups.has(key)) groups.set(key, { course: c.subject || 'General', unit: c.unit || 'General', docs: [], cards: [], quizzes: [], sessions: [] });
    groups.get(key).cards.push(c);
  });
  quizResults.forEach(q => {
    const key = courseUnitKey(q.course, q.unit);
    if (!groups.has(key)) groups.set(key, { course: q.course || 'General', unit: q.unit || 'General', docs: [], cards: [], quizzes: [], sessions: [] });
    groups.get(key).quizzes.push(q);
  });
  timerSessions.forEach(s => {
    const key = courseUnitKey(s.course, s.unit);
    if (!groups.has(key)) groups.set(key, { course: s.course || 'General', unit: s.unit || 'General', docs: [], cards: [], quizzes: [], sessions: [] });
    groups.get(key).sessions.push(s);
  });
  $('progress-list').innerHTML = [...groups.values()].map(g => {
    const read = g.docs.length ? Math.round(g.docs.reduce((sum, d) => sum + (d.readingProgress || 0), 0) / g.docs.length) : 0;
    const gMastery = g.cards.length ? Math.round((g.cards.filter(c => c.mastered).length / g.cards.length) * 100) : 0;
    const gQuiz = g.quizzes.length ? Math.round(g.quizzes.reduce((sum, q) => sum + q.score, 0) / g.quizzes.length) : 0;
    const hours = g.sessions.reduce((sum, s) => sum + (s.seconds || 0), 0) / 3600;
    return `<div class="list-row"><div><h4>${escapeHtml(g.course)} - ${escapeHtml(g.unit)}</h4><p>Reading ${read}% - Cards ${gMastery}% - Quiz ${gQuiz}% - Study ${hours.toFixed(1)}h</p></div></div>`;
  }).join('') || '<div class="empty-state">No progress yet.</div>';
  const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = timerSessions.filter(s => s.completedAt >= weekStart).sort((a, b) => b.completedAt - a.completedAt);
  $('session-list').innerHTML = recent.slice(0, 8).map(s => `
    <div class="list-row"><div><h4>${escapeHtml(s.course || 'General')} - ${escapeHtml(s.unit || 'General')}</h4><p>${Math.round(s.seconds / 60)} minutes on ${new Date(s.completedAt).toLocaleDateString()}</p></div></div>
  `).join('') || '<div class="empty-state">No sessions this week.</div>';
}

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function readJSONFile(file, cb) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try { cb(JSON.parse(reader.result)); }
    catch (e) { alert('Could not read that file. Make sure it is valid JSON.'); }
  };
  reader.readAsText(file);
}

function renderEverything() {
  renderTaxonomy();
  renderDocuments();
  renderDeckBar();
  renderCardList();
  renderNotes();
  renderProgress();
}

$('upload-doc-btn').addEventListener('click', addDocument);
['doc-search', 'doc-sort', 'doc-filter'].forEach(id => $(id).addEventListener('input', renderDocuments));
$('active-doc-select').addEventListener('change', e => previewDocument(e.target.value));
$('open-doc-btn').addEventListener('click', () => $('active-doc-select').value && openRawDocument($('active-doc-select').value));
$('doc-progress').addEventListener('input', e => {
  const doc = documents.find(d => d.id === currentPreviewDocId);
  if (!doc) return;
  doc.readingProgress = parseInt(e.target.value) || 0;
  idbSet('documents', documents);
  renderProgress();
  renderDocuments();
});
$('chat-send').addEventListener('click', sendChat);
$('access-token-input').value = localStorage.getItem(ACCESS_TOKEN_KEY) || '';
$('save-access-token-btn').addEventListener('click', () => {
  const token = $('access-token-input').value.trim();
  if (!token) {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    setStatus('access-token-status', 'Saved token cleared.');
    return;
  }
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
  setStatus('access-token-status', 'Access token saved in this browser.');
});
$('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
$('add-card-btn').addEventListener('click', addManualCard);
$('generate-cards-btn').addEventListener('click', generateFlashcardsFromDocument);
$('export-cards-btn').addEventListener('click', () => downloadJSON(cards, 'margin-flashcards.json'));
$('import-cards-btn').addEventListener('click', () => $('import-cards-file').click());
$('import-cards-file').addEventListener('change', e => readJSONFile(e.target.files[0], data => {
  if (Array.isArray(data)) {
    data.forEach(c => cards.push({ id: uid(), front: c.front || '', back: c.back || '', subject: c.subject || c.course || '', unit: c.unit || '', format: c.format || 'basic', aiGenerated: !!c.aiGenerated, mastered: !!c.mastered, createdAt: Date.now() }));
    idbSet('cards', cards);
    renderEverything();
  }
}));
$('start-card-study-btn').addEventListener('click', startCardStudy);
$('flip-card').addEventListener('click', () => {
  if (studyIndex >= studyDeck.length) return;
  studyFlipped = !studyFlipped;
  $('flip-card').classList.toggle('flipped', studyFlipped);
  $('flip-card').textContent = studyFlipped ? studyDeck[studyIndex].back : studyDeck[studyIndex].front;
});
$('card-got-it-btn').addEventListener('click', () => markStudyCard(true));
$('card-again-btn').addEventListener('click', () => markStudyCard(false));
$('card-study-exit-btn').addEventListener('click', () => $('cards-study').classList.add('hidden'));
$('generate-quiz-btn').addEventListener('click', generateQuiz);
$('new-note-btn').addEventListener('click', () => openNoteForm(null));
$('cancel-note-btn').addEventListener('click', () => $('note-form').classList.add('hidden'));
$('save-note-btn').addEventListener('click', saveNote);
$('notes-search').addEventListener('input', renderNotes);
$('generate-notes-btn').addEventListener('click', generateNotesFromDocument);
$('export-notes-btn').addEventListener('click', () => downloadJSON(notes, 'margin-notes.json'));
$('import-notes-btn').addEventListener('click', () => $('import-notes-file').click());
$('import-notes-file').addEventListener('change', e => readJSONFile(e.target.files[0], data => {
  if (Array.isArray(data)) {
    data.forEach(n => notes.push({ id: uid(), title: n.title || '', tag: n.tag || '', unit: n.unit || '', body: n.body || '', aiGenerated: !!n.aiGenerated, createdAt: n.createdAt || Date.now(), updatedAt: n.updatedAt || Date.now() }));
    idbSet('notes', notes);
    renderEverything();
  }
}));
$('timer-start-btn').addEventListener('click', () => {
  timer.running = !timer.running;
  if (timer.running) timer.intervalId = setInterval(timerTick, 1000);
  else clearInterval(timer.intervalId);
  renderTimer();
});
$('timer-reset-btn').addEventListener('click', () => {
  clearInterval(timer.intervalId);
  const d = getDurations();
  timer = { mode: 'work', remaining: d.work, total: d.work, running: false, cyclesDone: 0, intervalId: null };
  renderTimer();
});
['work-min', 'break-min', 'long-min'].forEach(id => $(id).addEventListener('change', () => {
  if (!timer.running) {
    const d = getDurations();
    timer.total = timer.mode === 'work' ? d.work : (timer.mode === 'long' ? d.long : d.brk);
    timer.remaining = timer.total;
    renderTimer();
  }
}));

async function init() {
  documents = await idbGet('documents') || [];
  cards = await idbGet('cards') || [];
  notes = await idbGet('notes') || [];
  quizResults = await idbGet('quizResults') || [];
  timerSessions = await idbGet('timerSessions') || [];
  renderTimer();
  renderEverything();
  if (documents[0]) previewDocument(documents[0].id);
}
init();