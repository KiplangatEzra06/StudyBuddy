import { state } from '../shared/state.js';
import { $, escapeHtml, setStatus } from '../shared/dom.js';
import { uid, formatBytes } from '../shared/format.js';
import { emit } from '../shared/bus.js';
import { idbSet } from '../services/storage.js';
import { confirmDeletion, softDeleteRecords } from '../shared/undo.js';
import { paginateToFit } from '../shared/fit-paginator.js';

let renderProgress = () => {};

export function changeDocumentPage(index) {
  state.documentPageIndex = Math.max(0, Math.min(Number(index) || 0, state.documentTextPages.length - 1));
  renderDocumentPage();
}

export function normalizeExtractedText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\uF0B7\u2022\u25AA\u25CF\u25E6]/g, '•')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uE000-\uF8FF\uFFFD]/g, '')
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')
    .trim();
}

export function extractPdfPageText(items) {
  const lines = [];
  items.filter(item => typeof item.str === 'string' && item.str.trim()).forEach(item => {
    const transform = item.transform || [];
    const x = Number(transform[4]) || 0;
    const y = Number(transform[5]) || 0;
    const fontSize = Math.abs(Number(transform[3])) || 10;
    let line = lines.find(candidate => Math.abs(candidate.y - y) <= Math.max(2, fontSize * 0.22));
    if (!line) {
      line = { y, fontSize, items: [] };
      lines.push(line);
    }
    line.items.push({ x, width: Number(item.width) || 0, text: item.str });
  });

  lines.sort((a, b) => b.y - a.y);
  return lines.map((line, index) => {
    line.items.sort((a, b) => a.x - b.x);
    let text = '';
    let previousEnd = null;
    line.items.forEach(item => {
      const gap = previousEnd === null ? 0 : item.x - previousEnd;
      if (text && gap > 1.25) text += ' ';
      text += item.text;
      previousEnd = item.x + item.width;
    });
    const next = lines[index + 1];
    const blankLine = next && line.y - next.y > Math.max(line.fontSize, next.fontSize) * 1.65;
    return `${text.trim()}${blankLine ? '\n' : ''}`;
  }).join('\n');
}

export async function parseDocumentFile(file) {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    if (!window.pdfjsLib) throw new Error('PDF parser did not load. Check your connection and try again.');
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const chunks = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      chunks.push(extractPdfPageText(content.items));
    }
    const originalText = chunks.join('\n\n').trim();
    return { originalText, extractedText: normalizeExtractedText(originalText) };
  }
  if (file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt')) {
    const originalText = await file.text();
    return { originalText, extractedText: normalizeExtractedText(originalText) };
  }
  throw new Error('Only PDF and TXT files are supported in v1.');
}

export async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl) {
  const [meta, body] = dataUrl.split(',');
  const mime = (meta.match(/data:(.*?);base64/) || [, 'application/octet-stream'])[1];
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export async function addDocument() {
  const file = $('doc-file').files[0];
  if (!file) return setStatus('doc-status', 'Choose a PDF or TXT file first.');
  setStatus('doc-status', 'Extracting text...');
  try {
    const { originalText, extractedText } = await parseDocumentFile(file);
    if (!extractedText) throw new Error('No readable text was found.');
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
      originalExtractedText: originalText,
      extractedText,
      uploadedAt: now,
      lastOpened: null,
      readingProgress: 0
    };
    state.documents.push(doc);
    $('doc-file').value = '';
    $('doc-title').value = '';
    $('document-metadata').classList.add('hidden');
    $('upload-dropzone').classList.remove('has-file');
    $('upload-file-name').textContent = '';
    $('upload-file-name').classList.add('hidden');
    state.showOriginalDocumentText = false;
    setStatus('doc-status', 'Document saved.');
    await idbSet('documents', state.documents);
    emit('documents:changed');
    previewDocument(doc.id);
  } catch (err) {
    setStatus('doc-status', err.message || 'Could not upload document.');
  }
}

