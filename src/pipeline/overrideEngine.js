// Override Engine - Check for exact matches on authoritative sources
import CONFIG from '../foundation/config.js';
import logger from '../foundation/logger.js';
import cache from '../foundation/cache.js';

class OverrideEngine {
  constructor() {
    this._aiClient = null;
    this.authoritativeSources = [
      'nih.gov',
      'cdc.gov',
      'who.int',
      'fda.gov',
      'britannica.com',
      'wikipedia.org',
      'scholar.google.com',
      'pubmed.ncbi.nlm.nih.gov'
    ];
  }

  getAIClient() {
    if (!this._aiClient) {
      // Lazy initialization - use global AIClient or fallback to require
      this._aiClient = (typeof window !== 'undefined' && window.AIClient)
        ? new window.AIClient()
        : new (require('../routers/ai.js').AIClient)();
    }
    return this._aiClient;
  }

  async checkOverride(normalizedClaim) {
    logger.debug('Checking for overrides for claim:', normalizedClaim.original_claim);

    // First check for exact matches in authoritative sources
    const exactMatches = await this.findExactMatches(normalizedClaim);

    if (exactMatches.length === 0) {
      return null; // No overrides found
    }

    // Validate each potential override
    const validOverrides = [];

    for (const match of exactMatches) {
      const validation = await this.validateOverride(normalizedClaim, match);

      if (validation.override_valid) {
        validOverrides.push({
          source: match.source,
          url: match.url,
          excerpt: match.excerpt,
          relationship: validation.relationship,
          confidence: validation.confidence,
          reasoning: validation.reasoning
        });
      }
    }

    if (validOverrides.length === 0) {
      return null;
    }

    // Select the highest confidence override
    const bestOverride = validOverrides.reduce((best, current) =>
      current.confidence > best.confidence ? current : best
    );

    logger.log('Found valid override:', bestOverride);

    return {
      type: 'authoritative_override',
      score: this.calculateOverrideScore(bestOverride.relationship),
      confidence: 'high',
      source: bestOverride.source,
      url: bestOverride.url,
      explanation: `Verified against ${bestOverride.source}: ${bestOverride.reasoning}`,
      relationship: bestOverride.relationship
    };
  }

  async findExactMatches(normalizedClaim) {
    const matches = [];

    // Search for exact claim matches in authoritative sources
    for (const source of this.authoritativeSources) {
      try {
        const sourceMatches = await this.searchSource(source, normalizedClaim);
        matches.push(...sourceMatches);
      } catch (error) {
        logger.error(`Error searching ${source}:`, error);
        continue;
      }
    }

    return matches;
  }

  async searchSource(source, normalizedClaim) {
    const matches = [];

    try {
      let searchUrl;

      switch (source) {
        case 'nih.gov':
          searchUrl = `https://search.nih.gov/search?utf8=✓&affiliate=nih&query=${encodeURIComponent(normalizedClaim.original_claim)}`;
          break;
        case 'cdc.gov':
          searchUrl = `https://search.cdc.gov/search?utf8=✓&affiliate=cdc-main&query=${encodeURIComponent(normalizedClaim.original_claim)}`;
          break;
        case 'who.int':
          searchUrl = `https://www.who.int/search?query=${encodeURIComponent(normalizedClaim.original_claim)}`;
          break;
        case 'fda.gov':
          searchUrl = `https://www.fda.gov/search?s=${encodeURIComponent(normalizedClaim.original_claim)}`;
          break;
        case 'britannica.com':
          searchUrl = `https://www.britannica.com/search?query=${encodeURIComponent(normalizedClaim.original_claim)}`;
          break;
        case 'wikipedia.org':
          searchUrl = `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(normalizedClaim.original_claim)}`;
          break;
        default:
          // For other sources, we'd need specific scraping logic
          return [];
      }

      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        throw new Error(`Search failed for ${source}`);
      }

      const html = await response.text();

      // Extract relevant snippets and URLs from search results
      const sourceMatches = await this.extractMatchesFromSearch(html, source, normalizedClaim);

      matches.push(...sourceMatches);

    } catch (error) {
      logger.error(`Error searching ${source}:`, error);
    }

