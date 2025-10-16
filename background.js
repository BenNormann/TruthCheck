// Background script for Truth Check extension
console.log('Truth Check extension background script loaded');

// Simplified CONFIG for service worker compatibility
const CONFIG = {
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
