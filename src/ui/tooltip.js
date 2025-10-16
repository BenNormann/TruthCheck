// Tooltip System - Show detailed claim information on hover
import logger from '../foundation/logger.js';

class Tooltip {
  constructor() {
    this.currentTooltip = null;
    this.showDelay = CONFIG.display.tooltip_delay;
    this.hideDelay = 300;
    this.showTimer = null;
    this.hideTimer = null;
    this.isVisible = false;
  }

  show(highlightId, highlightData, event) {
    // Clear any existing timers
    this.clearTimers();

    // Set up show timer
    this.showTimer = setTimeout(() => {
      this.createTooltip(highlightId, highlightData, event);
    }, this.showDelay);
  }

  hide() {
    // Clear show timer if still pending
    if (this.showTimer) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }

    // Set up hide timer
    this.hideTimer = setTimeout(() => {
      this.removeTooltip();
    }, this.hideDelay);
  }

  createTooltip(highlightId, highlightData, event) {
    // Remove existing tooltip
    this.removeTooltip();

    try {
      const tooltip = document.createElement('div');
      tooltip.className = 'truth-check-tooltip';
      tooltip.id = `tooltip-${highlightId}`;

      // Create tooltip content
      tooltip.innerHTML = this.generateTooltipContent(highlightData);

      // Position tooltip
      this.positionTooltip(tooltip, event);

      // Add to DOM
      document.body.appendChild(tooltip);

      // Add event listeners for interactions
      tooltip.addEventListener('mouseenter', () => this.onTooltipMouseEnter());
      tooltip.addEventListener('mouseleave', () => this.onTooltipMouseLeave());

      // Add click handler for "Learn More" links
      tooltip.addEventListener('click', (e) => this.onTooltipClick(e));

      this.currentTooltip = tooltip;
      this.isVisible = true;

      logger.debug('Created tooltip for:', highlightId);

    } catch (error) {
      logger.error('Error creating tooltip:', error);
    }
  }

  generateTooltipContent(highlightData) {
    const { claim, scores, override, finalScore } = highlightData;

    // Header with score and confidence
    const confidence = scores.confidence || 'medium';
    const confidenceClass = confidence;

    let content = `
      <div class="truth-check-tooltip-header">
        <div class="truth-check-tooltip-score">${finalScore}/10</div>
        <div class="truth-check-tooltip-confidence ${confidenceClass}">
          ${confidence.toUpperCase()}
        </div>
      </div>
    `;

    // Component breakdown (if enabled)
    if (CONFIG.display.show_breakdown) {
      content += `
        <div class="truth-check-tooltip-breakdown">
          <div class="truth-check-tooltip-breakdown-title">Score Breakdown:</div>
          <div class="truth-check-tooltip-components">
      `;

      if (scores.components) {
        for (const [component, data] of Object.entries(scores.components)) {
          if (data && typeof data.score === 'number') {
            const componentClass = this.getComponentClass(data.score);
            content += `
              <div class="truth-check-tooltip-component ${componentClass}">
                <span class="truth-check-tooltip-component-label">${this.formatComponentName(component)}</span>
                <span class="truth-check-tooltip-component-value">${data.score}</span>
              </div>
            `;
          }
        }
      }

      content += `
          </div>
        </div>
      `;
    }

    // Fact-checker results (if available)
    if (scores.components?.fact_checker && CONFIG.display.show_confidence) {
      const factChecker = scores.components.fact_checker;
      content += `
        <div class="truth-check-tooltip-evidence">
          <div class="truth-check-tooltip-evidence-title">Fact-Check Results:</div>
          <div class="truth-check-tooltip-evidence-item">
            <span class="truth-check-tooltip-evidence-source">${factChecker.source}:</span>
            <span>${factChecker.explanation}</span>
          </div>
        </div>
      `;
    }

    // Scholarly evidence (if available)
    if (scores.components?.scholarly && scores.components.scholarly.sources) {
      content += `
        <div class="truth-check-tooltip-evidence">
          <div class="truth-check-tooltip-evidence-title">Scholarly Evidence:</div>
      `;

      scores.components.scholarly.sources.slice(0, 2).forEach(source => {
        content += `
          <div class="truth-check-tooltip-evidence-item">
            <span class="truth-check-tooltip-evidence-source">${source.source}:</span>
            <span>${source.title.substring(0, 80)}${source.title.length > 80 ? '...' : ''}</span>
          </div>
        `;
      });

      content += `</div>`;
    }

    // Red flags (if available)
    if (scores.components?.coherence && scores.components.coherence.red_flags) {
      content += `
        <div class="truth-check-tooltip-red-flags">
          <div class="truth-check-tooltip-red-flags-title">Red Flags Detected:</div>
      `;

      scores.components.coherence.red_flags.slice(0, 3).forEach(flag => {
        content += `
          <div class="truth-check-tooltip-red-flag">
            <strong>${flag.flag_type}:</strong> ${flag.significance}
          </div>
        `;
      });

      content += `</div>`;
    }

    // Override information (if applicable)
    if (override) {
      content += `
        <div class="truth-check-tooltip-evidence">
          <div class="truth-check-tooltip-evidence-title">Override Applied:</div>
          <div class="truth-check-tooltip-evidence-item">
            <span class="truth-check-tooltip-evidence-source">${override.source}:</span>
            <span>${override.explanation}</span>
          </div>
        </div>
      `;
    }

    // Footer with learn more link
    content += `
      <div class="truth-check-tooltip-footer">
        <a href="#" class="truth-check-tooltip-learn-more" data-action="learn-more">Learn More</a>
      </div>
    `;

    return content;
  }

  positionTooltip(tooltip, event) {
    const rect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Get mouse position
    const mouseX = event.clientX;
    const mouseY = event.clientY;

    // Calculate position (prefer top-right of mouse, but adjust for viewport)
    let left = mouseX + 10;
    let top = mouseY - rect.height - 10;

    // Adjust if tooltip would go off-screen
    if (left + rect.width > viewportWidth) {
      left = mouseX - rect.width - 10;
    }

    if (top < 0) {
      top = mouseY + 10;
    }

    // Ensure tooltip stays within viewport bounds
    left = Math.max(10, Math.min(left, viewportWidth - rect.width - 10));
    top = Math.max(10, Math.min(top, viewportHeight - rect.height - 10));

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  removeTooltip() {
    if (this.currentTooltip) {
      this.currentTooltip.remove();
      this.currentTooltip = null;
      this.isVisible = false;
      logger.debug('Removed tooltip');
    }
  }

  onTooltipMouseEnter() {
    this.clearTimers();
  }

  onTooltipMouseLeave() {
    this.hide();
  }

  onTooltipClick(event) {
    const action = event.target.getAttribute('data-action');

    if (action === 'learn-more') {
      event.preventDefault();
      this.handleLearnMore(event);
    }
  }

  handleLearnMore(event) {
    // Open detailed view or external resources
    // For now, just log the action
    logger.log('Learn more clicked for tooltip');

    // In a real implementation, this might:
    // 1. Open a detailed popup with more information
    // 2. Navigate to fact-checking websites
    // 3. Show the original sources

    // Placeholder: show alert with more info
    const tooltip = event.target.closest('.truth-check-tooltip');
    const score = tooltip.querySelector('.truth-check-tooltip-score').textContent;
    const confidence = tooltip.querySelector('.truth-check-tooltip-confidence').textContent;

    alert(`Claim Score: ${score}/10 (${confidence} confidence)\n\nFor more detailed information, visit fact-checking websites like Snopes, FactCheck.org, or consult academic sources.`);
  }

  clearTimers() {
    if (this.showTimer) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }

    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  getComponentClass(score) {
    if (score >= CONFIG.scoring.high_trust) {
      return 'high';
    } else if (score >= CONFIG.scoring.medium_trust) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  formatComponentName(component) {
    const nameMap = {
      fact_checker: 'Fact-Checkers',
      source_credibility: 'Source Credibility',
      scholarly: 'Scholarly Sources',
      coherence: 'Content Analysis'
    };

    return nameMap[component] || component.replace('_', ' ');
  }

  // Update tooltip content without recreating
  updateTooltip(highlightId, highlightData) {
    if (this.currentTooltip && this.currentTooltip.id === `tooltip-${highlightId}`) {
      this.currentTooltip.innerHTML = this.generateTooltipContent(highlightData);
      logger.debug('Updated tooltip content for:', highlightId);
    }
  }

  // Check if tooltip is currently visible for a specific highlight
  isVisibleFor(highlightId) {
    return this.currentTooltip &&
           this.currentTooltip.id === `tooltip-${highlightId}` &&
           this.isVisible;
  }

  // Get tooltip statistics
  getStats() {
    return {
      visible: this.isVisible,
      show_delay: this.showDelay,
      hide_delay: this.hideDelay
    };
  }
}

export default Tooltip;
