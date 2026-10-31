const fetch = require('node-fetch');
const { StringDecoder } = require('string_decoder');

const REQUEST_TIMEOUT_MS = 60000;

function redactSecrets(text) {
    let safeText = text;
    for (const secret of [process.env.OLLAMA_API_KEY, process.env.ACCESS_TOKEN].filter(Boolean)) {
        safeText = safeText.split(secret).join('[REDACTED]');
    }
    return safeText.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]').slice(0, 2000);
}

async function callOllama(messages, options = {}) {
    const streaming = typeof options.onToken === 'function';
    if (!process.env.OLLAMA_API_KEY) {
        const error = new Error('OLLAMA_API_KEY is not configured');
        error.status = 500;
        throw error;
    }

    const baseUrl = (process.env.OLLAMA_BASE_URL || 'https://ollama.com').replace(/\/+$/, '');
    const requestBody = JSON.stringify({
        model: process.env.OLLAMA_MODEL || 'gpt-oss:20b',
        messages,
        stream: streaming,
        ...(options.format ? { format: options.format } : {})
    });

    for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const abortFromCaller = () => controller.abort();
        if (options.signal?.aborted) controller.abort();
        else options.signal?.addEventListener('abort', abortFromCaller, { once: true });
        let receivedContent = false;

        try {
            const response = await fetch(`${baseUrl}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${process.env.OLLAMA_API_KEY}`
                },
                body: requestBody,
                signal: controller.signal
            });

            if (!response.ok) {
                await response.text();
                console.error('Ollama Cloud request failed', {
                    status: response.status
                });
                const error = new Error(`Ollama rejected the request (upstream status: ${response.status})`);
                error.status = 502;
                error.upstreamStatus = response.status;
                if (response.status >= 500 && attempt === 0) continue;
                throw error;
            }

            if (streaming) {
                const decoder = new StringDecoder('utf8');
                let pending = '';
                let content = '';
                const consumeLine = line => {
                    if (!line.trim()) return;
                    let event;
                    try {
                        event = JSON.parse(line);
                    } catch {
                        const error = new Error('Ollama returned an invalid streaming response');
                        error.status = 502;
                        throw error;
                    }
                    if (typeof event.error === 'string' && event.error) {
                        const error = new Error(event.error);
                        error.status = 502;
                        throw error;
                    }
                    const token = event.message?.content;
                    if (typeof token === 'string' && token) {
                        content += token;
                        receivedContent = true;
                        options.onToken(token);
                    }
                };
                for await (const chunk of response.body) {
                    pending += decoder.write(chunk);
                    const lines = pending.split(/\r?\n/);
                    pending = lines.pop() || '';
                    lines.forEach(consumeLine);
                }
                pending += decoder.end();
                if (pending.trim()) consumeLine(pending);
                if (!content.trim()) {
                    const error = new Error('Ollama returned no message content');
                    error.status = 502;
                    throw error;
                }
                return content;
            }

            const data = await response.json();
            const content = data?.message?.content;
            if (typeof content !== 'string' || !content.trim()) {
                const error = new Error('Ollama returned no message content');
                error.status = 502;
                throw error;
            }
            return content;
        } catch (error) {
            if (options.signal?.aborted) throw error;
            const retryableNetworkError = error.name === 'AbortError' || error.type === 'system';
            if (error.status || attempt === 1 || receivedContent || !retryableNetworkError) throw error;
        } finally {
            clearTimeout(timeout);
            options.signal?.removeEventListener('abort', abortFromCaller);
        }
    }

    throw new Error('Ollama request failed');
}

module.exports = { callOllama };