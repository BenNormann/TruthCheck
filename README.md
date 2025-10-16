# Truth Check - Misinformation Detector Browser Extension

A comprehensive browser extension that identifies misinformation by scoring claims on news sites with a 0-10 scale, highlighting them with color-coded indicators, and providing transparency through interactive tooltips.

## Features

- **Hybrid Claim Detection**: Uses both heuristic pattern matching and AI-powered analysis for accurate claim extraction
- **Multi-Source Scoring**: Evaluates claims using fact-checkers, scholarly sources, source credibility, and content analysis
- **Real-time Highlighting**: Color-coded highlights (green/yellow/red) based on claim trustworthiness
- **Interactive Tooltips**: Hover over highlights to see detailed scoring breakdown and evidence
- **Override Engine**: Detects exact matches against authoritative sources for definitive verdicts
- **Configurable Settings**: All parameters externalized to CONFIG object for easy customization
- **Performance Optimized**: Parallel API processing with caching and rate limiting

## Architecture Overview

### Foundation Layer
- **CONFIG**: Centralized configuration for all APIs, weights, prompts, and UI settings
- **Cache**: IndexedDB wrapper with TTL management for performance optimization
- **Logger**: Comprehensive logging and error handling with graceful degradation

### Router Layer
- **Fact-Checker Router**: Queries Google Fact Check, Snopes, and FactCheck.org in priority order
- **Scholar Router**: Searches Google Scholar, PubMed, Britannica, and arXiv for evidence
- **Credibility Router**: Checks source credibility via NewsGuard and Media Bias/Fact Check
- **AI Client**: OpenAI/Anthropic API wrapper with retry logic and rate limiting

### Pipeline Layer
- **Claim Extractor**: Heuristic + AI hybrid approach for identifying factual claims
- **Claim Normalizer**: Optimizes claims for better search queries and entity extraction
- **Scorer**: Combines all scoring sources with configurable weighted averaging
- **Override Engine**: Exact string matching against authoritative sources

### UI Layer
- **Highlighter**: DOM manipulation for color-coded claim highlighting
- **Tooltip System**: Interactive hover tooltips with detailed breakdowns
- **Control Panel**: Extension popup with toggles and statistics

### Utilities Layer
- **Text Processing**: Sentence segmentation, entity extraction, similarity scoring
- **Scrapers**: Web scraping utilities for academic and fact-checking sites
- **Retry Logic**: Exponential backoff and circuit breaker patterns

## Installation

