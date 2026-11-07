import { state } from '../shared/state.js';
import { $, setStatus } from '../shared/dom.js';
import { uid, formatBytes } from '../shared/format.js';
import { emit } from '../shared/bus.js';
import { idbSet } from '../services/storage.js';
import {
  MAX_ASSIGNMENT_BRIEF_BYTES,
  MAX_ASSIGNMENT_BRIEF_TEXT_LENGTH,
  mimeTypeForBriefFilename,
  createAssignmentBriefsApi
} from '../services/assignment-briefs-api.js';

const SCANNED_BRIEF_MESSAGE = 'Scanned PDFs and images need pasted text because OCR is not available.';

let briefsApi = null;
let activeAssignmentId = null;
let selectedFile = null;
let busy = false;

function sourceMode() {
  return document.querySelector('input[name="assignment-brief-source"]:checked')?.value || 'file';
}

function setProgress(visible, value = 0) {
  const progress = $('assignment-brief-progress');
  if (!progress) return;
  progress.classList.toggle('hidden', !visible);
  progress.value = value;
}

function setBusy(nextBusy) {
  busy = nextBusy;
  $('assignment-brief-save').disabled = nextBusy;
  $('assignment-brief-remove').disabled = nextBusy;
  $('assignment-brief-choose-file').disabled = nextBusy;
  document.querySelectorAll('input[name="assignment-brief-source"]').forEach(input => {
    input.disabled = nextBusy;
  });
}

function clearBriefFields(assignment) {
  assignment.briefDocumentId = null;
  assignment.briefFileName = null;
  assignment.briefMimeType = null;
  assignment.briefFileSize = null;
  assignment.briefStatus = null;
  assignment.briefExtractedText = null;
}

function applyBriefFields(assignment, brief) {
  if (!brief?.brief_document_id) {
    clearBriefFields(assignment);
    return;
  }
  assignment.briefDocumentId = brief.brief_document_id;
  assignment.briefFileName = brief.brief_file_name || null;
  assignment.briefMimeType = brief.brief_mime_type || null;
  assignment.briefFileSize = brief.brief_file_size == null ? null : Number(brief.brief_file_size);
  assignment.briefStatus = brief.brief_status || null;
  assignment.briefExtractedText = brief.brief_extracted_text || null;
}

function assignmentPayload(assignment) {
  return {
    id: assignment.id,
    title: assignment.title || '',
    classId: assignment.classId || '',
    dueAt: Number(assignment.dueAt),
    reminderAt: Number.isFinite(assignment.reminderAt) ? assignment.reminderAt : null,
    reminderSentAt: Number.isFinite(assignment.reminderSentAt) ? assignment.reminderSentAt : null,
    details: assignment.details || '',
    completed: Boolean(assignment.completed),
    ...(Number.isFinite(assignment.createdAt) ? { createdAt: assignment.createdAt } : {}),
    ...(Number.isFinite(assignment.updatedAt) ? { updatedAt: assignment.updatedAt } : {})
  };
}

function syncSourcePanels() {
  const paste = sourceMode() === 'paste';
  $('assignment-brief-file-source').classList.toggle('hidden', paste);
  $('assignment-brief-paste-source').classList.toggle('hidden', !paste);
}

function syncSelectedFileLabel() {
  const label = $('assignment-brief-file-name');
  if (!selectedFile) {
    label.textContent = '';
    label.classList.add('hidden');
    return;
  }
  label.textContent = `${selectedFile.name} · ${formatBytes(selectedFile.size)}`;
  label.classList.remove('hidden');
}

function resetBriefDialogForm() {
  selectedFile = null;
  $('assignment-brief-file').value = '';
  $('assignment-brief-text').value = '';
  document.querySelector('input[name="assignment-brief-source"][value="file"]').checked = true;
  syncSourcePanels();
  syncSelectedFileLabel();
  setProgress(false, 0);
  setStatus('assignment-brief-status', '');
}

