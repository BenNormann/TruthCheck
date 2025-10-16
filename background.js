// Background script for Truth Check extension
console.log('Truth Check extension background script loaded');

// Default configuration - will be overridden by stored config
let CONFIG = {
  extension_name: "Truth Check",
  extension_version: "1.0.0",
  debug_mode: true,
  min_content_length: 300,
  scoring: {
    high_trust: 8,
    medium_trust: 5,
    low_trust: 3,
    fact_checker: { weight: 0.35, enabled: true },
    source_credibility: { weight: 0.20, enabled: true },
    scholarly: { weight: 0.30, enabled: true },
    coherence: { weight: 0.15, enabled: true }
  },
  display: {
    colors: {
      high: "#22c55e",
      medium: "#eab308",
      low: "#ef4444"
    }
  }
};

// Load configuration from storage
async function loadConfig() {
  try {
    const stored = await chrome.storage.sync.get('config');
    if (stored.config) {
      CONFIG = { ...CONFIG, ...stored.config };
      console.log('Loaded configuration from storage');
    } else {
      // Save default config to storage
      await chrome.storage.sync.set({ config: CONFIG });
      console.log('Saved default configuration to storage');
    }
  } catch (error) {
    console.error('Error loading config:', error);
  }
  return CONFIG;
}

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Truth Check extension installed');
  }
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);

  if (message.type === 'GET_CONFIG') {
    // Return configuration to requester
    sendResponse(CONFIG);
  }

  return true; // Keep message channel open for async response
});
