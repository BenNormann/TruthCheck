// Claim Extractor - Extract factual claims from text using heuristic and AI methods
import CONFIG from '../foundation/config.js';
import logger from '../foundation/logger.js';
import cache from '../foundation/cache.js';
import AIClient from '../routers/ai.js';

class ClaimExtractor {
  constructor() {
    this.aiClient = new AIClient();
    this.method = CONFIG.claim_extraction.method;
    this.heuristicThreshold = CONFIG.claim_extraction.heuristic_threshold;
    this.factualVerbs = new Set(CONFIG.claim_extraction.factual_verbs);
    this.claimMarkers = new Set(CONFIG.claim_extraction.claim_markers);
    this.minLength = CONFIG.claim_extraction.min_claim_length;
    this.maxLength = CONFIG.claim_extraction.max_claim_length;
    this.sentenceEndings = new Set(CONFIG.claim_extraction.sentence_endings);
  }

  async extractClaims(text) {
    logger.log('Starting claim extraction from text length:', text.length);

    // First, try heuristic extraction
    const heuristicClaims = this.extractClaimsHeuristic(text);

    if (this.method === 'heuristic') {
      return heuristicClaims;
    }

    // For hybrid method, evaluate heuristic confidence
    const heuristicConfidence = this.evaluateHeuristicConfidence(heuristicClaims, text);

    if (heuristicConfidence >= this.heuristicThreshold) {
      logger.debug('Using heuristic extraction (confidence sufficient)');
      return heuristicClaims;
    }

    // Fall back to AI extraction if heuristic confidence is too low
    logger.debug('Using AI extraction (heuristic confidence too low)');
    const aiClaims = await this.extractClaimsAI(text);

    // Combine and deduplicate
    return this.combineAndDeduplicateClaims(heuristicClaims, aiClaims);
  }

  extractClaimsHeuristic(text) {
    const claims = [];

    // Split text into sentences
    const sentences = this.splitIntoSentences(text);

    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim();

      // Skip if too short or too long
      if (trimmedSentence.length < this.minLength || trimmedSentence.length > this.maxLength) {
        continue;
      }

      // Check if sentence looks like a factual claim
      const confidence = this.scoreClaimLikelihood(trimmedSentence);

      if (confidence >= 0.3) { // Minimum confidence threshold
        claims.push({
          text: trimmedSentence,
          confidence,
          method: 'heuristic',
          position: text.indexOf(trimmedSentence)
        });
      }
    }

