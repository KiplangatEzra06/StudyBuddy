export const MAX_ASSIGNMENT_BRIEF_BYTES = 10 * 1024 * 1024;
export const MAX_ASSIGNMENT_BRIEF_TEXT_LENGTH = 2_000_000;

export const BRIEF_EXTENSION_MIME_TYPES = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.txt': 'text/plain',
  '.webp': 'image/webp'
};

export function mimeTypeForBriefFilename(filename) {
  const extension = String(filename || '').toLowerCase().match(/\.[^.]+$/)?.[0];
  return extension ? BRIEF_EXTENSION_MIME_TYPES[extension] || null : null;
}

export function createAssignmentBriefsApi(apiFetch, apiErrorMessage) {
  async function readError(response, fallback) {
    if (typeof apiErrorMessage === 'function') return apiErrorMessage(response, fallback);
    try {
      const data = await response.json();
      if (typeof data.error === 'string' && data.error) return data.error;
    } catch { }
    return `${fallback} (${response.status}). Please try again.`;
  }

  return {
    async listBriefs() {
      const response = await apiFetch('/api/assignments/briefs');
      if (!response.ok) throw new Error(await readError(response, 'Could not load assignment briefs'));
      return response.json();
    },

    async validateBriefUpload({ assignmentId, documentId, file }) {
      const response = await apiFetch(`/api/assignments/${encodeURIComponent(assignmentId)}/brief/validate`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Upload-Filename': encodeURIComponent(file.name || 'assignment-brief'),
          'X-Document-ID': documentId,
          'X-Upload-Mime-Type': file.type || ''
        },
        body: file
      });
      if (!response.ok) throw new Error(await readError(response, 'Could not validate the brief file'));
      return response.json();
    },

    async saveBrief(assignmentId, payload) {
      const response = await apiFetch(`/api/assignments/${encodeURIComponent(assignmentId)}/brief`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(await readError(response, 'Could not save the assignment brief'));
      return response.json();
    },

    async removeBrief(assignmentId) {
      const response = await apiFetch(`/api/assignments/${encodeURIComponent(assignmentId)}/brief`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      if (!response.ok) throw new Error(await readError(response, 'Could not remove the assignment brief'));
      return null;
    }
  };
}
