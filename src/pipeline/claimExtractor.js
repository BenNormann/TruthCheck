// ClaimExtractor - Extracts factual claims from article content using heuristics and semantics
import CONFIG from '../foundation/config.js';
import logger from '../foundation/logger.js';
import cache from '../foundation/cache.js';

class ClaimExtractor {
  constructor() {
    this.config = CONFIG.claim_extraction;
  }

  getAIClient() {
    if (!this._aiClient) {
      // Lazy initialization - use global aiServerClient instance if available
      if (typeof window !== 'undefined' && window.aiServerClient) {
        console.log('[AI CLIENT] Using global aiServerClient instance');
        this._aiClient = window.aiServerClient;
      } else if (typeof window !== 'undefined' && window.aiClient) {
        console.log('[AI CLIENT] Fallback to global aiClient instance');
        this._aiClient = window.aiClient;
      } else {
        console.error('[AI CLIENT] ❌ AIClient not available in window object');
        throw new Error('AIClient not loaded. Make sure ai-server.js is imported in content.js');
      }
    }
    return this._aiClient;
  }

  async extractClaims(text) {
    logger.log('Starting claim extraction from text length:', text.length);
    console.log('[CLAIM EXTRACTOR] Method:', this.config.method);
    console.log('[CLAIM EXTRACTOR] Heuristic Threshold:', this.config.heuristic_threshold);

    // First, try heuristic extraction
    const heuristicClaims = this.extractClaimsHeuristic(text);
    console.log('[CLAIM EXTRACTOR] Heuristic claims found:', heuristicClaims.length);

    if (this.config.method === 'heuristic') {
      console.log('[CLAIM EXTRACTOR] Using pure heuristic mode - skipping AI');
      return heuristicClaims;
    }

    // For hybrid method, evaluate heuristic confidence
    const heuristicConfidence = this.evaluateHeuristicConfidence(heuristicClaims, text);
    console.log('[CLAIM EXTRACTOR] Heuristic confidence:', heuristicConfidence);

    if (heuristicConfidence >= this.config.heuristic_threshold) {
      logger.debug('Using heuristic extraction (confidence sufficient)');
      console.log('[CLAIM EXTRACTOR] Heuristic confidence sufficient - not calling AI');
      return heuristicClaims;
    }

    // Fall back to AI extraction if heuristic confidence is too low
    logger.debug('Using AI extraction (heuristic confidence too low)');
    console.log('[CLAIM EXTRACTOR] ⚠️ Heuristic confidence too low - falling back to AI');
    const aiClaims = await this.extractClaimsAI(text);

    // Combine and deduplicate
    return this.combineAndDeduplicateClaims(heuristicClaims, aiClaims);
  }

