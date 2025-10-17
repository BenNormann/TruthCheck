// Scorer - Combine scores from all sources with weighted averaging
import CONFIG from '../foundation/config.js';
import logger from '../foundation/logger.js';
import cache from '../foundation/cache.js';
// Import router instances instead of classes for browser extension compatibility
import factCheckerRouter from '../routers/factcheckers.js';
import scholarRouter from '../routers/scholar.js';
import credibilityRouter from '../routers/credibility.js';
// Using global AIClient instead of import for browser extension compatibility

class Scorer {
  constructor() {
    this.factChecker = factCheckerRouter;
    this.scholar = scholarRouter;
    this.credibility = credibilityRouter;
    this._aiClient = null;

    this.weights = {
      fact_checker: CONFIG.scoring.fact_checker.weight,
      source_credibility: CONFIG.scoring.source_credibility.weight,
      scholarly: CONFIG.scoring.scholarly.weight,
      coherence: CONFIG.scoring.coherence.weight
    };

    this.enabled = {
      fact_checker: CONFIG.scoring.fact_checker.enabled,
      source_credibility: CONFIG.scoring.source_credibility.enabled,
      scholarly: CONFIG.scoring.scholarly.enabled,
      coherence: CONFIG.scoring.coherence.enabled
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
      fact_checker: this.enabled.fact_checker,
      source_credibility: this.enabled.source_credibility,
      scholarly: this.enabled.scholarly,
      coherence: this.enabled.coherence
    });

    const scores = {};
    const promises = [];

    // Score from fact-checkers (parallel)
    if (this.enabled.fact_checker) {
      console.log('[SCORER] Adding fact-checker scoring');
      promises.push(this.scoreFromFactCheckers(normalizedClaim, scores));
    }

    // Score from source credibility (parallel)
    if (this.enabled.source_credibility) {
      console.log('[SCORER] Adding source credibility scoring');
      promises.push(this.scoreFromCredibility(normalizedClaim, scores));
    }

    // Score from scholarly sources (parallel)
    if (this.enabled.scholarly) {
      console.log('[SCORER] Adding scholarly scoring (using OpenAI via API server)');
      promises.push(this.scoreFromScholarly(normalizedClaim, scores));
    }

    // Score from coherence analysis (parallel)
    if (this.enabled.coherence) {
      console.log('[SCORER] Adding coherence scoring');
      promises.push(this.scoreFromCoherence(normalizedClaim, scores));
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

  async scoreFromFactCheckers(normalizedClaim, scores) {
    try {
      logger.debug('Scoring from fact-checkers');
      const result = await this.factChecker.checkClaim(normalizedClaim.original_claim);

      if (result) {
        scores.fact_checker = {
          score: result.verdict,
          confidence: 'high',
          source: result.source,
          explanation: result.explanation,
          url: result.url,
          date: result.date
        };
      } else {
        scores.fact_checker = {
          score: 5, // Neutral when no fact-check found
          confidence: 'low',
          explanation: 'No fact-check results found'
        };
      }
    } catch (error) {
      logger.error('Fact-checker scoring failed:', error);
      scores.fact_checker = {
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

      // Use AI to assess evidence even if no search results
      // This allows AI to score based on claim content alone
      const assessment = await this.assessScholarlyEvidence(normalizedClaim, searchResults);

      scores.scholarly = {
        score: assessment.overall_score,
        confidence: assessment.confidence,
        assessment: assessment.assessment,
        sources: searchResults.slice(0, 3), // Top 3 sources
        findings: assessment.findings,
        search_results_count: searchResults.length
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

  async scoreFromCoherence(normalizedClaim, scores) {
    try {
      logger.debug('Scoring from coherence analysis');

      // Get article text for coherence analysis
      const articleText = this.getArticleText();

      const coherenceResult = await this.analyzeCoherence(articleText, normalizedClaim);

      scores.coherence = {
        score: coherenceResult.coherence_score,
        confidence: 'medium',
        red_flags: coherenceResult.red_flags_detected,
        manipulation_risk: coherenceResult.manipulation_risk,
        factors: coherenceResult.factors
      };

    } catch (error) {
      logger.error('Coherence scoring failed:', error);
      scores.coherence = {
        score: 5,
        confidence: 'low',
        error: error.message
      };
    }
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

  async analyzeCoherence(articleText, normalizedClaim) {
    // Extract a relevant excerpt around the claim
    const excerpt = this.extractRelevantExcerpt(articleText, normalizedClaim.original_claim);

    const prompt = CONFIG.prompts.red_flag_detection.replace('{article_excerpt}', excerpt);

    try {
      const response = await this.getAIClient().query(prompt, {
        temperature: 0.3,
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
      logger.error('Coherence analysis failed:', error);
    }

    // Fallback heuristic analysis
    return this.fallbackCoherenceAnalysis(excerpt);
  }

  fallbackCoherenceAnalysis(excerpt) {
    const redFlags = [];

    // Check for sensationalism
    if (excerpt.includes('SHOCKING') || excerpt.includes('AMAZING') || excerpt.includes('UNBELIEVABLE')) {
      redFlags.push({
        flag_type: 'sensationalism',
        severity: 3,
        example: 'Sensational language detected',
        significance: 'May indicate clickbait or exaggeration'
      });
    }

    // Check for extraordinary claims
    if (excerpt.includes('cure') || excerpt.includes('miracle') || excerpt.includes('revolutionary')) {
      redFlags.push({
        flag_type: 'extraordinary_claim',
        severity: 4,
        example: 'Extraordinary claim without evidence',
        significance: 'Requires substantial evidence to be credible'
      });
    }

    // Check for vague attribution
    if (excerpt.includes('sources say') || excerpt.includes('experts claim') || excerpt.includes('studies show')) {
      redFlags.push({
        flag_type: 'vague_attribution',
        severity: 2,
        example: 'Vague source attribution',
        significance: 'Specific sources would increase credibility'
      });
    }

    const coherenceScore = Math.max(1, 10 - (redFlags.length * 2));
    const manipulationRisk = redFlags.reduce((sum, flag) => sum + flag.severity, 0);

    return {
      red_flags_detected: redFlags,
      coherence_score: coherenceScore,
      manipulation_risk: Math.min(10, manipulationRisk),
      factors: [`${redFlags.length} red flags detected`]
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
