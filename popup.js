// Popup script for Truth Check extension
document.addEventListener('DOMContentLoaded', async function() {
  console.log('Truth Check popup loaded');

  // Get DOM elements
  const statusEl = document.getElementById('status');
  const statusTextEl = document.getElementById('status-text');
  const highlightToggle = document.getElementById('highlight-toggle');
  const highlightText = document.getElementById('highlight-text');
  const highlightSwitch = document.getElementById('highlight-switch');
  const confidenceToggle = document.getElementById('confidence-toggle');
  const confidenceText = document.getElementById('confidence-text');
  const confidenceSwitch = document.getElementById('confidence-switch');
  const claimsCountEl = document.getElementById('claims-count');
  const highTrustCountEl = document.getElementById('high-trust-count');
  const mediumTrustCountEl = document.getElementById('medium-trust-count');
  const lowTrustCountEl = document.getElementById('low-trust-count');

  // Load CONFIG
  let CONFIG = {};
  try {
    CONFIG = await getConfig();
  } catch (error) {
    console.error('Failed to load config:', error);
  }

  // Initialize popup state
  await initializePopup();

  // Set up event listeners
  highlightToggle.addEventListener('click', toggleHighlighting);
  confidenceToggle.addEventListener('click', toggleConfidenceFilter);

  async function getConfig() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (response) => {
        resolve(response || {});
      });
    });
  }

  async function initializePopup() {
    try {
      // Load status from storage (set by content script)
      const status = await chrome.storage.local.get('truthCheckStatus');
      const truthCheckStatus = status.truthCheckStatus || {
        ready: false,
        claimsAnalyzed: 0,
        stats: { total: 0, high: 0, medium: 0, low: 0 }
      };

      if (truthCheckStatus.ready) {
        showStatus('active', `Ready - ${truthCheckStatus.claimsAnalyzed || 0} claims analyzed`);
        updateStats(truthCheckStatus.stats || { total: 0, high: 0, medium: 0, low: 0 });
      } else {
        showStatus('inactive', 'Extension not ready');
      }

      // Load user preferences
      const preferences = await chrome.storage.sync.get(['highlightingEnabled', 'confidenceFilterEnabled']);

      // Set highlighting toggle state
      const highlightingEnabled = preferences.highlightingEnabled !== false; // Default true
      setToggleState(highlightSwitch, highlightText, highlightingEnabled, 'Enabled', 'Disabled');

      // Set confidence filter toggle state
      const confidenceFilterEnabled = preferences.confidenceFilterEnabled === true; // Default false
      setToggleState(confidenceSwitch, confidenceText, confidenceFilterEnabled, 'Enabled', 'Disabled');

    } catch (error) {
      console.error('Error initializing popup:', error);
      showStatus('inactive', 'Error loading status');
    }
  }

  function showStatus(type, message) {
    statusEl.className = `status ${type}`;
    statusTextEl.textContent = message;
  }

  function setToggleState(switchEl, textEl, active, activeText, inactiveText) {
    if (active) {
      switchEl.classList.add('active');
      textEl.textContent = activeText;
      switchEl.parentElement.classList.add('active');
    } else {
      switchEl.classList.remove('active');
      textEl.textContent = inactiveText;
      switchEl.parentElement.classList.remove('active');
    }
  }

  function updateStats(stats) {
    claimsCountEl.textContent = stats.total || 0;
    highTrustCountEl.textContent = stats.high || 0;
    mediumTrustCountEl.textContent = stats.medium || 0;
    lowTrustCountEl.textContent = stats.low || 0;
  }

  async function toggleHighlighting() {
    const currentlyEnabled = highlightSwitch.classList.contains('active');

    try {
      // Save preference
      await chrome.storage.sync.set({ highlightingEnabled: !currentlyEnabled });

      // Update UI
      setToggleState(highlightSwitch, highlightText, !currentlyEnabled, 'Enabled', 'Disabled');

    } catch (error) {
      console.error('Error toggling highlighting:', error);
    }
  }

  async function toggleConfidenceFilter() {
    const currentlyEnabled = confidenceSwitch.classList.contains('active');

    try {
      // Save preference
      await chrome.storage.sync.set({ confidenceFilterEnabled: !currentlyEnabled });

      // Update UI
      setToggleState(confidenceSwitch, confidenceText, !currentlyEnabled, 'Enabled', 'Disabled');

    } catch (error) {
      console.error('Error toggling confidence filter:', error);
    }
  }

  // Handle settings link
  document.getElementById('settings-link').addEventListener('click', (e) => {
    e.preventDefault();
    // For now, just show an alert - in a real implementation, you'd open a settings page
    alert('Settings panel would open here. Configuration can be modified in the CONFIG object.');
  });

  // Request status updates periodically
  setInterval(async () => {
    try {
      const status = await chrome.storage.local.get('truthCheckStatus');
      const truthCheckStatus = status.truthCheckStatus;

      if (truthCheckStatus && truthCheckStatus.ready) {
        showStatus('active', `Ready - ${truthCheckStatus.claimsAnalyzed || 0} claims analyzed`);
        updateStats(truthCheckStatus.stats || { total: 0, high: 0, medium: 0, low: 0 });
      }
    } catch (error) {
      // Silently handle errors during periodic updates
    }
  }, 2000);
});
