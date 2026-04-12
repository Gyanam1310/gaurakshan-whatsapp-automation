function sleep(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function resolveDelayMs({ attempt, baseDelayMs, maxDelayMs, jitterRatio }) {
  const exponent = Math.max(0, attempt - 1);
  const unboundedDelay = baseDelayMs * (2 ** exponent);
  const boundedDelay = Math.min(unboundedDelay, maxDelayMs);
  const normalizedJitter = Math.max(0, Math.min(jitterRatio, 0.8));
  const jitterRange = boundedDelay * normalizedJitter;
  const jitteredDelay = boundedDelay + ((Math.random() * 2 * jitterRange) - jitterRange);
  return Math.max(50, Math.round(jitteredDelay));
}

async function retryWithBackoff(task, options = {}) {
  const attempts = Math.max(1, options.attempts || 1);
  const baseDelayMs = Math.max(50, options.baseDelayMs || 1000);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs || 10000);
  const jitterRatio = Number.isFinite(options.jitterRatio) ? options.jitterRatio : 0.2;
  const shouldRetry = typeof options.shouldRetry === "function"
    ? options.shouldRetry
    : () => true;
  const onRetry = typeof options.onRetry === "function"
    ? options.onRetry
    : null;

  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      const retryable = shouldRetry(error, attempt);
      const hasAttemptsLeft = attempt < attempts;

      if (!retryable || !hasAttemptsLeft) {
        break;
      }

      const delayMs = resolveDelayMs({
        attempt,
        baseDelayMs,
        maxDelayMs,
        jitterRatio,
      });

      if (onRetry) {
        onRetry({
          attempt,
          nextAttempt: attempt + 1,
          delayMs,
          error,
        });
      }

      await sleep(delayMs);
    }
  }

  throw lastError;
}

module.exports = {
  retryWithBackoff,
};