function validateSelectedFile(file) {
  if (!file) return { error: 'Choose a brief file first.' };
  if (!file.size) return { error: 'Choose a non-empty brief file.' };
  if (file.size > MAX_ASSIGNMENT_BRIEF_BYTES) {
    return { error: 'Brief files must be 10 MB or smaller.' };
  }
  const mimeType = mimeTypeForBriefFilename(file.name);
  if (!mimeType) {
    return { error: 'Supported brief files are PDF, DOCX, TXT, JPG, PNG, GIF, and WEBP.' };
  }
  if (file.type && file.type !== 'application/octet-stream' && file.type !== mimeType) {
    return { error: 'The file type does not match its filename.' };
  }
  return { mimeType };
}

function selectBriefFile(file) {
  const validation = validateSelectedFile(file);
  if (validation.error) {
    selectedFile = null;
    $('assignment-brief-file').value = '';
    syncSelectedFileLabel();
    setStatus('assignment-brief-status', validation.error);
    return;
  }
  selectedFile = file;
  syncSelectedFileLabel();
  setStatus('assignment-brief-status', '');
}

function normalizeExtractedText(text) {
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

function extractPdfPageText(items) {
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

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot unpack DOCX briefs. Paste the brief text instead.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

function readUint16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes, offset) {
  return bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24);
}

async function extractDocxText(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let endOffset = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      endOffset = i;
      break;
    }
  }
  if (endOffset < 0) throw new Error('Could not read text from that DOCX file.');
  const centralOffset = readUint32(bytes, endOffset + 16);
  const centralCount = readUint16(bytes, endOffset + 10);
  let offset = centralOffset;
  let documentEntry = null;
  for (let index = 0; index < centralCount; index += 1) {
    if (offset + 46 > bytes.length
      || bytes[offset] !== 0x50 || bytes[offset + 1] !== 0x4b
      || bytes[offset + 2] !== 0x01 || bytes[offset + 3] !== 0x02) {
      break;
    }
    const compression = readUint16(bytes, offset + 10);
    const compressedSize = readUint32(bytes, offset + 20);
    const nameLength = readUint16(bytes, offset + 28);
    const extraLength = readUint16(bytes, offset + 30);
    const commentLength = readUint16(bytes, offset + 32);
    const localHeaderOffset = readUint32(bytes, offset + 42);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name === 'word/document.xml') {
      documentEntry = { compression, compressedSize, localHeaderOffset };
      break;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (!documentEntry) throw new Error('Could not read text from that DOCX file.');
  const local = documentEntry.localHeaderOffset;
  if (local + 30 > bytes.length
    || bytes[local] !== 0x50 || bytes[local + 1] !== 0x4b
    || bytes[local + 2] !== 0x03 || bytes[local + 3] !== 0x04) {
    throw new Error('Could not read text from that DOCX file.');
  }
  const localNameLength = readUint16(bytes, local + 26);
  const localExtraLength = readUint16(bytes, local + 28);
  const dataStart = local + 30 + localNameLength + localExtraLength;
  const payload = bytes.subarray(dataStart, dataStart + documentEntry.compressedSize);
  const xmlBytes = documentEntry.compression === 0
    ? payload
    : documentEntry.compression === 8
      ? await inflateRaw(payload)
      : null;
  if (!xmlBytes) throw new Error('Could not read text from that DOCX file.');
  const xml = new TextDecoder('utf-8', { fatal: false }).decode(xmlBytes);
  return normalizeExtractedText(
    xml
      .replace(/<w:tab\b[^/]*\/>/g, '\t')
      .replace(/<w:br\b[^/]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
  );
}

async function extractBriefTextFromFile(file, mimeType) {
  if (mimeType.startsWith('image/')) {
    return { text: '', needsPaste: true };
  }
  if (mimeType === 'text/plain') {
    return { text: normalizeExtractedText(await file.text()), needsPaste: false };
  }
  if (mimeType === 'application/pdf') {
    if (!window.pdfjsLib) throw new Error('PDF parser did not load. Check your connection and try again.');
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const chunks = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      chunks.push(extractPdfPageText(content.items));
    }
    const text = normalizeExtractedText(chunks.join('\n\n'));
    return { text, needsPaste: !text };
  }
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const text = await extractDocxText(await file.arrayBuffer());
    return { text, needsPaste: !text };
  }
  return { text: '', needsPaste: true };
}

