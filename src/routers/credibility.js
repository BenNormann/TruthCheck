// Credibility Router - Check source credibility and domain reputation
import CONFIG from '../foundation/config.js';
import logger from '../foundation/logger.js';
import cache from '../foundation/cache.js';

// Backend server configuration - will be set by extension initialization
let SERVER_CONFIG = {
  baseUrl: 'http://localhost:3001',
  apiKey: null,
  timeout: 10000,
  retries: 2
};

// Function to configure server settings
export function configureServer(config) {
  SERVER_CONFIG = { ...SERVER_CONFIG, ...config };
}

class CredibilityRouter {
  constructor() {
    this.sources = CONFIG.apis.credibility_sources.filter(source => source.enabled);
  }

  async checkDomain(domain) {
    logger.debug('Checking credibility for domain:', domain);

    const cacheKey = cache.getCredibilityKey(domain);
    const cached = await cache.get(cacheKey);

    if (cached) {
      logger.debug('Using cached credibility data for:', domain);
      return cached;
    }

    const results = {};

    for (const source of this.sources) {
      try {
        logger.log(`Querying ${source.name} for domain: ${domain}`);

        const result = await this.querySource(source, domain);
        if (result) {
          results[source.name] = result;
        }
      } catch (error) {
        logger.error(`Error querying ${source.name}:`, error);
        continue;
      }
    }

    // Combine results into overall credibility score
    const credibilityScore = this.calculateCredibilityScore(results);

    const finalResult = {
      domain,
      sources: results,
      overall: credibilityScore,
      timestamp: Date.now()
    };

    await cache.set(cacheKey, finalResult, 72); // Cache for 72 hours
    return finalResult;
  }

  async querySource(source, domain) {
    logger.logRequest(source.url, 'GET', { domain });

    const startTime = performance.now();

    try {
      let result;

      switch (source.name) {
        case 'NewsGuard':
          result = await this.queryNewsGuard(source, domain);
          break;
        case 'Media Bias/Fact Check':
          result = await this.queryMediaBiasFactCheck(source, domain);
          break;
        default:
          throw new Error(`Unsupported credibility source: ${source.name}`);
      }

      const responseTime = performance.now() - startTime;
      logger.logResponse(source.url, 200, responseTime, result);

      return result;

    } catch (error) {
      const responseTime = performance.now() - startTime;
      logger.logResponse(source.url, 500, responseTime, { error: error.message });
      throw error;
    }
  }

