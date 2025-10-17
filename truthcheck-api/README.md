# TruthCheck API Server

A simple Express.js server that handles OpenAI API calls for the TruthCheck Chrome extension.

## Features

- 🔍 **Claim Extraction**: Extract factual claims from text using OpenAI
- 📊 **Evidence Scoring**: Score claims based on evidence (0-10 scale)
- 🔒 **Secure**: API keys are hidden from the browser extension
- 🚀 **Fast**: Optimized for Chrome extension usage
- 🛡️ **CORS Enabled**: Works with browser extensions

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp env.example .env
   # Edit .env and add your OpenAI API key
   ```

3. **Start the server**:
   ```bash
   npm start
   # or for development with auto-reload:
   npm run dev
   ```

## API Endpoints

### Health Check
```
GET /health
```

### Extract Claims
```
POST /extract-claims
Content-Type: application/json

{
  "text": "Your article text here...",
  "model": "gpt-4o-mini",  // optional
  "max_tokens": 3000       // optional
}
```

**Response**:
```json
{
  "success": true,
  "claims": [
    {
      "text": "factual claim here",
      "confidence": 0.8,
      "type": "other"
    }
  ],
  "model": "gpt-4o-mini",
  "response_length": 1234
}
```

### Score Evidence
```
POST /score-evidence
Content-Type: application/json

{
  "claim": "The claim to score",
  "search_results": [],  // optional
  "model": "gpt-4o-mini" // optional
}
```

**Response**:
```json
{
  "success": true,
  "score": 8,
  "confidence": "high",
  "assessment": "Strong evidence supports this claim",
  "model": "gpt-4o-mini"
}
```

## Chrome Extension Integration

Update your extension's AI client to use the local API:

```javascript
// In your extension's ai.js
const API_BASE_URL = 'http://localhost:3001';

async function callAPI(prompt, options = {}) {
  const response = await fetch(`${API_BASE_URL}/extract-claims`, {
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
  
  return await response.json();
}
```

## Benefits

✅ **No API key exposure** in browser extension  
✅ **No CORS issues** with OpenAI  
✅ **Better error handling** and logging  
✅ **Rate limiting** capabilities  
✅ **Caching** potential  
✅ **Multiple model support**  

## Development

- **Port**: 3001 (configurable via PORT env var)
- **CORS**: Enabled for all origins
- **Logging**: Console logs for debugging
- **Error handling**: Graceful fallbacks for malformed responses
