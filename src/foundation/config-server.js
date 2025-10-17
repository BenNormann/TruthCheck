// CONFIG - Updated for API Server usage
const CONFIG = {
  // Basic extension settings
  extension_name: "Truth Check",
  extension_version: "1.0.0",
  min_content_length: 300,
  async_processing: true,
  debug_mode: true,

  // API Server Configuration
  api_server: {
    enabled: true, // Set to false to use direct API calls
    base_url: "http://localhost:3001",
    timeout: 15000,
    retries: 3
  },

  // Claim extraction settings
  claim_extraction: {
    method: "hybrid", // "heuristic" | "ai" | "hybrid"
    heuristic_threshold: 0.6,
    factual_verbs: [
      "is", "was", "are", "were", "be", "been",
      "caused", "led", "resulted", "produced",
      "found", "discovered", "determined", "established",
      "proved", "demonstrated", "confirmed", "verified",
      "reported", "stated", "announced", "declared",
      "claimed", "asserted", "maintained", "argued",
      "shows", "indicates", "suggests", "implies",
      "reduces", "increases", "decreases", "improves",
      "costs", "saves", "generates", "creates",
      "revealed", "concluded", "demonstrated", "proven",
      "measured", "calculated", "estimated", "projected",
      "rose", "fell", "grew", "declined", "surged", "plummeted",
      "wants", "would", "will", "commemorate", "commemorates",
      "unveiled", "displayed", "built", "construct", "constructed",
      "opened", "gave", "approved", "need", "needs", "requires",
      "takes", "took", "appears", "allows", "prohibits"
    ],
    claim_markers: [
      "according to", "studies show", "research indicates",
      "experts say", "scientists have found", "data shows",
      "evidence suggests", "reports indicate", "findings reveal",
      "statistics show", "numbers indicate", "figures suggest",
      "the study", "the research", "the report", "the analysis",
      "findings show", "results indicate", "survey reveals",
      "investigation found", "analysis shows", "study reveals",
      "research shows", "data reveals", "figures show",
      "the latest", "recent study", "new research", "latest findings",
      "reportedly", "is reportedly", "are reportedly", "was reportedly",
      "congress gave", "congress approved", "federal law", "typically",
      "most notably", "according to a", "in a report", "the report"
    ],
    min_claim_length: 15,
    max_claim_length: 300,
    sentence_endings: ['.', '!', '?', ':', ';']
  },

  // Scoring configuration
  scoring: {
    fact_checker: { weight: 0.35, enabled: true },
    source_credibility: { weight: 0.20, enabled: true },
    scholarly: { weight: 0.30, enabled: true },
    coherence: { weight: 0.15, enabled: true },
    high_trust: 8,
    medium_trust: 5,
    low_trust: 3,
    confidence_thresholds: {
      high: 0.8,
      medium: 0.5,
      low: 0.2
    }
  },

  // API configurations (for direct API calls when server is disabled)
  apis: {
    ai_provider: {
      provider: "openai", // "openai" | "anthropic" | "gemini"
      model: "gpt-4o-mini", // Cost-effective model
      temperature: 0.1,
      max_tokens: 3000,
      timeout: 15000,
      retries: 3,
      api_key: null, // Will be set via environment or server
      base_url: "https://api.openai.com/v1"
    }
  },

  // Display configuration
  display: {
    colors: {
      high: "#22c55e",
      medium: "#eab308",
      low: "#ef4444"
    },
    show_confidence: true,
    show_breakdown: true,
    tooltip_delay: 300,
    highlight_opacity: 0.2,
    highlight_border_width: 3
  },

  // Cache configuration
  cache: {
    enabled: true,
    ttl_hours: 24,
    max_entries: 1000,
    storage_type: "indexedDB"
  },

  // Performance settings
  performance: {
    max_concurrent_requests: 5,
    request_timeout: 10000,
    batch_size: 5,
    delay_between_batches: 100,
    max_retries: 3,
    retry_delay: 1000
  },

  // Feature flags
  features: {
    enable_highlighting: true,
    enable_tooltips: true,
    enable_popup_stats: true,
    enable_confidence_filter: true,
    enable_red_flag_detection: true,
    enable_override_engine: true,
    enable_parallel_processing: true
  }
};

// Export for use in other modules
export default CONFIG;

// Make CONFIG available globally for content scripts
if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
}
