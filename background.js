// Background script for Truth Check extension
console.log('Truth Check extension background script loaded');

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
