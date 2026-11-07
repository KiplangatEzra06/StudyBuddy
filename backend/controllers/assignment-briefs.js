const express = require('express');
const { query } = require('../../db/pool');
const { databaseFailure } = require('../services/database-errors');
const { ownerIdForUsername } = require('../services/owner-id');
const {
  MAX_ASSIGNMENT_BRIEF_BYTES,
  mimeTypeForFilename,
  sanitizeFilename,
  validateAssignmentBriefFile,
  validateAssignmentBriefText
} = require('../services/assignment-briefs');
const assignmentBriefsRepository = require('../repositories/assignment-briefs');

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

function validateBriefUpload(req, res) {
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
}

async function listBriefs(req, res) {
  const ownerId = req.session.ownerId || ownerIdForUsername(process.env.ADMIN_USERNAME);
  try {
    const result = await assignmentBriefsRepository.listBriefs(query, ownerId);
    return res.json({ briefs: result.rows });
  } catch (error) {
    return databaseFailure(res, 'load assignment briefs', error);
  }
}

async function saveBrief(req, res) {
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
    const result = await assignmentBriefsRepository.saveBrief(query, {
      ownerId,
      assignmentId,
      assignment,
      documentId,
      filename,
      fileType,
      fileSize,
      extractedText: textResult.text || null,
      briefStatus: textResult.text ? 'ready' : 'needs_text'
    });
    delete req.session.validatedAssignmentBriefUpload;
    return res.json({ brief: result.rows[0] });
  } catch (error) {
    return databaseFailure(res, 'save the assignment brief', error);
  }
}

async function removeBrief(req, res) {
  const { assignmentId } = req.params;
  if (!ASSIGNMENT_ID_PATTERN.test(assignmentId)) {
    return res.status(400).json({ error: 'A valid assignment ID is required.' });
  }
  const ownerId = req.session.ownerId || ownerIdForUsername(process.env.ADMIN_USERNAME);
  try {
    await assignmentBriefsRepository.removeBrief(query, ownerId, assignmentId);
    return res.sendStatus(204);
  } catch (error) {
    return databaseFailure(res, 'remove the assignment brief', error);
  }
}

const validateBriefUploadHandlers = [
  express.raw({
    type: 'application/octet-stream',
    limit: MAX_ASSIGNMENT_BRIEF_BYTES
  }),
  validateBriefUpload
];

module.exports = {
  validateBriefUpload: validateBriefUploadHandlers,
  listBriefs,
  saveBrief,
  removeBrief
};
