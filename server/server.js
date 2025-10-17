const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'chrome-extension://*',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Middleware to parse JSON
app.use(express.json({ limit: '10mb' }));

// API key validation middleware
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const expectedKey = process.env.EXTENSION_API_KEY;

  if (!expectedKey) {
    return res.status(500).json({ error: 'Server not properly configured' });
  }

  if (!apiKey || apiKey !== expectedKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  next();
};

// Health check endpoint (no auth required for basic connectivity check)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'TruthCheck API Server'
  });
});

// OpenAI API proxy endpoint
app.post('/api/ai/query', validateApiKey, async (req, res) => {
  try {
    const { prompt, options = {} } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4-turbo-preview',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant for fact-checking and analysis.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: options.temperature || 0.1,
        max_tokens: options.max_tokens || 1000,
        response_format: { type: 'json_object' }
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();

    // Parse the response content
    const message = data.choices?.[0]?.message?.content;
    if (!message) {
      throw new Error('No response content from OpenAI');
    }

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(message);
    } catch (error) {
      // If not JSON, return as text
      parsedResponse = {
        content: message,
        usage: data.usage,
        model: data.model,
        raw_response: message
      };
    }

    res.json({
      success: true,
      data: parsedResponse,
      usage: data.usage
    });

  } catch (error) {
    console.error('OpenAI API error:', error);
    res.status(500).json({
      error: 'Failed to process AI request',
      details: error.message
    });
  }
});

// NewsGuard API proxy endpoint
app.get('/api/credibility/newsguard/:domain', validateApiKey, async (req, res) => {
  try {
    const { domain } = req.params;

    if (!domain) {
      return res.status(400).json({ error: 'Domain is required' });
    }

    const newsguardApiKey = process.env.NEWSGUARD_API_KEY;
    if (!newsguardApiKey) {
      return res.status(500).json({ error: 'NewsGuard API key not configured' });
    }

    const response = await fetch(`https://api.newsguardtech.com/v1/domain/${domain}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${newsguardApiKey}`,
        'Content-Type': 'application/json'
      },
    });

    if (!response.ok) {
      throw new Error(`NewsGuard API error: ${response.status}`);
    }

    const data = await response.json();

    res.json({
      success: true,
      data: {
        source: 'NewsGuard',
        score: data.overall_score || 0,
        rating: mapNewsGuardRating(data.rating),
        credibility: data.credibility_indicators || {},
        transparency: data.transparency_score || 0,
        bias: data.bias_rating || 'unknown'
      }
    });

  } catch (error) {
    console.error('NewsGuard API error:', error);
    res.status(500).json({
      error: 'Failed to check domain credibility',
      details: error.message
    });
  }
});

// Media Bias/Fact Check proxy (web scraping simulation)
app.get('/api/credibility/mediabias/:domain', validateApiKey, async (req, res) => {
  try {
    const { domain } = req.params;

    if (!domain) {
      return res.status(400).json({ error: 'Domain is required' });
    }

    // Note: This is a simulation since MBFC doesn't have an official API
    // In a real implementation, you would scrape their website
    const response = await fetch(`https://mediabiasfactcheck.com/?s=${encodeURIComponent(domain)}`);

    if (!response.ok) {
      throw new Error(`Media Bias/Fact Check error: ${response.status}`);
    }

    const html = await response.text();

    // Simple parsing simulation
    const rating = extractMediaBiasRating(html);
    const bias = extractMediaBias(html);

    res.json({
      success: true,
      data: {
        source: 'Media Bias/Fact Check',
        rating: rating,
        bias: bias,
        factual_reporting: mapMediaBiasFactualReporting(rating),
        url: `https://mediabiasfactcheck.com/?s=${domain}`
      }
    });

  } catch (error) {
    console.error('Media Bias/Fact Check error:', error);
    res.status(500).json({
      error: 'Failed to check media bias',
      details: error.message
    });
  }
});

