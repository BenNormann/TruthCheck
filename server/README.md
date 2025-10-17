# TruthCheck API Server

This Express.js server acts as a secure proxy between the TruthCheck Chrome extension and external APIs, handling sensitive API keys server-side.

## Features

- **Secure API Key Management**: API keys are stored server-side and never exposed to the client
- **Rate Limiting**: Prevents abuse with configurable rate limits
- **CORS Support**: Properly configured for Chrome extension requests
- **Error Handling**: Comprehensive error handling and logging
- **Health Checks**: Built-in health check endpoint

## Setup

1. **Install Dependencies**:
   ```bash
   cd server
   npm install
   ```

2. **Configure Environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your actual API keys
   ```

3. **Get API Keys**:
   - **OpenAI**: Get your API key from [OpenAI Platform](https://platform.openai.com/api-keys)
   - **NewsGuard**: Get your API key from [NewsGuard](https://www.newsguardtech.com/)

4. **Generate Extension API Key**:
   ```bash
   # Generate a secure random key for your extension
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

5. **Start Server**:
   ```bash
   npm start
   # or for development
   npm run dev
   ```

## API Endpoints

### Health Check
- `GET /health` - Check server status

### AI Queries
- `POST /api/ai/query` - Proxy OpenAI API requests

### Credibility Checks
- `GET /api/credibility/newsguard/:domain` - Check domain credibility via NewsGuard
- `GET /api/credibility/mediabias/:domain` - Check media bias via Media Bias/Fact Check
- `POST /api/credibility/batch` - Batch credibility checks for multiple domains

## Security Features

- **API Key Authentication**: All requests require a valid extension API key
- **Rate Limiting**: Prevents abuse with configurable limits
- **CORS**: Properly configured for Chrome extension requests
- **Helmet Security**: Security headers to prevent common attacks
- **Input Validation**: Validates all incoming requests

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port | No (default: 3001) |
| `NODE_ENV` | Environment mode | No (default: development) |
| `FRONTEND_URL` | Allowed CORS origins | No |
| `OPENAI_API_KEY` | OpenAI API key | Yes |
| `NEWSGUARD_API_KEY` | NewsGuard API key | No |
| `EXTENSION_API_KEY` | Extension authentication key | Yes |
| `OPENAI_MODEL` | OpenAI model to use | No (default: gpt-4-turbo-preview) |

## Integration with Chrome Extension

The server is designed to work with the TruthCheck Chrome extension. Update your extension's configuration to point to your server:

```javascript
// In your extension's config or API client
const API_BASE_URL = 'http://localhost:3001';
const EXTENSION_API_KEY = 'your_extension_api_key_here';
```

## Development

For development with auto-restart:
```bash
npm run dev
```

For production deployment, consider:
- Using a process manager (PM2)
- Setting up proper logging
- Configuring reverse proxy (nginx)
- Using environment-specific configurations

## Troubleshooting

**Common Issues**:

1. **API Key Errors**: Ensure all required API keys are properly set in `.env`
2. **CORS Errors**: Make sure `FRONTEND_URL` matches your extension's origin
3. **Rate Limiting**: Adjust rate limits in the server configuration if needed
4. **Port Conflicts**: Change `PORT` if 3001 is already in use

**Logs**: Check the console output for detailed error messages and request logging.
