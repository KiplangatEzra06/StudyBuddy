const API_TIMEOUT_MS = 75000;

export function createApiClient({ onUnauthorized }) {
  return async function apiFetch(path, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    const externalSignal = options.signal;
    const abortFromCaller = () => controller.abort(externalSignal.reason);
    if (externalSignal?.aborted) controller.abort(externalSignal.reason);
    else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
    try {
      const response = await fetch(path, {
        ...options,
        credentials: 'same-origin',
        headers: { ...options.headers, 'X-Requested-With': 'StudyBuddy' },
        signal: controller.signal
      });
      if (response.status === 401) {
        onUnauthorized();
        const error = new Error('Session expired, please sign in again');
        error.status = 401;
        throw error;
      }
      return response;
    } catch (error) {
      if (error.status === 401) throw error;
      if (externalSignal?.aborted) throw new DOMException('The request was cancelled.', 'AbortError');
      const reason = error?.message || String(error || 'Unknown error');
      if (controller.signal.aborted) {
        throw new Error(`Backend timeout calling ${path}. Last error: ${reason}`);
      }
      throw new Error(`Could not reach backend for ${path}. Last error: ${reason}`);
    } finally {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener('abort', abortFromCaller);
    }
  };
}
