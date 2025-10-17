// Scholar Router - Query academic sources (Scholar, PubMed, Britannica, arXiv)
import CONFIG from '../foundation/config.js';
import logger from '../foundation/logger.js';
import cache from '../foundation/cache.js';

class ScholarRouter {
  constructor() {
    this.sources = CONFIG.apis.scholar_sources.filter(source => source.enabled);
    this.sortByPriority();
  }

  sortByPriority() {
    this.sources.sort((a, b) => a.priority - b.priority);
  }

  async searchClaim(claim, claimType = 'other') {
    logger.debug('Starting scholar search for claim:', claim);

    const results = [];

    for (const source of this.sources) {
      try {
        logger.log(`Searching ${source.name} for claim: ${claim}`);

        const cacheKey = cache.getScholarKey(cache.hashString(claim), source.name);
        const cached = await cache.get(cacheKey);

        if (cached) {
          logger.debug(`Using cached scholar result from ${source.name}`);
          results.push(...cached);
          continue;
        }

        const sourceResults = await this.querySource(source, claim, claimType);

        if (sourceResults && sourceResults.length > 0) {
          await cache.set(cacheKey, sourceResults, 48); // Cache for 48 hours
          results.push(...sourceResults);
        }
      } catch (error) {
        logger.error(`Error querying ${source.name}:`, error);
        continue; // Try next source
      }
    }

    logger.log(`Found ${results.length} scholar results for claim`);
    return results;
  }

  async querySource(source, claim, claimType) {
    logger.logRequest(source.url, 'GET', { claim, claimType });

    const startTime = performance.now();

    try {
      let results;

      switch (source.name) {
        case 'Google Scholar':
          results = await this.queryGoogleScholar(source, claim, claimType);
          break;
        case 'PubMed':
          results = await this.queryPubMed(source, claim, claimType);
          break;
        case 'Britannica':
          results = await this.queryBritannica(source, claim, claimType);
          break;
        case 'arXiv':
          results = await this.queryArXiv(source, claim, claimType);
          break;
        default:
          throw new Error(`Unsupported scholar source: ${source.name}`);
      }

      const responseTime = performance.now() - startTime;
      logger.logResponse(source.url, 200, responseTime, { resultCount: results.length });

      return results;

    } catch (error) {
      const responseTime = performance.now() - startTime;
      logger.logResponse(source.url, 500, responseTime, { error: error.message });
      throw error;
    }
  }

