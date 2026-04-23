async function retryRead(fn, { retries = 1, backoffMs = 250, maxBackoffMs = 8000, fastMode = false } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const isClientError = error?.status >= 400 && error?.status < 500;
      if (isClientError) throw error;
      if (attempt >= retries) throw error;
      if (fastMode) continue;
      const delay = Math.min(backoffMs * (2 ** attempt), maxBackoffMs);
      const jitter = Math.floor(Math.random() * delay * 0.2);
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
    }
  }
  throw lastError;
}

module.exports = { retryRead };
