const OpenAI = require('openai');

let client;
const limitedModels = new Map();
const MODEL_LIMIT_MS = 60 * 1000;
const DEFAULT_FALLBACK_MODELS = 'openai/gpt-oss-20b,qwen/qwen3.8-27b';
const MAX_TOTAL_TOKENS = 6000;
const ATTACHMENT_MARKERS = ['\nSource text:\n', '\nNotes:\n'];

function messageCharacters(messages) {
  return messages.reduce((total, message) => (
    total + (typeof message.content === 'string' ? message.content.length : 0)
  ), 0);
}

function estimatedTokens(messages) {
  return Math.ceil(messageCharacters(messages) / 4);
}

function latestUserQuery(messages) {
  const latestUser = [...messages].reverse().find(message => message.role === 'user');
  if (!latestUser || typeof latestUser.content !== 'string') return '';
  const markerIndex = ATTACHMENT_MARKERS
    .map(marker => latestUser.content.indexOf(marker))
    .filter(index => index >= 0)
    .sort((left, right) => left - right)[0];
  return markerIndex === undefined
    ? latestUser.content
    : latestUser.content.slice(0, markerIndex);
}

function removeOldestChatTurn(messages) {
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === 'user') {
      latestUserIndex = index;
      break;
    }
  }
  if (latestUserIndex < 0) return false;
  const oldestIndex = messages.findIndex((message, index) => (
    index < latestUserIndex && message.role !== 'system'
  ));
  if (oldestIndex < 0) return false;

  const removeIndexes = [oldestIndex];
  if (messages[oldestIndex].role === 'user') {
    const nextMessageIndex = messages.findIndex((message, index) => (
      index > oldestIndex && index < latestUserIndex && message.role !== 'system'
    ));
    if (nextMessageIndex >= 0 && messages[nextMessageIndex].role === 'assistant') {
      removeIndexes.push(nextMessageIndex);
    }
  }
  for (const index of removeIndexes.sort((left, right) => right - left)) {
    messages.splice(index, 1);
  }
  return true;
}

function attachmentTrimmers(messages) {
  const attachments = [];
  for (const message of messages) {
    if (typeof message.content !== 'string') continue;

    if (message.role === 'system') {
      const startMarker = '<untrusted_reference_material>\n';
      const endMarker = '\n</untrusted_reference_material>';
      const start = message.content.indexOf(startMarker);
      const end = message.content.indexOf(endMarker, start + startMarker.length);
      if (start >= 0 && end >= 0) {
        try {
          const references = JSON.parse(message.content.slice(start + startMarker.length, end));
          if (Array.isArray(references)) {
            const prefix = message.content.slice(0, start + startMarker.length);
            const suffix = message.content.slice(end);
            const serialize = () => {
              const encoded = JSON.stringify(references).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
              message.content = `${prefix}${encoded}${suffix}`;
            };
            for (const reference of references) {
              if (!reference || typeof reference.text !== 'string') continue;
              attachments.push({
                getText: () => reference.text,
                setText(text) {
                  reference.text = text;
                  serialize();
                }
              });
            }
          }
        } catch {
          continue;
        }
      }
    } else if (message.role === 'user') {
      for (const marker of ATTACHMENT_MARKERS) {
        const markerIndex = message.content.indexOf(marker);
        if (markerIndex < 0) continue;
        const prefix = message.content.slice(0, markerIndex + marker.length);
        let text = message.content.slice(markerIndex + marker.length);
        attachments.push({
          getText: () => text,
          setText(nextText) {
            text = nextText;
            message.content = `${prefix}${text}`;
          }
        });
        break;
      }
    }
  }
  return attachments;
}

function truncateRelevantText(text, query, maxCharacters) {
  if (text.length <= maxCharacters) return text;
  if (maxCharacters <= 0) return '';

  const terms = [...new Set((query.toLowerCase().match(/[a-z0-9]{4,}/g) || [])
    .filter(term => !['about', 'after', 'before', 'could', 'first', 'please', 'that', 'them', 'then', 'this', 'what', 'when', 'where', 'which', 'with', 'would'].includes(term)))];
  const chunks = text.split(/(?<=[.!?])\s+|\r?\n+/)
    .map((content, index) => ({ content: content.trim(), index }))
    .filter(chunk => chunk.content);
  const rankedChunks = chunks.map(chunk => ({
    ...chunk,
    score: terms.reduce((score, term) => score + (chunk.content.toLowerCase().includes(term) ? 1 : 0), 0)
  }));
  const matchingChunks = rankedChunks.filter(chunk => chunk.score > 0);
  const ranked = (matchingChunks.length ? matchingChunks : rankedChunks)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const selected = [];
  let usedCharacters = 0;
  for (const chunk of ranked) {
    const separator = selected.length ? '\n...\n' : '';
    const remaining = maxCharacters - usedCharacters - separator.length;
    if (remaining <= 0) break;
    selected.push({ ...chunk, content: chunk.content.slice(0, remaining) });
    usedCharacters += separator.length + Math.min(chunk.content.length, remaining);
    if (usedCharacters >= maxCharacters) break;
  }
  return selected
    .sort((left, right) => left.index - right.index)
    .map(chunk => chunk.content)
    .join('\n...\n');
}