  async queryGoogleScholar(source, claim, claimType) {
    // Note: Google Scholar scraping requires careful handling due to terms of service
    // This is a simplified implementation - real implementation would use official API if available

    const searchQuery = this.buildGoogleScholarQuery(claim, claimType);
    const url = `https://scholar.google.com/scholar?q=${encodeURIComponent(searchQuery)}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(source.timeout)
    });

    if (!response.ok) {
      throw new Error(`Google Scholar error: ${response.status}`);
    }

    const html = await response.text();

    // Parse Google Scholar results (simplified)
    const results = [];
    const resultRegex = /<h3[^>]*>.*?href="([^"]*)"[^>]*>([^<]*)<\/a>/g;
    let match;

    while ((match = resultRegex.exec(html)) !== null && results.length < 5) {
      results.push({
        source: 'Google Scholar',
        title: match[2].trim(),
        url: match[1],
        snippet: this.extractSnippet(html, match.index),
        year: this.extractYear(html, match.index),
        authors: this.extractAuthors(html, match.index),
        citations: this.extractCitations(html, match.index)
      });
    }

    return results;
  }

  async queryPubMed(source, claim, claimType) {
    if (claimType !== 'health') {
      return []; // PubMed only for health claims
    }

    const searchQuery = this.buildPubMedQuery(claim);
    const url = `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(searchQuery)}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(source.timeout)
    });

    if (!response.ok) {
      throw new Error(`PubMed error: ${response.status}`);
    }

    const html = await response.text();

    // Parse PubMed results (simplified)
    const results = [];
    const resultRegex = /<a[^>]*class="doc-title"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g;
    let match;

    while ((match = resultRegex.exec(html)) !== null && results.length < 5) {
      results.push({
        source: 'PubMed',
        title: match[2].trim(),
        url: `https://pubmed.ncbi.nlm.nih.gov${match[1]}`,
        snippet: this.extractPubMedSnippet(html, match.index),
        year: this.extractPubMedYear(html, match.index),
        authors: this.extractPubMedAuthors(html, match.index)
      });
    }

    return results;
  }

  async queryBritannica(source, claim, claimType) {
    const searchQuery = this.buildBritannicaQuery(claim);
    const url = `https://www.britannica.com/search?query=${encodeURIComponent(searchQuery)}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(source.timeout)
    });

    if (!response.ok) {
      throw new Error(`Britannica error: ${response.status}`);
    }

    const html = await response.text();

    // Parse Britannica results (simplified)
    const results = [];
    const resultRegex = /<h3[^>]*>.*?href="([^"]*)"[^>]*>([^<]*)<\/a>/g;
    let match;

    while ((match = resultRegex.exec(html)) !== null && results.length < 3) {
      results.push({
        source: 'Britannica',
        title: match[2].trim(),
        url: `https://www.britannica.com${match[1]}`,
        snippet: this.extractBritannicaSnippet(html, match.index),
        type: 'encyclopedia'
      });
    }

    return results;
  }

  async queryArXiv(source, claim, claimType) {
    if (claimType !== 'scientific') {
      return []; // arXiv only for scientific claims
    }

    const searchQuery = this.buildArXivQuery(claim);
    const url = `https://arxiv.org/search/?query=${encodeURIComponent(searchQuery)}&searchtype=all`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(source.timeout)
    });

    if (!response.ok) {
      throw new Error(`arXiv error: ${response.status}`);
    }

    const html = await response.text();

    // Parse arXiv results (simplified)
    const results = [];
    const resultRegex = /<p[^>]*class="title[^"]*"[^>]*>.*?href="([^"]*)"[^>]*>([^<]*)<\/a>/g;
    let match;

    while ((match = resultRegex.exec(html)) !== null && results.length < 5) {
      results.push({
        source: 'arXiv',
        title: match[2].trim(),
        url: `https://arxiv.org${match[1]}`,
        snippet: this.extractArXivSnippet(html, match.index),
        year: this.extractArXivYear(html, match.index),
        authors: this.extractArXivAuthors(html, match.index)
      });
    }

    return results;
  }

  // Query building helpers
  buildGoogleScholarQuery(claim, claimType) {
    const baseQuery = claim.replace(/[^\w\s]/g, ' ').trim();
    const typeTerms = {
      health: 'medicine OR clinical OR medical',
      scientific: 'science OR research OR study',
      political: 'politics OR policy OR government'
    };

    const typeQuery = typeTerms[claimType] || '';
    return typeQuery ? `${baseQuery} ${typeQuery}` : baseQuery;
  }

  buildPubMedQuery(claim) {
    return claim.replace(/[^\w\s]/g, ' ').trim();
  }

  buildBritannicaQuery(claim) {
    return claim.replace(/[^\w\s]/g, ' ').trim();
  }

  buildArXivQuery(claim) {
    return claim.replace(/[^\w\s]/g, ' ').trim();
  }

  // Snippet extraction helpers (simplified implementations)
  extractSnippet(html, index) {
    // Simplified snippet extraction - real implementation would be more sophisticated
    const start = Math.max(0, index - 200);
    const end = Math.min(html.length, index + 300);
    return html.substring(start, end).replace(/<[^>]*>/g, '').trim();
  }

  extractPubMedSnippet(html, index) {
    return this.extractSnippet(html, index);
  }

  extractBritannicaSnippet(html, index) {
    return this.extractSnippet(html, index);
  }

  extractArXivSnippet(html, index) {
    return this.extractSnippet(html, index);
  }

  extractYear(html, index) {
    // Simplified year extraction
    const yearRegex = /(\d{4})/g;
    const matches = html.substring(index, index + 500).match(yearRegex);
    return matches ? matches[0] : null;
  }

  extractPubMedYear(html, index) {
    return this.extractYear(html, index);
  }

  extractArXivYear(html, index) {
    return this.extractYear(html, index);
  }

  extractAuthors(html, index) {
    // Simplified author extraction
    const authorRegex = /([A-Z][a-z]+ [A-Z]\.)/g;
    const matches = html.substring(index, index + 300).match(authorRegex);
    return matches ? matches.slice(0, 3) : [];
  }

  extractPubMedAuthors(html, index) {
    return this.extractAuthors(html, index);
  }

  extractArXivAuthors(html, index) {
    return this.extractAuthors(html, index);
  }

  extractCitations(html, index) {
    // Simplified citation extraction
    const citeRegex = /Cited by (\d+)/g;
    const match = html.substring(index, index + 300).match(citeRegex);
    return match ? parseInt(match[1]) : 0;
  }

  // Batch search for multiple claims
  async searchClaimsBatch(claims, claimTypes = []) {
    const results = await Promise.allSettled(
      claims.map((claim, index) =>
        this.searchClaim(claim, claimTypes[index] || 'other')
      )
    );

    return results.map((result, index) => ({
      claim: claims[index],
      results: result.status === 'fulfilled' ? result.value : [],
      error: result.status === 'rejected' ? result.reason : null
    }));
  }
}

// Export the class itself for use in other modules
export { ScholarRouter };

// Create and export singleton instance
const scholarRouter = new ScholarRouter();
export default scholarRouter;

// Make scholarRouter available globally for content scripts
if (typeof window !== 'undefined') {
  window.ScholarRouter = ScholarRouter;
  window.scholarRouter = scholarRouter;
}
