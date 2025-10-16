// Retry - Retry logic with exponential backoff for API calls and operations
import CONFIG from '../foundation/config.js';
import logger from '../foundation/logger.js';

class Retry {
  // Retry an async operation with exponential backoff
  static async withRetry(operation, options = {}) {
    const {
      maxRetries = CONFIG.performance.max_retries,
      baseDelay = CONFIG.performance.retry_delay,
      maxDelay = 30000,
      backoffFactor = 2,
      retryCondition = this.defaultRetryCondition,
      onRetry = null
    } = options;

    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation();

        if (attempt > 0) {
          logger.log(`Operation succeeded after ${attempt} retries`);
        }

        return result;

      } catch (error) {
        lastError = error;

        // Check if we should retry this error
        if (!retryCondition(error, attempt, maxRetries)) {
          logger.error(`Operation failed permanently after ${attempt} attempts:`, error);
          throw error;
        }

        // Don't wait after the last attempt
        if (attempt < maxRetries) {
          const delay = Math.min(baseDelay * Math.pow(backoffFactor, attempt), maxDelay);

          logger.warn(`Operation failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms:`, error.message);

          if (onRetry) {
            onRetry(error, attempt, delay);
          }

          await this.sleep(delay);
        }
      }
    }

    logger.error(`Operation failed after ${maxRetries + 1} attempts`);
    throw lastError;
  }

  // Default retry condition - retry on network errors and 5xx status codes
  static defaultRetryCondition(error, attempt, maxRetries) {
    // Don't retry on the last attempt
    if (attempt >= maxRetries) {
      return false;
    }

    // Retry on network errors
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return true;
    }

    // Retry on timeout errors
    if (error.name === 'AbortError' || error.message.includes('timeout')) {
      return true;
    }

    // Retry on 5xx server errors
    if (error.message.includes('HTTP 5')) {
      return true;
    }

    // Retry on rate limiting (429)
    if (error.message.includes('429') || error.message.includes('rate limit')) {
      return true;
    }

    // Don't retry on 4xx client errors (except 429)
    if (error.message.includes('HTTP 4')) {
      return false;
    }

    // Don't retry on validation errors or bad requests
    if (error.message.includes('validation') || error.message.includes('invalid')) {
      return false;
    }

    return false;
  }

  // Sleep for specified milliseconds
  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Retry with jitter to avoid thundering herd
  static async withJitter(operation, options = {}) {
    const jitteredOptions = {
      ...options,
      baseDelay: options.baseDelay + (Math.random() * 1000) // Add up to 1s of jitter
    };

    return this.withRetry(operation, jitteredOptions);
  }

  // Circuit breaker pattern - fail fast if service is down
  static createCircuitBreaker(threshold = 5, timeout = 60000) {
    let failures = 0;
    let lastFailureTime = 0;
    let state = 'closed'; // 'closed' | 'open' | 'half-open'

    return async function(operation, options = {}) {
      const now = Date.now();

      // Check if circuit should be half-open
      if (state === 'open' && now - lastFailureTime >= timeout) {
        state = 'half-open';
        logger.log('Circuit breaker: half-open');
      }

      // Fail fast if circuit is open
      if (state === 'open') {
        throw new Error('Circuit breaker is open');
      }

      try {
        const result = await Retry.withRetry(operation, options);

        // Reset on success
        if (state === 'half-open') {
          state = 'closed';
          failures = 0;
          logger.log('Circuit breaker: closed');
        }

        return result;

      } catch (error) {
        failures++;
        lastFailureTime = now;

        // Open circuit if threshold exceeded
        if (failures >= threshold) {
          state = 'open';
          logger.error(`Circuit breaker: open (threshold ${threshold} exceeded)`);
        }

        throw error;
      }
    };
  }

  // Batch operations with retry
  static async batchWithRetry(operations, options = {}) {
    const {
      concurrency = 3,
      retryOptions = {}
    } = options;

    const results = new Array(operations.length);
    const errors = new Array(operations.length);

    // Process in batches
    for (let i = 0; i < operations.length; i += concurrency) {
      const batch = operations.slice(i, i + concurrency);

      const batchPromises = batch.map(async (operation, index) => {
        const globalIndex = i + index;

        try {
          results[globalIndex] = await this.withRetry(operation, retryOptions);
          errors[globalIndex] = null;
        } catch (error) {
          results[globalIndex] = null;
          errors[globalIndex] = error;
          logger.error(`Batch operation ${globalIndex} failed:`, error);
        }
      });

      await Promise.all(batchPromises);
    }

    return {
      results,
      errors,
      successCount: results.filter(r => r !== null).length,
      errorCount: errors.filter(e => e !== null).length
    };
  }

  // Retry with timeout
  static async withTimeout(operation, timeoutMs, options = {}) {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    const retryOptions = {
      ...options,
      retryCondition: (error, attempt, maxRetries) => {
        // Don't retry on timeout
        if (error.message.includes('timed out')) {
          return false;
        }
        return this.defaultRetryCondition(error, attempt, maxRetries);
      }
    };

    return Promise.race([
      this.withRetry(operation, retryOptions),
      timeoutPromise
    ]);
  }

  // Retry with fallback
  static async withFallback(operation, fallback, options = {}) {
    try {
      return await this.withRetry(operation, options);
    } catch (error) {
      logger.warn('Operation failed, using fallback:', error.message);
      return typeof fallback === 'function' ? fallback(error) : fallback;
    }
  }

  // Get retry statistics
  static getRetryStats() {
    return {
      defaultMaxRetries: CONFIG.performance.max_retries,
      defaultBaseDelay: CONFIG.performance.retry_delay,
      defaultBackoffFactor: 2,
      defaultMaxDelay: 30000
    };
  }

  // Create a retry-enabled fetch function
  static createRetryableFetch(options = {}) {
    return async (url, fetchOptions = {}) => {
      const operation = async () => {
        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
          error.status = response.status;
          error.response = response;
          throw error;
        }

        return response;
      };

      return this.withRetry(operation, {
        maxRetries: 3,
        baseDelay: 1000,
        retryCondition: (error) => {
          // Retry on network errors and 5xx status codes
          return error.name === 'TypeError' ||
                 (error.status && error.status >= 500) ||
                 error.message.includes('fetch');
        },
        ...options
      });
    };
  }
}

export default Retry;