### Development Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd truth-check-extension
   ```

2. **Install dependencies** (if any)
   ```bash
   npm install
   ```

3. **Load in browser**
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked" and select the extension directory
   - The Truth Check extension should now appear in your extensions list

4. **Configure API keys** (required for full functionality)
   - See `SETUP.md` for detailed API key configuration instructions
   - Keys needed: Google Fact Check, NewsGuard, OpenAI
   - Set environment variables or modify `src/foundation/config.js` directly

### Production Build

```bash
npm run package
```

This will prepare the extension for distribution.

## Configuration

All settings are centralized in `src/foundation/config.js`. Key configuration areas:

### API Settings
```javascript
apis: {
  fact_checkers: [
    {
      name: "Google Fact Check",
      enabled: true,
      api_key: process.env.GOOGLE_FACT_CHECK_API_KEY
    }
  ],
  ai_provider: {
    provider: "openai",
    api_key: process.env.OPENAI_API_KEY,
    model: "gpt-4-turbo-preview"
  }
}
```

### Scoring Weights
```javascript
scoring: {
  fact_checker: { weight: 0.35, enabled: true },
  source_credibility: { weight: 0.20, enabled: true },
  scholarly: { weight: 0.30, enabled: true },
  coherence: { weight: 0.15, enabled: true }
}
```

### UI Customization
```javascript
display: {
  colors: {
    high: "#22c55e",    // Green for trustworthy claims
    medium: "#eab308",  // Yellow for uncertain claims
    low: "#ef4444"      // Red for questionable claims
  }
}
```

## Usage

### Basic Usage

1. **Navigate to a news article** on supported sites (CNN, BBC, Fox News, etc.)
2. **Wait for analysis** - the extension automatically processes claims in the background
3. **View highlights** - claims are highlighted with color-coded backgrounds:
   - 🟢 Green: High trust (8-10 score)
   - 🟡 Yellow: Medium trust (4-7 score)
   - 🔴 Red: Low trust (0-3 score)

4. **Hover for details** - hover over any highlight to see:
   - Overall score (0-10)
   - Confidence level
   - Component breakdown (fact-checker, scholarly, etc.)
   - Source evidence and red flags

### Extension Controls

Click the Truth Check icon in your browser toolbar to access:

- **Toggle highlighting** on/off
- **High confidence filter** - show only high-confidence results
- **View statistics** - claims analyzed, trust distribution
- **Access settings** - advanced configuration options

## API Integration

### Required API Keys

For full functionality, configure these API keys in your environment:

- **OpenAI API Key**: For AI-powered claim classification and evidence assessment
- **NewsGuard API Key**: For source credibility scoring
- **Google Fact Check API Key**: For fact-checking integration

### Supported Sources

- **Fact-Checkers**: Google Fact Check, Snopes, FactCheck.org
- **Scholarly Sources**: Google Scholar, PubMed, Britannica, arXiv
- **Credibility Sources**: NewsGuard, Media Bias/Fact Check

## Development

### Project Structure

```
├── manifest.json           # Extension manifest
├── background.js          # Background script
├── content.js             # Main content script
├── popup.html             # Extension popup UI
├── popup.js               # Popup functionality
├── styles.css             # Extension styles
├── src/
│   ├── foundation/        # Core utilities
│   │   ├── config.js      # Centralized configuration
│   │   ├── cache.js       # IndexedDB cache wrapper
│   │   └── logger.js      # Logging and error handling
│   ├── routers/           # API integration layer
│   │   ├── factcheckers.js # Fact-checking services
│   │   ├── scholar.js     # Academic sources
│   │   ├── credibility.js # Source credibility
│   │   └── ai.js          # AI API client
│   ├── pipeline/          # Processing pipeline
│   │   ├── claimExtractor.js # Claim identification
│   │   ├── normalizer.js  # Query optimization
│   │   ├── scorer.js      # Multi-source scoring
│   │   └── overrideEngine.js # Authoritative overrides
│   ├── ui/                # User interface
│   │   ├── highlighter.js # DOM highlighting
│   │   └── tooltip.js     # Interactive tooltips
│   └── utils/             # Utility functions
│       ├── text.js        # Text processing
│       ├── scrapers.js    # Web scraping utilities
│       └── retry.js       # Retry logic with backoff
└── icons/                 # Extension icons
```

### Adding New Features

1. **New Scoring Source**: Add to `CONFIG.apis` and implement in appropriate router
2. **Custom Processing**: Extend pipeline modules with new analysis types
3. **UI Enhancements**: Modify highlighter and tooltip components

### Testing

```bash
npm test  # Run test suite
npm run lint  # Check code style
```

## Performance

### Optimization Features

- **Parallel Processing**: All scoring sources run concurrently via Promise.all()
- **Intelligent Caching**: IndexedDB with TTL for API responses and processed claims
- **Rate Limiting**: Built-in delays and circuit breakers for API respect
- **Batch Processing**: Claims processed in configurable batches to avoid overwhelming pages

### Performance Metrics

- **Target Response Time**: <5 seconds per article for complete analysis
- **Memory Usage**: Efficient DOM manipulation with cleanup
- **Network Efficiency**: Request deduplication and compression

## Privacy & Security

- **Local Processing**: All analysis happens in the browser, no external data transmission
- **API Privacy**: API keys stored locally, requests made directly from browser
- **No Personal Data**: Extension only processes visible page content
- **Transparent Operation**: All scoring logic and data sources clearly documented

## Troubleshooting

### Common Issues

1. **No highlights appearing**
   - Ensure you're on a supported news site
   - Check that content script is loaded (see browser console)
   - Verify API keys are configured if using AI features

2. **Slow performance**
   - Reduce concurrent requests in CONFIG.performance
   - Enable caching for repeated site visits
   - Check network connectivity for API calls

3. **Tooltip not showing**
   - Hover over highlighted text for 300ms
   - Check browser console for JavaScript errors
   - Ensure styles.css is properly loaded

### Debug Mode

Enable debug logging by setting `CONFIG.debug_mode = true` in `src/foundation/config.js`.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

### Code Style

- Use ES6+ features and modules
- Follow existing code patterns
- Add JSDoc comments for new functions
- Maintain backward compatibility

## License

MIT License - see LICENSE file for details.

## Support

- **Issues**: Report bugs and feature requests on GitHub
- **Documentation**: Comprehensive inline documentation and this README
- **Community**: Join discussions for help and contributions

## Changelog

### Version 1.0.0
- Initial release with full misinformation detection pipeline
- Support for multiple fact-checking and scholarly sources
- Interactive tooltips with detailed breakdowns
- Configurable scoring weights and API settings
- Performance optimizations with caching and parallel processing

---

*Built with modern web technologies for accurate, transparent fact-checking in your browser.*
