// Scorer - Combine scores from all sources with weighted averaging
import CONFIG from '../foundation/config.js';
import logger from '../foundation/logger.js';
import cache from '../foundation/cache.js';
// Import router instances instead of classes for browser extension compatibility
import scholarRouter from '../routers/scholar.js';
import credibilityRouter from '../routers/credibility.js';
// Using global AIClient instead of import for browser extension compatibility

class Scorer {
  constructor() {
    this.scholar = scholarRouter;
    this.credibility = credibilityRouter;
    this._aiClient = null;

    this.weights = {
      ai: CONFIG.scoring.ai.weight,
      source_credibility: CONFIG.scoring.source_credibility.weight,
      scholarly: CONFIG.scoring.scholarly.weight
    };

    this.enabled = {
      ai: CONFIG.scoring.ai.enabled,
      source_credibility: CONFIG.scoring.source_credibility.enabled,
      scholarly: CONFIG.scoring.scholarly.enabled
    };
  }

  getAIClient() {
    if (!this._aiClient) {
      // Lazy initialization - import AIClient properly
      const { AIClient, configureServer } = require('../routers/ai.js');

      // Configure server settings if available
      if (typeof window !== 'undefined' && window.SERVER_CONFIG) {
        configureServer(window.SERVER_CONFIG);
      }

      this._aiClient = new AIClient();
    }
    return this._aiClient;
  }

  async scoreClaim(normalizedClaim) {
    logger.log('Starting claim scoring for:', normalizedClaim.original_claim);

    const cacheKey = cache.generateKey('scores', cache.hashString(normalizedClaim.original_claim));
    const cached = await cache.get(cacheKey);

    if (cached) {
      logger.debug('Using cached scores');
      return cached;
    }

    const scores = {};
    const promises = [];

    // Score from AI analysis (parallel)
    if (this.enabled.ai) {
      promises.push(this.scoreFromAI(normalizedClaim, scores));
    }

    // Score from source credibility (parallel)
    if (this.enabled.source_credibility) {
      promises.push(this.scoreFromCredibility(normalizedClaim, scores));
    }

    // Score from scholarly sources (parallel)
    if (this.enabled.scholarly) {
      promises.push(this.scoreFromScholarly(normalizedClaim, scores));
    }

    // Execute all scoring in parallel
    await Promise.allSettled(promises);

    // Calculate final weighted score
    const finalScore = this.calculateFinalScore(scores);

    const result = {
      components: scores,
      final: finalScore,
      confidence: this.calculateOverallConfidence(scores),
      timestamp: Date.now()
    };

    await cache.set(cacheKey, result, 6); // Cache for 6 hours
    return result;
  }

  async scoreFromAI(normalizedClaim, scores) {
    try {
      logger.debug('Scoring from AI analysis');

      // Use AI to analyze the claim credibility
      const aiAssessment = await this.assessClaimWithAI(normalizedClaim);

      scores.ai = {
        score: aiAssessment.overall_score,
        confidence: aiAssessment.confidence,
        assessment: aiAssessment.assessment,
        reasoning: aiAssessment.reasoning
      };

      logger.debug('AI scoring successful:', aiAssessment.overall_score);

    } catch (error) {
      logger.error('AI scoring failed:', error);

      // If it's a server configuration issue, mark as not available
      if (error.message.includes('Backend server not configured') ||
          error.message.includes('Unable to connect to backend server')) {
        scores.ai = {
          score: 'n/a',
          confidence: 'none',
          error: 'Backend server not configured - Please set up the server with API keys'
        };
      } else {
        // For other errors, try fallback but log the real error
        logger.warn('Using fallback AI assessment due to error:', error.message);
        const fallback = this.fallbackAIAssessment(normalizedClaim);
        scores.ai = {
          score: fallback.overall_score,
          confidence: fallback.confidence,
          assessment: fallback.assessment,
          reasoning: fallback.reasoning,
          error: error.message,
          fallback: true
        };
      }
    }
  }

