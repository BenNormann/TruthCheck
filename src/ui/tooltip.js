// Tooltip UI Component - Interactive tooltip displaying claim trustworthiness scores

// Get CONFIG from global scope or provide fallback
const getConfig = () => {
  if (typeof window !== 'undefined' && window.CONFIG) {
    return window.CONFIG;
  }

  // Fallback CONFIG
  return {
    display: {
      colors: {
        high: "#22c55e",
        medium: "#eab308",
        low: "#ef4444"
      },
      show_breakdown: true,
      show_sources: true,
      tooltip_delay: 300
    },
    scoring: {
      high_trust: 8,
      medium_trust: 5,
      low_trust: 3
    }
  };
};

// Simple logger
const logger = {
  log: console.log.bind(console, '[Tooltip]'),
  error: console.error.bind(console, '[Tooltip ERROR]'),
  debug: console.debug.bind(console, '[Tooltip DEBUG]')
};

class TooltipManager {
  constructor() {
    this.activeTooltip = null;
    this.hideTimeout = null;
    this.modal = null;
    this.tooltipContainer = null;
    this.initialized = false;
  }

  initialize() {
    if (this.initialized) return;

    // Create tooltip container
    this.tooltipContainer = document.createElement('div');
    this.tooltipContainer.className = 'truth-check-tooltip-container';
    this.tooltipContainer.style.position = 'fixed';
    this.tooltipContainer.style.top = '0';
    this.tooltipContainer.style.left = '0';
    this.tooltipContainer.style.zIndex = '10000';
    this.tooltipContainer.style.pointerEvents = 'none';
    document.body.appendChild(this.tooltipContainer);

    // Create modal container
    this.modal = new BibliographyModal();
    this.modal.initialize();

    this.initialized = true;
    logger.log('Tooltip manager initialized');
  }

  showTooltip(highlightElement, highlightData) {
    const CONFIG = getConfig();
    if (!this.initialized) {
      this.initialize();
    }

    // Clear any existing hide timeout
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }

    // Remove existing tooltip
    this.hideTooltip();

    // Create new tooltip
    this.activeTooltip = new Tooltip(highlightElement, highlightData, this.modal);
    this.activeTooltip.show();
  }

  hideTooltip() {
    if (this.activeTooltip) {
      this.activeTooltip.hide();
      this.activeTooltip = null;
    }
  }

  scheduleHide(delay = 100) {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
    }

    this.hideTimeout = setTimeout(() => {
      this.hideTooltip();
    }, delay);
  }

  cancelHide() {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }
}

// Bibliography Modal Component
class BibliographyModal {
  constructor() {
    this.modal = null;
    this.overlay = null;
    this.isOpen = false;
    this.initialized = false;
  }

