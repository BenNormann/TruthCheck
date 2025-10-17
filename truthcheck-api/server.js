const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize OpenAI client
console.log('[SERVER] API Key loaded:', process.env.OPENAI_API_KEY ? 'YES' : 'NO');
console.log('[SERVER] API Key preview:', process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.substring(0, 20) + '...' : 'NOT SET');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Claim extraction endpoint
app.post('/extract-claims', async (req, res) => {
  try {
    const { text, model = 'gpt-4o-mini', max_tokens = 3000 } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    console.log(`[API] Extracting claims from text (${text.length} chars)`);

    const prompt = `Extract factual claims as JSON array. Return ONLY valid JSON.
Each object: {"text":"claim","confidence":0.8,"type":"other"}

Text: ${text.substring(0, 3000)} ${text.length > 3000 ? '...' : ''}

JSON:`;

    const completion = await openai.chat.completions.create({
      model: model,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.1,
      max_tokens: max_tokens,
    });

    let response = completion.choices[0].message.content;
    console.log(`[API] OpenAI response length: ${response.length}`);

    // Strip markdown code block formatting if present
    response = response.trim();
    if (response.startsWith('```json')) {
      response = response.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (response.startsWith('```')) {
      response = response.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    // Try to parse the response
    let claims = [];
    try {
      claims = JSON.parse(response);
      if (!Array.isArray(claims)) {
        claims = [];
      }
    } catch (parseError) {
      console.error('[API] JSON parse error:', parseError.message);
      console.error('[API] Raw response:', response);
      
      // Try to extract claims from malformed JSON
      const textMatches = response.match(/"text"\s*:\s*"([^"]+)"/g);
      if (textMatches) {
        claims = textMatches.map(match => {
          const textMatch = match.match(/"text"\s*:\s*"([^"]+)"/);
          return {
            text: textMatch ? textMatch[1] : match,
            confidence: 0.5,
            type: 'other'
          };
        });
      }
    }

    console.log(`[API] Extracted ${claims.length} claims`);
    
    res.json({
      success: true,
      claims: claims,
      model: model,
      response_length: response.length
    });

  } catch (error) {
    console.error('[API] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      type: error.type || 'unknown'
    });
  }
});

