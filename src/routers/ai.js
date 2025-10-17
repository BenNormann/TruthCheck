// AI Client - OpenAI/Anthropic API wrapper with retry logic and rate limiting
import CONFIG from '../foundation/config.js';
import logger from '../foundation/logger.js';
import cache from '../foundation/cache.js';

// Backend server configuration - will be set by extension initialization
let SERVER_CONFIG = {
  baseUrl: 'http://localhost:3001',
  apiKey: null,
  timeout: 30000,
  retries: 3
};

// Function to configure server settings
export function configureServer(config) {
  SERVER_CONFIG = { ...SERVER_CONFIG, ...config };
}

class AIClient {
  constructor() {
    this.provider = CONFIG.apis.ai_provider.provider;
    this.model = CONFIG.apis.ai_provider.model;
    this.apiKey = CONFIG.apis.ai_provider.api_key;
    this.baseUrl = CONFIG.apis.ai_provider.base_url;
    this.temperature = CONFIG.apis.ai_provider.temperature;
    this.maxTokens = CONFIG.apis.ai_provider.max_tokens;
    this.timeout = CONFIG.apis.ai_provider.timeout;
    this.retries = CONFIG.apis.ai_provider.retries;

    this.requestQueue = [];
    this.processing = false;
    this.lastRequestTime = 0;
    this.minRequestInterval = 1000; // Minimum 1 second between requests
  }

  async query(prompt, options = {}) {
    const requestOptions = {
      temperature: options.temperature || this.temperature,
      max_tokens: options.max_tokens || this.maxTokens,
      timeout: options.timeout || this.timeout,
      retries: options.retries || this.retries,
      cache: options.cache !== false,
      ...options
    };

    // Check cache first
    if (requestOptions.cache) {
      const cacheKey = cache.generateKey('ai', this.hashString(prompt), requestOptions.temperature, requestOptions.max_tokens);
      const cached = await cache.get(cacheKey);

      if (cached) {
        logger.debug('Using cached AI response');
        return cached;
      }
    }

    // Queue request to respect rate limits
    return this.queueRequest(prompt, requestOptions);
  }

  async queueRequest(prompt, options) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({
        prompt,
        options,
        resolve,
        reject,
        timestamp: Date.now()
      });