  async scoreFromCredibility(normalizedClaim, scores) {
    try {
      logger.debug('Scoring from source credibility');

      // Extract domain from current page
      const domain = window.location.hostname;

      const result = await this.credibility.checkDomain(domain);

      scores.source_credibility = {
        score: result.overall.score,
        confidence: result.overall.confidence,
        domain: domain,
        factors: result.overall.factors,
        sources: result.sources
      };
    } catch (error) {
      logger.error('Credibility scoring failed:', error);
      // Use tone-based fallback scoring
      const fallback = this.fallbackCredibilityAssessment(normalizedClaim);
      scores.source_credibility = {
        score: fallback.score,
        confidence: fallback.confidence,
        domain: window.location.hostname,
        factors: fallback.factors,
        error: error.message,
        fallback: true
      };
    }
  }

  async scoreFromScholarly(normalizedClaim, scores) {
    try {
      logger.debug('Scoring from scholarly sources');

      const searchResults = await this.scholar.searchClaim(
        normalizedClaim.original_claim,
        normalizedClaim.claim_type
      );

      if (searchResults.length === 0) {
        // Use fallback scoring for no results
        const fallback = this.fallbackScholarlyAssessment(normalizedClaim, []);
        scores.scholarly = {
          score: fallback.score,
          confidence: fallback.confidence,
          explanation: fallback.explanation,
          fallback: true
        };
        return;
      }

      // Use AI to assess evidence from search results
      const assessment = await this.assessScholarlyEvidence(normalizedClaim, searchResults);

      scores.scholarly = {
        score: assessment.overall_score,
        confidence: assessment.confidence,
        assessment: assessment.assessment,
        sources: searchResults.slice(0, 3), // Top 3 sources
        findings: assessment.findings
      };

    } catch (error) {
      logger.error('Scholarly scoring failed:', error);
      // Use fallback scoring for errors
      const fallback = this.fallbackScholarlyAssessment(normalizedClaim, []);
      scores.scholarly = {
        score: fallback.score,
        confidence: fallback.confidence,
        explanation: fallback.explanation,
        error: error.message,
        fallback: true
      };
    }
  }

