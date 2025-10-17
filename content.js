// Content script for Truth Check extension
console.log('Truth Check: Content script loaded');
console.log('Truth Check: Current URL:', window.location.href);
console.log('Truth Check: Current domain:', window.location.hostname);

// Global configuration - will be loaded from background script
let CONFIG = null;

// Simple logger for content script
const Logger = {
  log: function(message, data = null) {
    console.log(`[TruthCheck] ${message}`, data ? data : '');
  },
  warn: function(message, data = null) {
    console.warn(`[TruthCheck WARNING] ${message}`, data ? data : '');
  },
  error: function(message, error = null) {
    console.error(`[TruthCheck ERROR] ${message}`, error ? error : '');
  },
  debug: function(message, data = null) {
    if (CONFIG && CONFIG.debug_mode) {
      console.debug(`[TruthCheck DEBUG] ${message}`, data ? data : '');
    }
  }
};

// Simple cache for content script
const Cache = {
  data: new Map(),
  get: function(key) {
    return this.data.get(key);
  },
  set: function(key, value, ttlMinutes = 60) {
    const expires = Date.now() + (ttlMinutes * 60 * 1000);
    this.data.set(key, { value, expires });
  },
  cleanup: function() {
    const now = Date.now();
    for (const [key, item] of this.data.entries()) {
      if (now > item.expires) {
        this.data.delete(key);
      }
    }
  }
};

// Pipeline modules (loaded dynamically)
let claimExtractor, claimNormalizer, scorer, overrideEngine, highlighter, tooltip;

// Simple utilities
const Utils = {
  // Extract main article content
  extractArticleContent: function() {
    const articleSelectors = [
      'article',
      '[class*="article"]',
      '[class*="content"]',
      'main',
      '.post-content',
      '.entry-content'
    ];

    for (const selector of articleSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        const cloned = element.cloneNode(true);
        cloned.querySelectorAll('script, style, nav, header, footer, aside, .advertisement, .ads').forEach(el => el.remove());
        const text = cloned.textContent || cloned.innerText || '';
        if (text.trim().length > (CONFIG ? CONFIG.min_content_length : 300)) {
          return text.trim();
        }
      }
    }

    // Fallback: get all paragraph text
    const paragraphs = Array.from(document.querySelectorAll('p')).map(p => p.textContent || p.innerText || '');
    return paragraphs.join(' ').trim();
  },

  // Check if current site is a news site
  isNewsSite: function() {
    const newsDomains = ['news', 'cnn', 'bbc', 'foxnews', 'nytimes', 'washingtonpost', 'reuters', 'apnews', 'bloomberg'];
    const currentDomain = window.location.hostname.toLowerCase();

    return newsDomains.some(domain => currentDomain.includes(domain)) ||
           document.querySelector('article') !== null ||
           document.querySelector('[class*="article"]') !== null;
  }
};

async function initializeExtension() {
  try {
    console.log('Truth Check: Initializing extension...');

    // Load CONFIG from background script
    console.log('Truth Check: Loading configuration...');
    CONFIG = await getConfig();

    // Load pipeline modules dynamically
    console.log('Truth Check: Loading pipeline modules...');
    await loadPipelineModules();

    console.log('Truth Check: Extension initialized successfully');
    startProcessing();

  } catch (error) {
    console.error('Truth Check: Failed to initialize extension:', error);
  }
}

async function getConfig() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (response) => {
      resolve(response || {});
    });
  });
}