  initialize() {
    if (this.initialized) return;

    // Create overlay
    this.overlay = document.createElement('div');
    this.overlay.className = 'truth-check-modal-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 1001;
      opacity: 0;
      transition: opacity 0.2s ease;
      pointer-events: none;
    `;

    // Create modal
    this.modal = document.createElement('div');
    this.modal.className = 'truth-check-modal';
    this.modal.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      border-radius: 8px;
      padding: 20px;
      max-width: 600px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
      z-index: 1002;
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.9);
      transition: all 0.2s ease;
    `;

    this.overlay.appendChild(this.modal);
    document.body.appendChild(this.overlay);

    // Close on overlay click
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.close();
      }
    });

    // Close on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });

    this.initialized = true;
    logger.log('Bibliography modal initialized');
  }

  async open(sourceData) {
    if (!this.initialized) this.initialize();

    try {
      // Show loading state
      this.modal.innerHTML = `
        <div class="truth-check-modal-header">
          <h3>Loading source details...</h3>
        </div>
        <div class="truth-check-modal-body">
          <div class="truth-check-modal-loading">
            <div class="truth-check-modal-spinner"></div>
            <p>Fetching source information...</p>
          </div>
        </div>
      `;

      this.overlay.style.pointerEvents = 'auto';
      this.overlay.style.opacity = '1';
      this.modal.style.opacity = '1';
      this.modal.style.transform = 'translate(-50%, -50%) scale(1)';
      this.isOpen = true;

      // Fetch source details (simulate async operation)
      await this.loadSourceDetails(sourceData);

    } catch (error) {
      logger.error('Error opening bibliography modal:', error);
      this.showError('Unable to load source details');
    }
  }

  async loadSourceDetails(sourceData) {
    // Simulate loading source details
    await new Promise(resolve => setTimeout(resolve, 500));

    const modalContent = this.generateModalContent(sourceData);
    this.modal.innerHTML = modalContent;
  }

  generateModalContent(sourceData) {
    const { title, url, excerpt, type, date, status } = sourceData;

    return `
      <div class="truth-check-modal-header">
        <button class="truth-check-modal-close" onclick="window.tooltipManager?.modal.close()">×</button>
        <h3>Source Details</h3>
      </div>
      <div class="truth-check-modal-body">
        <div class="truth-check-modal-badge truth-check-modal-badge-${status.toLowerCase()}">
          ${this.getStatusIcon(status)} ${status}
        </div>

        <h4 class="truth-check-modal-title">${this.escapeHtml(title)}</h4>

        <div class="truth-check-modal-meta">
          <div class="truth-check-modal-type">${type}</div>
          ${date ? `<div class="truth-check-modal-date">${date}</div>` : ''}
        </div>

        <div class="truth-check-modal-url">
          <a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>
        </div>

        ${excerpt ? `
          <div class="truth-check-modal-excerpt">
            <h5>Excerpt:</h5>
            <blockquote>"${this.escapeHtml(excerpt)}"</blockquote>
          </div>
        ` : ''}

        <div class="truth-check-modal-actions">
          <a href="${url}" target="_blank" rel="noopener noreferrer" class="truth-check-modal-open">
            Open Full Source →
          </a>
        </div>
      </div>
    `;
  }

  getStatusIcon(status) {
    switch (status) {
      case 'CORROBORATED':
      case 'SUPPORTED':
        return '✓';
      case 'CONTRADICTED':
        return '✗';
      case 'UNVERIFIED':
      default:
        return '⚠';
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showError(message) {
    this.modal.innerHTML = `
      <div class="truth-check-modal-header">
        <button class="truth-check-modal-close" onclick="window.tooltipManager?.modal.close()">×</button>
        <h3>Error</h3>
      </div>
      <div class="truth-check-modal-body">
        <div class="truth-check-modal-error">
          <p>${this.escapeHtml(message)}</p>
          <button onclick="window.tooltipManager?.modal.close()" class="truth-check-modal-retry">
            Close
          </button>
        </div>
      </div>
    `;
  }

  close() {
    this.overlay.style.opacity = '0';
    this.modal.style.opacity = '0';
    this.modal.style.transform = 'translate(-50%, -50%) scale(0.9)';
    this.overlay.style.pointerEvents = 'none';
    this.isOpen = false;
  }
}

// Main Tooltip Component
class Tooltip {
  constructor(highlightElement, highlightData, modal) {
    this.highlightElement = highlightElement;
    this.highlightData = highlightData;
    this.modal = modal;
    this.element = null;
    this.position = { top: 0, left: 0 };
  }

  createElement() {
    this.element = document.createElement('div');
    this.element.className = 'truth-check-tooltip';
    this.element.innerHTML = this.generateContent();
    return this.element;
  }

  generateContent() {
    const { claim, finalScore, scores } = this.highlightData;
    const components = scores?.components || scores || {};

    if (!claim || !finalScore) {
      return '<div>Error: Invalid tooltip data</div>';
    }

    // Truncate claim text (first 80 characters)
    const displayClaim = claim.length > 80 ? claim.substring(0, 80) + '...' : claim;

    // Get score label and color based on exact specifications
    const scoreInfo = this.getScoreInfo(finalScore);

    // Generate score breakdown section (4 components in 2x2 grid)
    const breakdownHtml = this.generateBreakdown(components);

    // Generate evidence section (conditional)
    const evidenceHtml = this.generateEvidence(components);

    return `
      <div class="truth-check-tooltip-header">
        <div class="truth-check-tooltip-claim">${this.escapeHtml(displayClaim)}</div>
        <div class="truth-check-tooltip-score">${finalScore}</div>
        <div class="truth-check-tooltip-label">${scoreInfo.label}</div>
      </div>

      ${breakdownHtml}

      ${evidenceHtml}
    `;
  }


  generateBreakdown(components) {
    const CONFIG = getConfig();
    if (!CONFIG.display.show_breakdown) return '';

    const componentOrder = ['fact_checker', 'source_credibility', 'scholarly', 'coherence'];

    return `
      <div class="truth-check-tooltip-breakdown">
        ${componentOrder.map((component, index) => this.generateComponentRow(component, components[component], index)).join('')}
      </div>
    `;
  }

  generateComponentRow(component, data, index) {
    const label = this.getComponentLabel(component);
    const score = data?.score ?? 5;
    const error = data?.error;
    const scoreInfo = this.getScoreInfo(score);

    // Handle different error types according to specifications
    let displayText = `${score}/10`;
    let valueClass = scoreInfo.level;

    if (error) {
      displayText = `N/A - ${error}`;
      valueClass = 'error';
    } else if (score === 5 && !data) {
      // Component not enabled or no data
      displayText = 'N/A - Disabled';
      valueClass = 'disabled';
    }

    return `
      <div class="truth-check-tooltip-component">
        <div class="truth-check-tooltip-component-label">${label}:</div>
        <div class="truth-check-tooltip-component-value ${valueClass}">${displayText}</div>
      </div>
    `;
  }

  generateEvidence(components) {
    const CONFIG = getConfig();
    if (!CONFIG.display.show_sources) return '';

    const evidence = this.extractEvidence(components);

    if (!evidence.length) {
      return `
        <div class="truth-check-tooltip-evidence">
          <div class="truth-check-tooltip-evidence-item">
            <span class="truth-check-tooltip-evidence-icon">⚠</span>
            <span class="truth-check-tooltip-evidence-text">NO CORROBORATING EVIDENCE</span>
            <span class="truth-check-tooltip-evidence-status">UNVERIFIED</span>
          </div>
        </div>
      `;
    }

    return `
      <div class="truth-check-tooltip-evidence">
        ${evidence.map(ev => this.generateEvidenceItem(ev)).join('')}
      </div>
    `;
  }

  generateEvidenceItem(evidence) {
    let statusIcon, statusText, badgeClass;

    switch (evidence.status) {
      case 'corroborated':
        statusIcon = '✓';
        statusText = 'FACT-CHECKER CORROBORATION';
        badgeClass = 'corroborated';
        break;
      case 'contradicted':
        statusIcon = '✗';
        statusText = 'DIRECT CONTRADICTION';
        badgeClass = 'contradicted';
        break;
      case 'supported':
        statusIcon = '✓';
        statusText = 'SCHOLARLY CORROBORATION';
        badgeClass = 'supported';
        break;
      default:
        statusIcon = '⚠';
        statusText = 'NO CORROBORATING EVIDENCE';
        badgeClass = 'unverified';
    }

    return `
      <div class="truth-check-tooltip-evidence-item">
        <div class="truth-check-tooltip-evidence-header">
          <span class="truth-check-tooltip-evidence-icon">${statusIcon}</span>
          <span class="truth-check-tooltip-evidence-text">${statusText}</span>
        </div>
        <div class="truth-check-tooltip-evidence-source">
          Source: ${evidence.source}
        </div>
        <button class="truth-check-tooltip-view-source" onclick="window.tooltipManager?.modal.open(${JSON.stringify(evidence).replace(/"/g, '&quot;')})">
          [CLICK TO VIEW]
        </button>
      </div>
    `;
  }

  extractEvidence(components) {
    const evidence = [];

    // Fact-checker evidence
    if (components.fact_checker) {
      const score = components.fact_checker.score;
      if (score >= 8) {
        evidence.push({
          source: components.fact_checker.source || 'FactCheck.org',
          status: 'corroborated',
          title: components.fact_checker.explanation || 'Fact-check result',
          url: components.fact_checker.url || '#',
          excerpt: 'Fact-checking analysis available',
          type: 'Fact-Checker',
          date: components.fact_checker.date || null,
          badge: 'CORROBORATED'
        });
      } else if (score <= 3) {
        evidence.push({
          source: components.fact_checker.source || 'FactCheck.org',
          status: 'contradicted',
          title: components.fact_checker.explanation || 'Fact-check result',
          url: components.fact_checker.url || '#',
          excerpt: 'Fact-checking analysis available',
          type: 'Fact-Checker',
          date: components.fact_checker.date || null,
          badge: 'CONTRADICTED'
        });
      }
    }

    // Scholarly evidence
    if (components.scholarly && components.scholarly.sources && components.scholarly.sources.length > 0) {
      const primarySource = components.scholarly.sources[0];

      if (primarySource.support_level === 'supports' || primarySource.score >= 7) {
        evidence.push({
          source: `Google Scholar - ${primarySource.source_title || 'Scholarly Paper'}`,
          status: 'supported',
          title: primarySource.source_title || 'Scholarly paper',
          url: primarySource.url || '#',
          excerpt: primarySource.excerpt || 'Research findings available',
          type: 'Scholarly Paper',
          date: primarySource.year ? `${primarySource.year}` : null,
          badge: 'SUPPORTED'
        });
      } else if (primarySource.support_level === 'contradicts' || primarySource.score <= 3) {
        evidence.push({
          source: `Google Scholar - ${primarySource.source_title || 'Scholarly Paper'}`,
          status: 'contradicted',
          title: primarySource.source_title || 'Scholarly paper',
          url: primarySource.url || '#',
          excerpt: primarySource.excerpt || 'Research findings available',
          type: 'Scholarly Paper',
          date: primarySource.year ? `${primarySource.year}` : null,
          badge: 'CONTRADICTED'
        });
      }
    }

    return evidence;
  }

  getComponentLabel(component) {
    const labels = {
      fact_checker: 'Fact-Checker',
      source_credibility: 'Source Credibility',
      scholarly: 'Scholarly Evidence',
      coherence: 'Coherence & Flags'
    };
    return labels[component] || component;
  }

  getScoreInfo(score) {
    const CONFIG = getConfig();
    let level, label, color;

    if (score >= 8) {
      level = 'high';
      label = 'High Trust';
      color = CONFIG.display.colors.high;
    } else if (score >= 5) {
      level = 'medium';
      label = score === 5 ? 'Uncertain' : 'Mixed Signals';
      color = CONFIG.display.colors.medium;
    } else {
      level = 'low';
      label = 'Low Trust';
      color = CONFIG.display.colors.low;
    }

    return { level, label, color };
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  calculatePosition() {
    const rect = this.highlightElement.getBoundingClientRect();
    const tooltipWidth = 320; // Fixed width as per specifications
    const tooltipHeight = 300; // Approximate height
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight
    };

    // Default: Below claim, center-aligned
    let top = rect.bottom + 5;
    let left = rect.left + (rect.width / 2) - (tooltipWidth / 2);

    // If bottom would be off screen and there's room above, show above
    if (top + tooltipHeight > viewport.height && rect.top > tooltipHeight) {
      top = rect.top - tooltipHeight - 5;
    }

    // Adjust horizontal position if tooltip goes off screen
    if (left + tooltipWidth > viewport.width) {
      left = viewport.width - tooltipWidth - 10;
    }

    if (left < 10) {
      left = 10;
    }

    return { top, left };
  }

  show() {
    if (!this.element) {
      this.createElement();
      document.body.appendChild(this.element);
    }

    this.position = this.calculatePosition();

    this.element.style.cssText = `
      position: fixed;
      top: ${this.position.top}px;
      left: ${this.position.left}px;
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    `;

    // Add event listeners for interactive elements
    this.addInteractiveListeners();
  }

  hide() {
    if (this.element) {
      this.element.style.opacity = '0';
      this.element.style.transform = 'translateY(5px)';

      setTimeout(() => {
        if (this.element && this.element.parentNode) {
          this.element.parentNode.removeChild(this.element);
        }
        this.element = null;
      }, 200);
    }
  }

  addInteractiveListeners() {
    // Add hover effects for interactive elements
    const viewButtons = this.element.querySelectorAll('.truth-check-tooltip-view-source');
    viewButtons.forEach(button => {
      button.addEventListener('mouseenter', () => {
        button.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
      });

      button.addEventListener('mouseleave', () => {
        button.style.backgroundColor = 'transparent';
      });
    });
  }
}

// Create and export singleton instance
const tooltipManager = new TooltipManager();

// Make available globally for content scripts
if (typeof window !== 'undefined') {
  window.TooltipManager = tooltipManager;
}

export default tooltipManager;
