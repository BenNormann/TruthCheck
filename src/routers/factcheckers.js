// Fact-Checker Router - Query multiple fact-checking sources in priority order
import CONFIG from '../foundation/config.js';
import logger from '../foundation/logger.js';
import cache from '../foundation/cache.js';

class FactCheckerRouter {
  constructor() {
    this.sources = CONFIG.apis.fact_checkers.filter(source => source.enabled);
    this.sortByPriority();
  }

  sortByPriority() {
    this.sources.sort((a, b) => a.priority - b.priority);
  }

  async checkClaim(claim) {
    logger.debug('Starting fact-check for claim:', claim);

    for (const source of this.sources) {
      try {
        logger.log(`Querying ${source.name} for claim: ${claim}`);

        const cacheKey = cache.getFactCheckKey(cache.hashString(claim), source.name);
        const cached = await cache.get(cacheKey);

        if (cached) {
          logger.debug(`Using cached result from ${source.name}`);
          return cached;
        }

        const result = await this.querySource(source, claim);

        if (result) {
          await cache.set(cacheKey, result, 24); // Cache for 24 hours
          return result;
        }
      } catch (error) {
        logger.error(`Error querying ${source.name}:`, error);
        continue; // Try next source
      }
    }

    logger.warn('No fact-check results found for claim:', claim);
    return null;
  }

  async querySource(source, claim) {
    logger.logRequest(source.url, 'GET', { claim });

    const startTime = performance.now();

    try {
      // Simple credibility check based on domain factors
      const result = await this.checkSourceCredibility(source, claim);

      const responseTime = performance.now() - startTime;
      logger.logResponse(source.url, 200, responseTime, result);

      return result;

    } catch (error) {
      const responseTime = performance.now() - startTime;
      logger.logResponse(source.url, 500, responseTime, { error: error.message });
      throw error;
    }
  }

  async checkSourceCredibility(source, claim) {
    // Simple credibility check based on basic web factors
    // No API calls - just check domain age, HTTPS, and publication date presence

    const url = new URL(source.url || window.location.href);
    const hostname = url.hostname;

    // Check HTTPS status (1 point if HTTPS, 0 if HTTP)
    const hasHttps = url.protocol === 'https:' ? 1 : 0;

    // Check for publication date (simple heuristic - look for common date patterns in page)
    const hasPublicationDate = await this.checkForPublicationDate();

    // Check domain age (simulate - in real implementation, you'd query WHOIS or similar)
    // For demo purposes, we'll use a simple heuristic based on TLD and common patterns
    const domainAgeScore = await this.estimateDomainAge(hostname);

    // Calculate overall credibility score (0-10 scale)
    const baseScore = 5; // Neutral baseline
    const httpsBonus = hasHttps * 2; // HTTPS worth 2 points
    const dateBonus = hasPublicationDate * 2; // Publication date worth 2 points
    const ageBonus = domainAgeScore; // Domain age contributes its score

    const totalScore = Math.min(10, baseScore + httpsBonus + dateBonus + ageBonus);

      return {
      source: source.name || 'Source Credibility Check',
      claim: claim,
      verdict: totalScore,
      confidence: 'medium',
      url: source.url || window.location.href,
      explanation: `HTTPS: ${hasHttps ? 'Yes (+2)' : 'No'}, Publication Date: ${hasPublicationDate ? 'Yes (+2)' : 'No'}, Domain Age Score: ${domainAgeScore}`,
      date: new Date().toISOString(),
      credibility_factors: {
        https: hasHttps,
        publication_date: hasPublicationDate,
        domain_age_score: domainAgeScore
      }
    };
  }

  async checkForPublicationDate() {
    try {
      // Simple heuristic to detect publication dates in the page
      const bodyText = document.body ? document.body.innerText : '';

      // Common date patterns (simplified)
      const datePatterns = [
        /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}\b/gi,
        /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g,
        /\b\d{4}-\d{1,2}-\d{1,2}\b/g,
        /published:\s+([a-z]+\s+\d{1,2},?\s+\d{4})/gi,
        /posted:\s+([a-z]+\s+\d{1,2},?\s+\d{4})/gi,
        /date:\s+([a-z]+\s+\d{1,2},?\s+\d{4})/gi
      ];

      for (const pattern of datePatterns) {
        if (pattern.test(bodyText)) {
          return true;
        }
      }

      // Check for common date-related meta tags
      const metaTags = document.getElementsByTagName('meta');
      for (let i = 0; i < metaTags.length; i++) {
        const name = metaTags[i].getAttribute('name') || metaTags[i].getAttribute('property');
        if (name && (name.includes('publish') || name.includes('date') || name.includes('time'))) {
          const content = metaTags[i].getAttribute('content');
          if (content && /\d{4}/.test(content)) {
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      logger.error('Error checking for publication date:', error);
      return false;
    }
  }

  async estimateDomainAge(hostname) {
    // Simple domain age estimation based on TLD and common patterns
    // In a real implementation, you'd query WHOIS data or use a domain age API

    // Common established domains get higher scores
    const establishedDomains = [
      'nytimes.com', 'washingtonpost.com', 'bbc.com', 'bbc.co.uk',
      'reuters.com', 'ap.org', 'npr.org', 'pbs.org', 'cnn.com',
      'foxnews.com', 'wsj.com', 'bloomberg.com', 'economist.com',
      'nature.com', 'sciencemag.org', 'nih.gov', 'cdc.gov',
      'who.int', 'un.org', 'whitehouse.gov', 'congress.gov'
    ];

    // Government and educational domains
    if (hostname.endsWith('.gov') || hostname.endsWith('.edu')) {
      return 3;
    }

    // Major news organizations
    if (establishedDomains.some(domain => hostname === domain || hostname.endsWith('.' + domain))) {
      return 3;
    }

    // Common reputable domains
    if (hostname.includes('edu') || hostname.includes('ac.') ||
        hostname.includes('university') || hostname.includes('college')) {
      return 2;
    }

    // Default for unknown domains
    return 1;
  }


  // Get all fact-check results for a claim (for batch processing)
  async checkClaimBatch(claims) {
    const results = await Promise.allSettled(
      claims.map(claim => this.checkClaim(claim))
    );

    return results.map((result, index) => ({
      claim: claims[index],
      result: result.status === 'fulfilled' ? result.value : null,
      error: result.status === 'rejected' ? result.reason : null
    }));
  }
}

// Export the class itself for use in other modules
export { FactCheckerRouter };

// Create and export singleton instance
const factCheckerRouter = new FactCheckerRouter();
export default factCheckerRouter;

// Make factCheckerRouter available globally for content scripts
if (typeof window !== 'undefined') {
  window.FactCheckerRouter = FactCheckerRouter;
  window.factCheckerRouter = factCheckerRouter;
}
