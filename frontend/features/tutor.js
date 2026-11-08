import { emit } from '../shared/bus.js';
import { bindMarkdownCodeButtons, normalizeTutorReply, renderMathInElementSafe } from '../shared/markdown.js';
import { state } from '../shared/state.js';

const TUTOR_MATERIAL_KEY = 'studybuddy-tutor-material';
let dependencies;
const $ = id => document.getElementById(id);

export function renderTutorChatPage() {
  const log = $('chat-log');
  const previousScrollTop = log.scrollTop;
  log.replaceChildren();
  state.tutorChatStreamingMessageElement = null;
  const latestAssistantIndex = state.tutorChatHistory.reduce((latest, message, index) =>
    message.role === 'assistant' && !message.retry ? index : latest, -1);
  state.tutorChatHistory.forEach((message, index) => {
    if (message.role === 'assistant') {
      dependencies.addAssistantMsg(message.content, message.sources || [], log, {
        ...message,
        isLatest: index === latestAssistantIndex
      });
    } else {
      dependencies.addMsg('user', message.content, log, message);
    }
  });
  if (!state.tutorChatHistory.length) {
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.id = 'chat-empty';
    empty.innerHTML = `<h2>What would you like to work on?</h2>
      <p>Ask a question, explore your study material, or plan your next study session.</p>
      <div class="chat-suggestions">
        <button type="button" class="quick-prompt" data-prompt="Explain a concept from my document simply.">Explain a concept from my document simply</button>
        <button type="button" class="quick-prompt" data-prompt="Quiz me on my latest notes.">Quiz me on my latest notes</button>
        <button type="button" class="quick-prompt" data-prompt="Help me plan this week's study.">Help me plan this week's study</button>
        <button type="button" class="quick-prompt" data-prompt="Summarise my document in 5 points.">Summarise my document in 5 points</button>
      </div>
      <p class="chat-material-note"></p>`;
    log.appendChild(empty);
  }
  if (state.tutorChatPending && state.tutorChatHistory.at(-1)?.role === 'user') {
    const loading = dependencies.addMsg('assistant', state.tutorChatStreamingReply, log);
    state.tutorChatStreamingMessageElement = loading;
    if (!state.tutorChatStreamingReply) loading.classList.add('loading');
    if (!state.tutorChatStreamingReply) {
      const indicator = document.createElement('div');
      indicator.className = 'assistant-content loading-content';
      indicator.innerHTML = '<span class="typing-indicator" aria-label="Tutor is thinking"><i></i><i></i><i></i></span>';
      loading.insertBefore(indicator, loading.querySelector('.msg-time'));
    }
    if (state.tutorChatWakeMessage) {
      const wakeMessage = document.createElement('span');
      wakeMessage.className = 'chat-wake-message';
      wakeMessage.textContent = state.tutorChatWakeMessage;
      const content = loading.querySelector('.assistant-content');
      if (content) content.appendChild(wakeMessage);
      else loading.insertBefore(wakeMessage, loading.querySelector('.msg-time'));
    }
  }
  const title = state.tutorConversations.find(item => item.id === state.activeTutorConversationId)?.title || 'New chat';
  $('tutor-conversation-title').value = title;
  const note = $('chat-log').querySelector('.chat-material-note');
  if (note) note.textContent = $('tutor-use-material').checked
    ? 'Study material is on. Relevant excerpts may be sent with your question.'
    : 'Study material is off. Your questions are sent without local excerpts.';
  updateTutorConnectionStatus();
  $('chat-jump-latest').classList.toggle('hidden', state.tutorChatAtLatest || state.tutorChatHistory.length === 0);
  requestAnimationFrame(() => {
    if (state.tutorChatAtLatest) log.scrollTop = log.scrollHeight;
    else log.scrollTop = previousScrollTop;
  });
}

