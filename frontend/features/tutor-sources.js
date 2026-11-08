import { emit } from '../shared/bus.js';
import { bindMarkdownCodeButtons, renderMathInElementSafe } from '../shared/markdown.js';
import { state } from '../shared/state.js';

const $ = id => document.getElementById(id);
let dependencies;
export function init(deps) { dependencies = deps; }

export function renderTutorScopeOptions() {
  const select = $('tutor-study-scope');
  if (!select) return;
  const current = select.value || 'all';
  const options = ['<option value="all">All material</option>'];
  const courses = [...new Set([
    ...dependencies.getDocuments().map(item => item.course),
    ...dependencies.getNotes().map(item => item.tag),
    ...dependencies.getCards().map(item => item.subject),
    ...dependencies.getClasses().map(item => item.name)
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  courses.forEach(course => options.push(`<option value="course:${dependencies.escapeHtml(course)}">Course: ${dependencies.escapeHtml(course)}</option>`));
  dependencies.getDocuments().forEach(item => options.push(`<option value="document:${dependencies.escapeHtml(item.id)}">Document: ${dependencies.escapeHtml(item.title)}</option>`));
  dependencies.getAssignments().filter(item => item.briefDocumentId).forEach(item => {
    options.push(`<option value="assignment:${dependencies.escapeHtml(item.id)}">Assignment: ${dependencies.escapeHtml(item.title || 'Untitled assignment')}</option>`);
  });
  select.innerHTML = options.join('');
  select.value = [...select.options].some(option => option.value === current) ? current : 'all';
  document.querySelectorAll('select').forEach(dependencies.syncCustomSelect);
}

function splitStudyText(text, chunkSize = 650) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const chunks = [];
  let chunk = '';
  words.forEach(word => {
    if (chunk && chunk.length + word.length + 1 > chunkSize) {
      chunks.push(chunk);
      chunk = '';
    }
    chunk += `${chunk ? ' ' : ''}${word}`;
  });
  if (chunk) chunks.push(chunk);
  return chunks;
}

function indexStudyMaterial(type, records) {
  const activeIds = new Set();
  records.forEach(record => {
    const key = `${type}:${record.id}`;
    activeIds.add(key);
    const signature = JSON.stringify([
      record.updatedAt || record.createdAt || record.takenAt || record.completedAt || '',
      record.title || record.name || record.front || '',
      record.body || record.extractedText || record.back || record.text || '',
      record.score ?? '',
      record.dueAt || '',
      record.briefExtractedText || '',
      record.briefStatus || '',
      record.briefFileName || ''
    ]);
    if (state.studyMaterialIndex.get(key)?.signature === signature) return;
    const text = record.body || record.extractedText || record.text
      || (type === 'card' ? `${record.front || ''}\n${record.back || ''}` : '');
    const chunks = ['document', 'note', 'assignment'].includes(type)
      ? splitStudyText(text)
      : [String(text || '')];
    state.studyMaterialIndex.set(key, {
      signature,
      chunks: chunks.map((excerpt, index) => ({
        type,
        title: record.title || record.name || (type === 'card' ? 'Flashcard' : type === 'quiz' ? 'Quiz result' : type),
        course: record.course || record.tag || record.subject || '',
        sourceId: record.id,
        text: type === 'quiz'
          ? `Quiz score ${record.score}% (${record.correct}/${record.total}) in ${record.course || 'General'} ${Array.isArray(record.mistakes) && record.mistakes.length
            ? `Mistakes: ${record.mistakes.map(mistake => `${mistake.question} Your answer: ${mistake.answer || 'blank'}; correct answer: ${mistake.correctAnswer || 'not recorded'}`).join('; ')}`
            : ''}`
          : excerpt,
        chunkIndex: index
      })).filter(chunk => chunk.text.trim())
    });
  });
  [...state.studyMaterialIndex.keys()].forEach(key => {
    if (key.startsWith(`${type}:`) && !activeIds.has(key)) state.studyMaterialIndex.delete(key);
  });
}

export function updateStudyMaterialIndex() {
  indexStudyMaterial('document', dependencies.getDocuments().map(item => ({
    ...item, title: item.title, course: item.course, extractedText: item.extractedText
  })));
  indexStudyMaterial('note', dependencies.getNotes().map(item => ({
    ...item, title: item.title || 'Untitled note', course: item.tag, body: item.body
  })));
  indexStudyMaterial('card', dependencies.getCards());
  indexStudyMaterial('quiz', dependencies.getQuizResults());
  indexStudyMaterial('assignment', dependencies.getAssignments().map(item => ({
    ...item, title: item.title, course: dependencies.classForAssignment(item)?.name || 'General',
    text: `${item.title || 'Assignment'} due ${new Date(Number(item.dueAt)).toLocaleString()} ${item.completed ? 'completed' : 'open'} ${item.details || ''}`
      + (item.briefStatus === 'needs_text'
        ? '\nBrief file attached but no readable text was extracted; ask the student to paste the text.'
        : item.briefExtractedText
          ? `\nAssignment brief (${item.briefFileName || 'pasted'}): ${item.briefExtractedText}`
          : '')
  })));
  indexStudyMaterial('class', dependencies.getClasses().map(item => ({
    ...item, course: item.name, text: `${item.name} ${item.instructor || ''} ${item.location || ''} ${dependencies.formatMeetingDays(item.meetingDays)} ${item.startTime || ''} ${item.endTime || ''}`
  })));
  indexStudyMaterial('session', dependencies.getTimerSessions().map(item => ({
    ...item, title: `${item.course || 'General'} study session`,
    text: `${Math.round((Number(item.seconds) || 0) / 60)} minutes ${item.unit || ''} ${new Date(Number(item.completedAt)).toLocaleString()}`
  })));
  indexStudyMaterial('progress', [{
    id: 'aggregate',
    title: 'Study progress',
    text: `${dependencies.getDocuments().filter(item => (item.readingProgress || 0) >= 100).length} documents completed. `
      + `${dependencies.getCards().filter(item => item.mastered).length} of ${dependencies.getCards().length} flashcards mastered. `
      + `${dependencies.getQuizResults().length ? Math.round(dependencies.getQuizResults().reduce((total, item) => total + item.score, 0) / dependencies.getQuizResults().length) : 0}% average quiz accuracy. `
      + `${Math.round(dependencies.getTimerSessions().reduce((total, item) => total + (Number(item.seconds) || 0), 0) / 60)} minutes total focus time.`
  }]);
}

function tokenizeStudyText(text) {
  return String(text || '').toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
}

export function retrieveStudyReferences(question) {
  updateStudyMaterialIndex();
  const queryTerms = [...new Set(tokenizeStudyText(question))];
  if (!queryTerms.length) return [];
  const query = $('tutor-study-scope')?.value || 'all';
  const includePlanning = /\b(class|classes|course|schedule|assignment|assignments|deadline|due|progress|timer|focus|study time|session)\b/i.test(question);
  const scopedAssignmentId = query.startsWith('assignment:') ? query.slice('assignment:'.length) : '';
  const allChunks = [...state.studyMaterialIndex.values()].flatMap(entry => entry.chunks);
  const assignmentTitleMatches = new Map();
  allChunks.filter(chunk => chunk.type === 'assignment').forEach(chunk => {
    const overlap = tokenizeStudyText(chunk.title).filter(term => queryTerms.includes(term)).length;
    if (overlap) assignmentTitleMatches.set(chunk.sourceId, Math.max(assignmentTitleMatches.get(chunk.sourceId) || 0, overlap));
  });
  const candidates = allChunks
    .filter(chunk => {
      if (scopedAssignmentId) return chunk.type === 'assignment' && chunk.sourceId === scopedAssignmentId;
      if (query.startsWith('course:') && chunk.course !== query.slice(7)) return false;
      if (query.startsWith('document:')) {
        const documentId = query.slice(9);
        return (chunk.type === 'document' && chunk.sourceId === documentId)
          || (chunk.type === 'note' && dependencies.getNotes().find(item => item.id === chunk.sourceId)?.sourceDocumentId === documentId)
          || (chunk.type === 'card' && dependencies.getCards().find(item => item.id === chunk.sourceId)?.sourceDocumentId === documentId);
      }
      if (!includePlanning && ['class', 'session'].includes(chunk.type)) return false;
      if (!includePlanning && chunk.type === 'assignment'
        && !assignmentTitleMatches.has(chunk.sourceId)) return false;
      return true;
    });
  const documentFrequency = new Map();
  candidates.forEach(chunk => {
    const terms = new Set(tokenizeStudyText(`${chunk.title} ${chunk.course} ${chunk.text}`));
    terms.forEach(term => documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1));
  });
  const averageLength = candidates.length
    ? candidates.reduce((sum, chunk) => sum + tokenizeStudyText(chunk.text).length, 0) / candidates.length
    : 0;
  const ranked = candidates.map(chunk => {
    const terms = tokenizeStudyText(`${chunk.title} ${chunk.course} ${chunk.text}`);
    const frequencies = new Map();
    terms.forEach(term => frequencies.set(term, (frequencies.get(term) || 0) + 1));
    const score = queryTerms.reduce((total, term) => {
      const frequency = frequencies.get(term) || 0;
      if (!frequency) return total;
      const idf = Math.log(1 + (candidates.length - (documentFrequency.get(term) || 0) + .5)
        / ((documentFrequency.get(term) || 0) + .5));
      const denominator = frequency + 1.2 * (.25 + .75 * terms.length / Math.max(1, averageLength));
      return total + idf * frequency * 2.2 / denominator;
    }, 0);
    return { chunk, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
  const priorityAssignments = [...assignmentTitleMatches.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .flatMap(([sourceId]) => ranked
      .filter(item => item.chunk.type === 'assignment' && item.chunk.sourceId === sourceId)
      .slice(0, 4)
      .map(item => item.chunk)
      .sort((a, b) => a.chunkIndex - b.chunkIndex));
  const priorityAssignmentIds = new Set(priorityAssignments.map(chunk => chunk.sourceId));
  const references = [];
  const seen = new Set();
  const assignmentCounts = new Map();
  let usedCharacters = 0;
  const addReference = chunk => {
    const key = `${chunk.type}:${chunk.sourceId}`;
    const text = chunk.text.slice(0, 900);
    if (chunk.type === 'assignment') {
      const count = assignmentCounts.get(chunk.sourceId) || 0;
      if (count >= 4 || usedCharacters + text.length > 7000 || references.length >= 8) return;
      assignmentCounts.set(chunk.sourceId, count + 1);
    } else {
      if (seen.has(key) || usedCharacters + text.length > 7000 || references.length >= 8) return;
      seen.add(key);
    }
    references.push({
      type: chunk.type,
      title: chunk.title,
      course: chunk.course,
      ...(chunk.type === 'progress' ? {} : { sourceId: chunk.sourceId }),
      text
    });
    usedCharacters += text.length;
  };
  priorityAssignments.forEach(addReference);
  ranked.forEach(({ chunk }) => {
    if (chunk.type === 'assignment' && priorityAssignmentIds.has(chunk.sourceId)) return;
    addReference(chunk);
  });
  return references;
}

export function addMsg(role, text, container = $('chat-log'), messageData = {}) {
  const empty = container.querySelector('.chat-empty');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  if (role === 'user') {
    const content = document.createElement('div');
    content.className = 'user-content';
    content.textContent = text;
    div.appendChild(content);
  } else {
    const avatar = document.createElement('span');
    avatar.className = 'msg-avatar tutor-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    const avatarImage = document.createElement('img');
    avatarImage.src = '/brand/logo-mark.png';
    avatarImage.alt = '';
    avatar.appendChild(avatarImage);
    div.appendChild(avatar);
    if (text) {
      const content = document.createElement('div');
      content.className = 'assistant-content';
      content.innerHTML = dependencies.renderTutorMarkdown(text, messageData.sources || []);
      div.appendChild(content);
      bindMarkdownCodeButtons(content, { truncateLongCode: false });
      renderMathInElementSafe(content);
    }
  }
  const timestamp = document.createElement('time');
  timestamp.className = 'msg-time';
  const sentAt = Number(messageData.timestamp) || Date.now();
  timestamp.dateTime = new Date(sentAt).toISOString();
  timestamp.textContent = new Date(sentAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  div.appendChild(timestamp);
  container.appendChild(div);
  return div;
}

export function addAssistantMsg(text, sources = [], container = $('chat-log'), messageData = {}) {
  const message = addMsg('assistant', text, container, messageData);
  if (sources.length) {
    const details = document.createElement('details');
    details.className = 'message-sources';
    const summary = document.createElement('summary');
    summary.textContent = `Sources used (${sources.length})`;
    const list = document.createElement('ul');
    sources.forEach(source => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'source-open';
      button.dataset.sourceType = source.type === 'doc' ? 'document' : source.type;
      button.dataset.sourceId = source.sourceId || '';
      const label = source.type === 'document' || source.type === 'doc' ? 'Doc'
        : source.type === 'card' ? 'Card'
          : source.type.charAt(0).toUpperCase() + source.type.slice(1);
      button.textContent = source.title ? `[${label}: ${source.title}]` : `[${label}]`;
      item.appendChild(button);
      list.appendChild(item);
    });
    details.append(summary, list);
    message.appendChild(details);
  }
  if (messageData.retry) {
    const retryRow = document.createElement('div');
    retryRow.className = 'tutor-error-actions';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-secondary btn-sm';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => dependencies.sendChat(messageData.retry, messageData.timestamp));
    retryRow.append(retry);
    message.append(retryRow);
    return message;
  }
  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  [
    ['Copy reply', '⧉', async () => {
      try {
        await navigator.clipboard.writeText(text);
        dependencies.setChatRequestStatus('Reply copied.');
      } catch {
        dependencies.setChatRequestStatus('Clipboard access is unavailable in this browser.');
      }
    }],
    ['Save to notes', '?', async () => {
      emit('tutor:save-note', { question: messageData.question, text });
    }],
    ['Make flashcard', '?', async () => {
      emit('flashcards:save-record', {
        input: {
          front: messageData.question || 'What is the key idea?',
          back: text,
          subject: 'General',
          unit: '',
          format: 'basic',
          aiGenerated: false
        },
        onSaved: () => dependencies.setChatRequestStatus('Flashcard added.'),
        onError: error => dependencies.setChatRequestStatus(error.message || 'Could not add the flashcard.')
      });
    }],
    ['Explain simpler', '↓', () => dependencies.sendChat(`Explain this more simply, in a few clear sentences:\n\n${text}`)],
    ['Regenerate reply', '↻', () => dependencies.sendChat(messageData.question || 'Please repeat your last answer.')],
    ['Helpful', '👍', async () => {
      const saved = state.tutorChatHistory.find(item => item.timestamp === messageData.timestamp);
      if (saved) saved.feedback = saved.feedback === 'up' ? '' : 'up';
      await dependencies.persistTutorConversations();
      dependencies.renderTutorChatPage();
    }],
    ['Not helpful', '👎', async () => {
      const saved = state.tutorChatHistory.find(item => item.timestamp === messageData.timestamp);
      if (saved) saved.feedback = saved.feedback === 'down' ? '' : 'down';
      await dependencies.persistTutorConversations();
      dependencies.renderTutorChatPage();
    }]
  ].forEach(([label, icon, callback]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-btn tutor-action-btn';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.textContent = icon;
    if ((label === 'Helpful' && messageData.feedback === 'up')
      || (label === 'Not helpful' && messageData.feedback === 'down')) {
      button.setAttribute('aria-pressed', 'true');
    } else if (label === 'Helpful' || label === 'Not helpful') {
      button.setAttribute('aria-pressed', 'false');
    }
    button.addEventListener('click', callback);
    actions.appendChild(button);
  });
  message.appendChild(actions);

  if (messageData.isLatest) {
    const followups = document.createElement('div');
    followups.className = 'chat-followups';
    ['Give me an example', 'Quiz me on this', 'Explain the key idea'].forEach(prompt => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'text-btn';
      button.textContent = prompt;
      button.addEventListener('click', () => dependencies.sendChat(`${prompt}: ${messageData.question || text}`));
      followups.appendChild(button);
    });
    message.appendChild(followups);
  }
  return message;
}