    return matches;
  }

  async extractMatchesFromSearch(html, source, normalizedClaim) {
    const matches = [];

    // This is a simplified extraction - real implementation would be more sophisticated
    const claimLower = normalizedClaim.original_claim.toLowerCase();

    // Look for text that contains parts of the claim
    const textRegex = /<[^>]*>([^<]{50,200})<\/[^>]*>/g;
    let match;

    while ((match = textRegex.exec(html)) !== null) {
      const text = match[1];

      if (text.toLowerCase().includes(claimLower.substring(0, 50))) {
        // Found potentially relevant text
        const urlMatch = html.substring(0, match.index).match(/href="([^"]*)"/);
        const url = urlMatch ? this.resolveUrl(urlMatch[1], source) : null;

        if (url) {
          matches.push({
            source,
            url,
            excerpt: text.trim(),
            relevance: this.calculateRelevance(text, normalizedClaim.original_claim)
          });
        }
      }
    }

    // Filter for high relevance matches
    return matches.filter(m => m.relevance > 0.5).slice(0, 3);
  }

  resolveUrl(url, source) {
    if (url.startsWith('http')) {
      return url;
    }

    // Resolve relative URLs
    switch (source) {
      case 'nih.gov':
        return `https://nih.gov${url}`;
      case 'cdc.gov':
        return `https://cdc.gov${url}`;
      case 'who.int':
        return `https://who.int${url}`;
      case 'fda.gov':
        return `https://fda.gov${url}`;
      case 'britannica.com':
        return `https://britannica.com${url}`;
      case 'wikipedia.org':
        return `https://en.wikipedia.org${url}`;
      default:
        return url;
    }
  }

  calculateRelevance(text, claim) {
    const textLower = text.toLowerCase();
    const claimLower = claim.toLowerCase();

    // Simple relevance scoring based on word overlap
    const textWords = new Set(textLower.split(/\s+/));
    const claimWords = new Set(claimLower.split(/\s+/));

    const intersection = new Set([...textWords].filter(x => claimWords.has(x)));
    const union = new Set([...textWords, ...claimWords]);

    return intersection.size / union.size;
  }

  async validateOverride(normalizedClaim, match) {
    const prompt = CONFIG.prompts.override_validation
      .replace('{claim}', normalizedClaim.original_claim)
      .replace('{source_title}', match.source)
      .replace('{source_excerpt}', match.excerpt);

    try {
      const response = await this.getAIClient().query(prompt, {
        temperature: 0.2,
        max_tokens: 500
      });

      // Handle different response formats from AI client
      if (typeof response === 'object' && response !== null) {
        if (response.content) {
          return response.content;
        }
        if (response.raw_response) {
          return JSON.parse(response.raw_response);
        }
        // If it's already a parsed object, return it
        return response;
      }

      // If it's a string, try to parse as JSON
      if (typeof response === 'string') {
        return JSON.parse(response);
      }

    } catch (error) {
      logger.error('Override validation failed:', error);
    }

    // Fallback validation based on relevance
    return {
      addresses_same_topic: match.relevance > 0.6,
      relationship: match.relevance > 0.8 ? 'supports' : 'tangential',
      override_valid: match.relevance > 0.7,
      confidence: match.relevance,
      reasoning: `Relevance score: ${match.relevance.toFixed(2)}`
    };
  }

  calculateOverrideScore(relationship) {
    switch (relationship) {
      case 'supports':
        return 9; // High score for supporting evidence
      case 'contradicts':
        return 2; // Low score for contradicting evidence
      case 'tangential':
        return 5; // Neutral for tangential evidence
      default:
        return 5;
    }
  }

  // Check if a domain is authoritative
  isAuthoritativeDomain(domain) {
    return this.authoritativeSources.some(source =>
      domain.includes(source) || source.includes(domain)
    );
  }

  // Batch override checking for multiple claims
  async checkOverridesBatch(normalizedClaims) {
    const results = await Promise.allSettled(
      normalizedClaims.map(claim => this.checkOverride(claim))
    );

    return results.map((result, index) => ({
      claim: normalizedClaims[index],
      override: result.status === 'fulfilled' ? result.value : null,
      error: result.status === 'rejected' ? result.reason : null
    }));
  }
}

// Create and export singleton instance
const overrideEngine = new OverrideEngine();
export default overrideEngine;

// Make overrideEngine available globally for content scripts
if (typeof window !== 'undefined') {
  window.OverrideEngine = overrideEngine;
}
