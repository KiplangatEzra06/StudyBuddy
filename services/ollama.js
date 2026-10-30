const fetch = require('node-fetch');

const REQUEST_TIMEOUT_MS = 60000;

async function callOllama(messages) {
    if (!process.env.OLLAMA_API_KEY) {
        const error = new Error('OLLAMA_API_KEY is not configured');
        error.status = 500;
        throw error;
    }

    const baseUrl = (process.env.OLLAMA_BASE_URL || 'https://ollama.com').replace(/\/+$/, '');
    const requestBody = JSON.stringify({
        model: process.env.OLLAMA_MODEL || 'gpt-oss:20b',
        messages,
        stream: false
    });

    for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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
                const responseText = await response.text();
                const error = new Error(`Ollama request failed (${response.status}): ${responseText}`);
                error.status = response.status;
                if (response.status >= 500 && attempt === 0) continue;
                throw error;
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
            const retryableNetworkError = error.name === 'AbortError' || error.type === 'system';
            if (error.status || attempt === 1 || !retryableNetworkError) throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    throw new Error('Ollama request failed');
}

module.exports = { callOllama };