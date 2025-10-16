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
      let result;

      switch (source.name) {
        case 'Google Fact Check':
          result = await this.queryGoogleFactCheck(source, claim);
          break;
        case 'Snopes':
          result = await this.querySnopes(source, claim);
          break;
        case 'FactCheck.org':
          result = await this.queryFactCheckOrg(source, claim);
          break;
        default:
          throw new Error(`Unsupported fact-checker: ${source.name}`);
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

  async queryGoogleFactCheck(source, claim) {
    // Note: Google Fact Check API requires API key and has specific format
    // This is a simplified implementation - real implementation would use actual API

    const searchQuery = encodeURIComponent(claim);
    const url = `${source.url}search?q=${searchQuery}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${source.api_key}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(source.timeout)
    });

    if (!response.ok) {
      throw new Error(`Google Fact Check API error: ${response.status}`);
    }

    const data = await response.json();

    // Parse Google Fact Check response format
    if (data.claims && data.claims.length > 0) {
      const claimReview = data.claims[0];

      return {
        source: 'Google Fact Check',
        claim: claimReview.text,
        verdict: this.mapGoogleVerdict(claimReview.claimReview[0].textualRating),
        confidence: 'high',
        url: claimReview.claimReview[0].url,
        explanation: claimReview.claimReview[0].textualRating,
        date: claimReview.claimReview[0].reviewDate
      };
    }

    return null;
  }

  async querySnopes(source, claim) {
    // Simplified Snopes API query - real implementation would use actual API
    const searchQuery = encodeURIComponent(claim);
    const url = `${source.url}search/${searchQuery}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(source.timeout)
    });

    if (!response.ok) {
      throw new Error(`Snopes API error: ${response.status}`);
    }

    const data = await response.json();

    // Parse Snopes response format
    if (data.articles && data.articles.length > 0) {
      const article = data.articles[0];

      return {
        source: 'Snopes',
        claim: article.claim,
        verdict: this.mapSnopesVerdict(article.rating),
        confidence: 'high',
        url: article.url,
        explanation: article.explanation,
        date: article.date
      };
    }

    return null;
  }

  async queryFactCheckOrg(source, claim) {
    // Simplified FactCheck.org API query
    const searchQuery = encodeURIComponent(claim);
    const url = `${source.url}search?q=${searchQuery}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(source.timeout)
    });

    if (!response.ok) {
      throw new Error(`FactCheck.org API error: ${response.status}`);
    }

    const data = await response.json();

    // Parse FactCheck.org response format
    if (data.factchecks && data.factchecks.length > 0) {
      const factcheck = data.factchecks[0];

      return {
        source: 'FactCheck.org',
        claim: factcheck.claim,
        verdict: this.mapFactCheckOrgVerdict(factcheck.verdict),
        confidence: 'high',
        url: factcheck.url,
        explanation: factcheck.summary,
        date: factcheck.date
      };
    }

    return null;
  }

  mapGoogleVerdict(rating) {
    const verdictMap = {
      'True': 10,
      'Mostly True': 8,
      'Half True': 5,
      'Mostly False': 3,
      'False': 1,
      'Pants on Fire': 0
    };

    return verdictMap[rating] || 5;
  }

  mapSnopesVerdict(rating) {
    const verdictMap = {
      'true': 10,
      'mostly-true': 8,
      'mixture': 5,
      'mostly-false': 3,
      'false': 1,
      'outdated': 4,
      'unproven': 5
    };

    return verdictMap[rating] || 5;
  }

  mapFactCheckOrgVerdict(verdict) {
    const verdictMap = {
      'correct': 10,
      'mostly-correct': 8,
      'partial': 5,
      'mostly-incorrect': 3,
      'incorrect': 1,
      'unsupported': 2
    };

    return verdictMap[verdict] || 5;
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

// Create and export singleton instance
const factCheckerRouter = new FactCheckerRouter();
export default factCheckerRouter;

// Make factCheckerRouter available globally for content scripts
if (typeof window !== 'undefined') {
  window.FactCheckerRouter = factCheckerRouter;
}
