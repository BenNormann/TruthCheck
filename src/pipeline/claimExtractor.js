// ClaimExtractor - Extracts factual claims from article content using heuristics and semantics
import CONFIG from '../foundation/config.js';

class ClaimExtractor {
  constructor() {
    this.config = CONFIG.claim_extraction;
  }

  /**
   * Main extraction method - extracts all factual claims from article content
   * @param {string} articleContent - Full text of the article
   * @returns {Promise<Array>} Array of claim objects with text, confidence, method, position
   */
  async extractClaims(articleContent) {
    if (!articleContent || articleContent.trim().length < this.config.min_claim_length) {
      return [];
    }

    try {
      // Split article into sentences
      const sentences = this.tokenizeSentences(articleContent);
      console.log(`ClaimExtractor: Split article into ${sentences.length} sentences`);
      
      // Extract and score each potential claim
      const claims = [];
      let currentPosition = 0;

      for (const sentence of sentences) {
        // Find position of sentence in original text
        const position = articleContent.indexOf(sentence, currentPosition);
        currentPosition = position + sentence.length;

        // Score the sentence as a potential claim
        const claimScore = this.scoreClaimCandidate(sentence);

        // If passes threshold, add to results (using lower threshold for sensitivity)
        const sensitivityThreshold = Math.min(this.config.claim_confidence_threshold, 0.15);
        if (claimScore.isClaim && claimScore.confidence >= sensitivityThreshold) {
          claims.push({
            text: sentence.trim(),
            confidence: claimScore.confidence,
            method: "heuristic",
            position: position >= 0 ? position : 0,
            signals: claimScore.signals // Debug info
          });
        }
      }

      console.log(`ClaimExtractor: Found ${claims.length} potential claims`);
      
      // Sort by confidence (highest first) and limit to reasonable number
      claims.sort((a, b) => b.confidence - a.confidence);
      
      // Return top claims (limit to 150 for high sensitivity)
      const topClaims = claims.slice(0, 150);
      console.log(`ClaimExtractor: Returning top ${topClaims.length} claims`);
      
      // Debug: log first few claims
      if (topClaims.length > 0) {
        console.log('ClaimExtractor: Sample claims:', topClaims.slice(0, 3).map(c => ({
          text: c.text.substring(0, 80) + '...',
          confidence: c.confidence.toFixed(2),
          signals: c.signals
        })));
      }
      
      return topClaims;
      
    } catch (error) {
      console.error('ClaimExtractor: Error extracting claims:', error);
      return [];
    }
  }

  /**
   * Tokenize text into sentences while respecting abbreviations
   * @param {string} text - Input text
   * @returns {Array<string>} Array of sentences
   */
  tokenizeSentences(text) {
    if (!text) return [];

    // Protect abbreviations by replacing periods with placeholders
    let protectedText = text;
    const abbrevMap = new Map();
    let abbrevIndex = 0;

    this.config.abbreviations.forEach(abbrev => {
      const placeholder = `__ABBREV_${abbrevIndex}__`;
      abbrevMap.set(placeholder, abbrev);
      // Escape special regex characters in abbreviation
      const escapedAbbrev = abbrev.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      protectedText = protectedText.replace(new RegExp(escapedAbbrev, 'g'), placeholder);
      abbrevIndex++;
    });

    // More comprehensive sentence splitting - split on:
    // 1. Period/!/?/:/; followed by space (with or without capital letter)
    // 2. Line breaks that might indicate new sentences
    // More permissive pattern to catch more sentences
    const sentencePattern = /([.!?])\s+/g;
    let sentences = [];
    let lastIndex = 0;
    let match;

    while ((match = sentencePattern.exec(protectedText)) !== null) {
      const endIndex = match.index + match[1].length;
      const sentence = protectedText.substring(lastIndex, endIndex);
      sentences.push(sentence.trim());
      lastIndex = sentencePattern.lastIndex;
    }

    // Add the last sentence if there's remaining text
    if (lastIndex < protectedText.length) {
      const lastSentence = protectedText.substring(lastIndex).trim();
      if (lastSentence) {
        sentences.push(lastSentence);
      }
    }

    // Restore abbreviations and clean up
    const result = [];
    for (const sentence of sentences) {
      let restored = sentence;
      abbrevMap.forEach((original, placeholder) => {
        restored = restored.replace(new RegExp(placeholder, 'g'), original);
      });

      const cleaned = restored.trim();
      // More lenient minimum length for sensitivity
      if (cleaned.length >= Math.min(this.config.min_claim_length, 15)) {
        result.push(cleaned);
      }
    }

    // If still no sentences, try even simpler fallback
    if (result.length === 0) {
      // Restore abbreviations in original text
      let restoredText = protectedText;
      abbrevMap.forEach((original, placeholder) => {
        restoredText = restoredText.replace(new RegExp(placeholder, 'g'), original);
      });
      
      // Split on any sentence ending, newlines, or semicolons
      const simpleSplit = restoredText
        .split(/[.!?\n;]+/)
        .map(s => s.trim())
        .filter(s => s.length >= 15);
      return simpleSplit;
    }

    return result;
  }