async function loadPipelineModules() {
  try {
    // Load modules using dynamic imports (content script context)
    const modules = await Promise.all([
      import(chrome.runtime.getURL('src/pipeline/claimExtractor.js')),
      import(chrome.runtime.getURL('src/pipeline/normalizer.js')),
      import(chrome.runtime.getURL('src/pipeline/scorer.js')),
      import(chrome.runtime.getURL('src/pipeline/overrideEngine.js')),
      import(chrome.runtime.getURL('src/ui/highlighter.js')),
      import(chrome.runtime.getURL('src/ui/tooltip.js'))
    ]);

    claimExtractor = modules[0].default;
    claimNormalizer = modules[1].default;
    scorer = modules[2].default;
    overrideEngine = modules[3].default;
    highlighter = modules[4].default;
    tooltip = modules[5].default;

    console.log('Truth Check: Pipeline modules loaded successfully');
  } catch (error) {
    console.error('Truth Check: Failed to load pipeline modules:', error);
    throw error;
  }
}

async function checkApiKeys() {
  // Check if essential API keys are configured
  const keys = {
    ai: CONFIG.apis?.ai_provider?.api_key && CONFIG.apis.ai_provider.api_key !== 'null',
    scholar: CONFIG.apis?.scholar_sources?.some(s => s.enabled),
    credibility: CONFIG.apis?.credibility_sources?.some(c => c.enabled && c.api_key)
  };

  const hasAnyKeys = Object.values(keys).some(k => k);

  if (!hasAnyKeys) {
    Logger.warn('No API keys configured - running with limited functionality');
  }

  return keys;
}