export function updateTutorStreamingReply(text) {
  state.tutorChatStreamingReply = text;
  if (!state.tutorChatStreamingMessageElement?.isConnected) {
    renderTutorChatPage();
    return;
  }

  const message = state.tutorChatStreamingMessageElement;
  const content = message.querySelector('.assistant-content');
  if (text) {
    message.classList.remove('loading');
    const renderedContent = content || document.createElement('div');
    renderedContent.className = 'assistant-content';
    renderedContent.innerHTML = dependencies.renderTutorMarkdown(text);
    if (!content) message.insertBefore(renderedContent, message.querySelector('.msg-time'));
    bindMarkdownCodeButtons(renderedContent, { truncateLongCode: false });
    renderMathInElementSafe(renderedContent);
    if (state.tutorChatWakeMessage) {
      const wakeMessage = document.createElement('span');
      wakeMessage.className = 'chat-wake-message';
      wakeMessage.textContent = state.tutorChatWakeMessage;
      renderedContent.append(wakeMessage);
    }
  }
  requestAnimationFrame(() => {
    if (state.tutorChatAtLatest) $('chat-log').scrollTop = $('chat-log').scrollHeight;
  });
}

export function renderTutorHistory() {
  const content = $('tutor-history-content');
  const query = $('tutor-history-search').value.trim().toLocaleLowerCase();
  const filtered = state.tutorConversations.filter(conversation =>
    `${conversation.title || ''} ${conversation.messages.map(message => message.content || '').join(' ')}`
      .toLocaleLowerCase().includes(query));
  const pageSize = 6;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  state.tutorHistoryPageIndex = Math.max(0, Math.min(state.tutorHistoryPageIndex, pageCount - 1));
  content.replaceChildren();
  const pageConversations = filtered
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(state.tutorHistoryPageIndex * pageSize, (state.tutorHistoryPageIndex + 1) * pageSize);
  pageConversations.forEach(conversation => {
    const item = document.createElement('article');
    item.className = 'conversation-item';
    const title = document.createElement('strong');
    title.textContent = conversation.title || 'New chat';
    const count = document.createElement('span');
    count.textContent = `${conversation.messages.length} messages`;
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn btn-sm';
    open.dataset.openConversation = conversation.id;
    open.textContent = 'Open';
    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'btn btn-sm';
    rename.dataset.renameConversation = conversation.id;
    rename.textContent = 'Rename';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-sm btn-danger';
    remove.dataset.deleteConversation = conversation.id;
    remove.textContent = 'Delete';
    item.append(title, count, open, rename, remove);
    content.append(item);
  });
  const controls = $('tutor-history-controls');
  controls.innerHTML = `<button type="button" class="btn btn-sm" data-history-prev ${state.tutorHistoryPageIndex === 0 ? 'disabled' : ''}>Previous</button><span aria-live="polite">Page ${state.tutorHistoryPageIndex + 1} of ${pageCount}</span><button type="button" class="btn btn-sm" data-history-next ${state.tutorHistoryPageIndex >= pageCount - 1 ? 'disabled' : ''}>Next</button>`;
  controls.querySelector('[data-history-prev]').addEventListener('click', () => { state.tutorHistoryPageIndex--; renderTutorHistory(); });
  controls.querySelector('[data-history-next]').addEventListener('click', () => { state.tutorHistoryPageIndex++; renderTutorHistory(); });
  if (!filtered.length) {
    content.innerHTML = `<p class="hint">${state.tutorConversations.length ? 'No conversations match your search.' : 'No conversations yet. Start a new chat to begin.'}</p>`;
    controls.classList.add('hidden');
  } else {
    controls.classList.remove('hidden');
  }
}

