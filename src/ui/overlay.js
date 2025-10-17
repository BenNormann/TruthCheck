// Overlay - Top-right overview panel with status and logs
import CONFIG from '../foundation/config.js';

class Overlay {
  constructor() {
    this.root = null;
    this.statusEl = null;
    this.counts = { claims: 0, normalized: 0, highlighted: 0 };
    this.countsEl = null;
    this.logsEl = null;
    this.logTimer = null;
  }

  init() {
    if (this.root) return;

    const root = document.createElement('div');
    root.id = 'truth-check-overlay';
    root.className = 'truth-check-overlay';

    root.innerHTML = `
      <div class="tc-ovl-header">
        <div class="tc-ovl-title">Truth Check</div>
        <div class="tc-ovl-actions">
          <button class="tc-ovl-btn" data-action="minimize">–</button>
          <button class="tc-ovl-btn" data-action="close">×</button>
        </div>
      </div>
      <div class="tc-ovl-tabs">
        <button class="tc-ovl-tab active" data-tab="overview">Overview</button>
        <button class="tc-ovl-tab" data-tab="claims">Claims</button>
      </div>
      <div class="tc-ovl-body">
        <div class="tc-ovl-pane" data-pane="overview">
          <div class="tc-ovl-section">
            <div class="tc-ovl-label">Status</div>
            <div class="tc-ovl-status" id="tc-status">Initializing…</div>
          </div>
          <div class="tc-ovl-section tc-ovl-counts" id="tc-counts">
            <div class="tc-ovl-count"><span class="tc-ovl-count-num" id="tc-claims">0</span><span class="tc-ovl-count-label">claims</span></div>
            <div class="tc-ovl-count"><span class="tc-ovl-count-num" id="tc-normalized">0</span><span class="tc-ovl-count-label">normalized</span></div>
            <div class="tc-ovl-count"><span class="tc-ovl-count-num" id="tc-highlighted">0</span><span class="tc-ovl-count-label">highlighted</span></div>
          </div>
          <div class="tc-ovl-section">
            <div class="tc-ovl-label">Logs</div>
            <div class="tc-ovl-logs" id="tc-logs"></div>
          </div>
        </div>
        <div class="tc-ovl-pane hidden" data-pane="claims">
          <div class="tc-ovl-section">
            <div class="tc-ovl-label">Claims Found</div>
            <div class="tc-ovl-claims" id="tc-claims-list"></div>
          </div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(root);

    this.root = root;
    this.statusEl = root.querySelector('#tc-status');
    this.countsEl = root.querySelector('#tc-counts');
    this.logsEl = root.querySelector('#tc-logs');

    // Actions
    root.querySelector('[data-action="close"]').addEventListener('click', () => this.hide());
    root.querySelector('[data-action="minimize"]').addEventListener('click', () => this.toggleMinimized());

    // Tab switching
    root.querySelectorAll('.tc-ovl-tab').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.getAttribute('data-tab')));
    });

    // Start log polling if global Logger available
    this.startLogStream();
  }

  switchTab(tab) {
    if (!this.root) return;
    this.root.querySelectorAll('.tc-ovl-tab').forEach(t => t.classList.remove('active'));
    const activeBtn = this.root.querySelector(`.tc-ovl-tab[data-tab="${tab}"]`);
    if (activeBtn) activeBtn.classList.add('active');
    this.root.querySelectorAll('.tc-ovl-pane').forEach(p => p.classList.add('hidden'));
    const pane = this.root.querySelector(`.tc-ovl-pane[data-pane="${tab}"]`);
    if (pane) pane.classList.remove('hidden');
  }

  startLogStream() {
    if (this.logTimer) return;
    const pull = () => {
      try {
        const logger = window && window.Logger ? window.Logger : null;
        if (!logger || !this.logsEl) return;
        const items = logger.getLogs(null, 50);
        const html = items.slice(-50).map(l => `
          <div class="tc-ovl-log tc-ovl-log-${l.level.toLowerCase()}">
            <span class="tc-ovl-log-time">${this._shortTime(l.timestamp)}</span>
            <span class="tc-ovl-log-level">${l.level}</span>
            <span class="tc-ovl-log-msg">${this._escape(l.message)}</span>
          </div>`).join('');
        this.logsEl.innerHTML = html;
        this.logsEl.scrollTop = this.logsEl.scrollHeight;
      } catch (_) { /* ignore */ }
    };
    pull();
    this.logTimer = setInterval(pull, 1500);
  }

  setStatus(text) {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
  }

  setCounts({ claims, normalized, highlighted }) {
    this.counts = {
      claims: claims ?? this.counts.claims,
      normalized: normalized ?? this.counts.normalized,
      highlighted: highlighted ?? this.counts.highlighted
    };
    const c = this.counts;
    const claimsEl = this.root.querySelector('#tc-claims');
    const normEl = this.root.querySelector('#tc-normalized');
    const highEl = this.root.querySelector('#tc-highlighted');
    if (claimsEl) claimsEl.textContent = String(c.claims);
    if (normEl) normEl.textContent = String(c.normalized);
    if (highEl) highEl.textContent = String(c.highlighted);
  }

  setClaims(items = []) {
    this._claims = items;
    const container = this.root && this.root.querySelector('#tc-claims-list');
    if (!container) return;
    const html = items.map((it, idx) => {
      const level = (it.level || 'low').toLowerCase();
      const score = typeof it.score === 'number' ? it.score.toFixed(1) : '';
      const safeText = this._escape(it.text || '');
      return `
        <div class="tc-ovl-claim">
          <div class="tc-ovl-claim-index">${idx + 1}</div>
          <div class="tc-ovl-claim-main">
            <div class="tc-ovl-claim-text">${safeText}</div>
            <div class="tc-ovl-claim-meta">
              <span class="tc-ovl-claim-level ${level}">${level[0].toUpperCase()}</span>
              <span class="tc-ovl-claim-score">${score}</span>
            </div>
          </div>
          <button class="tc-ovl-claim-view" data-highlight="${(it.highlightIds && it.highlightIds[0]) || ''}">View</button>
        </div>`;
    }).join('');
    container.innerHTML = html || '<div class="tc-ovl-empty">No claims</div>';

    // Attach click handlers
    container.querySelectorAll('.tc-ovl-claim-view').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-highlight');
        if (id) this.scrollToHighlight(id);
      });
    });
  }

  scrollToHighlight(highlightId) {
    const el = document.getElementById(highlightId);
    if (el) {
      try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
      el.classList.add('tc-flash');
      setTimeout(() => el.classList.remove('tc-flash'), 1200);
    }
  }

  toggleMinimized() {
    if (!this.root) return;
    this.root.classList.toggle('minimized');
  }

  hide() {
    if (this.root) this.root.style.display = 'none';
    if (this.logTimer) clearInterval(this.logTimer);
    this.logTimer = null;
  }

  show() {
    if (this.root) this.root.style.display = 'block';
  }

  _escape(s) {
    return (s || '').toString().replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  }

  _shortTime(ts) {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch { return ts; }
  }
}

const overlay = new Overlay();
export default overlay;
