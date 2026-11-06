const MAX_ASSIGNMENT_BRIEF_BYTES = 10 * 1024 * 1024;
const MAX_ASSIGNMENT_BRIEF_TEXT_LENGTH = 2_000_000;

const MIME_TYPES = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.txt': 'text/plain',
  '.webp': 'image/webp'
};

function sanitizeFilename(value) {
  const filename = String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .at(-1)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 255);
  return filename || 'assignment-brief';
}

function mimeTypeForFilename(filename) {
  const extension = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
  return extension ? MIME_TYPES[extension] || null : null;
}

function validateAssignmentBriefFile(buffer, filename, declaredMimeType = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { error: 'Choose a non-empty brief file.' };
  }
  if (buffer.length > MAX_ASSIGNMENT_BRIEF_BYTES) {
    return { error: 'Brief files must be 10 MB or smaller.' };
  }

  const safeFilename = sanitizeFilename(filename);
  const mimeType = mimeTypeForFilename(safeFilename);
  if (!mimeType) {
    return { error: 'Supported brief files are PDF, DOCX, TXT, JPG, PNG, GIF, and WEBP.' };
  }
  if (declaredMimeType && declaredMimeType !== 'application/octet-stream' && declaredMimeType !== mimeType) {
    return { error: 'The file type does not match its filename.' };
  }

  const signatures = {
    'application/pdf': buffer.subarray(0, 5).toString('ascii') === '%PDF-',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b
      && buffer[2] === 0x03 && buffer[3] === 0x04,
    'image/gif': ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii')),
    'image/jpeg': buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
    'image/png': buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/webp': buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP',
    'text/plain': !buffer.includes(0)
  };
  if (!signatures[mimeType]) {
    return { error: 'The file contents do not match the selected file type.' };
  }
  if (mimeType === 'text/plain') {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      return { error: 'Text briefs must use UTF-8 encoding.' };
    }
  }

  return { filename: safeFilename, mimeType, size: buffer.length };
}

function validateAssignmentBriefText(value) {
  if (typeof value !== 'string') return { error: 'Brief text must be plain text.' };
  if (value.length > MAX_ASSIGNMENT_BRIEF_TEXT_LENGTH) {
    return { error: 'The extracted brief text is too long to save. Keep it under 2 million characters.' };
  }
  return { text: value.replace(/\u0000/g, '').trim() };
}

module.exports = {
  MAX_ASSIGNMENT_BRIEF_BYTES,
  MAX_ASSIGNMENT_BRIEF_TEXT_LENGTH,
  mimeTypeForFilename,
  sanitizeFilename,
  validateAssignmentBriefFile,
  validateAssignmentBriefText
};