export function createTutorConversation() {
  const conversation = { id: dependencies.uid(), title: 'New chat', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
  state.tutorConversations.push(conversation);
  state.activeTutorConversationId = conversation.id;
  state.tutorChatHistory = conversation.messages;
  localStorage.setItem('studybuddy-active-conversation', state.activeTutorConversationId);
  persistTutorConversations();
  state.tutorChatAtLatest = true;
  renderTutorChatPage();
  renderTutorOverview();
}

export function renameTutorConversation(conversation) {
  if (!conversation) return;
  const title = prompt('Rename conversation', conversation.title || 'New chat');
  if (!title?.trim()) return;
  conversation.title = title.trim().slice(0, 80);
  persistTutorConversations().then(() => {
    $('tutor-conversation-title').value = conversation.title;
    renderTutorHistory();
  });
}

export function exportTutorConversation() {
  const conversation = state.tutorConversations.find(item => item.id === state.activeTutorConversationId);
  if (!conversation) return;
  const lines = [`# ${conversation.title || 'Tutor conversation'}`, ''];
  conversation.messages.forEach(message => {
    lines.push(message.role === 'user' ? '## You' : '## Tutor', '', normalizeTutorReply(message.content), '');
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${(conversation.title || 'tutor-chat').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 80)}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function setTutorOverviewOpen(open) {
  if (window.matchMedia('(min-width: 769px)').matches) return;
  const aside = $('tutor-aside');
  aside.classList.toggle('open', open);
  $('tutor-aside-backdrop').classList.toggle('hidden', !open);
  $('tutor-overview-open').setAttribute('aria-expanded', String(open));
  if (open) {
    aside.setAttribute('role', 'dialog');
    aside.setAttribute('aria-modal', 'true');
    $('tutor-aside-close').focus();
  } else {
    aside.removeAttribute('role');
    aside.removeAttribute('aria-modal');
    $('tutor-overview-open').focus();
  }
}

export async function persistTutorConversations() {
  const active = state.tutorConversations.find(item => item.id === state.activeTutorConversationId);
  if (active) {
    active.messages = state.tutorChatHistory;
    active.updatedAt = Date.now();
    const firstQuestion = state.tutorChatHistory.find(message => message.role === 'user')?.content;
    if (active.title === 'New chat' && firstQuestion) {
      active.title = firstQuestion.trim().replace(/\s+/g, ' ').slice(0, 48) || 'New chat';
    }
  }
  await dependencies.idbSet('tutorConversations', state.tutorConversations);
}

function openReplyDialog(text) {
  const content = $('reply-dialog-content');
  const pageLength = Math.max(500, Math.min(1400, Math.floor(($('reply-dialog').clientWidth || 700) * ($('reply-dialog').clientHeight || 500) / 26)));
  state.tutorReplyPages = [];
  for (let index = 0; index < text.length; index += pageLength) state.tutorReplyPages.push(text.slice(index, index + pageLength));
  state.tutorReplyPageIndex = 0;
  content.textContent = state.tutorReplyPages[0] || '';
  renderReplyControls();
  $('reply-dialog').showModal();
}

function renderReplyControls() {
  const controls = $('reply-dialog-controls');
  controls.innerHTML = `<button type="button" class="btn btn-sm" data-reply-prev ${state.tutorReplyPageIndex === 0 ? 'disabled' : ''}>Previous</button><span aria-live="polite">Part ${state.tutorReplyPageIndex + 1} of ${state.tutorReplyPages.length}</span><button type="button" class="btn btn-sm" data-reply-next ${state.tutorReplyPageIndex >= state.tutorReplyPages.length - 1 ? 'disabled' : ''}>Next</button>`;
  controls.querySelector('[data-reply-prev]').addEventListener('click', () => { state.tutorReplyPageIndex--; renderReplyPage(); });
  controls.querySelector('[data-reply-next]').addEventListener('click', () => { state.tutorReplyPageIndex++; renderReplyPage(); });
}

function renderReplyPage() {
  $('reply-dialog-content').textContent = state.tutorReplyPages[state.tutorReplyPageIndex] || '';
  renderReplyControls();
}

export function openStudySource(type, id) {
  if (!id && type !== 'progress') return;
  if (type === 'document') {
    dependencies.activatePage('documents');
    dependencies.previewDocument(id);
  } else if (type === 'note') {
    dependencies.activatePage('notes');
    dependencies.selectNote(id);
  } else if (type === 'card') {
    dependencies.activatePage('cards');
    $('card-course-filter').value = 'all';
    $('card-unit-filter').value = 'all';
    $('card-mastery-filter').value = 'all';
    $('card-search').value = '';
    dependencies.renderCardList();
    dependencies.showFitItem($('card-list'), `[data-card-id="${CSS.escape(id)}"]`);
  } else if (type === 'assignment' || type === 'class') {
    dependencies.activatePage('classes');
    dependencies.setClassesView(type === 'assignment' ? 'assignments' : 'classes');
    dependencies.renderClasses();
    dependencies.showFitItem($(type === 'assignment' ? 'classes-assignment-list' : 'class-list'), `[data-edit-${type}="${CSS.escape(id)}"]`);
  } else if (type === 'quiz' || type === 'session' || type === 'progress') {
    dependencies.activatePage('progress');
  }
}

export function setChatRequestStatus(message = '') {
  $('chat-request-message').textContent = message;
}

export async function readTutorStream(response, onUpdate) {
  let reply = '';
  let sources = [];
  let finished = false;
  const dispatch = block => {
    const data = block.split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
      .join('\n');
    if (!data || data === '[DONE]') return;
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      throw new Error('The tutor returned an invalid streaming response.');
    }
    if (event.error) {
      const error = new Error(event.error);
      error.status = Number(event.status) || 502;
      throw error;
    }
    if (typeof event.token === 'string') {
      reply += event.token;
      onUpdate(reply);
    }
    if (typeof event.reply === 'string') reply = event.reply;
    if (Array.isArray(event.sources)) sources = event.sources;
    if (event.done === true) finished = true;
  };

  if (!response.body?.getReader) {
    const text = await response.text();
    text.split(/\r?\n\r?\n/).forEach(dispatch);
  } else {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value || new Uint8Array(), { stream: !done });
        const blocks = pending.split(/\r?\n\r?\n/);
        pending = blocks.pop() || '';
        blocks.forEach(dispatch);
        if (done) break;
      }
      if (pending.trim()) dispatch(pending);
    } finally {
      reader.releaseLock();
    }
  }
  if (!reply.trim()) throw new Error('The tutor did not return a response. Please try again.');
  if (!finished) throw new Error('The tutor response was interrupted. Please try again.');
  return { reply, sources };
}