async function persistAssignments() {
  await idbSet('assignments', state.assignments);
  emit('assignment-brief:changed');
}

export async function loadAssignmentBriefs() {
  if (!briefsApi) return;
  try {
    const { briefs } = await briefsApi.listBriefs();
    const byId = new Map((briefs || []).map(item => [item.assignment_id, item]));
    state.assignments.forEach(assignment => {
      const brief = byId.get(assignment.id);
      if (brief?.brief_document_id) applyBriefFields(assignment, brief);
      else clearBriefFields(assignment);
    });
    await idbSet('assignments', state.assignments);
  } catch (error) {
    console.error('Could not load assignment briefs.', error);
  }
}

export function openAssignmentBriefDialog(assignmentId = null) {
  const id = assignmentId || state.editingAssignmentId;
  const assignment = state.assignments.find(item => item.id === id);
  activeAssignmentId = assignment?.id || null;
  resetBriefDialogForm();
  $('assignment-brief-title').textContent = assignment?.briefDocumentId ? 'Replace assignment brief' : 'Upload assignment brief';
  $('assignment-brief-save').textContent = assignment?.briefDocumentId ? 'Upload & replace brief' : 'Upload & save brief';
  $('assignment-brief-remove').classList.toggle('hidden', !assignment?.briefDocumentId);
  if (!assignment) {
    setStatus('assignment-brief-status', 'Save the assignment before uploading a brief.');
  } else if (assignment.briefDocumentId) {
    setStatus(
      'assignment-brief-status',
      assignment.briefFileName
        ? `Current brief: ${assignment.briefFileName}${assignment.briefStatus === 'needs_text' ? ' (needs pasted text)' : ''}`
        : 'A brief is already saved for this assignment.'
    );
  }
  $('assignment-brief-dialog').showModal();
}

async function saveAssignmentBrief() {
  if (busy || !briefsApi) return;
  const assignment = state.assignments.find(item => item.id === activeAssignmentId);
  if (!assignment) {
    setStatus('assignment-brief-status', 'Save the assignment before uploading a brief.');
    return;
  }

  const mode = sourceMode();
  let extractedText = '';
  let fileName = 'brief.txt';
  let fileType = 'text/plain';
  let fileSize = 0;
  let documentId = uid();
  let sourceType = 'paste';

  try {
    setBusy(true);
    setProgress(true, 10);

    if (mode === 'paste') {
      extractedText = $('assignment-brief-text').value;
      if (!extractedText.trim()) {
        setStatus('assignment-brief-status', 'Paste the assignment brief text first.');
        return;
      }
      if (extractedText.length > MAX_ASSIGNMENT_BRIEF_TEXT_LENGTH) {
        setStatus('assignment-brief-status', 'The extracted brief text is too long to save. Keep it under 2 million characters.');
        return;
      }
      setProgress(true, 55);
      setStatus('assignment-brief-status', 'Saving pasted brief...');
    } else {
      const validation = validateSelectedFile(selectedFile);
      if (validation.error) {
        setStatus('assignment-brief-status', validation.error);
        return;
      }
      setStatus('assignment-brief-status', 'Reading brief...');
      const extracted = await extractBriefTextFromFile(selectedFile, validation.mimeType);
      if (extracted.needsPaste && !extracted.text) {
        const message = validation.mimeType.startsWith('image/') || validation.mimeType === 'application/pdf'
          ? SCANNED_BRIEF_MESSAGE
          : 'Could not extract text from that file. Paste the brief text instead.';
        setStatus('assignment-brief-status', message);
        document.querySelector('input[name="assignment-brief-source"][value="paste"]').checked = true;
        syncSourcePanels();
        return;
      }
      extractedText = extracted.text;
      if (extractedText.length > MAX_ASSIGNMENT_BRIEF_TEXT_LENGTH) {
        setStatus('assignment-brief-status', 'The extracted brief text is too long to save. Keep it under 2 million characters.');
        return;
      }
      setProgress(true, 35);
      setStatus('assignment-brief-status', 'Validating brief...');
      const validated = await briefsApi.validateBriefUpload({
        assignmentId: assignment.id,
        documentId,
        file: selectedFile
      });
      fileName = validated.fileName;
      fileType = validated.fileType;
      fileSize = validated.fileSize;
      sourceType = 'file';
      setProgress(true, 70);
      setStatus('assignment-brief-status', 'Saving brief...');
    }

    const result = await briefsApi.saveBrief(assignment.id, {
      assignment: assignmentPayload(assignment),
      documentId,
      extractedText,
      sourceType,
      fileName,
      fileType,
      fileSize
    });
    applyBriefFields(assignment, result.brief);
    await persistAssignments();
    setProgress(true, 100);
    setStatus('assignment-brief-status', 'Brief saved.');
    $('assignment-brief-dialog').close();
  } catch (error) {
    setStatus('assignment-brief-status', error.message || 'Could not save the assignment brief.');
  } finally {
    setBusy(false);
    setProgress(false, 0);
  }
}

