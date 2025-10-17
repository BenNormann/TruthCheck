// CONFIG - Centralized configuration for Truth Check extension
const CONFIG = {
  // Basic extension settings
  extension_name: "Truth Check",
  extension_version: "1.0.0",
  min_content_length: 300,
  async_processing: true,
  debug_mode: true,

  // Claim extraction settings
  claim_extraction: {
    method: "hybrid", // "heuristic" | "ai" | "hybrid" - using Express server with OpenAI
    heuristic_threshold: 0.6,
    
    // Factual verb patterns (case-insensitive) - indicate objective statements
    factual_verbs: [
      "is", "was", "are", "were", "be", "been", "being",
      "caused", "causes", "led", "leads", "lead",
      "resulted", "results", "produced", "produces",
      "found", "finds", "discovered", "discovers",
      "determined", "determines", "established", "establishes",
      "proved", "proves", "demonstrated", "demonstrates",
      "confirmed", "confirms", "verified", "verifies",
      "reported", "reports", "stated", "states",
      "announced", "announces", "declared", "declares",
      "claimed", "claims", "asserted", "asserts",
      "maintained", "maintains", "argued", "argues",
      "told", "tells", "said", "says",
      "showed", "shows", "indicated", "indicates",
      "suggested", "suggests", "implied", "implies",
      "revealed", "reveals", "reduced", "reduces",
      "increased", "increases", "decreased", "decreases",
      "improved", "improves", "worsened", "worsens",
      "cost", "costs", "saved", "saves",
      "generated", "generates", "created", "creates",
      "killed", "kills", "infected", "infects",
      "prevented", "prevents", "treated", "treats",
      "concluded", "proven", "measured", "calculated", 
      "estimated", "projected", "rose", "fell", "grew", 
      "declined", "surged", "plummeted", "wants", "would", 
      "will", "commemorate", "commemorates", "unveiled", 
      "displayed", "built", "construct", "constructed",
      "opened", "gave", "approved", "need", "needs", "requires",
      "takes", "took", "appears", "allows", "prohibits",
      // Legal/news verbs
      "indicted", "charged", "convicted", "sentenced", "arrested",
      "sued", "pleaded", "testified", "alleged", "accused",
      "appointed", "elected", "resigned", "retired", "fired",
      "hired", "promoted", "demoted", "died", "passed",
      "signed", "vetoed", "rejected", "denied",
      "used", "sent", "received", "emailed", "wrote", "described",
      // Investigation/contradiction verbs
      "investigating", "investigated", "confirming", "refuted",
      "contradicted", "disputed", "challenged", "debunked",
      "witnessed", "observed", "documented", "recorded", "captured",
      "urged", "warned", "emphasized", "directed", "ordered"
    ],
    
    // Claim marker phrases - strong indicators of factual claims
    claim_markers: [
      "according to", "studies show", "research indicates",
      "data reveals", "scientists found", "report states",
      "statistics show", "evidence shows", "findings indicate",
      "analysis shows", "experts say", "research found",
      "scientists have found", "data shows", "study found",
      "evidence suggests", "reports indicate", "findings reveal",
      "numbers indicate", "figures suggest",
      "survey found", "poll shows", "census data",
      "clinical trial", "peer-reviewed", "meta-analysis",
      "researchers discovered", "investigation found",
      "official data", "government report",
      "the study", "the research", "the report", "the analysis",
      "results indicate", "survey reveals", "study reveals",
      "research shows", "figures show",
      "the latest", "recent study", "new research", "latest findings",
      "reportedly", "is reportedly", "are reportedly", "was reportedly",
      "congress gave", "congress approved", "federal law", "typically",
      "most notably", "in a report",
      // Legal/news markers
      "the indictment", "prosecutors say", "court documents",
      "grand jury", "the complaint", "officials said",
      "sources say", "witnesses reported", "records show",
      "documents reveal", "emails show", "testimony indicates",
      "told fox news", "a spokesperson said", "employee told",
      "department said", "officials note", "advocates say",
      "has confirmed", "is investigating", "are inaccurate",
      "circulating on", "video shows", "images show"
    ],
    
    // Abbreviations to protect during sentence splitting
    abbreviations: [
      "Dr.", "Mr.", "Mrs.", "Ms.", "Prof.", "Sr.", "Jr.",
      "vs.", "etc.", "i.e.", "e.g.", "et al.", "Ph.D.",
      "U.S.", "U.K.", "U.N.", "E.U.", "Inc.", "Corp.",
      "Ltd.", "Co.", "Dept.", "Gov.", "Rep.", "Sen.",
      "St.", "Ave.", "Blvd.", "Rd.", "Mt.", "Ft.",
      "a.m.", "p.m.", "A.M.", "P.M.", "No.", "vol.",
      "Jan.", "Feb.", "Mar.", "Apr.", "Jun.", "Jul.",
      "Aug.", "Sep.", "Sept.", "Oct.", "Nov.", "Dec."
    ],
    
    // Percentage and statistical keywords
    percentage_keywords: ["%", "percent", "percentage"],
    
    // Large number patterns - numbers >= this threshold are claim indicators  
    large_number_threshold: 10, // Lowered to catch claims like "40 leaders", "12 jumps"
    large_number_units: [
      "million", "billion", "trillion", "thousand",
      "people", "cases", "deaths", "patients", "dollars",
      "infections", "hospitalizations", "vaccinations",
      "leaders", "sites", "employees", "staff", "jumps",
      "incidents", "violations", "individuals", "years", "months"
    ],
    
    // Opinion/subjective language markers - indicate NOT a factual claim
    opinion_markers: [
      "i think", "i believe", "i feel", "in my opinion",
      "arguably", "seems", "appears", "might", "could",
      "probably", "possibly", "maybe", "perhaps",
      "supposedly", "allegedly", "rumored", "claimed by some"
    ],
    
    // Exclusion patterns (regex) - sentences matching these likely not claims
    exclude_patterns: [
      "\\?$",                                    // Ends with question mark
      "^(and|or|but)\\s",                       // Starts with conjunction alone                                                                                                 
      "^(i think|i believe|arguably)",          // Starts with opinion marker
      "^(click here|subscribe|follow|share)",    // Call-to-action
      "^(warning|disclaimer|note:)"              // Meta-content
    ],
    
    // Claim length constraints
    min_claim_length: 15,
    max_claim_length: 300,
    
    // Claim confidence threshold - minimum score to classify as claim
    claim_confidence_threshold: 0.25,
    
    // Sentence endings for splitting
    sentence_endings: ['.', '!', '?', ':', ';']
  },

  // Scoring configuration
  scoring: {
    ai: { weight: 0.40, enabled: true },
    source_credibility: { weight: 0.30, enabled: true },
    scholarly: { weight: 0.30, enabled: true },
    high_trust: 8,
    medium_trust: 5,
    low_trust: 3,
    confidence_thresholds: {
      high: 0.8,
      medium: 0.5,
      low: 0.2
    }
  },

  // Prompt templates for AI processing
  prompts: {
    claim_classification: `You are a fact-checking classifier. Analyze this sentence carefully:

"{sentence}"

Classifications:
- CLAIM: Specific, verifiable factual assertion (e.g. "COVID vaccines reduce hospitalization by 90%")
- OPINION: Subjective judgment or value statement (e.g. "vaccines are amazing")
- CONTEXT: Background info or definition (e.g. "vaccines prevent disease")

Respond ONLY with valid JSON:
{
  "classification": "CLAIM|OPINION|CONTEXT",
  "confidence": 0.0-1.0,
  "reasoning": "one sentence explaining why"
}`,

    query_normalization: `Extract the core factual claim and normalize for database searches.

Sentence: "{claim}"

Return ONLY valid JSON:
{
  "normalized_claim": "simplified version suitable for search databases",
  "key_entities": ["entity1", "entity2", "entity3"],
  "search_queries": [
    "optimized query for Google Scholar",
    "optimized query for PubMed (health claims only)",
    "optimized query for Britannica"
  ],
  "claim_type": "health|political|scientific|other"
}`,

    evidence_assessment: `Evaluate research evidence against a factual claim.

CLAIM: "{claim}"

SEARCH RESULTS (JSON):
{search_results_json}

For each result, determine:
- Does it directly support the claim? (score: 9-10)
- Partial/tangential support? (5-8)
- Contradicts? (1-3)
- Neutral/irrelevant? (5)
- Outdated/unreliable? (0-2)

Return ONLY valid JSON:
{
  "overall_score": 0-10,
  "confidence": "high|medium|low",
  "assessment": "one paragraph summary of key findings",
  "findings": [
    {
      "source_title": "string",
      "support_level": "supports|contradicts|neutral",
      "score": 0-10,
      "recency_concern": "recent|acceptable|outdated"
    }
  ]
}`,

    red_flag_detection: `Analyze this article excerpt for red flags indicating potential misinformation.

PASSAGE: "{article_excerpt}"

Check for:
1. Extraordinary claims without supporting evidence
2. Cherry-picked statistics (percentage without denominator)
3. Emotional manipulation (ALL CAPS, multiple !!!, extreme language)
4. Self-contradictions within the article
5. Vague attribution ("sources say", "anonymous")
6. Logical fallacies (ad hominem, appeal to authority, strawman)
7. Sensationalism ("SHOCKING", "DOCTORS HATE THIS")

Return ONLY valid JSON:
{
  "red_flags_detected": [
    {
      "flag_type": "name",
      "severity": 1-5,
      "example": "quote from text",
      "significance": "brief explanation"
    }
  ],
  "coherence_score": 0-10,
  "manipulation_risk": 0-10
}`,

    override_validation: `Verify whether a source actually contradicts or supports a claim.

ORIGINAL CLAIM: "{claim}"
FOUND SOURCE: "{source_title}"
SOURCE EXCERPT: "{source_excerpt}"

Determine:
1. Does source address the identical topic?
2. Support, contradict, or tangential?
3. Could the claim be misinterpreted against source?
4. Is source recent enough (not outdated)?

Return ONLY valid JSON:
{
  "addresses_same_topic": true|false,
  "relationship": "supports|contradicts|tangential",
  "override_valid": true|false,
  "confidence": 0-1,
  "reasoning": "one sentence"
}`
  },

  // API configurations
  apis: {
    // Note: API keys should be set as environment variables or replaced with actual keys
    // For development, you can replace process.env.KEY_NAME with your actual API key
    fact_checkers: [
      {
        name: "Google Fact Check",
        enabled: true,
        url: "https://toolbox.google.com/factcheck/api/",
        priority: 1,
        api_key: null, // Configure API key in extension settings
        timeout: 5000,
        retries: 2
      },
      {
        name: "Snopes",
        enabled: true,
        url: "https://www.snopes.com/api/",
        priority: 2,
        timeout: 8000,
        retries: 3
      },
      {
        name: "FactCheck.org",
        enabled: true,  
        url: "https://factcheck.org/api/",
        priority: 3,
        timeout: 6000,
        retries: 2
      }
    ],

    scholar_sources: [
      {
        name: "Google Scholar",
        enabled: true,
        url: "https://scholar.google.com/scholar",
        priority: 1,
        timeout: 10000,
        retries: 3,
        scraper_needed: true
      },
      {
        name: "PubMed",
        enabled: true,
        url: "https://pubmed.ncbi.nlm.nih.gov/",
        priority: 2,
        timeout: 8000,
        retries: 2,
        scraper_needed: true
      },
      {
        name: "Britannica",
        enabled: true,
        url: "https://www.britannica.com/",
        priority: 3,
        timeout: 6000,
        retries: 2,
        scraper_needed: true
      },
      {
        name: "arXiv",
        enabled: true,
        url: "https://arxiv.org/",
        priority: 4,
        timeout: 5000,
        retries: 2,
        scraper_needed: true
      }
    ],

    credibility_sources: [
      {
        name: "NewsGuard",
        enabled: true,
        api_key: null, // Configure API key in extension settings
        timeout: 3000,
        retries: 2
      },
      {
        name: "Media Bias/Fact Check",
        enabled: true,
        url: "https://mediabiasfactcheck.com/",
        timeout: 5000,
        retries: 2,
        scraper_needed: true
      }
    ],

    ai_provider: {
      provider: "openai", // "openai" | "anthropic"
      model: "gpt-4-turbo-preview",
      temperature: 0.1,
      max_tokens: 1000,
      timeout: 15000,
      retries: 3,
      api_key: null, // API key is now handled by Express server
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
    storage_type: "indexedDB" // "indexedDB" | "localStorage" | "memory"
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
