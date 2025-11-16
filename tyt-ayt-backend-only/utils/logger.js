const winston = require('winston');
const path = require('path');
const fs = require('fs-extra');

class Logger {
  constructor() {
    this.logger = null;
    this.initialized = false;
  }

  async init() {
    try {
      // Create logs directory
      const logsDir = path.join(__dirname, '../../logs');
      await fs.ensureDir(logsDir);

      // Define log format
      const logFormat = winston.format.combine(
        winston.format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.json()
      );

      // Define console format
      const consoleFormat = winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({
          format: 'HH:mm:ss'
        }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaString = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
          return `${timestamp} [${level}]: ${message} ${metaString}`;
        })
      );

      // Create logger instance
      this.logger = winston.createLogger({
        level: process.env.LOG_LEVEL || 'info',
        format: logFormat,
        defaultMeta: { service: 'ultra-platform' },
        transports: [
          // Error log file
          new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
            tailable: true
          }),
          // Combined log file
          new winston.transports.File({
            filename: path.join(logsDir, 'combined.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 5,
            tailable: true
          }),
          // API specific log file
          new winston.transports.File({
            filename: path.join(logsDir, 'api.log'),
            level: 'info',
            maxsize: 10485760, // 10MB
            maxFiles: 3,
            tailable: true
          })
        ],
        // Handle uncaught exceptions
        exceptionHandlers: [
          new winston.transports.File({
            filename: path.join(logsDir, 'exceptions.log')
          })
        ],
        // Handle unhandled promise rejections
        rejectionHandlers: [
          new winston.transports.File({
            filename: path.join(logsDir, 'rejections.log')
          })
        ]
      });

      // Add console transport for development
      if (process.env.NODE_ENV !== 'production') {
        this.logger.add(new winston.transports.Console({
          format: consoleFormat
        }));
      }

      this.initialized = true;
      this.logger.info('Logger initialized successfully');
      
      return this.logger;
    } catch (error) {
      console.error('Failed to initialize logger:', error);
      throw error;
    }
  }

  // API request logging
  logAPIRequest(req, res, responseTime) {
    if (!this.logger) return;

    const logData = {
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      contentLength: res.get('content-length') || 0
    };

    if (res.statusCode >= 400) {
      this.logger.warn('API request failed', logData);
    } else {
      this.logger.info('API request completed', logData);
    }
  }

  // Chat specific logging
  logChatInteraction(userId, sessionId, userMessage, aiResponse, metadata = {}) {
    if (!this.logger) return;

    const logData = {
      userId,
      sessionId,
      userMessageLength: userMessage.length,
      aiResponseLength: aiResponse?.length || 0,
      timestamp: new Date().toISOString(),
      ...metadata
    };

    this.logger.info('Chat interaction', logData);
  }

  // YouTube API logging
  logYouTubeAction(action, videoId, metadata = {}) {
    if (!this.logger) return;

    const logData = {
      action,
      videoId,
      timestamp: new Date().toISOString(),
      ...metadata
    };

    this.logger.info('YouTube action', logData);
  }

  // Python execution logging
  logPythonExecution(userId, executionId, code, success, executionTime, metadata = {}) {
    if (!this.logger) return;

    const logData = {
      userId,
      executionId,
      codeLength: code.length,
      success,
      executionTime: `${executionTime}ms`,
      timestamp: new Date().toISOString(),
      ...metadata
    };

    if (success) {
      this.logger.info('Python execution completed', logData);
    } else {
      this.logger.warn('Python execution failed', logData);
    }
  }

  // Error logging with context
  logError(error, context = {}) {
    if (!this.logger) return;

    this.logger.error('Application error', {
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      },
      context,
      timestamp: new Date().toISOString()
    });
  }

  // Performance logging
  logPerformance(operation, duration, metadata = {}) {
    if (!this.logger) return;

    this.logger.info('Performance metric', {
      operation,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
      ...metadata
    });
  }

  // Security event logging
  logSecurityEvent(event, details = {}) {
    if (!this.logger) return;

    this.logger.warn('Security event', {
      event,
      details,
      timestamp: new Date().toISOString(),
      severity: 'medium'
    });
  }

  // User activity logging
  logUserActivity(userId, activity, metadata = {}) {
    if (!this.logger) return;

    this.logger.info('User activity', {
      userId,
      activity,
      timestamp: new Date().toISOString(),
      ...metadata
    });
  }

  // System metrics logging
  logSystemMetrics(metrics) {
    if (!this.logger) return;

    this.logger.info('System metrics', {
      ...metrics,
      timestamp: new Date().toISOString()
    });
  }

  // Database operation logging
  logDatabaseOperation(operation, table, duration, success, metadata = {}) {
    if (!this.logger) return;

    const logData = {
      operation,
      table,
      duration: `${duration}ms`,
      success,
      timestamp: new Date().toISOString(),
      ...metadata
    };

    if (success) {
      this.logger.debug('Database operation', logData);
    } else {
      this.logger.warn('Database operation failed', logData);
    }
  }

  // RAG system logging
  logRAGAction(action, query, resultsCount, metadata = {}) {
    if (!this.logger) return;

    this.logger.info('RAG action', {
      action,
      queryLength: query.length,
      resultsCount,
      timestamp: new Date().toISOString(),
      ...metadata
    });
  }

  // Clean up old log files
  async cleanupLogs() {
    try {
      const logsDir = path.join(__dirname, '../../logs');
      const files = await fs.readdir(logsDir);
      
      const now = new Date();
      const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days

      for (const file of files) {
        if (file.endsWith('.log')) {
          const filePath = path.join(logsDir, file);
          const stats = await fs.stat(filePath);
          
          if (now - stats.mtime > maxAge) {
            await fs.remove(filePath);
            this.logger.info('Cleaned up old log file', { file });
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to cleanup logs', { error: error.message });
    }
  }

  // Get log statistics
  async getLogStats() {
    try {
      const logsDir = path.join(__dirname, '../../logs');
      const files = await fs.readdir(logsDir);
      
      const stats = {};
      
      for (const file of files) {
        if (file.endsWith('.log')) {
          const filePath = path.join(logsDir, file);
          const fileStats = await fs.stat(filePath);
          
          stats[file] = {
            size: fileStats.size,
            modified: fileStats.mtime,
            sizeMB: Math.round(fileStats.size / 1024 / 1024 * 100) / 100
          };
        }
      }
      
      return stats;
    } catch (error) {
      this.logger.error('Failed to get log stats', { error: error.message });
      return {};
    }
  }

  // Express middleware for API request logging
  getExpressMiddleware() {
    if (!this.logger) {
      return (req, res, next) => next();
    }

    const startTime = Date.now();

    return (req, res, next) => {
      res.on('finish', () => {
        const responseTime = Date.now() - startTime;
        this.logAPIRequest(req, res, responseTime);
      });
      
      next();
    };
  }
}

module.exports = new Logger();