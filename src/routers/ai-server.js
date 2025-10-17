// AI Client for TruthCheck API Server
// This replaces the direct OpenAI/Gemini calls with API server calls

class AIServerClient {
  constructor() {
    this.apiBaseUrl = 'http://localhost:3001';
    this.timeout = 15000;
    this.retries = 3;
  }

  async query(prompt, options = {}) {
    console.log('[AI SERVER] Making request to local API server...');
    
    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        const response = await fetch(`${this.apiBaseUrl}/extract-claims`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: prompt,
            model: options.model || 'gpt-4o-mini',
            max_tokens: options.max_tokens || 3000
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        if (!data.success) {
          throw new Error(data.error || 'API request failed');
        }

        console.log(`[AI SERVER] ✅ Successfully extracted ${data.claims.length} claims`);
        
        // Convert to the format expected by claimExtractor
        return data.claims.map(claim => ({
          text: claim.text,
          confidence: claim.confidence,
          type: claim.type || 'other'
        }));

      } catch (error) {
        console.error(`[AI SERVER] Attempt ${attempt}/${this.retries} failed:`, error.message);
        
        if (attempt === this.retries) {
          throw error;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  async searchEvidence(claim) {
    console.log('[AI SERVER] Searching for evidence...');
    
    try {
      const response = await fetch(`${this.apiBaseUrl}/search-evidence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          claim: claim
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Evidence search failed');
      }

      console.log(`[AI SERVER] ✅ Found ${data.count} evidence items`);
      
      return data.evidence || [];

    } catch (error) {
      console.error('[AI SERVER] Evidence search failed:', error.message);
      // Return empty array on failure instead of throwing
      return [];
    }
  }

  async scoreEvidence(claim, searchResults = []) {
    console.log('[AI SERVER] Scoring evidence for claim...');
    
    try {
      const response = await fetch(`${this.apiBaseUrl}/score-evidence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          claim: claim,
          search_results: searchResults,
          model: 'gpt-4o-mini'
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Scoring request failed');
      }

      console.log(`[AI SERVER] ✅ Evidence scored: ${data.score}/10 (${data.confidence})`);
      
      return {
        overall_score: data.score,
        confidence: data.confidence,
        assessment: data.assessment
      };

    } catch (error) {
      console.error('[AI SERVER] Evidence scoring failed:', error.message);
      throw error;
    }
  }

  // Health check method
  async healthCheck() {
    try {
      const response = await fetch(`${this.apiBaseUrl}/health`);
      const data = await response.json();
      return data.status === 'OK';
    } catch (error) {
      console.error('[AI SERVER] Health check failed:', error.message);
      return false;
    }
  }
}

// Create and export singleton instance
const aiServerClient = new AIServerClient();

// Make available globally for content scripts
if (typeof window !== 'undefined') {
  window.aiServerClient = aiServerClient;
}

export default aiServerClient;
