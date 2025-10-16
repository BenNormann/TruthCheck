// Logger - Centralized logging and error handling for Truth Check extension
import CONFIG from './config.js';

class Logger {
  constructor() {
    this.logs = [];
    this.maxLogs = 1000;
    this.debugMode = CONFIG.debug_mode;
  }

  log(message, data = null) {
    if (!this.debugMode && message.includes('DEBUG')) return;

    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      message,
      data: data ? JSON.stringify(data, null, 2) : null
    };

    this.addLog(logEntry);
    this.output(logEntry);
  }

  warn(message, data = null) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'WARN',
      message,
      data: data ? JSON.stringify(data, null, 2) : null
    };

    this.addLog(logEntry);
    this.output(logEntry);
  }

  error(message, error = null) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      message,
      data: error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : null
    };

    this.addLog(logEntry);
    this.output(logEntry);
  }

  debug(message, data = null) {
    if (!this.debugMode) return;

    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'DEBUG',
      message,
      data: data ? JSON.stringify(data, null, 2) : null
    };

    this.addLog(logEntry);
    this.output(logEntry);
  }

  addLog(logEntry) {
    this.logs.push(logEntry);

    // Keep only the most recent logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
  }

  output(logEntry) {
    const { timestamp, level, message, data } = logEntry;

    switch (level) {
      case 'ERROR':
        console.error(`[${timestamp}] ${level}: ${message}`, data ? '\n' + data : '');
        break;
      case 'WARN':
        console.warn(`[${timestamp}] ${level}: ${message}`, data ? '\n' + data : '');
        break;
      case 'DEBUG':
        console.debug(`[${timestamp}] ${level}: ${message}`, data ? '\n' + data : '');
        break;
      default:
        console.log(`[${timestamp}] ${level}: ${message}`, data ? '\n' + data : '');
    }
  }

  // Get recent logs for debugging
  getLogs(level = null, limit = 100) {
    let filteredLogs = level ? this.logs.filter(log => log.level === level) : this.logs;
    return filteredLogs.slice(-limit);
  }

  // Clear logs
  clearLogs() {
    this.logs = [];
  }

  // Export logs for debugging
  exportLogs() {
    return {
      timestamp: new Date().toISOString(),
      version: CONFIG.extension_version,
      logs: this.logs,
      summary: {
        total: this.logs.length,
        errors: this.logs.filter(log => log.level === 'ERROR').length,
        warnings: this.logs.filter(log => log.level === 'WARN').length,
        info: this.logs.filter(log => log.level === 'INFO').length,
        debug: this.logs.filter(log => log.level === 'DEBUG').length
      }
    };
  }

  // Performance monitoring
  startTimer(label) {
    this.timers = this.timers || {};
    this.timers[label] = performance.now();
  }

  endTimer(label) {
    if (!this.timers || !this.timers[label]) return 0;

    const duration = performance.now() - this.timers[label];
    this.debug(`Timer "${label}": ${duration.toFixed(2)}ms`);
    delete this.timers[label];
    return duration;
  }

  // Error boundary for async operations
  async withErrorBoundary(operation, fallback = null) {
    try {
      return await operation();
    } catch (error) {
      this.error('Operation failed in error boundary', error);

      if (fallback) {
        return fallback;
      }

      throw error;
    }
  }

  // Request/response logging for API calls
  logRequest(url, method = 'GET', requestData = null) {
    this.debug(`API Request: ${method} ${url}`, requestData);
  }

  logResponse(url, status, responseTime, responseData = null) {
    const level = status >= 200 && status < 300 ? 'debug' : 'error';
    this[level](`API Response: ${url} - ${status} (${responseTime}ms)`, responseData);
  }

  // Batch logging for performance
  batchLog(logs) {
    logs.forEach(log => {
      switch (log.level) {
        case 'error':
          this.error(log.message, log.data);
          break;
        case 'warn':
          this.warn(log.message, log.data);
          break;
        case 'debug':
          this.debug(log.message, log.data);
          break;
        default:
          this.log(log.message, log.data);
      }
    });
  }
}

// Create singleton instance
const logger = new Logger();

// Global error handler for unhandled errors
window.addEventListener('error', (event) => {
  logger.error('Unhandled error', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error
  });
});

// Global promise rejection handler
window.addEventListener('unhandledrejection', (event) => {
  logger.error('Unhandled promise rejection', event.reason);
});

export default logger;