export async function sendChat(retryQuestion = '', retryTimestamp = 0) {
  const q = (retryQuestion || $('chat-input').value).trim();
  if (!q || state.tutorChatPending) return;
  if (retryTimestamp) {
    const failedIndex = state.tutorChatHistory.findIndex(message => message.timestamp === retryTimestamp && message.retry);
    if (failedIndex >= 0) {
      const start = state.tutorChatHistory[failedIndex - 1]?.role === 'user' ? failedIndex - 1 : failedIndex;
      state.tutorChatHistory.splice(start);
      await persistTutorConversations();
    }
  }
  if (!state.tutorConversations.some(item => item.id === state.activeTutorConversationId)) createTutorConversation();
  state.tutorChatPending = true;
  state.lastTutorQuestion = q;
  state.tutorChatWakeMessage = '';
  state.tutorChatStreamingReply = '';
  state.tutorChatAbortController = new AbortController();
  $('chat-input').value = '';
  $('chat-input').style.height = 'auto';
  $('chat-send').disabled = true;
  $('chat-send').classList.add('hidden');
  $('chat-stop-btn').classList.remove('hidden');
  setChatRequestStatus('');
  clearTimeout(state.tutorChatWakeTimer);
  state.tutorChatWakeTimer = setTimeout(() => {
    if (state.tutorChatPending) {
      state.tutorChatWakeMessage = 'Waking up the server, this can take up to a minute...';
      renderTutorChatPage();
    }
  }, 5000);
  state.tutorChatHistory.push({ role: 'user', content: q, timestamp: Date.now() });
  state.tutorChatAtLatest = true;
  await persistTutorConversations();
  renderTutorChatPage();
  renderTutorOverview();
  $('chat-input').focus();
  try {
    const references = $('tutor-use-material').checked ? dependencies.retrieveStudyReferences(q) : [];
    const res = await dependencies.apiFetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: q, history: state.tutorChatHistory.slice(0, -1), references, stream: true }),
      signal: state.tutorChatAbortController.signal
    });
    if (!res.ok) {
      const error = new Error(await dependencies.apiErrorMessage(res, 'The AI request failed'));
      error.status = res.status;
      throw error;
    }
    let data;
    if (res.headers.get('content-type')?.includes('text/event-stream')) {
      data = await readTutorStream(res, partial => {
        updateTutorStreamingReply(partial);
      });
    } else {
      try {
        data = await res.json();
      } catch {
        throw new Error('The server returned an invalid response. Please try again.');
      }
    }
    if (data?.error) throw new Error(data.error);
    if (typeof data?.reply !== 'string' || !data.reply.trim()) {
      throw new Error('The AI did not return a response. Please try again.');
    }
    const textBlock = normalizeTutorReply(data.reply);
    state.tutorChatHistory.push({
      role: 'assistant',
      content: textBlock,
      sources: Array.isArray(data.sources) ? data.sources : [],
      question: q,
      timestamp: Date.now()
    });
    if (state.tutorChatHistory.length > 40) state.tutorChatHistory = state.tutorChatHistory.slice(-40);
    await persistTutorConversations();
    updateTutorConnectionStatus('connected');
    renderTutorChatPage();
    renderTutorOverview();
  } catch (err) {
    const stopped = state.tutorChatAbortController?.signal.aborted;
    if (stopped) {
      if (state.tutorChatStreamingReply.trim()) {
        state.tutorChatHistory.push({
          role: 'assistant',
          content: state.tutorChatStreamingReply,
          question: q,
          timestamp: Date.now()
        });
        await persistTutorConversations();
      }
      state.tutorChatStreamingReply = '';
      state.tutorChatPending = false;
      setChatRequestStatus('Request stopped.');
      renderTutorChatPage();
      renderTutorOverview();
    } else {
      const status = Number(err.status) || 0;
      const message = status === 401
        ? 'Session expired, please sign in again'
        : status === 403
          ? 'The request could not be verified. Reload the page and try again.'
        : status === 429
          ? 'Too many requests, wait a moment.'
          : status >= 500 || !status
            ? 'The tutor server is unavailable.'
            : err.message || 'The tutor could not answer. Please try again.';
      state.tutorChatHistory.push({
        role: 'assistant',
        content: message,
        retry: q,
        question: q,
        timestamp: Date.now()
      });
      await persistTutorConversations();
      renderTutorChatPage();
      setChatRequestStatus(message);
    }
  } finally {
    clearTimeout(state.tutorChatWakeTimer);
    state.tutorChatWakeMessage = '';
    state.tutorChatStreamingReply = '';
    state.tutorChatPending = false;
    state.tutorChatAbortController = null;
    $('chat-send').classList.remove('hidden');
    $('chat-stop-btn').classList.add('hidden');
    $('chat-send').disabled = !$('chat-input').value.trim();
    $('chat-input').focus();
  }
}