function prepareMessages(messages, requestedMaxTokens) {
  const maxTokens = Math.min(
    MAX_TOTAL_TOKENS,
    Math.max(1, Number.isFinite(Number(requestedMaxTokens)) ? Math.floor(Number(requestedMaxTokens)) : 1000)
  );
  const trimmedMessages = messages.map(message => ({ ...message }));
  const inputCharacterBudget = (MAX_TOTAL_TOKENS - maxTokens) * 4;

  while (messageCharacters(trimmedMessages) > inputCharacterBudget && removeOldestChatTurn(trimmedMessages)) {
    // Keep system prompts and the latest user request while removing prior turns.
  }

  if (messageCharacters(trimmedMessages) > inputCharacterBudget) {
    const query = latestUserQuery(trimmedMessages);
    for (const attachment of attachmentTrimmers(trimmedMessages)) {
      while (messageCharacters(trimmedMessages) > inputCharacterBudget) {
        const currentText = attachment.getText();
        if (!currentText) break;
        const excessCharacters = messageCharacters(trimmedMessages) - inputCharacterBudget;
        const trimmedText = truncateRelevantText(
          currentText,
          query,
          Math.max(0, currentText.length - excessCharacters)
        );
        if (trimmedText.length >= currentText.length) break;
        attachment.setText(trimmedText);
      }
    }
  }

  const inputTokens = estimatedTokens(trimmedMessages);
  if (process.env.NODE_ENV === 'development') {
    console.info('AI request token estimate', {
      inputTokens,
      maxTokens,
      estimatedTotalTokens: inputTokens + maxTokens
    });
  }
  if (inputTokens + maxTokens > MAX_TOTAL_TOKENS) {
    const error = responseError('The AI request is too long to fit the token budget.');
    error.status = 413;
    throw error;
  }
  return { messages: trimmedMessages, maxTokens };
}

function getClient() {
  if (!process.env.AI_API_KEY) {
    const error = new Error('AI_API_KEY is not configured');
    error.status = 500;
    throw error;
  }
  if (!process.env.AI_BASE_URL) {
    const error = new Error('AI_BASE_URL is not configured');
    error.status = 500;
    throw error;
  }
  if (!client) {
    client = new OpenAI({
      baseURL: process.env.AI_BASE_URL,
      apiKey: process.env.AI_API_KEY,
      maxRetries: 0
    });
  }
  return client;
}

function responseError(message) {
  const error = new Error(message);
  error.status = 502;
  return error;
}

function isRateLimitError(error) {
  return Number(error.status) === 429
    || /rate.?limit|quota.?exceeded/i.test(`${error.code || ''} ${error.message || ''}`);
}

function retryAfterMs(error) {
  const rawValue = error.headers?.get?.('retry-after')
    ?? error.headers?.['retry-after']
    ?? error.headers?.['Retry-After'];
  if (rawValue === undefined || rawValue === null) return null;

  const seconds = Number(rawValue);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const retryAt = Date.parse(rawValue);
  return Number.isNaN(retryAt) ? null : Math.max(0, retryAt - Date.now());
}

function quotaExhaustedError() {
  const error = new Error('AI quota reached for now. Try again later.');
  error.name = 'AIQuotaExhaustedError';
  error.code = 'AI_QUOTA_EXHAUSTED';
  error.status = 503;
  return error;
}

function wait(milliseconds, signal) {
  if (signal?.aborted) {
    return Promise.reject(signal.reason || Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal.reason || Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function logConfigurationError(error) {
  const apiKey = process.env.AI_API_KEY;
  const message = String(error.message || 'Unknown AI provider error');
  console.error('AI provider configuration error', {
    status: Number(error.status) || 0,
    message: apiKey ? message.split(apiKey).join('[REDACTED]') : message
  });
}

async function requestCompletion(aiClient, model, messages, maxTokens, signal, onToken) {
  const request = {
    model,
    messages,
    max_tokens: maxTokens,
    ...(typeof onToken === 'function' ? { stream: true } : {})
  };

  if (typeof onToken === 'function') {
    const stream = await aiClient.chat.completions.create(request, { signal });
    let content = '';
    for await (const chunk of stream) {
      const token = chunk.choices?.[0]?.delta?.content;
      if (typeof token === 'string' && token) {
        content += token;
        onToken(token);
      }
    }
    if (!content.trim()) throw responseError('The AI returned no message content.');
    return content;
  }

  const completion = await aiClient.chat.completions.create(request, { signal });
  const content = completion.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw responseError('The AI returned no message content.');
  }
  return content;
}

async function generate({ messages, maxTokens = 1000, signal, onToken, onModel }) {
  const aiClient = getClient();
  const prepared = prepareMessages(messages, maxTokens);
  const primaryModel = process.env.AI_MODEL || 'openai/gpt-oss-120b';
  const fallbackModels = (process.env.AI_FALLBACK_MODELS || DEFAULT_FALLBACK_MODELS)
    .split(',')
    .map(model => model.trim())
    .filter(Boolean);
  const models = [...new Set([primaryModel, ...fallbackModels])];

  for (const model of models) {
    const limitedUntil = limitedModels.get(model);
    if (limitedUntil && limitedUntil > Date.now()) continue;
    if (limitedUntil) limitedModels.delete(model);

    try {
      const content = await requestCompletion(
        aiClient,
        model,
        prepared.messages,
        prepared.maxTokens,
        signal,
        onToken
      );
      if (typeof onModel === 'function') onModel(model);
      return content;
    } catch (error) {
      if ([400, 401, 403].includes(Number(error.status))) {
        logConfigurationError(error);
        throw error;
      }
      if (!isRateLimitError(error)) throw error;

      limitedModels.set(model, Date.now() + MODEL_LIMIT_MS);
      const delayMs = retryAfterMs(error);
      if (delayMs !== null && delayMs < 3000) await wait(delayMs, signal);
    }
  }

  throw quotaExhaustedError();
}

module.exports = { generate };
