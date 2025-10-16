// Highlighter - Highlight claims on web pages with colors and metadata
import CONFIG from '../foundation/config.js';
import logger from '../foundation/logger.js';

class Highlighter {
  constructor() {
    this.highlights = new Map();
    this.enabled = true;
    this.confidenceFilter = false;
    this.nextId = 0;
  }

  highlightText(node, startIndex, endIndex, color, result) {
    if (!this.enabled) return null;

    // Check confidence filter
    if (this.confidenceFilter && result.scores.confidence === 'low') {
      return null;
    }

    try {
      const highlightId = `truth-check-${this.nextId++}`;
      const text = node.textContent;

      if (startIndex < 0 || endIndex > text.length || startIndex >= endIndex) {
        logger.warn('Invalid highlight range:', { startIndex, endIndex, textLength: text.length });
        return null;
      }

      // Split the text node at the highlight boundaries
      const beforeText = text.substring(0, startIndex);
      const highlightText = text.substring(startIndex, endIndex);
      const afterText = text.substring(endIndex);

      // Create text nodes for before and after
      const beforeNode = document.createTextNode(beforeText);
      const afterNode = document.createTextNode(afterText);

      // Create highlight span
      const highlightSpan = document.createElement('span');
      highlightSpan.className = `truth-check-highlight ${this.getColorClass(color)}`;
      highlightSpan.id = highlightId;
      highlightSpan.textContent = highlightText;

      // Store metadata
      this.highlights.set(highlightId, {
        id: highlightId,
        claim: result.claim,
        normalized: result.normalized,
        scores: result.scores,
        override: result.override,
        finalScore: result.finalScore,
        positions: [{ node: highlightSpan, startIndex, endIndex }],
        color: color
      });

      // Replace the original node
      const parent = node.parentNode;
      parent.insertBefore(beforeNode, node);
      parent.insertBefore(highlightSpan, node);
      parent.insertBefore(afterNode, node);
      parent.removeChild(node);

      logger.debug('Created highlight:', highlightId);
      return highlightId;

    } catch (error) {
      logger.error('Error creating highlight:', error);
      return null;
    }
  }

  highlightMultiplePositions(positions, color, result) {
    const highlightIds = [];

    for (const pos of positions) {
      const id = this.highlightText(pos.node, pos.startIndex, pos.endIndex, color, result);
      if (id) {
        highlightIds.push(id);
      }
    }

    return highlightIds;
  }

  getColorClass(color) {
    if (color >= CONFIG.scoring.high_trust) {
      return 'high-trust';
    } else if (color >= CONFIG.scoring.medium_trust) {
      return 'medium-trust';
    } else {
      return 'low-trust';
    }
  }

  removeHighlight(highlightId) {
    const highlight = this.highlights.get(highlightId);
    if (!highlight) return false;

    try {
      // Find and remove all highlight spans for this claim
      highlight.positions.forEach(pos => {
        if (pos.node && pos.node.parentNode) {
          const parent = pos.node.parentNode;

          // Replace the highlight span with its text content
          const textNode = document.createTextNode(pos.node.textContent);
          parent.replaceChild(textNode, pos.node);
        }
      });

      this.highlights.delete(highlightId);
      logger.debug('Removed highlight:', highlightId);
      return true;

    } catch (error) {
      logger.error('Error removing highlight:', error);
      return false;
    }
  }

  removeAllHighlights() {
    const highlightIds = Array.from(this.highlights.keys());
    let removed = 0;

    highlightIds.forEach(id => {
      if (this.removeHighlight(id)) {
        removed++;
      }
    });

    logger.log(`Removed ${removed} highlights`);
    return removed;
  }

  updateHighlight(highlightId, newResult) {
    const highlight = this.highlights.get(highlightId);
    if (!highlight) return false;

    try {
      // Update metadata
      highlight.scores = newResult.scores;
      highlight.override = newResult.override;
      highlight.finalScore = newResult.finalScore;

      // Update color if needed
      const newColor = this.getColorFromScore(newResult.finalScore);
      if (newColor !== highlight.color) {
        highlight.color = newColor;

        // Update CSS class
        highlight.positions.forEach(pos => {
          if (pos.node) {
            pos.node.className = `truth-check-highlight ${this.getColorClass(newColor)}`;
          }
        });
      }

      logger.debug('Updated highlight:', highlightId);
      return true;

    } catch (error) {
      logger.error('Error updating highlight:', error);
      return false;
    }
  }