      this.processQueue();
    });
  }

  async processQueue() {
    if (this.processing || this.requestQueue.length === 0) return;

    this.processing = true;

    while (this.requestQueue.length > 0) {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;

      // Respect minimum interval between requests
      if (timeSinceLastRequest < this.minRequestInterval) {
        await new Promise(resolve =>
          setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest)
        );
      }

      const request = this.requestQueue.shift();
      this.lastRequestTime = Date.now();

      try {
        const result = await this.makeRequest(request.prompt, request.options);
        request.resolve(result);
      } catch (error) {
        logger.error('AI request failed:', error);
        request.reject(error);
      }

      // Small delay between requests to be respectful
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    this.processing = false;
  }

  async makeRequest(prompt, options) {
    logger.logRequest(this.baseUrl, 'POST', { model: this.model, promptLength: prompt.length });

    const startTime = performance.now();

    let lastError;

    for (let attempt = 0; attempt <= options.retries; attempt++) {
      try {
        const response = await this.callAPI(prompt, options);

        const responseTime = performance.now() - startTime;
        logger.logResponse(this.baseUrl, 200, responseTime, { tokens: response.usage?.total_tokens });

        // Cache successful response
        if (options.cache) {
          const cacheKey = cache.generateKey('ai', this.hashString(prompt), options.temperature, options.max_tokens);
          await cache.set(cacheKey, response, 24); // Cache for 24 hours
        }

        return response;

      } catch (error) {
        lastError = error;
        logger.error(`AI request attempt ${attempt + 1} failed:`, error);

        if (attempt < options.retries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000); // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    const responseTime = performance.now() - startTime;
    logger.logResponse(this.baseUrl, 500, responseTime, { error: lastError.message });

    throw lastError;
  }

  async callAPI(prompt, options) {
    // Check if server is properly configured
    if (!SERVER_CONFIG.apiKey || !SERVER_CONFIG.baseUrl) {
      throw new Error('Backend server not configured - Please set up the backend server with proper API keys');
    }

    const requestBody = {
      prompt,
      options
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout);

    try {
      logger.logRequest(`${SERVER_CONFIG.baseUrl}/api/ai/query`, 'POST', { promptLength: prompt.length });

      const response = await fetch(`${SERVER_CONFIG.baseUrl}/api/ai/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': SERVER_CONFIG.apiKey
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        logger.logResponse(`${SERVER_CONFIG.baseUrl}/api/ai/query`, response.status, 0, { error: errorData.error });

        if (response.status === 401) {
          throw new Error('Invalid API key - Please check your server configuration');
        }
        if (response.status === 500) {
          throw new Error(`Server error: ${errorData.error || 'Internal server error'}`);
        }
        throw new Error(`HTTP ${response.status}: ${errorData.error || 'Unknown error'}`);
      }

      const data = await response.json();
      const responseTime = performance.now() - (options.startTime || 0);

      if (!data.success) {
        logger.logResponse(`${SERVER_CONFIG.baseUrl}/api/ai/query`, 200, responseTime, { error: data.error });
        throw new Error(data.error || 'Server returned unsuccessful response');
      }

      logger.logResponse(`${SERVER_CONFIG.baseUrl}/api/ai/query`, 200, responseTime, { tokens: data.data?.usage?.total_tokens });

      return this.parseServerResponse(data.data);

    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        logger.logResponse(`${SERVER_CONFIG.baseUrl}/api/ai/query`, 408, 0, { error: 'Request timeout' });
        throw new Error('AI request timed out');
      }

      if (error.message.includes('fetch')) {
        logger.logResponse(`${SERVER_CONFIG.baseUrl}/api/ai/query`, 0, 0, { error: 'Network error' });
        throw new Error('Unable to connect to backend server - Please ensure the server is running');
      }

      logger.logResponse(`${SERVER_CONFIG.baseUrl}/api/ai/query`, 500, 0, { error: error.message });
      throw error;
    }
  }

  buildRequestBody(prompt, options) {
    const messages = [
      {
        role: 'system',
        content: 'You are a helpful assistant for fact-checking and analysis.'
      },
      {
        role: 'user',
        content: prompt
      }
    ];

    return {
      model: this.model,
      messages,
      temperature: options.temperature,
      max_tokens: options.max_tokens,
      response_format: { type: 'json_object' } // Request JSON response
    };
  }

  parseResponse(data) {
    const message = data.choices?.[0]?.message?.content;

    if (!message) {
      throw new Error('No response content from AI');
    }

    try {
      // Try to parse as JSON first
      return JSON.parse(message);
    } catch (error) {
      // If not JSON, return as text
      return {
        content: message,
        usage: data.usage,
        model: data.model,
        raw_response: message
      };
    }
  }

  parseServerResponse(data) {
    // Handle response from our backend server
    if (data.content && data.raw_response) {
      // This is a non-JSON response from OpenAI
      return {
        content: data.content,
        usage: data.usage,
        model: data.model,
        raw_response: data.raw_response
      };
    }

    // This should be a parsed JSON response from OpenAI
    return data;
  }

  // Utility method for consistent string hashing
  hashString(str) {
    let hash = 0;
    if (str.length === 0) return hash;

    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }

    return Math.abs(hash).toString(36);
  }

  // Batch processing for multiple prompts
  async queryBatch(prompts, options = {}) {
    const results = await Promise.allSettled(
      prompts.map(prompt => this.query(prompt, options))
    );

    return results.map((result, index) => ({
      prompt: prompts[index],
      result: result.status === 'fulfilled' ? result.value : null,
      error: result.status === 'rejected' ? result.reason : null
    }));
  }

  // Health check method
  async healthCheck() {
    try {
      const testPrompt = 'Respond with a simple JSON object: {"status": "ok"}';
      const response = await this.query(testPrompt, { cache: false });

      return {
        status: 'healthy',
        provider: this.provider,
        model: this.model,
        response_time: response.response_time
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        provider: this.provider,
        model: this.model
      };
    }
  }

  // Get usage statistics
  getStats() {
    return {
      provider: this.provider,
      model: this.model,
      queue_length: this.requestQueue.length,
      last_request: new Date(this.lastRequestTime).toISOString()
    };
  }
}

// Create singleton instance and make it globally available
// This works better in browser extension context
const aiClient = new AIClient();

// Make AIClient class and instance available globally for content scripts
if (typeof window !== 'undefined') {
  window.AIClient = AIClient;
  window.aiClient = aiClient;
}

// For compatibility with import statements in browser extension context
if (typeof module !== 'undefined' && module.exports) {
  module.exports = aiClient;
  module.exports.AIClient = AIClient;
}
