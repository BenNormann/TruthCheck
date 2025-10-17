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
      ai: CONFIG.scoring.ai?.weight || 0.40,
      source_credibility: CONFIG.scoring.source_credibility?.weight || 0.30,
      scholarly: CONFIG.scoring.scholarly?.weight || 0.30
    };

    this.enabled = {
      ai: CONFIG.scoring.ai?.enabled !== false,
      source_credibility: CONFIG.scoring.source_credibility?.enabled !== false,
      scholarly: CONFIG.scoring.scholarly?.enabled !== false
    };
  }

  getAIClient() {
    if (!this._aiClient) {
      // Lazy initialization - use global aiServerClient instance if available
      if (typeof window !== 'undefined' && window.aiServerClient) {
        console.log('[SCORER] Using global aiServerClient instance');
        this._aiClient = window.aiServerClient;
      } else if (typeof window !== 'undefined' && window.aiClient) {
        console.log('[SCORER] Fallback to global aiClient instance');
        this._aiClient = window.aiClient;
      } else {
        console.error('[SCORER] ❌ AIClient not available in window object');
        throw new Error('AIClient not loaded. Make sure ai-server.js is imported in content.js');
      }
    }
    return this._aiClient;
  }

  async scoreClaim(normalizedClaim) {
    logger.log('Starting claim scoring for:', normalizedClaim.original_claim);

    const cacheKey = cache.generateKey('scores', cache.hashString(normalizedClaim.original_claim));
    const cached = await cache.get(cacheKey);

    if (cached) {
      console.log('[SCORER] Using cached scores for:', normalizedClaim.original_claim.substring(0, 50) + '...');
      logger.debug('Using cached scores');
      return cached;
    }

    console.log('[SCORER] No cached scores found, running fresh scoring for:', normalizedClaim.original_claim.substring(0, 50) + '...');
    console.log('[SCORER] Enabled scoring methods:', {
      ai: this.enabled.ai,
      source_credibility: this.enabled.source_credibility,
      scholarly: this.enabled.scholarly
    });

    const scores = {};
    const promises = [];

    // Score from source credibility (parallel)
    if (this.enabled.source_credibility) {
      console.log('[SCORER] Adding source credibility scoring');
      promises.push(this.scoreFromCredibility(normalizedClaim, scores));
    }

    // Score from scholarly sources with AI assessment (parallel)
    if (this.enabled.scholarly) {
      console.log('[SCORER] Adding scholarly scoring (using OpenAI via API server)');
      promises.push(this.scoreFromScholarly(normalizedClaim, scores));
    }

    // Score from AI assessment (parallel)
    if (this.enabled.ai) {
      console.log('[SCORER] Adding AI-based scoring');
      promises.push(this.scoreFromAI(normalizedClaim, scores));
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
      logger.debug('Scoring from AI assessment');
      
      const aiClient = this.getAIClient();
      
      // Get scholarly search results for evidence
      const searchResults = await this.scholar.searchClaim(
        normalizedClaim.original_claim,
        normalizedClaim.claim_type
      );

      console.log('[AI SCORING] Search results found:', searchResults.length);

      // Use AI to assess evidence from all sources (this is the main AI scoring)
      const assessment = await this.assessScholarlyEvidence(normalizedClaim, searchResults);

      scores.ai = {
        score: assessment.overall_score,
        confidence: assessment.confidence,
        assessment: assessment.assessment,
        findings: assessment.findings
      };

    } catch (error) {
      logger.error('AI scoring failed:', error);
      console.error('[AI SCORING] Error:', error);
      scores.ai = {
        score: 5,
        confidence: 'low',
        error: error.message
      };
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
      scores.source_credibility = {
        score: 5,
        confidence: 'low',
        error: error.message
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

      console.log('[SCHOLARLY] Search results found:', searchResults.length);

      // Simple scoring based on whether we found scholarly sources
      // Don't use AI here - that's for the AI component
      const scholarScore = this.scoreScholarlyResults(searchResults);

      scores.scholarly = {
        score: scholarScore.score,
        confidence: scholarScore.confidence,
        sources: searchResults.slice(0, 3), // Top 3 sources
        search_results_count: searchResults.length,
        assessment: scholarScore.assessment
      };

    } catch (error) {
      logger.error('Scholarly scoring failed:', error);
      console.error('[SCHOLARLY] Error:', error);
      scores.scholarly = {
        score: 5,
        confidence: 'low',
        error: error.message
      };
    }
  }

  scoreScholarlyResults(searchResults) {
    if (searchResults.length === 0) {
      return {
        score: 5,
        confidence: 'low',
        assessment: 'No scholarly sources found'
      };
    }

    // Score based on number and quality of results
    let score = 5; // Start neutral
    
    if (searchResults.length >= 5) {
      score = 8; // Good number of sources
    } else if (searchResults.length >= 3) {
      score = 7;
    } else if (searchResults.length >= 1) {
      score = 6;
    }

    return {
      score: score,
      confidence: searchResults.length >= 3 ? 'high' : 'medium',
      assessment: `Found ${searchResults.length} scholarly source${searchResults.length > 1 ? 's' : ''}`
    };
  }


  async assessScholarlyEvidence(normalizedClaim, searchResults) {
    console.log('[SCORING] Claim:', normalizedClaim.original_claim);
    console.log('[SCORING] Search results from extension:', searchResults.length);

    try {
      const aiClient = this.getAIClient();
      
      // First, try to get additional evidence from API server
      let allEvidence = [...searchResults];
      if (aiClient && typeof aiClient.searchEvidence === 'function') {
        console.log('[SCORING] Searching for additional evidence via API server...');
        try {
          const serverEvidence = await aiClient.searchEvidence(normalizedClaim.original_claim);
          if (serverEvidence && serverEvidence.length > 0) {
            console.log(`[SCORING] ✅ API server found ${serverEvidence.length} additional evidence items`);
            allEvidence = [...searchResults, ...serverEvidence];
          } else {
            console.log('[SCORING] API server found no additional evidence');
          }
        } catch (evidenceError) {
          console.warn('[SCORING] API evidence search failed, continuing with extension results:', evidenceError.message);
        }
      }

      console.log('[SCORING] Total evidence items:', allEvidence.length);

      // Handle case when no search results are available
      const resultsJson = allEvidence.length > 0 
        ? JSON.stringify(allEvidence.slice(0, 10)) 
        : '[]';

      const prompt = CONFIG.prompts.evidence_assessment
        .replace('{claim}', normalizedClaim.original_claim)
        .replace('{search_results_json}', resultsJson);

      // Use API server's scoreEvidence method if available
      if (aiClient && typeof aiClient.scoreEvidence === 'function') {
        console.log('[SCORING] Using API server scoreEvidence method');
        const assessment = await aiClient.scoreEvidence(normalizedClaim.original_claim, allEvidence);
        
        console.log('[SCORING] ✅ OpenAI score:', assessment.overall_score, '/10');
        console.log('[SCORING] Confidence:', assessment.confidence);
        console.log('[SCORING] Assessment:', assessment.assessment);
        
        return assessment;
      } else {
        // Fallback to direct query method
        console.log('[SCORING] Using fallback query method');
        const response = await aiClient.query(prompt, {
          temperature: 0.2,
          max_tokens: 1500
        });

        console.log('[SCORING] Raw AI response:', response);

        // Handle different response formats from AI client
        let assessment = null;
        if (typeof response === 'object' && response !== null) {
          if (response.content) {
            assessment = response.content;
          } else if (response.raw_response) {
            assessment = JSON.parse(response.raw_response);
          } else {
            assessment = response;
          }
        } else if (typeof response === 'string') {
          assessment = JSON.parse(response);
        }

        if (assessment && assessment.overall_score !== undefined) {
          console.log('[SCORING] ✅ AI score:', assessment.overall_score, '/10');
          console.log('[SCORING] Confidence:', assessment.confidence);
          console.log('[SCORING] Assessment:', assessment.assessment);
          return assessment;
        } else {
          console.log('[SCORING] ❌ Invalid response format:', assessment);
        }
      }

    } catch (error) {
      logger.error('Scholarly evidence assessment failed:', error);
      console.error('[SCORING] ❌ Error:', error);
    }

    // Fallback assessment based on result relevance
    console.log('[SCORING] Using fallback assessment');
    return this.fallbackEvidenceAssessment(normalizedClaim, searchResults);
  }

  fallbackEvidenceAssessment(normalizedClaim, searchResults) {
    let totalScore = 0;
    let validResults = 0;
    const similarities = [];

    for (const result of searchResults.slice(0, 5)) {
      // Simple relevance scoring based on title similarity
      const similarity = this.calculateTextSimilarity(normalizedClaim.original_claim, result.title || '');
      similarities.push({ result, similarity });

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
      findings: similarities.slice(0, 3).map(({ result, similarity }) => ({
        source_title: result.title || 'Unknown',
        support_level: 'neutral',
        score: Math.round(similarity * 10),
        recency_concern: result.year && result.year < 2010 ? 'outdated' : 'recent'
      }))
    };
  }


  calculateFinalScore(scores) {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const [component, data] of Object.entries(scores)) {
      if (data && typeof data.score === 'number') {
        const weight = this.weights[component] || 0;
        weightedSum += data.score * weight;
        totalWeight += weight;
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