  /**
   * Score a sentence as a potential factual claim
   * @param {string} sentence - Sentence to evaluate
   * @returns {Object} Score object with isClaim, confidence, and signals
   */
  scoreClaimCandidate(sentence) {
    if (!sentence || sentence.trim().length < this.config.min_claim_length) {
      return { isClaim: false, confidence: 0, signals: {} };
    }

    const cleaned = sentence.trim();
    const lowerCase = cleaned.toLowerCase();
    
    // Check length constraints
    if (cleaned.length > this.config.max_claim_length) {
      return { isClaim: false, confidence: 0, signals: { reason: 'too_long' } };
    }

    // Check exclusion patterns first (early exit for non-claims)
    // Be less aggressive with exclusions for higher sensitivity
    for (const pattern of this.config.exclude_patterns) {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(cleaned)) {
        // Only exclude if it's a very strong match (question mark at end)
        if (pattern === "\\?$") {
          return { isClaim: false, confidence: 0, signals: { reason: 'excluded_pattern', pattern } };
        }
        // For other patterns, just reduce confidence instead of excluding
        // We'll handle this in the scoring below
      }
    }

    // Check for opinion markers (reduces confidence but doesn't exclude entirely)
    const hasOpinionMarker = this.config.opinion_markers.some(marker => 
      lowerCase.includes(marker)
    );
    // Don't completely exclude opinions - some claims include opinion language
    // We'll apply a penalty in scoring instead

    // Score based on multiple signals
    const signals = {
      hasFactualVerb: false,
      hasClaimMarker: false,
      hasPercentage: false,
      hasLargeNumber: false,
      hasNamedEntity: false,
      hasDateReference: false,
      hasQuotation: false,
      structureScore: 0
    };

    let confidenceScore = 0;
    // Adjusted weights for higher sensitivity - more generous scoring
    const weights = {
      factualVerb: 0.45,        // Core signal - increased more
      claimMarker: 0.35,        // Strong indicator - increased more
      percentage: 0.25,         // Statistical claim - increased more
      largeNumber: 0.22,        // Quantitative claim - increased more
      namedEntity: 0.15,        // Specific entities - increased more
      dateReference: 0.12,      // Temporal specificity - increased more
      quotation: 0.12,          // Attributed statement - increased more
      structure: 0.18           // Sentence structure - increased more
    };

    // 1. Check for factual verbs (is, was, are, were, caused, etc.)
    // Use a more aggressive check - match partial words too
    const hasFactualVerb = this.config.factual_verbs.some(verb => {
      const pattern = new RegExp(`\\b${verb}\\b`, 'i');
      return pattern.test(cleaned);
    });
    if (hasFactualVerb) {
      signals.hasFactualVerb = true;
      confidenceScore += weights.factualVerb;
    }

    // Apply opinion penalty if needed (but don't exclude)
    if (hasOpinionMarker) {
      confidenceScore *= 0.7; // 30% penalty
      signals.hasOpinionMarker = true;
    }

    // 2. Check for claim markers (according to, studies show, etc.)
    const claimMarker = this.config.claim_markers.find(marker => 
      lowerCase.includes(marker)
    );
    if (claimMarker) {
      signals.hasClaimMarker = true;
      signals.claimMarkerFound = claimMarker;
      confidenceScore += weights.claimMarker;
    }

    // 3. Check for percentages
    const hasPercentage = this.config.percentage_keywords.some(keyword => 
      lowerCase.includes(keyword)
    ) || /\d+%/.test(cleaned);
    if (hasPercentage) {
      signals.hasPercentage = true;
      confidenceScore += weights.percentage;
    }

    // 4. Check for large numbers with units
    const hasLargeNumber = this.hasLargeNumberWithUnit(cleaned);
    if (hasLargeNumber) {
      signals.hasLargeNumber = true;
      confidenceScore += weights.largeNumber;
    }

    // 5. Check for named entities (capitalized multi-word phrases, proper nouns)
    const namedEntityPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/;
    if (namedEntityPattern.test(cleaned)) {
      signals.hasNamedEntity = true;
      confidenceScore += weights.namedEntity;
    }

    // 6. Check for date references
    const datePatterns = [
      /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+\d{1,2}/i,
      /\b\d{4}\b/,                    // Years
      /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/, // Dates
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
      /\b(last|this|next)\s+(week|month|year|monday|tuesday|wednesday|thursday|friday)\b/i
    ];
    const hasDate = datePatterns.some(pattern => pattern.test(cleaned));
    if (hasDate) {
      signals.hasDateReference = true;
      confidenceScore += weights.dateReference;
    }

    // 7. Check for quotations (attributed statements)
    const hasQuotation = cleaned.includes('"') || cleaned.includes('"') || cleaned.includes('"');
    if (hasQuotation) {
      signals.hasQuotation = true;
      confidenceScore += weights.quotation;
    }