  getColorFromScore(score) {
    if (score >= CONFIG.scoring.high_trust) {
      return CONFIG.display.colors.high;
    } else if (score >= CONFIG.scoring.medium_trust) {
      return CONFIG.display.colors.medium;
    } else {
      return CONFIG.display.colors.low;
    }
  }

  getHighlightInfo(highlightId) {
    return this.highlights.get(highlightId) || null;
  }

  getAllHighlights() {
    return Array.from(this.highlights.entries()).map(([id, highlight]) => ({
      id,
      ...highlight
    }));
  }

  getHighlightsByScore(minScore = 0, maxScore = 10) {
    return this.getAllHighlights().filter(highlight =>
      highlight.finalScore >= minScore && highlight.finalScore <= maxScore
    );
  }

  setEnabled(enabled) {
    this.enabled = enabled;

    if (!enabled) {
      this.removeAllHighlights();
    }

    logger.log(`Highlighting ${enabled ? 'enabled' : 'disabled'}`);
  }

  setConfidenceFilter(enabled) {
    this.confidenceFilter = enabled;

    if (enabled) {
      // Remove low confidence highlights
      const toRemove = this.getAllHighlights().filter(h => h.scores.confidence === 'low');
      toRemove.forEach(h => this.removeHighlight(h.id));
    }

    logger.log(`Confidence filter ${enabled ? 'enabled' : 'disabled'}`);
  }

  // Handle overlapping highlights
  mergeOverlappingHighlights() {
    const highlights = this.getAllHighlights();
    let merged = false;

    for (let i = 0; i < highlights.length; i++) {
      for (let j = i + 1; j < highlights.length; j++) {
        const h1 = highlights[i];
        const h2 = highlights[j];

        if (this.highlightsOverlap(h1, h2)) {
          // Merge the highlights
          this.mergeHighlights(h1.id, h2.id);
          merged = true;
          break;
        }
      }
      if (merged) break;
    }

    return merged;
  }

  highlightsOverlap(h1, h2) {
    // Check if any positions of h1 overlap with positions of h2
    for (const pos1 of h1.positions) {
      for (const pos2 of h2.positions) {
        if (this.rangesOverlap(pos1.startIndex, pos1.endIndex, pos2.startIndex, pos2.endIndex)) {
          return true;
        }
      }
    }
    return false;
  }

  rangesOverlap(start1, end1, start2, end2) {
    return start1 < end2 && start2 < end1;
  }

  mergeHighlights(id1, id2) {
    const h1 = this.highlights.get(id1);
    const h2 = this.highlights.get(id2);

    if (!h1 || !h2) return false;

    // Combine positions
    h1.positions.push(...h2.positions);

    // Remove duplicate positions
    h1.positions = h1.positions.filter((pos, index, arr) =>
      arr.findIndex(p => p.node === pos.node &&
                         p.startIndex === pos.startIndex &&
                         p.endIndex === pos.endIndex) === index
    );

    // Use the higher score
    if (h2.finalScore > h1.finalScore) {
      h1.finalScore = h2.finalScore;
      h1.color = this.getColorFromScore(h2.finalScore);
    }

    this.highlights.delete(id2);

    logger.debug('Merged highlights:', id1, id2);
    return true;
  }

  // Performance optimization: limit number of highlights
  limitHighlights(maxHighlights = 50) {
    const allHighlights = this.getAllHighlights();

    if (allHighlights.length <= maxHighlights) {
      return 0;
    }

    // Remove oldest highlights first
    allHighlights
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .slice(0, allHighlights.length - maxHighlights)
      .forEach(highlight => {
        this.removeHighlight(highlight.id);
      });

    const removed = allHighlights.length - this.highlights.size;
    logger.log(`Limited highlights: removed ${removed}`);
    return removed;
  }

  // Get statistics about highlights
  getStats() {
    const highlights = this.getAllHighlights();
    const stats = {
      total: highlights.length,
      high_trust: 0,
      medium_trust: 0,
      low_trust: 0,
      enabled: this.enabled,
      confidence_filter: this.confidenceFilter
    };

    highlights.forEach(highlight => {
      if (highlight.finalScore >= CONFIG.scoring.high_trust) {
        stats.high_trust++;
      } else if (highlight.finalScore >= CONFIG.scoring.medium_trust) {
        stats.medium_trust++;
      } else {
        stats.low_trust++;
      }
    });

    return stats;
  }
}

export default Highlighter;