  async queryNewsGuard(source, domain) {
    // Use backend server for NewsGuard API calls to avoid exposing API keys
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), source.timeout);

    try {
      const response = await fetch(`${SERVER_CONFIG.baseUrl}/api/credibility/newsguard/${domain}`, {
        method: 'GET',
        headers: {
          'x-api-key': SERVER_CONFIG.apiKey
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('NewsGuard API key not configured - Please set up the backend server');
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`NewsGuard API error: ${response.status} - ${errorData.error || 'Unknown error'}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Server returned unsuccessful response');
      }

      return data.data;

    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error('NewsGuard request timed out');
      }

      throw error;
    }
  }

  async queryMediaBiasFactCheck(source, domain) {
    // Note: Media Bias/Fact Check doesn't have an official API
    // This would require web scraping - simplified implementation

    const url = `https://mediabiasfactcheck.com/?s=${encodeURIComponent(domain)}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(source.timeout)
    });

    if (!response.ok) {
      throw new Error(`Media Bias/Fact Check error: ${response.status}`);
    }

    const html = await response.text();

    // Parse Media Bias/Fact Check results (simplified)
    const rating = this.extractMediaBiasRating(html);
    const bias = this.extractMediaBias(html);

    return {
      source: 'Media Bias/Fact Check',
      rating: rating,
      bias: bias,
      factual_reporting: this.mapMediaBiasFactualReporting(rating),
      url: `https://mediabiasfactcheck.com/?s=${domain}`
    };
  }

  mapNewsGuardRating(rating) {
    const ratingMap = {
      'T': 'Trustworthy',
      'T+': 'Highly Trustworthy',
      'N': 'Not Trustworthy',
      'S': 'Satirical'
    };

    return ratingMap[rating] || 'Unknown';
  }

  extractMediaBiasRating(html) {
    // Look for rating indicators in HTML
    const ratingRegex = /credibility.?rating[^>]*>([^<]*)/i;
    const match = html.match(ratingRegex);

    if (match) {
      const ratingText = match[1].toLowerCase();

      if (ratingText.includes('high')) return 'high';
      if (ratingText.includes('mixed')) return 'mixed';
      if (ratingText.includes('low')) return 'low';
    }

    return 'unknown';
  }

  extractMediaBias(html) {
    // Look for bias indicators
    const biasRegex = /bias.?rating[^>]*>([^<]*)/i;
    const match = html.match(biasRegex);

    if (match) {
      return match[1].toLowerCase().trim();
    }

    // Fallback: check for common bias terms
    if (html.includes('left') || html.includes('liberal')) return 'left';
    if (html.includes('right') || html.includes('conservative')) return 'right';
    if (html.includes('center') || html.includes('moderate')) return 'center';

    return 'unknown';
  }

  mapMediaBiasFactualReporting(rating) {
    const ratingMap = {
      'high': 9,
      'mixed': 5,
      'low': 2,
      'unknown': 5
    };

    return ratingMap[rating] || 5;
  }

  calculateCredibilityScore(sources) {
    if (Object.keys(sources).length === 0) {
      return {
        score: 5,
        confidence: 'low',
        factors: ['No credibility data available']
      };
    }

    const scores = [];
    const factors = [];

    // NewsGuard score (if available)
    if (sources.NewsGuard) {
      scores.push(sources.NewsGuard.score);
      factors.push(`NewsGuard: ${sources.NewsGuard.rating} (${sources.NewsGuard.score}/100)`);
    }

    // Media Bias/Fact Check score (if available)
    if (sources['Media Bias/Fact Check']) {
      const score = sources['Media Bias/Fact Check'].factual_reporting;
      scores.push(score);
      factors.push(`Media Bias/Fact Check: ${sources['Media Bias/Fact Check'].rating} credibility`);
    }

    if (scores.length === 0) {
      return {
        score: 5,
        confidence: 'low',
        factors: ['Unable to determine credibility']
      };
    }

    const averageScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const confidence = scores.length > 1 ? 'high' : 'medium';

    return {
      score: Math.round(averageScore),
      confidence,
      factors
    };
  }

  // Additional domain checks (not from external APIs)
  async getDomainInfo(domain) {
    logger.debug('Getting domain information for:', domain);

    const info = {
      domain,
      age: await this.getDomainAge(domain),
      https: window.location.protocol === 'https:',
      alexa_rank: null, // Would need additional API
      similarweb_rank: null // Would need additional API
    };

    return info;
  }

  async getDomainAge(domain) {
    try {
      // Use WHOIS lookup (simplified - real implementation would use proper WHOIS service)
      const url = `https://who.is/whois/${domain}`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) return null;

      const html = await response.text();

      // Extract creation date from WHOIS data
      const creationRegex = /creation.date[^>]*>([^<]*)/i;
      const match = html.match(creationRegex);

      if (match) {
        const creationDate = new Date(match[1]);
        const now = new Date();
        const ageInYears = (now - creationDate) / (365 * 24 * 60 * 60 * 1000);

        return {
          years: Math.floor(ageInYears),
          created: creationDate.toISOString()
        };
      }

    } catch (error) {
      logger.error('Error getting domain age:', error);
    }

    return null;
  }

  // Batch domain checking
  async checkDomainsBatch(domains) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout for batch

    try {
      const response = await fetch(`${SERVER_CONFIG.baseUrl}/api/credibility/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': SERVER_CONFIG.apiKey
        },
        body: JSON.stringify({ domains }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('API key not configured - Please set up the backend server');
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Batch credibility check error: ${response.status} - ${errorData.error || 'Unknown error'}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Server returned unsuccessful response');
      }

      return data.data;

    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error('Batch credibility check timed out');
      }

      // Fallback to individual checks if batch fails
      const results = await Promise.allSettled(
        domains.map(domain => this.checkDomain(domain))
      );

      return results.map((result, index) => ({
        domain: domains[index],
        result: result.status === 'fulfilled' ? result.value : null,
        error: result.status === 'rejected' ? result.reason : null
      }));
    }
  }
}

// Export the class itself for use in other modules
export { CredibilityRouter };

// Create and export singleton instance
const credibilityRouter = new CredibilityRouter();
export default credibilityRouter;

// Make credibilityRouter available globally for content scripts
if (typeof window !== 'undefined') {
  window.CredibilityRouter = CredibilityRouter;
  window.credibilityRouter = credibilityRouter;
}
