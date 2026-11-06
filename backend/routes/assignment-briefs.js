const express = require('express');
const {
  MAX_ASSIGNMENT_BRIEF_BYTES,
  mimeTypeForFilename,
  sanitizeFilename,
  validateAssignmentBriefFile,
  validateAssignmentBriefText
} = require('../services/assignment-briefs');

const ASSIGNMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const VALIDATED_UPLOAD_MAX_AGE_MS = 15 * 60 * 1000;

function safeAssignmentData(value, assignmentId) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || value.id !== assignmentId) return null;
  const { title, classId, dueAt, reminderAt, reminderSentAt, details, completed, createdAt, updatedAt } = value;
  if (typeof title !== 'string' || title.trim().length > 160
    || typeof classId !== 'string' || classId.length > 128
    || !Number.isFinite(dueAt) || !Number.isFinite(new Date(dueAt).getTime())
    || typeof details !== 'string' || details.length > 2000
    || typeof completed !== 'boolean') return null;
  return {
    id: assignmentId,
    title: title.trim(),
    classId,
    dueAt,
    reminderAt: Number.isFinite(reminderAt) ? reminderAt : null,
    reminderSentAt: Number.isFinite(reminderSentAt) ? reminderSentAt : null,
    details,
    completed,
    ...(Number.isFinite(createdAt) ? { createdAt } : {}),
    ...(Number.isFinite(updatedAt) ? { updatedAt } : {})
  };
}

