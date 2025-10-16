# API Key Setup Guide

## Required API Keys

To use the full functionality of the Truth Check extension, you need to configure the following API keys:

### 1. Google Fact Check API
- **Purpose**: Query Google's Fact Check Tools API
- **Get Key**: https://console.developers.google.com/
- **Setup**:
  1. Go to Google Cloud Console
  2. Create a new project or select existing
  3. Enable "Fact Check Tools API"
  4. Create credentials (API Key)
  5. Copy the API key

### 2. NewsGuard API
- **Purpose**: Check source credibility ratings
- **Get Key**: https://www.newsguardtech.com/
- **Setup**:
  1. Sign up for NewsGuard API access
  2. Get your API key from dashboard
  3. Copy the API key

### 3. OpenAI API (for AI features)
- **Purpose**: AI-powered claim classification and evidence assessment
- **Get Key**: https://platform.openai.com/api-keys
- **Setup**:
  1. Create OpenAI account
  2. Navigate to API keys section
  3. Create new secret key
  4. Copy the API key

## Configuration Methods

### Method 1: Environment Variables (Recommended)

Create a `.env` file in the project root:

```env
GOOGLE_FACT_CHECK_API_KEY=your_actual_key_here
NEWSGUARD_API_KEY=your_actual_key_here
OPENAI_API_KEY=your_actual_key_here
```

### Method 2: Direct Configuration (Development)

In `src/foundation/config.js`, replace:
```javascript
api_key: process.env.GOOGLE_FACT_CHECK_API_KEY,
```

With:
```javascript
api_key: "your_actual_api_key_here",
```

### Method 3: Browser Environment

For browser extension context, you can also set these as browser environment variables or use a different configuration approach.

## Important Notes

- **Security**: Never commit API keys to version control
- **Costs**: Some APIs may have usage costs - check rate limits
- **Graceful Degradation**: Extension works with limited functionality if keys are missing
- **Privacy**: API keys are used locally in your browser, not transmitted to our servers

## Testing Configuration

You can verify your API keys are working by:

1. Opening browser developer tools
2. Checking the console for API request logs
3. Looking for successful responses vs. error messages

## Troubleshooting

If API requests fail:
1. Verify API keys are correctly configured
2. Check API rate limits and quotas
3. Ensure APIs are enabled in your accounts
4. Check browser network tab for request details