    // 8. Sentence structure analysis
    const structureScore = this.analyzeStructure(cleaned);
    signals.structureScore = structureScore;
    confidenceScore += structureScore * weights.structure;

    // Normalize confidence to 0-1 range (allow scores > 1 for high-confidence claims)
    const normalizedConfidence = Math.min(confidenceScore, 2.0) / 2.0;

    // Very permissive claim determination for maximum sensitivity
    // Accept if: has factual verb OR claim marker OR multiple other signals OR single strong signal
    const multipleSignals = [
      signals.hasPercentage,
      signals.hasLargeNumber,
      signals.hasNamedEntity,
      signals.hasDateReference,
      signals.hasQuotation
    ].filter(Boolean).length >= 2;

    const hasSingleStrongSignal = signals.hasPercentage || signals.hasLargeNumber;

    const isClaim = (signals.hasFactualVerb || signals.hasClaimMarker || multipleSignals || hasSingleStrongSignal) && 
                    normalizedConfidence >= 0.10 && // Very low threshold for maximum sensitivity
                    !cleaned.endsWith('?'); // Only exclude questions

    return {
      isClaim,
      confidence: normalizedConfidence,
      signals
    };
  }

  /**
   * Check if sentence contains large numbers with meaningful units
   * @param {string} sentence - Sentence to check
   * @returns {boolean} True if contains large number with unit
   */
  hasLargeNumberWithUnit(sentence) {
    const lowerSentence = sentence.toLowerCase();
    
    // Check for numbers >= threshold
    const numberPattern = /\b(\d+(?:,\d+)*(?:\.\d+)?)\b/g;
    const numbers = sentence.match(numberPattern);
    
    if (!numbers) return false;

    for (const numStr of numbers) {
      const num = parseFloat(numStr.replace(/,/g, ''));
      
      if (num >= this.config.large_number_threshold) {
        // Check if followed by a meaningful unit
        const hasUnit = this.config.large_number_units.some(unit => 
          lowerSentence.includes(unit)
        );
        
        if (hasUnit) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Analyze sentence structure for claim-like characteristics
   * @param {string} sentence - Sentence to analyze
   * @returns {number} Structure score 0-1
   */
  analyzeStructure(sentence) {
    let score = 0.6; // Start slightly positive for sensitivity

    // Good indicators
    const wordCount = sentence.split(/\s+/).length;
    
    // More generous length range for claims (5-40 words)
    if (wordCount >= 5 && wordCount <= 30) {
      score += 0.25; // Increased bonus
    } else if (wordCount > 30 && wordCount <= 50) {
      score += 0.15; // More acceptable range
    }

    // Has commas (complex structure with details)
    if (sentence.includes(',')) {
      score += 0.15; // Increased
    }

    // Contains numbers (quantitative)
    if (/\d/.test(sentence)) {
      score += 0.20; // Increased
    }

    // Has prepositional phrases (in, at, on, by, from, etc.)
    const prepPattern = /\b(in|at|on|by|from|to|with|under|over|between|among|during|after|before)\b/i;
    if (prepPattern.test(sentence)) {
      score += 0.15; // Increased
    }

    // Bad indicators (less harsh penalties for sensitivity)
    
    // Too short
    if (wordCount < 4) {
      score -= 0.2; // Reduced penalty
    }

    // Too many exclamation marks (sensational)
    const exclamationCount = (sentence.match(/!/g) || []).length;
    if (exclamationCount > 2) { // More lenient
      score -= 0.15; // Reduced penalty
    }

    // ALL CAPS words (sensational - but allow acronyms)
    const allCapsWords = sentence.match(/\b[A-Z]{3,}\b/g) || [];
    const nonAcronymCaps = allCapsWords.filter(word => word.length > 5);
    if (nonAcronymCaps.length > 1) { // Only penalize if multiple
      score -= 0.10; // Reduced penalty
    }

    // Starts with lowercase (likely continuation) - less harsh penalty
    if (/^[a-z]/.test(sentence)) {
      score -= 0.1; // Reduced penalty
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Extract claims using AI (placeholder for future enhancement)
   * @param {string} articleContent - Article text
   * @returns {Promise<Array>} Array of claim objects
   */
  async extractClaimsWithAI(articleContent) {
    // TODO: Implement AI-based extraction if CONFIG.claim_extraction.method includes "ai"
    // This would use the AI router to classify sentences as claims
    console.warn('ClaimExtractor: AI extraction not yet implemented, falling back to heuristics');
    return this.extractClaims(articleContent);
  }

  /**
   * Hybrid extraction combining heuristics and AI
   * @param {string} articleContent - Article text
   * @returns {Promise<Array>} Array of claim objects
   */
  async extractClaimsHybrid(articleContent) {
    // For now, use heuristics only
    // Future: Use heuristics first, then validate high-confidence claims with AI
    return this.extractClaims(articleContent);
  }
}

// Export as singleton instance (not the class)
const claimExtractor = new ClaimExtractor();
export default claimExtractor;