async function startProcessing() {
  console.log('Truth Check: Checking if should process page...');

  // Only process if we're on a news site and content is ready
  if (!Utils.isNewsSite() || document.readyState === 'loading') {
    if (document.readyState === 'loading') {
      console.log('Truth Check: Waiting for page to load completely...');
      document.addEventListener('DOMContentLoaded', startProcessing);
    }
    return;
  }

  try {
    console.log('Truth Check: Starting claim extraction and scoring...');
    Logger.log('Starting claim extraction and scoring...');

    // Extract article content
    console.log('Truth Check: Extracting article content...');
    const articleContent = Utils.extractArticleContent();
    console.log('Truth Check: Article content length:', articleContent?.length || 0);

    if (!articleContent || articleContent.length < (CONFIG ? CONFIG.min_content_length : 300)) {
      console.log('Truth Check: Article too short or no content found');
      Logger.log('Article too short or no content found');
      return;
    }

    console.log('Truth Check: Article content extracted successfully');

    // Extract claims from article using real pipeline
    console.log('Truth Check: Extracting claims from article...');
    const claimResults = await claimExtractor.extractClaims(articleContent);
    const claims = claimResults.map(c => c.text);
    console.log('Truth Check: Claims found:', claims.length);

    if (claims.length === 0) {
      console.log('Truth Check: No claims found in article');
      Logger.log('No claims found in article');
      return;
    }

    console.log('Truth Check: Claims extracted successfully');
    console.log('Truth Check: Found', claims.length, 'claims to analyze');

    // Normalize claims
    console.log('Truth Check: Normalizing claims...');
    const normalizedResults = await claimNormalizer.normalizeBatch(claims);
    const normalizedClaims = normalizedResults.map(r => r.normalized).filter(n => n !== null);

    if (normalizedClaims.length === 0) {
      console.log('Truth Check: No valid claims after normalization');
      return;
    }

    console.log('Truth Check: Claims normalized successfully');

    // Score claims using real pipeline (with batching and timeouts)
    console.log('Truth Check: Scoring claims...');

    // Check if we have necessary API keys for enhanced features
    const hasApiKeys = await checkApiKeys();
    const batchSize = CONFIG.performance?.batch_size || 5;
    const scoredResults = [];

    for (let i = 0; i < normalizedClaims.length; i += batchSize) {
      const batch = normalizedClaims.slice(i, i + batchSize);

      const batchPromises = batch.map(async (normalizedClaim) => {
        try {
          // Score the claim - pipeline handles missing API keys gracefully
          const scores = await scorer.scoreClaim(normalizedClaim);

          // Check for overrides if enabled and API keys are available
          let override = null;
          if (CONFIG.features?.enable_override_engine && hasApiKeys.ai) {
            override = await overrideEngine.checkOverride(normalizedClaim);
          }

          return {
            claim: normalizedClaim.original_claim,
            normalized: normalizedClaim,
            scores,
            override,
            finalScore: override?.score || scores.final
          };
        } catch (error) {
          Logger.error('Error scoring claim:', error);
          // Return neutral score on error
          return {
            claim: normalizedClaim.original_claim,
            normalized: normalizedClaim,
            scores: { final: 5, confidence: 'low', components: {} },
            override: null,
            finalScore: 5
          };
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);
      scoredResults.push(...batchResults.map(r => r.status === 'fulfilled' ? r.value : null).filter(r => r !== null));
    }

    console.log('Truth Check: Claims scored successfully');

    // Highlight claims on page using real highlighter
    highlightClaimsWithPipeline(scoredResults);

    // Update popup status
    updatePopupStatusWithPipeline(scoredResults);

  } catch (error) {
    console.error('Truth Check: Error in main processing:', error);
    Logger.error('Error in main processing:', error);
  }
}

// Highlight claims on the page using real pipeline
function highlightClaimsWithPipeline(scoredResults) {
  console.log('Truth Check: Highlighting claims on page...');
  console.log('Truth Check: Attempting to highlight', scoredResults.length, 'claims');

  // Clear existing highlights
  highlighter.removeAllHighlights();

  let highlightedCount = 0;

  // Create highlights for each scored claim
  scoredResults.forEach((result, idx) => {
    if (!result || !result.claim) {
      console.log('Truth Check: Skipping result', idx, '- no claim text');
      return;
    }

    // Find all occurrences of the claim text in the DOM
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let node;
    const positions = [];
    const claimLower = result.claim.toLowerCase().trim();
    
    // Normalize whitespace in claim for better matching
    const claimNormalized = claimLower.replace(/\s+/g, ' ');

    while (node = walker.nextNode()) {
      const text = node.textContent;
      const textNormalized = text.toLowerCase().replace(/\s+/g, ' ');
      
      // Try exact match first
      let index = textNormalized.indexOf(claimNormalized);
      
      // If no exact match and claim is long, try matching first 50 chars for partial matches
      if (index === -1 && claimNormalized.length > 50) {
        const claimPrefix = claimNormalized.substring(0, 50);
        index = textNormalized.indexOf(claimPrefix);
      }

      if (index !== -1 && text.length < 2000) {
        // Find the actual position in the original (non-normalized) text
        const actualIndex = text.toLowerCase().indexOf(result.claim.toLowerCase().substring(0, 30));
        if (actualIndex !== -1) {
          positions.push({
            node,
            startIndex: actualIndex,
            endIndex: actualIndex + Math.min(result.claim.length, text.length - actualIndex)
          });
        }
      }
    }

    // Create highlight if positions found
    if (positions.length > 0) {
      const highlightIds = highlighter.highlightMultiplePositions(
        positions,
        result.finalScore,
        result
      );

      highlightedCount++;

      // Attach tooltip handlers to each highlight
      highlightIds.forEach(highlightId => {
        const highlightElement = document.getElementById(highlightId);
        if (highlightElement) {
          highlightElement.addEventListener('mouseenter', (e) => {
            const highlightData = highlighter.getHighlightInfo(highlightId);
            if (highlightData) {
              tooltip.showTooltip(highlightElement, highlightData);
            }
          });

          highlightElement.addEventListener('mouseleave', () => {
            tooltip.scheduleHide();
          });
        }
      });
    } else {
      // Log claims that couldn't be highlighted for debugging
      if (idx < 5) {
        console.log('Truth Check: Could not find text for claim:', result.claim.substring(0, 100) + '...');
      }
    }
  });

  console.log(`Truth Check: Successfully highlighted ${highlightedCount} out of ${scoredResults.length} claims`);
}

// Update popup status with detailed pipeline data
function updatePopupStatusWithPipeline(scoredResults) {
  const totalClaims = scoredResults.length;
  const highTrust = scoredResults.filter(item => item.finalScore >= 8).length;
  const mediumTrust = scoredResults.filter(item => item.finalScore >= 5 && item.finalScore < 8).length;
  const lowTrust = scoredResults.filter(item => item.finalScore < 5).length;

  // Calculate confidence distribution
  const highConfidence = scoredResults.filter(item => item.scores.confidence === 'high').length;
  const mediumConfidence = scoredResults.filter(item => item.scores.confidence === 'medium').length;
  const lowConfidence = scoredResults.filter(item => item.scores.confidence === 'low').length;

  // Store detailed status for popup
  const status = {
    ready: true,
    claimsAnalyzed: totalClaims,
    stats: {
      total: totalClaims,
      high: highTrust,
      medium: mediumTrust,
      low: lowTrust
    },
    confidence: {
      high: highConfidence,
      medium: mediumConfidence,
      low: lowConfidence
    },
    features: {
      highlighting: highlighter.enabled,
      confidenceFilter: highlighter.confidenceFilter,
      overrideEngine: CONFIG.features?.enable_override_engine || false
    },
    timestamp: Date.now()
  };

  // Store in chrome.storage for popup access
  chrome.storage.local.set({ truthCheckStatus: status });
}

// Add CSS styles for highlights (tooltips are handled by styles.css)
function addHighlightStyles() {
  if (document.getElementById('truth-check-styles')) return;

  const style = document.createElement('style');
  style.id = 'truth-check-styles';
  style.textContent = `
    .truth-check-highlight {
      position: relative;
      cursor: help;
      border-radius: 2px;
      padding: 1px 2px;
      margin: 0 1px;
    }
    .truth-check-highlight.score-high-trust {
      background-color: rgba(34, 197, 94, 0.2);
      border: 2px solid #22c55e;
    }
    .truth-check-highlight.score-medium-trust {
      background-color: rgba(234, 179, 8, 0.2);
      border: 2px solid #eab308;
    }
    .truth-check-highlight.score-low-trust {
      background-color: rgba(239, 68, 68, 0.2);
      border: 2px solid #ef4444;
    }
  `;
  document.head.appendChild(style);
}

// Message listener for communication with popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Content script received message:', message);

  if (message.type === 'GET_STATUS') {
    // Return status information to popup
    chrome.storage.local.get('truthCheckStatus', (result) => {
      const status = result.truthCheckStatus || {
        ready: true,
        claimsAnalyzed: 0,
        stats: { total: 0, high: 0, medium: 0, low: 0 }
      };
      sendResponse(status);
    });
    return true; // Keep message channel open for async response
  }

  if (message.type === 'TOGGLE_HIGHLIGHTING') {
    // Handle highlighting toggle from popup using real highlighter
    console.log('Toggling highlighting:', message.enabled);
    highlighter.setEnabled(message.enabled);
    // Store preference
    chrome.storage.sync.set({ highlightingEnabled: message.enabled });
    sendResponse({ success: true });
  }

  if (message.type === 'TOGGLE_CONFIDENCE_FILTER') {
    // Handle confidence filter toggle from popup using real highlighter
    console.log('Toggling confidence filter:', message.enabled);
    highlighter.setConfidenceFilter(message.enabled);
    // Store preference
    chrome.storage.sync.set({ confidenceFilterEnabled: message.enabled });
    sendResponse({ success: true });
  }

  return true; // Keep message channel open for async response
});

// Initialize when DOM is ready
console.log('Truth Check: Setting up initialization...');
if (document.readyState === 'loading') {
  console.log('Truth Check: Waiting for DOM to be ready...');
  document.addEventListener('DOMContentLoaded', () => {
    addHighlightStyles();
    initializeExtension();
  });
} else {
  console.log('Truth Check: DOM already ready, initializing...');
  addHighlightStyles();
  // Use setTimeout to ensure DOM is fully ready, even if readyState suggests it is
  setTimeout(() => initializeExtension(), 100);
}