    // Sort by confidence and return top claims
    return claims
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 20); // Limit to top 20 claims
  }

  async extractClaimsAI(text) {
    const cacheKey = cache.getClaimKey(text);
    const cached = await cache.get(cacheKey);

    if (cached) {
      logger.debug('Using cached AI claim extraction');
      return cached;
    }

    // Use AI to extract claims from text
    const prompt = `Extract factual claims from the following text. Focus on specific, verifiable statements that could be fact-checked.

Text:
${text.substring(0, 3000)} ${text.length > 3000 ? '... [truncated]' : ''}

Return a JSON array of claim objects with:
- text: the claim text
- confidence: 0-1 score of how likely this is a factual claim
- type: "statistical", "causal", "definitional", "historical", "scientific", or "other"

Example response format:
[
  {
    "text": "COVID-19 vaccines reduce hospitalization by 85%",
    "confidence": 0.9,
    "type": "statistical"
  }
]

Return only valid JSON array:`;

    try {
      const response = await this.aiClient.query(prompt, {
        temperature: 0.1,
        max_tokens: 1500
      });

      let claims = [];

      if (response.content && Array.isArray(response.content)) {
        claims = response.content.map(claim => ({
          text: claim.text,
          confidence: claim.confidence || 0.5,
          method: 'ai',
          type: claim.type || 'other',
          position: text.indexOf(claim.text)
        }));
      } else if (response.raw_response) {
        // Fallback: try to parse as JSON
        try {
          const parsed = JSON.parse(response.raw_response);
          if (Array.isArray(parsed)) {
            claims = parsed.map(claim => ({
              text: claim.text,
              confidence: claim.confidence || 0.5,
              method: 'ai',
              type: claim.type || 'other',
              position: text.indexOf(claim.text)
            }));
          }
        } catch (error) {
          logger.error('Failed to parse AI claim extraction response:', error);
        }
      }

      await cache.set(cacheKey, claims, 12); // Cache for 12 hours
      return claims;

    } catch (error) {
      logger.error('AI claim extraction failed:', error);
      return [];
    }
  }

  splitIntoSentences(text) {
    // Enhanced sentence splitting that handles various punctuation
    const sentences = [];
    let currentSentence = '';
    let parenthesesDepth = 0;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const prevChar = i > 0 ? text[i - 1] : '';

      // Track parentheses depth
      if (char === '(' || char === '[') parenthesesDepth++;
      if (char === ')' || char === ']') parenthesesDepth--;

      currentSentence += char;

      // Check for sentence endings (but not inside parentheses)
      if (parenthesesDepth === 0 && this.sentenceEndings.has(char)) {
        // Don't split on common abbreviations and titles
        if (!this.isAbbreviation(prevChar, char)) {
          const trimmed = currentSentence.trim();
          if (trimmed.length > 10) { // Minimum sentence length
            sentences.push(trimmed);
          }
          currentSentence = '';
        }
      }
    }

    // Add remaining text as a sentence if it's long enough
    const remaining = currentSentence.trim();
    if (remaining.length > 10) {
      sentences.push(remaining);
    }

    return sentences;
  }

  isAbbreviation(prevChar, endingChar) {
    // Don't split on common abbreviations
    const abbreviations = ['Dr.', 'Mr.', 'Mrs.', 'Ms.', 'vs.', 'etc.', 'i.e.', 'e.g.', 'Jr.', 'Sr.'];
    const potentialAbbrev = prevChar + endingChar;

    return abbreviations.some(abbrev => potentialAbbrev.includes(abbrev));
  }

  scoreClaimLikelihood(sentence) {
    let score = 0;

    // Check for factual verbs
    const words = sentence.toLowerCase().split(/\s+/);
    for (const word of words) {
      if (this.factualVerbs.has(word)) {
        score += 0.2;
      }
    }

    // Check for claim markers
    for (const marker of this.claimMarkers) {
      if (sentence.toLowerCase().includes(marker)) {
        score += 0.3;
      }
    }

    // Check for numbers/statistics
    if (/\d+%|\d+\s*percent|\$[\d,]+|[\d,]+\s*(people|cases|deaths|patients)/i.test(sentence)) {
      score += 0.2;
    }

    // Check for scientific/medical terms
    if (/\b(vaccine|study|research|clinical|trial|evidence|data|statistics|analysis)\b/i.test(sentence)) {
      score += 0.1;
    }

    // Check for comparative/superlative language
    if (/\b(higher|lower|more|less|best|worst|most|least|increase|decrease)\b/i.test(sentence)) {
      score += 0.1;
    }

    // Penalty for opinion-like language
    if (/\b(believe|think|feel|hope|wish|want|should|must|need)\b/i.test(sentence)) {
      score -= 0.2;
    }

    // Penalty for questions
    if (sentence.includes('?')) {
      score -= 0.3;
    }

    return Math.max(0, Math.min(1, score));
  }

  evaluateHeuristicConfidence(claims, originalText) {
    if (claims.length === 0) return 0;

    // Calculate average confidence of extracted claims
    const avgConfidence = claims.reduce((sum, claim) => sum + claim.confidence, 0) / claims.length;

    // Bonus if we found claims with high statistical content
    const statisticalClaims = claims.filter(claim =>
      /\d+%|\d+\s*percent|\$[\d,]+|[\d,]+\s*(people|cases|deaths|patients)/i.test(claim.text)
    ).length;

    const statisticalBonus = Math.min(0.2, statisticalClaims * 0.05);

    // Penalty if very few claims found in long text
    const textLength = originalText.length;
    const claimsRatio = claims.length / Math.max(1, textLength / 200); // Expected ~1 claim per 200 chars
    const lengthPenalty = Math.max(0, 0.3 - claimsRatio);

    return Math.max(0, Math.min(1, avgConfidence + statisticalBonus - lengthPenalty));
  }

  combineAndDeduplicateClaims(heuristicClaims, aiClaims) {
    const allClaims = [...heuristicClaims, ...aiClaims];

    // Remove near-duplicates using simple similarity check
    const uniqueClaims = [];
    const threshold = 0.8;

    for (const claim of allClaims) {
      const isDuplicate = uniqueClaims.some(existing =>
        this.calculateSimilarity(claim.text, existing.text) > threshold
      );

      if (!isDuplicate) {
        uniqueClaims.push(claim);
      }
    }

    // Sort by confidence and limit
    return uniqueClaims
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 20);
  }

  calculateSimilarity(text1, text2) {
    // Simple Jaccard similarity for deduplication
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  // Batch processing for multiple texts
  async extractClaimsBatch(texts) {
    const results = await Promise.allSettled(
      texts.map(text => this.extractClaims(text))
    );

    return results.map((result, index) => ({
      text: texts[index],
      claims: result.status === 'fulfilled' ? result.value : [],
      error: result.status === 'rejected' ? result.reason : null
    }));
  }
}

export default ClaimExtractor;
