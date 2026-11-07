async function listBriefs(query, ownerId) {
  return query(
    `SELECT assignment_id, assignment_data, brief_document_id, brief_file_name,
                brief_mime_type, brief_file_size, brief_extracted_text, brief_status,
                created_at, updated_at
         FROM assignment_workspaces
         WHERE owner_id = $1
         ORDER BY updated_at DESC`,
    [ownerId],
    'assignment brief lookup'
  );
}

async function saveBrief(query, {
  ownerId,
  assignmentId,
  assignment,
  documentId,
  filename,
  fileType,
  fileSize,
  extractedText,
  briefStatus
}) {
  return query(
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
      extractedText,
      briefStatus
    ],
    'assignment brief save'
  );
}

async function removeBrief(query, ownerId, assignmentId) {
  return query(
    `UPDATE assignment_workspaces
         SET brief_document_id = NULL, brief_file_name = NULL, brief_mime_type = NULL,
             brief_file_size = NULL, brief_extracted_text = NULL, brief_status = 'ready',
             updated_at = now()
         WHERE owner_id = $1 AND assignment_id = $2`,
    [ownerId, assignmentId],
    'assignment brief removal'
  );
}

module.exports = {
  listBriefs,
  saveBrief,
  removeBrief
};