// Batch credibility check endpoint
app.post('/api/credibility/batch', validateApiKey, async (req, res) => {
  try {
    const { domains } = req.body;

    if (!Array.isArray(domains) || domains.length === 0) {
      return res.status(400).json({ error: 'Domains array is required' });
    }

    const results = await Promise.allSettled(
      domains.map(domain => checkDomainCredibility(domain))
    );

    const response = results.map((result, index) => ({
      domain: domains[index],
      result: result.status === 'fulfilled' ? result.value : null,
      error: result.status === 'rejected' ? result.reason.message : null
    }));

    res.json({
      success: true,
      data: response
    });

  } catch (error) {
    console.error('Batch credibility check error:', error);
    res.status(500).json({
      error: 'Failed to process batch credibility check',
      details: error.message
    });
  }
});

// Helper functions
function mapNewsGuardRating(rating) {
  const ratingMap = {
    'T': 'Trustworthy',
    'T+': 'Highly Trustworthy',
    'N': 'Not Trustworthy',
    'S': 'Satirical'
  };

  return ratingMap[rating] || 'Unknown';
}

function extractMediaBiasRating(html) {
  // Look for rating indicators in HTML
  const ratingRegex = /credibility.?rating[^>]*>([^<]*)/i;
  const match = html.match(ratingRegex);

  if (match) {
    const ratingText = match[1].toLowerCase();

    if (ratingText.includes('high')) return 'high';
    if (ratingText.includes('mixed')) return 'mixed';
    if (ratingText.includes('low')) return 'low';
  }

  return 'unknown';
}

function extractMediaBias(html) {
  // Look for bias indicators
  const biasRegex = /bias.?rating[^>]*>([^<]*)/i;
  const match = html.match(biasRegex);

  if (match) {
    return match[1].toLowerCase().trim();
  }

  // Fallback: check for common bias terms
  if (html.includes('left') || html.includes('liberal')) return 'left';
  if (html.includes('right') || html.includes('conservative')) return 'right';
  if (html.includes('center') || html.includes('moderate')) return 'center';

  return 'unknown';
}

function mapMediaBiasFactualReporting(rating) {
  const ratingMap = {
    'high': 9,
    'mixed': 5,
    'low': 2,
    'unknown': 5
  };

  return ratingMap[rating] || 5;
}

async function checkDomainCredibility(domain) {
  const results = {};

  // Check NewsGuard if API key is available
  if (process.env.NEWSGUARD_API_KEY) {
    try {
      const response = await fetch(`https://api.newsguardtech.com/v1/domain/${domain}`, {
        headers: {
          'Authorization': `Bearer ${process.env.NEWSGUARD_API_KEY}`,
          'Content-Type': 'application/json'
        },
      });

      if (response.ok) {
        const data = await response.json();
        results.NewsGuard = {
          source: 'NewsGuard',
          score: data.overall_score || 0,
          rating: mapNewsGuardRating(data.rating),
          credibility: data.credibility_indicators || {},
          transparency: data.transparency_score || 0,
          bias: data.bias_rating || 'unknown'
        };
      }
    } catch (error) {
      console.error(`NewsGuard check failed for ${domain}:`, error);
    }
  }

  // Check Media Bias/Fact Check
  try {
    const response = await fetch(`https://mediabiasfactcheck.com/?s=${encodeURIComponent(domain)}`);
    if (response.ok) {
      const html = await response.text();
      const rating = extractMediaBiasRating(html);
      const bias = extractMediaBias(html);

      results['Media Bias/Fact Check'] = {
        source: 'Media Bias/Fact Check',
        rating: rating,
        bias: bias,
        factual_reporting: mapMediaBiasFactualReporting(rating),
        url: `https://mediabiasfactcheck.com/?s=${domain}`
      };
    }
  } catch (error) {
    console.error(`Media Bias check failed for ${domain}:`, error);
  }

  return results;
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`TruthCheck API server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Health check available at: http://localhost:${PORT}/health`);
});
