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
  },

  // Simple claim extraction (basic implementation)
  extractClaims: function(text) {
    const claims = [];
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (trimmed.length > 20 && trimmed.length < 200) {
        claims.push(trimmed);
      }
    }

    return claims.slice(0, 10); // Limit to 10 claims for performance
  },

  // Simple scoring (mock implementation)
  scoreClaims: function(claims) {
    return claims.map(claim => ({
      claim,
      score: Math.random() * 10, // Mock score
      confidence: Math.random()
    }));
  }
};

async function initializeExtension() {
  try {
    console.log('Truth Check: Initializing extension...');

    // Load CONFIG from background script
    console.log('Truth Check: Loading configuration...');
    CONFIG = await getConfig();

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

    // Extract claims from article
    console.log('Truth Check: Extracting claims from article...');
    const claims = Utils.extractClaims(articleContent);
    console.log('Truth Check: Claims found:', claims.length);

    if (claims.length === 0) {
      console.log('Truth Check: No claims found in article');
      Logger.log('No claims found in article');
      return;
    }

    console.log('Truth Check: Claims extracted successfully');
    console.log('Truth Check: Found', claims.length, 'claims to analyze');

    // Score claims
    console.log('Truth Check: Scoring claims...');
    const scoredClaims = Utils.scoreClaims(claims);
    console.log('Truth Check: Claims scored successfully');

    // Highlight claims on page
    highlightClaims(scoredClaims);

    // Update popup status
    updatePopupStatus(scoredClaims);

  } catch (error) {
    console.error('Truth Check: Error in main processing:', error);
    Logger.error('Error in main processing:', error);
  }
}

// Highlight claims on the page
function highlightClaims(scoredClaims) {
  console.log('Truth Check: Highlighting claims on page...');

  scoredClaims.forEach(item => {
    const { claim, score } = item;

    // Find claim text in the DOM
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let node;
    while (node = walker.nextNode()) {
      const text = node.textContent;
      const index = text.toLowerCase().indexOf(claim.toLowerCase());

      if (index !== -1 && text.length < 1000) {
        // Create highlight span
        const highlight = document.createElement('span');
        highlight.className = `truth-check-highlight score-${getScoreClass(score)}`;
        highlight.title = `Truth Score: ${score.toFixed(1)}/10`;

        // Split text and insert highlight
        const beforeText = text.substring(0, index);
        const afterText = text.substring(index + claim.length);

        if (beforeText) node.parentNode.insertBefore(document.createTextNode(beforeText), node);
        node.parentNode.insertBefore(highlight, node);
        highlight.appendChild(document.createTextNode(claim));
        if (afterText) node.parentNode.insertBefore(document.createTextNode(afterText), node);

        node.remove();
        break; // Only highlight first occurrence
      }
    }
  });

  console.log('Truth Check: Claims highlighted successfully');
}

// Get CSS class for score
function getScoreClass(score) {
  if (score >= 8) return 'high-trust';
  if (score >= 5) return 'medium-trust';
  return 'low-trust';
}

// Update popup status
function updatePopupStatus(scoredClaims) {
  const totalClaims = scoredClaims.length;
  const highTrust = scoredClaims.filter(item => item.score >= 8).length;
  const mediumTrust = scoredClaims.filter(item => item.score >= 5 && item.score < 8).length;
  const lowTrust = scoredClaims.filter(item => item.score < 5).length;

  // Store status for popup
  const status = {
    ready: true,
    claimsAnalyzed: totalClaims,
    stats: {
      total: totalClaims,
      high: highTrust,
      medium: mediumTrust,
      low: lowTrust
    }
  };

  // Store in chrome.storage for popup access
  chrome.storage.local.set({ truthCheckStatus: status });
}

// Add CSS styles for highlights
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
    // Handle highlighting toggle from popup
    console.log('Toggling highlighting:', message.enabled);
    // Store preference
    chrome.storage.sync.set({ highlightingEnabled: message.enabled });
    sendResponse({ success: true });
  }

  if (message.type === 'TOGGLE_CONFIDENCE_FILTER') {
    // Handle confidence filter toggle from popup
    console.log('Toggling confidence filter:', message.enabled);
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
