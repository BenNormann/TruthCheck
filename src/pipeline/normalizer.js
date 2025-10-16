// Claim Normalizer - Normalize claims for better search queries and entity extraction
import CONFIG from '../foundation/config.js';
import logger from '../foundation/logger.js';
import cache from '../foundation/cache.js';
import AIClient from '../routers/ai.js';

class ClaimNormalizer {
  constructor() {
    this.aiClient = new AIClient();
  }

  async normalize(claim) {
    logger.debug('Normalizing claim:', claim);

    const cacheKey = cache.getNormalizedClaimKey(claim);
    const cached = await cache.get(cacheKey);

    if (cached) {
      logger.debug('Using cached normalization');
      return cached;
    }

    // First, try heuristic normalization
    const heuristicResult = this.normalizeHeuristic(claim);

    // If we have high confidence entities, use heuristic result
    if (heuristicResult.entities.length > 0 && heuristicResult.confidence > 0.7) {
      logger.debug('Using heuristic normalization');
      await cache.set(cacheKey, heuristicResult, 168); // Cache for 1 week
      return heuristicResult;
    }

    // Otherwise, use AI normalization
    logger.debug('Using AI normalization');
    const aiResult = await this.normalizeAI(claim);

    // Combine results, preferring AI for entities but keeping heuristic structure
    const combinedResult = {
      ...heuristicResult,
      ...aiResult,
      entities: [...new Set([...heuristicResult.entities, ...aiResult.entities])],
      confidence: Math.max(heuristicResult.confidence, aiResult.confidence || 0.5)
    };

    await cache.set(cacheKey, combinedResult, 168); // Cache for 1 week
    return combinedResult;
  }

  normalizeHeuristic(claim) {
    const result = {
      original_claim: claim,
      normalized_claim: this.simplifyClaim(claim),
      entities: this.extractEntities(claim),
      search_queries: this.buildSearchQueries(claim),
      claim_type: this.classifyClaimType(claim),
      confidence: 0.5
    };

    // Boost confidence if we found good entities
    if (result.entities.length > 0) {
      result.confidence = 0.8;
    }

    return result;
  }

  async normalizeAI(claim) {
    const prompt = CONFIG.prompts.query_normalization.replace('{claim}', claim);

    try {
      const response = await this.aiClient.query(prompt, {
        temperature: 0.1,
        max_tokens: 1000
      });

      if (response.content) {
        return {
          original_claim: claim,
          normalized_claim: response.content.normalized_claim || this.simplifyClaim(claim),
          entities: response.content.key_entities || this.extractEntities(claim),
          search_queries: response.content.search_queries || this.buildSearchQueries(claim),
          claim_type: response.content.claim_type || this.classifyClaimType(claim),
          confidence: response.content.confidence || 0.7,
          ai_generated: true
        };
      }

      if (response.raw_response) {
        try {
          const parsed = JSON.parse(response.raw_response);
          return {
            original_claim: claim,
            normalized_claim: parsed.normalized_claim || this.simplifyClaim(claim),
            entities: parsed.key_entities || this.extractEntities(claim),
            search_queries: parsed.search_queries || this.buildSearchQueries(claim),
            claim_type: parsed.claim_type || this.classifyClaimType(claim),
            confidence: 0.7,
            ai_generated: true
          };
        } catch (error) {
          logger.error('Failed to parse AI normalization response:', error);
        }
      }

    } catch (error) {
      logger.error('AI normalization failed:', error);
    }

    // Fallback to heuristic
    return this.normalizeHeuristic(claim);
  }