export function renderTutorOverview() {
  $('tutor-doc-count').textContent = dependencies.getDocuments().length;
  $('tutor-card-count').textContent = dependencies.getCards().length;
  $('tutor-note-count').textContent = dependencies.getNotes().length;
  const recentQuestions = state.tutorChatHistory.filter(message => message.role === 'user').slice(-3).reverse();
  const list = $('tutor-recent-topics');
  list.replaceChildren();
  if (!recentQuestions.length) {
    const empty = document.createElement('span');
    empty.className = 'hint';
    empty.textContent = 'Your recent questions will appear here.';
    list.appendChild(empty);
    return;
  }
  recentQuestions.forEach(message => {
    const topic = document.createElement('p');
    topic.textContent = message.content;
    list.appendChild(topic);
  });
}

export function updateTutorConnectionStatus() {
  $('tutor-connection-chip').textContent = 'Connected';
  $('tutor-connection-chip').dataset.state = 'connected';
}
export async function loadTutorConversations() {
  state.tutorConversations = await dependencies.idbGet('tutorConversations') || [];
  let migratedTutorTimestamps = false;
  state.tutorConversations.forEach(conversation => {
    if (!Array.isArray(conversation.messages)) {
      conversation.messages = [];
      migratedTutorTimestamps = true;
    }
    const messages = conversation.messages;
    messages.forEach((message, index) => {
      if (message.timestamp != null && Number.isFinite(Number(message.timestamp))) return;
      message.timestamp = Math.max(0, Number(conversation.updatedAt) - (messages.length - index) * 60000) || Date.now();
      migratedTutorTimestamps = true;
    });
  });
  if (migratedTutorTimestamps) await dependencies.idbSet('tutorConversations', state.tutorConversations);
  const savedConversationId = localStorage.getItem('studybuddy-active-conversation');
  state.activeTutorConversationId = state.tutorConversations.some(item => item.id === savedConversationId)
    ? savedConversationId
    : state.tutorConversations.at(-1)?.id || null;
  state.tutorChatHistory = state.tutorConversations.find(item => item.id === state.activeTutorConversationId)?.messages || [];
  if (!state.activeTutorConversationId) {
    const conversation = { id: dependencies.uid(), title: 'New chat', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    state.tutorConversations.push(conversation);
    state.activeTutorConversationId = conversation.id;
    state.tutorChatHistory = conversation.messages;
    localStorage.setItem('studybuddy-active-conversation', state.activeTutorConversationId);
    await persistTutorConversations();
  }
}


export function init(deps) {
  dependencies = deps;
  deps.initTutorSources({
    getDocuments: deps.getDocuments, getNotes: deps.getNotes, getCards: deps.getCards,
    getQuizResults: deps.getQuizResults, getAssignments: deps.getAssignments,
    getClasses: deps.getClasses, getTimerSessions: deps.getTimerSessions,
    classForAssignment: deps.classForAssignment, formatMeetingDays: deps.formatMeetingDays,
    escapeHtml: deps.escapeHtml, syncCustomSelect: deps.syncCustomSelect,
    renderTutorMarkdown: deps.renderTutorMarkdown, sendChat,
    setChatRequestStatus,
    persistTutorConversations,
    renderTutorChatPage
  });
  updateTutorConnectionStatus();
$('tutor-use-material').checked = localStorage.getItem(TUTOR_MATERIAL_KEY) !== 'false';
$('settings-tutor-material').checked = $('tutor-use-material').checked;
$('tutor-use-material').addEventListener('change', event => {
  localStorage.setItem(TUTOR_MATERIAL_KEY, String(event.target.checked));
  $('settings-tutor-material').checked = event.target.checked;
  renderTutorChatPage();
});
$('settings-tutor-material').addEventListener('change', event => {
  localStorage.setItem(TUTOR_MATERIAL_KEY, String(event.target.checked));
  $('tutor-use-material').checked = event.target.checked;
  renderTutorChatPage();
});
$('chat-send').addEventListener('click', () => sendChat());
$('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
$('chat-input').addEventListener('input', event => {
  const input = event.currentTarget;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 144)}px`;
  $('chat-send').disabled = state.tutorChatPending || !input.value.trim();
});
$('chat-input').addEventListener('paste', event => {
  const input = event.currentTarget;
  const pasted = event.clipboardData?.getData('text/plain') || '';
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const allowedLength = input.maxLength - (input.value.length - (end - start));
  if (allowedLength <= 0) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  const text = pasted.slice(0, allowedLength);
  input.setRangeText(text, start, end, 'end');
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
$('chat-log').addEventListener('scroll', () => {
  const log = $('chat-log');
  state.tutorChatAtLatest = log.scrollHeight - log.clientHeight - log.scrollTop <= 48;
  $('chat-jump-latest').classList.toggle('hidden', state.tutorChatAtLatest || state.tutorChatHistory.length === 0);
});
$('chat-jump-latest').addEventListener('click', () => {
  state.tutorChatAtLatest = true;
  $('chat-log').scrollTo({
    top: $('chat-log').scrollHeight,
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  });
  $('chat-jump-latest').classList.add('hidden');
});
$('tutor-history-open').addEventListener('click', () => {
  state.tutorHistoryPageIndex = 0;
  $('tutor-history-search').value = '';
  renderTutorHistory();
  $('tutor-history-dialog').showModal();
  $('tutor-history-search').focus();
});
$('tutor-history-search').addEventListener('input', () => {
  state.tutorHistoryPageIndex = 0;
  renderTutorHistory();
});
$('new-chat-btn').addEventListener('click', () => {
  $('tutor-menu').open = false;
  createTutorConversation();
  $('chat-input').focus();
});
$('rename-chat-btn').addEventListener('click', () => {
  $('tutor-menu').open = false;
  renameTutorConversation(state.tutorConversations.find(item => item.id === state.activeTutorConversationId));
});
$('export-chat-btn').addEventListener('click', () => {
  $('tutor-menu').open = false;
  exportTutorConversation();
});
$('tutor-conversation-title').addEventListener('change', async event => {
  const conversation = state.tutorConversations.find(item => item.id === state.activeTutorConversationId);
  if (!conversation) return;
  conversation.title = event.target.value.trim().slice(0, 80) || 'New chat';
  await persistTutorConversations();
  event.target.value = conversation.title;
});
$('tutor-conversation-title').addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    event.currentTarget.blur();
  } else if (event.key === 'Escape') {
    event.currentTarget.value = state.tutorConversations.find(item => item.id === state.activeTutorConversationId)?.title || 'New chat';
    event.currentTarget.blur();
  }
});
$('tutor-history-close').addEventListener('click', () => $('tutor-history-dialog').close());
$('tutor-overview-open').addEventListener('click', () => setTutorOverviewOpen(true));
$('tutor-aside-close').addEventListener('click', () => setTutorOverviewOpen(false));
$('tutor-aside-backdrop').addEventListener('click', () => setTutorOverviewOpen(false));
$('tutor-menu').addEventListener('keydown', event => {
  const items = [...$('tutor-menu').querySelectorAll('[role="menuitem"]')];
  const activeIndex = items.indexOf(document.activeElement);
  if (event.key === 'Escape') {
    event.preventDefault();
    $('tutor-menu').open = false;
    $('tutor-menu').querySelector('summary').focus();
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!$('tutor-menu').open) $('tutor-menu').open = true;
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = (activeIndex + direction + items.length) % items.length;
    items[nextIndex]?.focus();
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
  }
});
$('tutor-aside').addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.preventDefault();
    setTutorOverviewOpen(false);
    return;
  }
  if (event.key === 'Tab' && $('tutor-aside').classList.contains('open')) {
    const focusable = [...$('tutor-aside').querySelectorAll('button:not(:disabled)')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});
$('clear-chat-btn').addEventListener('click', async () => {
  $('tutor-menu').open = false;
  const confirmed = await dependencies.confirmBulkDeletion('Clear all Tutor conversations and messages? This does not delete notes or flashcards made from replies.');
  if (!confirmed) return;
  state.tutorConversations = [];
  state.tutorChatHistory = [];
  state.activeTutorConversationId = null;
  await dependencies.idbSet('tutorConversations', state.tutorConversations);
  createTutorConversation();
  renderTutorHistory();
});
$('tutor-history-dialog').addEventListener('click', async event => {
  const openButton = event.target.closest('[data-open-conversation]');
  const renameButton = event.target.closest('[data-rename-conversation]');
  const deleteButton = event.target.closest('[data-delete-conversation]');
  if (openButton) {
    const conversation = state.tutorConversations.find(item => item.id === openButton.dataset.openConversation);
    if (!conversation) return;
    await persistTutorConversations();
    state.activeTutorConversationId = conversation.id;
    state.tutorChatHistory = conversation.messages;
    localStorage.setItem('studybuddy-active-conversation', state.activeTutorConversationId);
    state.tutorChatAtLatest = true;
    renderTutorChatPage();
    renderTutorOverview();
    $('tutor-history-dialog').close();
    return;
  }
  if (renameButton) {
    const conversation = state.tutorConversations.find(item => item.id === renameButton.dataset.renameConversation);
    if (!conversation) return;
    renameTutorConversation(conversation);
    return;
  }
  if (deleteButton) {
    const conversation = state.tutorConversations.find(item => item.id === deleteButton.dataset.deleteConversation);
    if (!conversation) return;
    const confirmed = await dependencies.confirmDeletion({
      title: `Delete conversation "${conversation.title || 'New chat'}"?`,
      description: `This removes the conversation and its ${conversation.messages.length} messages from this browser.`,
      affected: 'Saved notes and flashcards created from replies are not changed.'
    });
    if (!confirmed) return;
    if (state.activeTutorConversationId === conversation.id) {
      state.activeTutorConversationId = state.tutorConversations.find(item => item.id !== conversation.id)?.id || null;
      state.tutorChatHistory = state.tutorConversations.find(item => item.id === state.activeTutorConversationId)?.messages || [];
    }
    localStorage.setItem('studybuddy-active-conversation', state.activeTutorConversationId || '');
    await dependencies.softDeleteRecords([{ collection: 'tutorConversations', ids: [conversation.id] }], 'Conversation deleted.');
    if (!state.activeTutorConversationId) createTutorConversation();
    renderTutorChatPage();
    renderTutorOverview();
    renderTutorHistory();
  }
});
$('reply-dialog-close').addEventListener('click', () => $('reply-dialog').close());
$('tutor-study-scope').addEventListener('change', () => {
  $('tutor-study-scope').setAttribute('aria-label', 'Study material scope');
});
document.querySelector('#chat-log').addEventListener('click', event => {
  const source = event.target.closest('.source-open');
  if (source) openStudySource(source.dataset.sourceType, source.dataset.sourceId);
});
document.querySelector('#tutor-history-dialog').addEventListener('click', event => {
  const source = event.target.closest('.source-open');
  if (source) openStudySource(source.dataset.sourceType, source.dataset.sourceId);
});
window.addEventListener('resize', () => {
  if (window.innerWidth <= 768 || !$('tutor-aside').classList.contains('open')) return;
  $('tutor-aside').classList.remove('open');
  $('tutor-aside').removeAttribute('role');
  $('tutor-aside').removeAttribute('aria-modal');
  $('tutor-aside-backdrop').classList.add('hidden');
  $('tutor-overview-open').setAttribute('aria-expanded', 'false');
});
$('chat-stop-btn').addEventListener('click', () => state.tutorChatAbortController?.abort());
}
