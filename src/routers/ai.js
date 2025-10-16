// AI Client - OpenAI/Anthropic API wrapper with retry logic and rate limiting
import logger from '../foundation/logger.js';
import cache from '../foundation/cache.js';

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
    const requestBody = this.buildRequestBody(prompt, options);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`AI API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
      }

      const data = await response.json();

      return this.parseResponse(data);

    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error('AI request timed out');
      }

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

export default AIClient;