  extractClaimsHeuristic(text) {
    const claims = [];

    // Split text into sentences
    const sentences = this.tokenizeSentences(text);

    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim();

      // Skip if too short or too long
      if (trimmedSentence.length < this.config.min_claim_length || trimmedSentence.length > this.config.max_claim_length) {
        continue;
      }

      // Check if sentence looks like a factual claim
      const confidence = this.scoreClaimLikelihood(trimmedSentence);

      if (confidence >= 0.25) { // Lowered minimum confidence threshold for better recall
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
      .slice(0, 100); // Limit to top 100 claims
  }

  async extractClaimsAI(text) {
    console.log('[AI EXTRACTION] Starting AI claim extraction');
    console.log('[AI EXTRACTION] API Key configured:', CONFIG.apis.ai_provider.api_key ? 'YES (length: ' + CONFIG.apis.ai_provider.api_key.length + ')' : 'NO (null)');
    console.log('[AI EXTRACTION] Provider:', CONFIG.apis.ai_provider.provider);
    console.log('[AI EXTRACTION] Model:', CONFIG.apis.ai_provider.model);
    
    const cacheKey = cache.getClaimKey(text);
    const cached = await cache.get(cacheKey);

    if (cached) {
      logger.debug('Using cached AI claim extraction');
      console.log('[AI EXTRACTION] Using cached result');
      return cached;
    }

    // Safe JSON parsing function for AI responses
    function safeJSONParse(str) {
      try {
        // First try to parse as-is
        return JSON.parse(str);
      } catch (e) {
        console.log("[AI EXTRACTION] Initial parse failed, attempting fixes...");
        
        try {
          // Extract JSON array portion only
          const match = str.match(/\[\s*{[\s\S]*}\s*\]/);
          if (match) return JSON.parse(match[0]);
          
          // Try to fix incomplete JSON by finding the last complete object
          const lastCompleteBrace = str.lastIndexOf('}');
          if (lastCompleteBrace > 0) {
            // Find the start of the last complete object
            let startIndex = str.lastIndexOf('{', lastCompleteBrace);
            if (startIndex > 0) {
              // Find the start of the array
              const arrayStart = str.lastIndexOf('[', startIndex);
              if (arrayStart >= 0) {
                const truncatedResponse = str.substring(arrayStart, lastCompleteBrace + 1) + ']';
                console.log("[AI EXTRACTION] Attempting to fix truncated JSON...");
                return JSON.parse(truncatedResponse);
              }
            }
          }
          
          // Try to fix trailing commas or missing brackets
          const cleaned = str
            .replace(/,\s*}/g, "}")
            .replace(/,\s*\]/g, "]")
            .replace(/\s+$/, "]"); // ensure it ends with ]
          return JSON.parse(cleaned);
        } catch (fixError) {
          console.log("[AI EXTRACTION] Standard fixes failed, trying advanced recovery...");
          
          try {
            // Advanced recovery: try to extract individual JSON objects
            const objectMatches = str.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
            if (objectMatches && objectMatches.length > 0) {
              console.log("[AI EXTRACTION] Found", objectMatches.length, "potential JSON objects");
              const validObjects = [];
              
              for (const objStr of objectMatches) {
                try {
                  const parsed = JSON.parse(objStr);
                  if (parsed && typeof parsed === 'object' && parsed.text) {
                    validObjects.push(parsed);
                  }
                } catch (objError) {
                  // Skip invalid objects
                }
              }
              
              if (validObjects.length > 0) {
                console.log("[AI EXTRACTION] Successfully recovered", validObjects.length, "valid objects");
                return validObjects;
              }
            }
            
            // Last resort: try to extract any text that looks like claims
            const textMatches = str.match(/"text"\s*:\s*"([^"]+)"/g);
            if (textMatches && textMatches.length > 0) {
              console.log("[AI EXTRACTION] Extracting text fields as fallback...");
              return textMatches.map(match => {
                const textMatch = match.match(/"text"\s*:\s*"([^"]+)"/);
                return {
                  text: textMatch ? textMatch[1] : match,
                  confidence: 0.5,
                  type: 'other'
                };
              });
            }
            
          } catch (advancedError) {
            console.warn("[AI EXTRACTION] Advanced recovery also failed:", advancedError);
          }
          
          console.warn("[AI EXTRACTION] All parsing attempts failed, returning empty array");
          return [];
        }
      }
    }

    // Use AI to extract claims from text
    const prompt = `Extract factual claims as JSON array. Return ONLY valid JSON.
Each object: {"text":"claim","confidence":0.8,"type":"other"}

Text: ${text.substring(0, 3000)} ${text.length > 3000 ? '...' : ''}

JSON:`;

    console.log('[AI EXTRACTION] Sending query to AI client...');
    try {
      const aiClient = this.getAIClient();
      console.log('[AI EXTRACTION] AI Client initialized:', !!aiClient);
      console.log('[AI EXTRACTION] AI Client API Key:', aiClient.apiKey ? 'SET (length: ' + aiClient.apiKey.length + ')' : 'NOT SET (null)');

      const response = await aiClient.query(prompt, {
        temperature: 0.1,
        max_tokens: 3000
      });

      console.log('[AI EXTRACTION] ✅ AI query successful');
      console.log('[AI EXTRACTION] Response type:', typeof response);

      if (typeof response === 'object' && response !== null) {
        if (response.content) {
          responseData = response.content;
        } else if (response.raw_response) {
          responseData = response.raw_response;
        } else {
          responseData = response;
        }
      } else if (typeof response === 'string') {
        responseData = response;
      }

      if (responseData && Array.isArray(responseData)) {
        console.log('[AI EXTRACTION] Response is array with', responseData.length, 'items');
        claims = responseData.map(claim => ({
          text: claim.text,
          confidence: claim.confidence || 0.5,
          method: 'ai',
          type: claim.type || 'other',
          position: text.indexOf(claim.text)
        }));
      } else if (responseData) {
        console.log('[AI EXTRACTION] Response needs parsing, type:', typeof responseData);

        // If it's a string, parse it as JSON using safe parsing
        if (typeof responseData === 'string') {
          console.log('[AI EXTRACTION] Raw response string length:', responseData.length);
          console.log('[AI EXTRACTION] Raw response string (first 1000 chars):', responseData.substring(0, 1000) + '...');

          const parsed = safeJSONParse(responseData);
          if (Array.isArray(parsed) && parsed.length > 0) {
            console.log('[AI EXTRACTION] ✅ Successfully parsed', parsed.length, 'claims');
            claims = parsed.map(claim => ({
              text: claim.text,
              confidence: claim.confidence || 0.5,
              method: 'ai',
              type: claim.type || 'other',
              position: text.indexOf(claim.text)
            }));
          } else {
            console.log('[AI EXTRACTION] No valid claims found in response');
          }
        }
        // If it's already an object, check if it has claims property
        else if (typeof responseData === 'object') {
          console.log('[AI EXTRACTION] Response is object, checking for claims array');
          console.log('[AI EXTRACTION] Response keys:', Object.keys(responseData));

          // Check common response formats
          const claimsArray = responseData.claims || responseData.results || responseData;

          if (Array.isArray(claimsArray)) {
            console.log('[AI EXTRACTION] Found claims array with', claimsArray.length, 'items');
            claims = claimsArray.map(claim => ({
              text: claim.text,
              confidence: claim.confidence || 0.5,
              method: 'ai',
              type: claim.type || 'other',
              position: text.indexOf(claim.text)
            }));
          } else {
            console.warn('[AI EXTRACTION] Response object does not contain claims array');
            console.log('[AI EXTRACTION] Full response:', responseData);
          }
        }
      }

      // Cache successful results
      if (claims.length > 0) {
        await cache.set(cacheKey, claims, 24);
        console.log('[AI EXTRACTION] ✅ Cached', claims.length, 'AI claims');
      }

      console.log('[AI EXTRACTION] Returning', claims.length, 'claims');
      return claims;

    } catch (error) {
      logger.error('AI claim extraction failed:', error);
      console.error('[AI EXTRACTION] ❌ ERROR:', error);
      console.error('[AI EXTRACTION] Error message:', error.message);
      console.error('[AI EXTRACTION] Error stack:', error.stack);
      return []; // Return empty array on failure
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

    return Math.max(0, Math.min(1, score));
  }

  isAbbreviation(prevChar, endingChar) {
    // Don't split on common abbreviations
    const abbreviations = ['Dr.', 'Mr.', 'Mrs.', 'Ms.', 'vs.', 'etc.', 'i.e.', 'e.g.', 'Jr.', 'Sr.', 'Inc.', 'Ltd.', 'Corp.', 'Co.'];
    const potentialAbbrev = prevChar + endingChar;

    return abbreviations.some(abbrev => potentialAbbrev.includes(abbrev));
  }

  isDecimalNumber(prevChar, char, nextChar) {
    // Don't split on decimal numbers (e.g., "1.1 degrees")
    return /\d/.test(prevChar) && char === '.' && /\d/.test(nextChar);
  }

  scoreClaimLikelihood(sentence) {
    let score = 0;
    const lowerSentence = sentence.toLowerCase();

    // Check for factual verbs
    const words = lowerSentence.split(/\s+/);
    for (const word of words) {
      if (this.config.factual_verbs.includes(word)) {
        score += 0.2;
      }
    }

    // Check for claim markers
    for (const marker of this.config.claim_markers) {
      if (lowerSentence.includes(marker)) {
        score += 0.3;
      }
    }

    // Enhanced statistical patterns
    const statisticalPatterns = [
      /\d+%|\d+\s*percent/i,  // Percentages
      /\$[\d,]+(\.\d+)?/i,    // Money amounts
      /[\d,]+\s*(people|cases|deaths|patients|citizens|workers|students|voters)/i,  // Counts with units
      /\d+\.\d+\s*(degrees?|years?|months?|days?|hours?|minutes?)/i,  // Decimal measurements
      /\d+\s*(times?|fold|percent)\s*(higher|lower|more|less|increase|decrease)/i,  // Multipliers
      /(increased|decreased|rose|fell|grew|declined|surged|plummeted)\s*by\s*\d+/i,  // Change amounts
      /(since|over|during|in)\s*\d{4}/i,  // Temporal references with years
      /(over|in)\s*(the\s*)?(past|last)\s*\d+\s*(years?|months?|decades?)/i,  // Time periods
      /(millions?|billions?|thousands?)\s*of/i,  // Large numbers
      /\d+\s*(out\s*of|of)\s*\d+/i,  // Ratios
      /\d{4}/i,  // Any 4-digit year
      /\d+\s*(step|steps)/i,  // Step counts (like "24-step plan")
      /\d+\s*(other|others)/i  // Counts with "other" (like "44 other presidents")
    ];

    for (const pattern of statisticalPatterns) {
      if (pattern.test(sentence)) {
        score += 0.2;
        break; // Only count once per sentence
      }
    }

    // Check for scientific/medical terms
    if (/\b(vaccine|study|research|clinical|trial|evidence|data|statistics|analysis|experiment|survey|investigation|report|findings|results)\b/i.test(sentence)) {
      score += 0.1;
    }

    // Check for comparative/superlative language
    if (/\b(higher|lower|more|less|best|worst|most|least|increase|decrease|better|worse|significant|dramatic|substantial)\b/i.test(sentence)) {
      score += 0.1;
    }

    // Check for temporal/causal language
    if (/\b(caused|led\s*to|resulted\s*in|due\s*to|because\s*of|as\s*a\s*result|consequently|therefore)\b/i.test(sentence)) {
      score += 0.15;
    }

    // Check for definitive statements
    if (/\b(always|never|all|every|none|no\s*one|everyone|everything|nothing)\b/i.test(sentence)) {
      score += 0.1;
    }

    // Check for policy/regulatory language
    if (/\b(announced|declared|implemented|enacted|passed|approved|rejected|banned|allowed|required|mandated)\b/i.test(sentence)) {
      score += 0.1;
    }

    // Check for commemorative/memorial language
    if (/\b(commemorate|memorial|monument|anniversary|unveiled|displayed|portraits|walk of fame)\b/i.test(sentence)) {
      score += 0.15;
    }

    // Check for specific location references
    if (/\b(lincoln memorial|white house|national mall|potomac river|arlington national cemetery|memorial bridge|west wing|oval office)\b/i.test(sentence)) {
      score += 0.1;
    }

    // Check for government/legal process language
    if (/\b(congressional approval|federal law|exemption|designated area|preeminent historical|lasting significance)\b/i.test(sentence)) {
      score += 0.15;
    }

    // Penalty for opinion-like language
    if (/\b(believe|think|feel|hope|wish|want|should|must|need|might|could|possibly|perhaps|maybe)\b/i.test(sentence)) {
      score -= 0.2;
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

    // Penalty for very short sentences (likely incomplete)
    if (sentence.length < 20) {
      score -= 0.1;
    }

    // Bonus for sentences with multiple claim indicators
    const claimIndicators = (score > 0.3) ? 1 : 0;
    if (claimIndicators > 0) {
      score += 0.05;
    }

    return Math.max(0, Math.min(1, score));
  }

  evaluateHeuristicConfidence(claims, originalText) {
    if (claims.length === 0) return 0;

    // Calculate average confidence of extracted claims
    const avgConfidence = claims.reduce((sum, claim) => sum + claim.confidence, 0) / claims.length;

    // Enhanced statistical content detection
    const statisticalPatterns = [
      /\d+%|\d+\s*percent/i,
      /\$[\d,]+(\.\d+)?/i,
      /[\d,]+\s*(people|cases|deaths|patients|citizens|workers|students|voters)/i,
      /\d+\.\d+\s*(degrees?|years?|months?|days?|hours?|minutes?)/i,
      /\d+\s*(times?|fold|percent)\s*(higher|lower|more|less|increase|decrease)/i,
      /(increased|decreased|rose|fell|grew|declined|surged|plummeted)\s*by\s*\d+/i,
      /(since|over|during|in)\s*\d{4}/i,
      /(over|in)\s*(the\s*)?(past|last)\s*\d+\s*(years?|months?|decades?)/i,
      /(millions?|billions?|thousands?)\s*of/i,
      /\d+\s*(out\s*of|of)\s*\d+/i,
      /\d{4}/i,  // Any 4-digit year
      /\d+\s*(step|steps)/i,  // Step counts
      /\d+\s*(other|others)/i  // Counts with "other"
    ];

    const statisticalClaims = claims.filter(claim =>
      statisticalPatterns.some(pattern => pattern.test(claim.text))
    ).length;

    const statisticalBonus = Math.min(0.3, statisticalClaims * 0.08);

    // More lenient penalty calculation - expect fewer claims per character
    const textLength = originalText.length;
    const claimsRatio = claims.length / Math.max(1, textLength / 300); // Expected ~1 claim per 300 chars
    const lengthPenalty = Math.max(0, 0.2 - claimsRatio);

    // Bonus for having multiple high-confidence claims
    const highConfidenceClaims = claims.filter(claim => claim.confidence >= 0.6).length;
    const highConfidenceBonus = Math.min(0.2, highConfidenceClaims * 0.05);

    return Math.max(0, Math.min(1, avgConfidence + statisticalBonus + highConfidenceBonus - lengthPenalty));
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

  /**
   * Combine and deduplicate claims from multiple sources
   * @param {Array} heuristicClaims - Claims from heuristic extraction
   * @param {Array} aiClaims - Claims from AI extraction
   * @returns {Array} Combined and deduplicated claims
   */
  combineAndDeduplicateClaims(heuristicClaims, aiClaims) {
    const allClaims = [...heuristicClaims];
    const seenTexts = new Set(heuristicClaims.map(c => c.text.toLowerCase()));

    // Add AI claims that are not duplicates
    for (const aiClaim of aiClaims) {
      const normalizedText = aiClaim.text.toLowerCase();
      if (!seenTexts.has(normalizedText)) {
        allClaims.push(aiClaim);
        seenTexts.add(normalizedText);
      }
    }

    // Sort by confidence and return top claims
    return allClaims
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 100);
  }
}

// Export as singleton instance (not the class)
const claimExtractor = new ClaimExtractor();
export default claimExtractor;