async function removeAssignmentBrief() {
  if (busy || !briefsApi) return;
  const assignment = state.assignments.find(item => item.id === activeAssignmentId);
  if (!assignment?.briefDocumentId) return;
  try {
    setBusy(true);
    setStatus('assignment-brief-status', 'Removing brief...');
    await briefsApi.removeBrief(assignment.id);
    clearBriefFields(assignment);
    await persistAssignments();
    setStatus('assignment-brief-status', 'Brief removed.');
    $('assignment-brief-dialog').close();
  } catch (error) {
    setStatus('assignment-brief-status', error.message || 'Could not remove the assignment brief.');
  } finally {
    setBusy(false);
  }
}

export function init(deps = {}) {
  briefsApi = deps.briefsApi || createAssignmentBriefsApi(deps.apiFetch, deps.apiErrorMessage);

  document.querySelectorAll('input[name="assignment-brief-source"]').forEach(input => {
    input.addEventListener('change', () => {
      syncSourcePanels();
      setStatus('assignment-brief-status', '');
    });
  });

  $('assignment-brief-choose-file')?.addEventListener('click', () => $('assignment-brief-file').click());
  $('assignment-brief-file')?.addEventListener('change', event => {
    selectBriefFile(event.target.files?.[0] || null);
  });

  const dropzone = $('assignment-brief-dropzone');
  if (dropzone) {
    ['dragenter', 'dragover'].forEach(type => dropzone.addEventListener(type, event => {
      event.preventDefault();
      dropzone.classList.add('is-dragging');
    }));
    ['dragleave', 'drop'].forEach(type => dropzone.addEventListener(type, event => {
      event.preventDefault();
      dropzone.classList.remove('is-dragging');
    }));
    dropzone.addEventListener('drop', event => {
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      const transfer = new DataTransfer();
      transfer.items.add(file);
      $('assignment-brief-file').files = transfer.files;
      selectBriefFile(file);
    });
  }

  $('assignment-brief-save')?.addEventListener('click', () => saveAssignmentBrief());
  $('assignment-brief-remove')?.addEventListener('click', () => removeAssignmentBrief());
  $('close-assignment-brief-dialog')?.addEventListener('click', () => $('assignment-brief-dialog').close());
  $('cancel-assignment-brief-dialog')?.addEventListener('click', () => $('assignment-brief-dialog').close());
  $('assignment-brief-dialog')?.addEventListener('close', () => {
    activeAssignmentId = null;
    resetBriefDialogForm();
    setBusy(false);
  });

  $('assignment-open-brief-btn')?.addEventListener('click', () => {
    openAssignmentBriefDialog(state.editingAssignmentId);
  });
}