function createAssignmentBriefRouter({ dbQuery, databaseFailure, ownerIdForUsername }) {
  const router = express.Router();

  router.put('/:assignmentId/brief/validate', express.raw({
    type: 'application/octet-stream',
    limit: MAX_ASSIGNMENT_BRIEF_BYTES
  }), (req, res) => {
    if (!Buffer.isBuffer(req.body)) return res.status(415).json({ error: 'Upload the brief as a binary file.' });
    const assignmentId = req.params.assignmentId;
    if (!ASSIGNMENT_ID_PATTERN.test(assignmentId)) {
      return res.status(400).json({ error: 'A valid assignment ID is required.' });
    }

    let filename;
    try {
      filename = decodeURIComponent(req.get('X-Upload-Filename') || '');
    } catch {
      return res.status(400).json({ error: 'The filename is invalid.' });
    }
    const documentId = req.get('X-Document-ID') || '';
    if (!DOCUMENT_ID_PATTERN.test(documentId)) {
      return res.status(400).json({ error: 'A valid document ID is required.' });
    }

    const validation = validateAssignmentBriefFile(
      req.body,
      filename,
      req.get('X-Upload-Mime-Type') || ''
    );
    if (validation.error) return res.status(400).json({ error: validation.error });

    req.session.validatedAssignmentBriefUpload = {
      assignmentId,
      documentId,
      ...validation,
      validatedAt: Date.now()
    };
    return res.json({
      fileName: validation.filename,
      fileType: validation.mimeType,
      fileSize: validation.size
    });
  });

  router.get('/briefs', async (req, res) => {
    const ownerId = req.session.ownerId || ownerIdForUsername(process.env.ADMIN_USERNAME);
    try {
      const result = await dbQuery(
        `SELECT assignment_id, assignment_data, brief_document_id, brief_file_name,
                brief_mime_type, brief_file_size, brief_extracted_text, brief_status,
                created_at, updated_at
         FROM assignment_workspaces
         WHERE owner_id = $1
         ORDER BY updated_at DESC`,
        [ownerId],
        'assignment brief lookup'
      );
      return res.json({ briefs: result.rows });
    } catch (error) {
      return databaseFailure(res, 'load assignment briefs', error);
    }
  });

  router.put('/:assignmentId/brief', async (req, res) => {
    const { assignmentId } = req.params;
    if (!ASSIGNMENT_ID_PATTERN.test(assignmentId)) {
      return res.status(400).json({ error: 'A valid assignment ID is required.' });
    }
    const assignment = safeAssignmentData(req.body.assignment, assignmentId);
    if (!assignment) return res.status(400).json({ error: 'Assignment details are invalid.' });
    const documentId = req.body.documentId;
    if (!DOCUMENT_ID_PATTERN.test(documentId || '')) {
      return res.status(400).json({ error: 'A valid document ID is required.' });
    }
    const textResult = validateAssignmentBriefText(req.body.extractedText);
    if (textResult.error) return res.status(400).json({ error: textResult.error });
    const pasted = req.body.sourceType === 'paste';
    const filename = sanitizeFilename(req.body.fileName);
    let fileType;
    let fileSize;
    if (pasted) {
      fileType = 'text/plain';
      fileSize = 0;
    } else {
      const validated = req.session.validatedAssignmentBriefUpload;
      if (!validated || validated.assignmentId !== assignmentId || validated.documentId !== documentId
        || Date.now() - validated.validatedAt > VALIDATED_UPLOAD_MAX_AGE_MS) {
        return res.status(400).json({ error: 'Validate the selected brief file before saving it.' });
      }
      fileType = validated.mimeType;
      fileSize = validated.size;
      if (filename !== validated.filename) {
        return res.status(400).json({ error: 'The filename changed after validation. Try uploading again.' });
      }
    }
    if (req.body.fileType !== fileType
      || (Number(req.body.fileSize) || 0) !== fileSize
      || (!pasted && mimeTypeForFilename(filename) !== fileType)) {
      return res.status(400).json({ error: 'Brief file details do not match the validated upload.' });
    }

    const ownerId = req.session.ownerId || ownerIdForUsername(process.env.ADMIN_USERNAME);
    try {
      const result = await dbQuery(
        `INSERT INTO assignment_workspaces (
           owner_id, assignment_id, assignment_data, brief_document_id,
           brief_file_name, brief_mime_type, brief_file_size, brief_extracted_text,
           brief_status, updated_at
         )
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (owner_id, assignment_id) DO UPDATE SET
           assignment_data = EXCLUDED.assignment_data,
           brief_document_id = EXCLUDED.brief_document_id,
           brief_file_name = EXCLUDED.brief_file_name,
           brief_mime_type = EXCLUDED.brief_mime_type,
           brief_file_size = EXCLUDED.brief_file_size,
           brief_extracted_text = EXCLUDED.brief_extracted_text,
           brief_status = EXCLUDED.brief_status,
           updated_at = now()
         RETURNING assignment_id, assignment_data, brief_document_id, brief_file_name,
                   brief_mime_type, brief_file_size, brief_extracted_text, brief_status,
                   created_at, updated_at`,
        [
          ownerId,
          assignmentId,
          JSON.stringify(assignment),
          documentId,
          filename,
          fileType,
          fileSize,
          textResult.text || null,
          textResult.text ? 'ready' : 'needs_text'
        ],
        'assignment brief save'
      );
      delete req.session.validatedAssignmentBriefUpload;
      return res.json({ brief: result.rows[0] });
    } catch (error) {
      return databaseFailure(res, 'save the assignment brief', error);
    }
  });

  router.delete('/:assignmentId/brief', async (req, res) => {
    const { assignmentId } = req.params;
    if (!ASSIGNMENT_ID_PATTERN.test(assignmentId)) {
      return res.status(400).json({ error: 'A valid assignment ID is required.' });
    }
    const ownerId = req.session.ownerId || ownerIdForUsername(process.env.ADMIN_USERNAME);
    try {
      await dbQuery(
        `UPDATE assignment_workspaces
         SET brief_document_id = NULL, brief_file_name = NULL, brief_mime_type = NULL,
             brief_file_size = NULL, brief_extracted_text = NULL, brief_status = 'ready',
             updated_at = now()
         WHERE owner_id = $1 AND assignment_id = $2`,
        [ownerId, assignmentId],
        'assignment brief removal'
      );
      return res.sendStatus(204);
    } catch (error) {
      return databaseFailure(res, 'remove the assignment brief', error);
    }
  });

  return router;
}

module.exports = createAssignmentBriefRouter;