  async assessClaimWithAI(normalizedClaim) {
    const prompt = CONFIG.prompts.ai_claim_assessment
      .replace('{claim}', normalizedClaim.original_claim)
      .replace('{claim_type}', normalizedClaim.claim_type || 'general');

    try {
      const response = await this.getAIClient().query(prompt, {
        temperature: 0.2,
        max_tokens: 1000
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
      logger.error('AI claim assessment failed:', error);
    }

    // Fallback assessment based on claim characteristics
    return this.fallbackAIAssessment(normalizedClaim);
  }

  fallbackAIAssessment(normalizedClaim) {
    // Simple heuristic-based assessment
    const claim = normalizedClaim.original_claim.toLowerCase();

    let score = 5; // Neutral baseline
    let confidence = 'medium';
    let reasoning = 'Basic heuristic analysis';

    // Check for sensational language (negative indicators)
    const sensationalWords = ['shocking', 'amazing', 'unbelievable', 'incredible', 'mind-blowing', 'astounding'];
    if (sensationalWords.some(word => claim.includes(word))) {
      score -= 2;
      reasoning = 'Sensational language suggests potential misinformation';
    }

    // Check for extraordinary claims (negative indicators)
    const extraordinaryWords = ['cure', 'miracle', 'revolutionary', 'breakthrough', 'never before', 'impossible'];
    if (extraordinaryWords.some(word => claim.includes(word))) {
      score -= 1;
      reasoning = 'Extraordinary claims require substantial evidence';
    }

    // Check for hedging language (reduces confidence)
    const hedgingWords = ['may', 'might', 'could', 'possibly', 'allegedly', 'supposedly'];
    if (hedgingWords.some(word => claim.includes(word))) {
      confidence = 'low';
      reasoning = 'Hedging language indicates uncertainty';
    }

    // Check for authoritative language (positive indicators)
    const authoritativeWords = ['studies show', 'research indicates', 'scientists found', 'experts agree'];
    if (authoritativeWords.some(phrase => claim.includes(phrase))) {
      score += 1;
      reasoning = 'Contains authoritative language suggesting credible sources';
    }

    // Check for specific numbers/data (positive indicators)
    const hasNumbers = /\d/.test(claim);
    const hasPercentages = claim.includes('%') || claim.includes('percent');
    if (hasNumbers && !hasPercentages) {
      score += 0.5; // Slight boost for quantified claims
    }

    return {
      overall_score: Math.max(1, Math.min(10, Math.round(score))),
      confidence: confidence,
      assessment: reasoning,
      reasoning: reasoning
    };
  }

  fallbackCredibilityAssessment(normalizedClaim) {
    // Use tone and content analysis for credibility fallback
    const claim = normalizedClaim.original_claim.toLowerCase();
    const claimType = normalizedClaim.claim_type || 'general';

    let score = 5; // Neutral baseline
    let confidence = 'medium';
    const factors = [];

    // Analyze tone for credibility indicators
    const negativeToneWords = ['conspiracy', 'hoax', 'fake', 'lie', 'scam', 'fraud', 'debunked'];
    const positiveToneWords = ['verified', 'confirmed', 'evidence-based', 'peer-reviewed', 'research'];

    const negativeCount = negativeToneWords.filter(word => claim.includes(word)).length;
    const positiveCount = positiveToneWords.filter(word => claim.includes(word)).length;

    if (negativeCount > 0) {
      score -= negativeCount * 1.5;
      factors.push(`${negativeCount} negative tone indicators`);
    }

    if (positiveCount > 0) {
      score += positiveCount * 1;
      factors.push(`${positiveCount} positive credibility indicators`);
    }

    // Adjust based on claim type
    switch (claimType) {
      case 'health':
      case 'scientific':
        // Scientific claims need stronger evidence, so more skeptical baseline
        score -= 1;
        confidence = 'low';
        factors.push('Scientific claim - requires strong evidence');
        break;
      case 'political':
        // Political claims are often more subjective
        confidence = 'low';
        factors.push('Political claim - often subjective');
        break;
      default:
        confidence = 'medium';
    }

    // Check for emotional manipulation
    const emotionalWords = ['outrageous', 'terrible', 'wonderful', 'horrible', 'amazing'];
    if (emotionalWords.some(word => claim.includes(word))) {
      score -= 1;
      factors.push('Emotional language detected');
    }

    return {
      score: Math.max(1, Math.min(10, Math.round(score))),
      confidence,
      factors
    };
  }

  fallbackScholarlyAssessment(normalizedClaim, searchResults) {
    // Fallback when no scholarly sources are available
    const claim = normalizedClaim.original_claim.toLowerCase();
    const claimType = normalizedClaim.claim_type || 'general';

    let score = 5;
    let confidence = 'low';
    let explanation = 'No scholarly sources available for verification';

    // Adjust based on claim characteristics
    if (claim.length < 50) {
      score = 3; // Short claims are harder to verify
      explanation = 'Short claim - limited context for verification';
    } else if (claim.length > 200) {
      score = 7; // Detailed claims often have more substance
      explanation = 'Detailed claim - more context available';
    }

    // Scientific/health claims typically need scholarly backing
    if (claimType === 'health' || claimType === 'scientific') {
      score -= 2;
      confidence = 'very_low';
      explanation = 'Scientific/health claim without scholarly backing';
    }

    // Check for data/numbers in claim
    if (/\d/.test(claim)) {
      score += 1; // Claims with numbers are more specific
      explanation += ' (contains specific data)';
    }

    return {
      score: Math.max(1, Math.min(10, score)),
      confidence,
      explanation
    };
  }

  async assessScholarlyEvidence(normalizedClaim, searchResults) {
    const resultsJson = JSON.stringify(searchResults.slice(0, 10)); // Limit to top 10

    const prompt = CONFIG.prompts.evidence_assessment
      .replace('{claim}', normalizedClaim.original_claim)
      .replace('{search_results_json}', resultsJson);

    try {
      const response = await this.getAIClient().query(prompt, {
        temperature: 0.2,
        max_tokens: 1500
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
      logger.error('Scholarly evidence assessment failed:', error);
    }

    // Fallback assessment based on result relevance
    return this.fallbackEvidenceAssessment(searchResults);
  }

  fallbackEvidenceAssessment(searchResults) {
    let totalScore = 0;
    let validResults = 0;

    for (const result of searchResults.slice(0, 5)) {
      // Simple relevance scoring based on title similarity
      const similarity = this.calculateTextSimilarity(normalizedClaim.original_claim, result.title);

      if (similarity > 0.3) {
        // Assume recent results are more relevant
        const year = result.year || new Date().getFullYear();
        const recency = Math.min(1, (year - 2000) / 20); // Normalize to 0-1

        totalScore += (similarity * 10 * recency);
        validResults++;
      }
    }

    const averageScore = validResults > 0 ? totalScore / validResults : 5;

    return {
      overall_score: Math.round(averageScore),
      confidence: validResults > 2 ? 'high' : 'medium',
      assessment: `Found ${validResults} relevant scholarly sources`,
      findings: searchResults.slice(0, 3).map(result => ({
        source_title: result.title,
        support_level: 'neutral',
        score: Math.round(similarity * 10),
        recency_concern: result.year && result.year < 2010 ? 'outdated' : 'recent'
      }))
    };
  }


  calculateFinalScore(scores) {
    let weightedSum = 0;
    let totalWeight = 0;
    const validComponents = [];

    for (const [component, data] of Object.entries(scores)) {
      if (data && data.score !== 'n/a' && typeof data.score === 'number') {
        const weight = this.weights[component] || 0;
        weightedSum += data.score * weight;
        totalWeight += weight;
        validComponents.push(component);
      }
    }

    if (totalWeight === 0) {
      return 5; // Neutral score if no valid scores
    }

    return Math.round(weightedSum / totalWeight);
  }

  calculateOverallConfidence(scores) {
    const confidences = Object.values(scores)
      .filter(data => data && data.confidence)
      .map(data => {
        switch (data.confidence) {
          case 'high': return 1;
          case 'medium': return 0.6;
          case 'low': return 0.3;
          default: return 0.5;
        }
      });

    if (confidences.length === 0) return 'low';

    const avgConfidence = confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length;

    if (avgConfidence >= 0.8) return 'high';
    if (avgConfidence >= 0.5) return 'medium';
    return 'low';
  }

  // Utility methods
  getArticleText() {
    // Get the full article text from the current page
    const articleSelectors = [
      'article',
      '[class*="article"]',
      '[class*="content"]',
      'main',
      '.post-content',
      '.entry-content'
    ];

    for (const selector of articleSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        const cloned = element.cloneNode(true);
        cloned.querySelectorAll('script, style, nav, header, footer, aside, .advertisement, .ads').forEach(el => el.remove());
        return cloned.textContent || cloned.innerText || '';
      }
    }

    return document.body.textContent || '';
  }

  extractRelevantExcerpt(articleText, claim) {
    // Find the claim in the article and extract surrounding context
    const claimIndex = articleText.toLowerCase().indexOf(claim.toLowerCase());

    if (claimIndex === -1) {
      return articleText.substring(0, 1000);
    }

    const start = Math.max(0, claimIndex - 500);
    const end = Math.min(articleText.length, claimIndex + claim.length + 500);

    return articleText.substring(start, end);
  }

  calculateTextSimilarity(text1, text2) {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  // Batch scoring for multiple claims
  async scoreClaimsBatch(normalizedClaims) {
    const results = await Promise.allSettled(
      normalizedClaims.map(claim => this.scoreClaim(claim))
    );

    return results.map((result, index) => ({
      claim: normalizedClaims[index],
      scores: result.status === 'fulfilled' ? result.value : null,
      error: result.status === 'rejected' ? result.reason : null
    }));
  }
}

// Create and export singleton instance
const scorer = new Scorer();
export default scorer;

// Make scorer available globally for content scripts
if (typeof window !== 'undefined') {
  window.Scorer = scorer;
}