export function filteredDocuments() {
  const q = $('doc-search').value.trim().toLowerCase();
  const filter = $('doc-filter').value;
  let list = state.documents.filter(doc => {
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

export function renderDocuments() {
  const list = $('doc-list');
  const empty = $('docs-empty');
  const docs = filteredDocuments();
  if (docs.length === 0) { list.innerHTML = ''; empty.classList.remove('hidden'); }
  else {
    empty.classList.add('hidden');
    list.innerHTML = docs.map(doc => `
      <article class="document-card">
        <div class="document-card-main">
          <div class="document-file-icon" aria-hidden="true">${doc.fileType === 'application/pdf' ? 'PDF' : 'TXT'}</div>
          <div class="document-card-copy">
          <h4>${escapeHtml(doc.title)}</h4>
          <p>${escapeHtml(doc.fileName)} - ${formatBytes(doc.fileSize)}</p>
          <div class="meta-line">
            <span class="pill">${escapeHtml(doc.course || 'General')}</span>
            <span class="pill">${escapeHtml(doc.unit || 'General')}</span>
            ${doc.favorite ? '<span class="pill good">favorite</span>' : ''}
            <span class="pill">${new Date(doc.uploadedAt).toLocaleDateString()}</span>
          </div>
          <div class="document-progress-label"><span>Reading progress</span><strong>${doc.readingProgress || 0}%</strong></div>
          <div class="progress-line" role="progressbar" aria-valuenow="${doc.readingProgress || 0}" aria-valuemin="0" aria-valuemax="100"><span style="width:${doc.readingProgress || 0}%"></span></div>
          </div>
        </div>
        <div class="row document-card-actions">
          <button class="btn btn-sm" data-preview-doc="${doc.id}">Preview</button>
          <button class="btn btn-sm" data-open-raw="${doc.id}">File</button>
          <button class="icon-btn btn-danger" data-delete-doc="${doc.id}" title="Delete" aria-label="Delete document">x</button>
        </div>
      </article>
    `).join('');
  }
  list.querySelectorAll('[data-preview-doc]').forEach(btn => btn.addEventListener('click', () => previewDocument(btn.dataset.previewDoc)));
  list.querySelectorAll('[data-open-raw]').forEach(btn => btn.addEventListener('click', () => openRawDocument(btn.dataset.openRaw)));
  list.querySelectorAll('[data-delete-doc]').forEach(btn => btn.addEventListener('click', async () => {
    const doc = state.documents.find(item => item.id === btn.dataset.deleteDoc);
    if (!doc) return;
    const linked = state.cards.filter(card => card.sourceDocumentId === doc.id);
    const choice = await confirmDeletion({
      title: `Delete document "${doc.title}"?`,
      description: 'The extracted text and reading progress for this document will be removed.',
      affected: linked.length ? `${linked.length} flashcard${linked.length === 1 ? '' : 's'} reference this document. Choose whether to keep or delete them.` : '',
      choices: linked.length
        ? [
          { key: 'document', label: 'Delete document only' },
          { key: 'all', label: `Delete document and ${linked.length} cards` }
        ]
        : [{ key: 'document', label: 'Delete document' }]
    });
    if (!choice) return;
    if (state.currentPreviewDocId === doc.id) state.currentPreviewDocId = null;
    const changes = [{ collection: 'documents', ids: [doc.id] }];
    if (choice === 'all') changes.push({ collection: 'cards', ids: linked.map(card => card.id) });
    await softDeleteRecords(changes, 'Document deleted.');
  }));
  paginateToFit(list, { label: 'Document pages', itemHeight: 118 });
  renderDocumentSelects();
}

export function renderDocumentSelects() {
  const options = state.documents.length
    ? state.documents.map(doc => `<option value="${doc.id}">${escapeHtml(doc.title)}</option>`).join('')
    : '<option value="">No documents</option>';
  ['active-doc-select', 'flashcard-doc-select', 'quiz-doc-select', 'notes-doc-select'].forEach(id => {
    const previous = $(id).value;
    $(id).innerHTML = options;
    if (state.documents.some(doc => doc.id === previous)) $(id).value = previous;
  });
}

export function splitDocumentPages(text, container) {
  const style = getComputedStyle(container);
  const font = `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const lineHeight = parseFloat(style.lineHeight) || 20;
  const maxLines = Math.max(4, Math.floor(container.clientHeight / lineHeight));
  const maxWidth = Math.max(80, container.clientWidth - 4);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  context.font = font;
  const lines = [];
  String(text || '').split(/\r?\n/).forEach(paragraph => {
    if (!paragraph) {
      lines.push('');
      return;
    }
    let line = '';
    paragraph.split(/\s+/).forEach(word => {
      const candidate = line ? `${line} ${word}` : word;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
      if (context.measureText(line).width > maxWidth) {
        let part = '';
        for (const character of line) {
          if (part && context.measureText(part + character).width > maxWidth) {
            lines.push(part);
            part = character;
          } else part += character;
        }
        line = part;
      }
    });
    if (line) lines.push(line);
  });
  const pages = [];
  for (let index = 0; index < lines.length; index += maxLines) pages.push(lines.slice(index, index + maxLines).join('\n'));
  return pages.length ? pages : ['No extracted text available.'];
}

export function renderDocumentPage() {
  const container = $('doc-preview');
  if (!container) return;
  state.documentTextPages = splitDocumentPages(container.dataset.fullText || container.textContent, container);
  state.documentPageIndex = Math.max(0, Math.min(state.documentPageIndex, state.documentTextPages.length - 1));
  container.textContent = state.documentTextPages[state.documentPageIndex];
  $('document-page-indicator').textContent = `Page ${state.documentPageIndex + 1} of ${state.documentTextPages.length}`;
  $('document-page-jump').max = String(state.documentTextPages.length);
  $('document-page-jump').value = String(state.documentPageIndex + 1);
  $('document-page-prev').disabled = state.documentPageIndex === 0;
  $('document-page-next').disabled = state.documentPageIndex >= state.documentTextPages.length - 1;
  const doc = state.documents.find(item => item.id === state.currentPreviewDocId);
  if (doc) {
    doc.readingProgress = Math.round(((state.documentPageIndex + 1) / state.documentTextPages.length) * 100);
    $('doc-progress').value = String(doc.readingProgress);
    idbSet('documents', state.documents);
  }
}

export function previewDocument(id) {
  const doc = state.documents.find(d => d.id === id);
  if (!doc) return;
  state.currentPreviewDocId = id;
  doc.lastOpened = Date.now();
  $('active-doc-select').value = id;
  const originalText = doc.originalExtractedText || doc.extractedText;
  const hasOriginal = originalText !== doc.extractedText;
  if (!hasOriginal) state.showOriginalDocumentText = false;
  $('original-text-toggle').disabled = !hasOriginal;
  $('original-text-toggle').setAttribute('aria-pressed', String(state.showOriginalDocumentText));
  $('original-text-toggle').textContent = state.showOriginalDocumentText ? 'View cleaned text' : 'View original text';
  $('doc-preview').dataset.fullText = String(state.showOriginalDocumentText ? originalText : doc.extractedText).slice(0, 120000) || 'No extracted text available.';
  state.documentTextPages = splitDocumentPages($('doc-preview').dataset.fullText, $('doc-preview'));
  state.documentPageIndex = Math.min(state.documentTextPages.length - 1, Math.floor(((doc.readingProgress || 0) / 100) * state.documentTextPages.length));
  renderDocumentPage();
  idbSet('documents', state.documents);
  renderDocuments();
}

export function openRawDocument(id) {
  const doc = state.documents.find(d => d.id === id);
  if (!doc || !doc.fileData) return;
  doc.lastOpened = Date.now();
  const url = URL.createObjectURL(dataUrlToBlob(doc.fileData));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  idbSet('documents', state.documents);
  renderDocuments();
}

export function renderTaxonomy() {
  const courses = [...new Set([
    ...state.documents.map(d => d.course),
    ...state.cards.map(c => c.subject),
    ...state.notes.map(n => n.tag),
    ...state.timerSessions.map(s => s.course),
    ...state.classes.map(item => item.name)
  ].filter(Boolean))].sort();
  const units = [...new Set([
    ...state.documents.map(d => d.unit),
    ...state.cards.map(c => c.unit),
    ...state.notes.map(n => n.unit),
    ...state.timerSessions.map(s => s.unit)
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

function updateSelectedUpload(file) {
  const allowed = file && (file.type === 'application/pdf' || file.type === 'text/plain'
    || /\.(pdf|txt)$/i.test(file.name));
  if (!file || !allowed) {
    $('document-metadata').classList.add('hidden');
    $('upload-dropzone').classList.remove('has-file');
    $('upload-file-name').classList.add('hidden');
    $('upload-file-name').textContent = '';
    if (file) setStatus('doc-status', 'Only PDF and TXT files are supported.');
    return;
  }
  $('document-metadata').classList.remove('hidden');
  $('upload-dropzone').classList.add('has-file');
  $('upload-file-name').textContent = `${file.name} · ${formatBytes(file.size)}`;
  $('upload-file-name').classList.remove('hidden');
  setStatus('doc-status', '');
}

export function init(deps = {}) {
  renderProgress = deps.renderProgress || renderProgress;

  $('upload-doc-btn')?.addEventListener('click', addDocument);
  $('doc-file')?.addEventListener('change', event => updateSelectedUpload(event.target.files[0]));
  const uploadDropzone = $('upload-dropzone');
  if (uploadDropzone) {
    ['dragenter', 'dragover'].forEach(type => uploadDropzone.addEventListener(type, event => {
      event.preventDefault();
      uploadDropzone.classList.add('dragging');
    }));
    ['dragleave', 'drop'].forEach(type => uploadDropzone.addEventListener(type, event => {
      event.preventDefault();
      uploadDropzone.classList.remove('dragging');
    }));
    uploadDropzone.addEventListener('drop', event => {
      const file = event.dataTransfer.files[0];
      if (!file) return;
      const transfer = new DataTransfer();
      transfer.items.add(file);
      $('doc-file').files = transfer.files;
      updateSelectedUpload(file);
    });
  }
  ['doc-search', 'doc-sort', 'doc-filter'].forEach(id => $(id)?.addEventListener('input', renderDocuments));
  $('active-doc-select')?.addEventListener('change', e => previewDocument(e.target.value));
  $('document-list-view')?.addEventListener('click', () => {
    $('panel-documents').classList.remove('show-document-reader');
    $('document-list-view').classList.add('active');
    $('document-list-view').setAttribute('aria-pressed', 'true');
    $('document-reader-view').classList.remove('active');
    $('document-reader-view').setAttribute('aria-pressed', 'false');
  });
  $('document-reader-view')?.addEventListener('click', () => {
    $('panel-documents').classList.add('show-document-reader');
    $('document-list-view').classList.remove('active');
    $('document-list-view').setAttribute('aria-pressed', 'false');
    $('document-reader-view').classList.add('active');
    $('document-reader-view').setAttribute('aria-pressed', 'true');
  });
  $('open-doc-btn')?.addEventListener('click', () => $('active-doc-select').value && openRawDocument($('active-doc-select').value));
  $('original-text-toggle')?.addEventListener('click', () => {
    const doc = state.documents.find(item => item.id === state.currentPreviewDocId);
    if (!doc || (doc.originalExtractedText || doc.extractedText) === doc.extractedText) return;
    state.showOriginalDocumentText = !state.showOriginalDocumentText;
    previewDocument(doc.id);
  });
  $('doc-progress')?.addEventListener('input', e => {
    const doc = state.documents.find(d => d.id === state.currentPreviewDocId);
    if (!doc) return;
    doc.readingProgress = parseInt(e.target.value) || 0;
    idbSet('documents', state.documents);
    renderProgress();
    renderDocuments();
  });
  $('document-page-prev')?.addEventListener('click', () => changeDocumentPage(state.documentPageIndex - 1));
  $('document-page-next')?.addEventListener('click', () => changeDocumentPage(state.documentPageIndex + 1));
  $('document-page-jump')?.addEventListener('change', event => {
    const page = Number(event.target.value);
    if (!Number.isInteger(page) || page < 1 || page > state.documentTextPages.length) {
      event.target.value = String(state.documentPageIndex + 1);
      return;
    }
    changeDocumentPage(page - 1);
  });
  if (typeof ResizeObserver !== 'undefined' && $('doc-preview')) {
    const documentPreviewObserver = new ResizeObserver(() => {
      if (!state.currentPreviewDocId) return;
      const previousPage = state.documentPageIndex;
      state.documentTextPages = splitDocumentPages($('doc-preview').dataset.fullText || '', $('doc-preview'));
      state.documentPageIndex = Math.min(previousPage, state.documentTextPages.length - 1);
      renderDocumentPage();
    });
    documentPreviewObserver.observe($('doc-preview'));
  }
}
