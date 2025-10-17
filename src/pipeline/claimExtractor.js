// Claim Extractor - Extract factual claims from text using heuristic and AI methods
import CONFIG from '../foundation/config.js';
import logger from '../foundation/logger.js';
import cache from '../foundation/cache.js';

class ClaimExtractor {
  constructor() {
    this._aiClient = null;
    this.method = CONFIG.claim_extraction.method;
    this.heuristicThreshold = CONFIG.claim_extraction.heuristic_threshold;
    this.factualVerbs = new Set(CONFIG.claim_extraction.factual_verbs);
    this.claimMarkers = new Set(CONFIG.claim_extraction.claim_markers);
    this.minLength = CONFIG.claim_extraction.min_claim_length;
    this.maxLength = CONFIG.claim_extraction.max_claim_length;
    this.sentenceEndings = new Set(CONFIG.claim_extraction.sentence_endings);
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
    console.log('[CLAIM EXTRACTOR] Method:', this.method);
    console.log('[CLAIM EXTRACTOR] Heuristic Threshold:', this.heuristicThreshold);

    // First, try heuristic extraction
    const heuristicClaims = this.extractClaimsHeuristic(text);
    console.log('[CLAIM EXTRACTOR] Heuristic claims found:', heuristicClaims.length);

    if (this.method === 'heuristic') {
      console.log('[CLAIM EXTRACTOR] Using pure heuristic mode - skipping AI');
      return heuristicClaims;
    }

    // For hybrid method, evaluate heuristic confidence
    const heuristicConfidence = this.evaluateHeuristicConfidence(heuristicClaims, text);
    console.log('[CLAIM EXTRACTOR] Heuristic confidence:', heuristicConfidence);

    if (heuristicConfidence >= this.heuristicThreshold) {
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
    const sentences = this.splitIntoSentences(text);

    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim();

      // Skip if too short or too long
      if (trimmedSentence.length < this.minLength || trimmedSentence.length > this.maxLength) {
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

      let claims = [];

      // Handle different response formats from AI client
      let responseData = null;

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

  splitIntoSentences(text) {
    // Enhanced sentence splitting that handles various punctuation
    const sentences = [];
    let currentSentence = '';
    let parenthesesDepth = 0;
    let quoteDepth = 0;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const prevChar = i > 0 ? text[i - 1] : '';
      const nextChar = i < text.length - 1 ? text[i + 1] : '';

      // Track parentheses and quote depth
      if (char === '(' || char === '[') parenthesesDepth++;
      if (char === ')' || char === ']') parenthesesDepth--;
      if (char === '"' || char === "'") quoteDepth = (quoteDepth + 1) % 2;

      currentSentence += char;

      // Check for sentence endings (but not inside parentheses or quotes)
      if (parenthesesDepth === 0 && quoteDepth === 0 && this.sentenceEndings.has(char)) {
        // Don't split on common abbreviations, titles, or decimal numbers
        if (!this.isAbbreviation(prevChar, char) && !this.isDecimalNumber(prevChar, char, nextChar)) {
          const trimmed = currentSentence.trim();
          if (trimmed.length > 8) { // Reduced minimum sentence length
            sentences.push(trimmed);
          }
          currentSentence = '';
        }
      }
    }

    // Add remaining text as a sentence if it's long enough
    const remaining = currentSentence.trim();
    if (remaining.length > 8) {
      sentences.push(remaining);
    }

    return sentences;
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
      if (this.factualVerbs.has(word)) {
        score += 0.2;
      }
    }

    // Check for claim markers
    for (const marker of this.claimMarkers) {
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

    // Penalty for questions
    if (sentence.includes('?')) {
      score -= 0.3;
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

// Create and export singleton instance
const claimExtractor = new ClaimExtractor();
export default claimExtractor;

// Make claimExtractor available globally for content scripts
if (typeof window !== 'undefined') {
  window.ClaimExtractor = claimExtractor;
}