  simplifyClaim(claim) {
    // Remove unnecessary words and normalize for search
    let simplified = claim.toLowerCase();

    // Remove common filler words
    const fillerWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
    fillerWords.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'g');
      simplified = simplified.replace(regex, '');
    });

    // Remove extra whitespace
    simplified = simplified.replace(/\s+/g, ' ').trim();

    // Remove punctuation except for important chars
    simplified = simplified.replace(/[^\w\s\-+%$]/g, '');

    return simplified;
  }

  extractEntities(claim) {
    const entities = [];

    // Extract numbers and percentages
    const numberRegex = /(\d+(?:\.\d+)?)\s*(%|percent|million|billion|thousand)?/g;
    let match;
    while ((match = numberRegex.exec(claim)) !== null) {
      entities.push({
        type: 'number',
        value: match[1],
        unit: match[2] || '',
        text: match[0]
      });
    }

    // Extract quoted phrases
    const quoteRegex = /"([^"]+)"/g;
    while ((match = quoteRegex.exec(claim)) !== null) {
      entities.push({
        type: 'quote',
        value: match[1],
        text: match[0]
      });
    }

    // Extract capitalized words (potential proper nouns)
    const capitalRegex = /\b([A-Z][a-z]+)\b/g;
    while ((match = capitalRegex.exec(claim)) !== null) {
      const word = match[1];
      // Skip common words that are often capitalized
      if (!['The', 'A', 'An', 'And', 'Or', 'But', 'In', 'On', 'At', 'To', 'For', 'Of', 'With', 'By'].includes(word)) {
        entities.push({
          type: 'proper_noun',
          value: word,
          text: word
        });
      }
    }

    // Extract scientific/medical terms
    const scientificTerms = /\b(vaccine|virus|COVID|coronavirus|pandemic|epidemic|clinical|trial|study|research)\b/gi;
    while ((match = scientificTerms.exec(claim)) !== null) {
      entities.push({
        type: 'scientific',
        value: match[0],
        text: match[0]
      });
    }

    return entities;
  }

  buildSearchQueries(claim) {
    const queries = [];

    // Basic query
    queries.push(claim);

    // Query without common words
    const simplified = this.simplifyClaim(claim);
    if (simplified !== claim) {
      queries.push(simplified);
    }

    // Query with key entities
    const entities = this.extractEntities(claim);
    if (entities.length > 0) {
      const entityTexts = entities.map(e => e.text).join(' ');
      queries.push(entityTexts);
    }

    return queries.slice(0, 3); // Limit to 3 queries
  }

  classifyClaimType(claim) {
    const lowerClaim = claim.toLowerCase();

    if (lowerClaim.includes('vaccine') || lowerClaim.includes('covid') || lowerClaim.includes('virus') || lowerClaim.includes('pandemic')) {
      return 'health';
    }

    if (lowerClaim.includes('election') || lowerClaim.includes('vote') || lowerClaim.includes('president') || lowerClaim.includes('government') || lowerClaim.includes('policy')) {
      return 'political';
    }

    if (lowerClaim.includes('study') || lowerClaim.includes('research') || lowerClaim.includes('experiment') || lowerClaim.includes('data') || lowerClaim.includes('statistics')) {
      return 'scientific';
    }

    if (lowerClaim.includes('climate') || lowerClaim.includes('environment') || lowerClaim.includes('temperature') || lowerClaim.includes('global warming')) {
      return 'environmental';
    }

    if (lowerClaim.includes('economy') || lowerClaim.includes('money') || lowerClaim.includes('market') || lowerClaim.includes('business')) {
      return 'economic';
    }

    return 'other';
  }

  // Batch normalization for multiple claims
  async normalizeBatch(claims) {
    const results = await Promise.allSettled(
      claims.map(claim => this.normalize(claim))
    );

    return results.map((result, index) => ({
      original_claim: claims[index],
      normalized: result.status === 'fulfilled' ? result.value : null,
      error: result.status === 'rejected' ? result.reason : null
    }));
  }

  // Get statistics about normalized claims
  getNormalizationStats(claims) {
    const stats = {
      total: claims.length,
      types: {},
      entities: 0,
      avg_confidence: 0
    };

    let totalConfidence = 0;

    claims.forEach(claim => {
      // Count by type
      const type = claim.claim_type || 'other';
      stats.types[type] = (stats.types[type] || 0) + 1;

      // Count entities
      stats.entities += claim.entities?.length || 0;

      // Sum confidence
      totalConfidence += claim.confidence || 0;
    });

    stats.avg_confidence = claims.length > 0 ? totalConfidence / claims.length : 0;

    return stats;
  }
}

// Create and export singleton instance
const claimNormalizer = new ClaimNormalizer();
export default claimNormalizer;

// Make claimNormalizer available globally for content scripts
if (typeof window !== 'undefined') {
  window.ClaimNormalizer = claimNormalizer;
}