// Evidence search endpoint
app.post('/search-evidence', async (req, res) => {
  try {
    const { claim } = req.body;

    if (!claim) {
      return res.status(400).json({ error: 'Claim is required' });
    }

    console.log(`[API] Searching evidence for claim: "${claim.substring(0, 100)}..."`);

    const evidence = [];

    // Search Google News (using a simple web search)
    try {
      const searchQuery = encodeURIComponent(claim);
      const newsUrl = `https://news.google.com/search?q=${searchQuery}`;
      
      // For now, we'll use a simple fetch to get basic results
      // In production, you'd want to use proper news APIs
      const response = await fetch(newsUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (response.ok) {
        const html = await response.text();
        
        // Extract article titles and snippets using regex
        // This is a simplified approach - in production, use a proper HTML parser
        const titleMatches = html.match(/<h3[^>]*>([^<]+)<\/h3>/g) || [];
        const snippetMatches = html.match(/<span[^>]*class="[^"]*snippet[^"]*"[^>]*>([^<]+)<\/span>/gi) || [];
        
        for (let i = 0; i < Math.min(5, titleMatches.length); i++) {
          const title = titleMatches[i].replace(/<[^>]+>/g, '').trim();
          const snippet = snippetMatches[i] ? snippetMatches[i].replace(/<[^>]+>/g, '').trim() : '';
          
          if (title) {
            evidence.push({
              source: 'Google News',
              title: title,
              snippet: snippet,
              url: newsUrl,
              credibility: 0.7
            });
          }
        }
      }
    } catch (searchError) {
      console.error('[API] Google News search error:', searchError.message);
    }

    // Use OpenAI to analyze the claim and generate likely evidence points
    try {
      const prompt = `As a fact-checker, analyze this claim and provide likely evidence points that would support or refute it:

CLAIM: "${claim}"

Return a JSON array of likely evidence points (3-5 items):
[
  {
    "source": "likely source name",
    "finding": "what this source would likely say about the claim",
    "supports": true/false,
    "credibility": 0.5
  }
]`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 1000,
      });

      let aiResponse = completion.choices[0].message.content.trim();
      
      // Strip markdown
      if (aiResponse.startsWith('```json')) {
        aiResponse = aiResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (aiResponse.startsWith('```')) {
        aiResponse = aiResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      const aiEvidence = JSON.parse(aiResponse);
      
      if (Array.isArray(aiEvidence)) {
        aiEvidence.forEach(item => {
          evidence.push({
            source: item.source || 'AI Analysis',
            title: item.finding || '',
            snippet: item.finding || '',
            url: '',
            credibility: item.credibility || 0.5,
            supports_claim: item.supports
          });
        });
      }
    } catch (aiError) {
      console.error('[API] AI evidence generation error:', aiError.message);
    }

    console.log(`[API] Found ${evidence.length} evidence items`);

    res.json({
      success: true,
      evidence: evidence,
      count: evidence.length
    });

  } catch (error) {
    console.error('[API] Evidence search error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Evidence scoring endpoint
app.post('/score-evidence', async (req, res) => {
  try {
    const { claim, search_results = [], model = 'gpt-4o-mini' } = req.body;

    if (!claim) {
      return res.status(400).json({ error: 'Claim is required' });
    }

    console.log(`[API] Scoring evidence for claim: "${claim.substring(0, 100)}..."`);

    const prompt = `You are a fact-checking expert. Analyze the evidence and score this claim from 0-10.

CLAIM: "${claim}"

SEARCH RESULTS: ${JSON.stringify(search_results)}

SCORING CRITERIA (be strict and consistent):
- 10: Overwhelming evidence, multiple reliable sources confirm
- 9: Strong evidence from credible sources
- 8: Good evidence with minor gaps
- 7: Decent evidence but some limitations
- 6: Weak evidence, limited support
- 5: Neutral - no clear evidence either way
- 4: Evidence suggests claim may be false
- 3: Evidence contradicts the claim
- 2: Strong evidence against the claim
- 1: Overwhelming evidence the claim is false
- 0: No relevant evidence found

IMPORTANT: Use the full 0-10 scale. Don't cluster scores around 5-7.

Return ONLY valid JSON (no other text):
{
  "overall_score": 0-10,
  "confidence": "high|medium|low",
  "assessment": "One sentence explaining the score"
}`;

    const completion = await openai.chat.completions.create({
      model: model,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.1,
      max_tokens: 1000,
    });

    let response = completion.choices[0].message.content;
    
    console.log(`[API] Raw OpenAI response (first 200 chars): ${response.substring(0, 200)}`);
    
    // Strip markdown code block formatting if present
    response = response.trim();
    if (response.startsWith('```json')) {
      response = response.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (response.startsWith('```')) {
      response = response.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    
    response = response.trim();
    
    let scoreData = {};
    try {
      scoreData = JSON.parse(response);
    } catch (parseError) {
      console.error('[API] Score JSON parse error:', parseError.message);
      console.error('[API] Cleaned response:', response);
      
      // Try to extract score using regex as fallback
      const scoreMatch = response.match(/"overall_score"\s*:\s*(\d+)/);
      const confidenceMatch = response.match(/"confidence"\s*:\s*"(\w+)"/);
      const assessmentMatch = response.match(/"assessment"\s*:\s*"([^"]+)"/);
      
      if (scoreMatch) {
        console.log('[API] Extracted score via regex fallback');
        scoreData = {
          overall_score: parseInt(scoreMatch[1]),
          confidence: confidenceMatch ? confidenceMatch[1] : "low",
          assessment: assessmentMatch ? assessmentMatch[1] : "Parsed from malformed response"
        };
      } else {
        scoreData = {
          overall_score: 5,
          confidence: "low",
          assessment: "Unable to parse AI response"
        };
      }
    }

    console.log(`[API] Score: ${scoreData.overall_score}/10 (${scoreData.confidence})`);
    
    res.json({
      success: true,
      score: scoreData.overall_score,
      confidence: scoreData.confidence,
      assessment: scoreData.assessment,
      model: model
    });

  } catch (error) {
    console.error('[API] Scoring error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`🚀 TruthCheck API server running on port ${port}`);
  console.log(`📊 Health check: http://localhost:${port}/health`);
  console.log(`🔍 Claim extraction: POST http://localhost:${port}/extract-claims`);
  console.log(`🔎 Evidence search: POST http://localhost:${port}/search-evidence`);
  console.log(`📈 Evidence scoring: POST http://localhost:${port}/score-evidence`);
});

module.exports = app;
