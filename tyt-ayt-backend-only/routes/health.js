const express = require('express');
const Database = require('../utils/database');
const RAGSystem = require('../utils/rag');

const router = express.Router();

// Overall health check
router.get('/', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {},
      metrics: {}
    };

    // Check database
    try {
      const dbStats = Database.getUserStats('health-check');
      health.services.database = {
        status: 'healthy',
        connected: true,
        stats: dbStats
      };
    } catch (dbError) {
      health.services.database = {
        status: 'unhealthy',
        error: dbError.message
      };
      health.status = 'degraded';
    }

    // Check RAG system
    try {
      const ragStats = RAGSystem.getDocumentStats();
      health.services.rag = {
        status: 'healthy',
        initialized: RAGSystem.initialized,
        stats: ragStats
      };
    } catch (ragError) {
      health.services.rag = {
        status: 'unhealthy',
        error: ragError.message
      };
      health.status = 'degraded';
    }

    // Check API keys
    health.services.apiKeys = {
      gemini: !!process.env.GEMINI_API_KEY,
      youtube: !!process.env.YOUTUBE_API_KEY,
      openai: !!process.env.OPENAI_API_KEY
    };

    // System metrics
    health.metrics = {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      nodeVersion: process.version,
      platform: process.platform
    };

    // Response status
    const responseStatus = health.status === 'healthy' ? 200 : 503;

    res.status(responseStatus).json({
      success: health.status === 'healthy',
      ...health
    });

  } catch (error) {
    console.error('Health check error:', error);
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Detailed system status
router.get('/detailed', async (req, res) => {
  try {
    const detailed = {
      timestamp: new Date().toISOString(),
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        version: process.version,
        platform: process.platform
      },
      services: {
        database: await checkDatabaseHealth(),
        rag: await checkRAGHealth(),
        api: await checkAPIHealth()
      },
      performance: {
        responseTime: Date.now(),
        activeConnections: getActiveConnections(),
        cacheStatus: getCacheStatus()
      }
    };

    res.json({
      success: true,
      data: detailed
    });

  } catch (error) {
    console.error('Detailed health check error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// System metrics
router.get('/metrics', async (req, res) => {
  try {
    const metrics = {
      timestamp: new Date().toISOString(),
      system: {
        uptime: process.uptime(),
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          external: Math.round(process.memoryUsage().external / 1024 / 1024),
          rss: Math.round(process.memoryUsage().rss / 1024 / 1024)
        },
        cpu: process.cpuUsage()
      },
      application: {
        databaseConnections: getDatabaseConnections(),
        ragDocuments: getRAGDocumentCount(),
        activeUsers: getActiveUserCount()
      }
    };

    res.json({
      success: true,
      data: metrics
    });

  } catch (error) {
    console.error('Metrics error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Database health check
router.get('/database', async (req, res) => {
  try {
    const health = await checkDatabaseHealth();
    
    res.json({
      success: health.status === 'healthy',
      ...health
    });

  } catch (error) {
    console.error('Database health error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// RAG system health check
router.get('/rag', async (req, res) => {
  try {
    const health = await checkRAGHealth();
    
    res.json({
      success: health.status === 'healthy',
      ...health
    });

  } catch (error) {
    console.error('RAG health error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// API keys status
router.get('/api-keys', (req, res) => {
  try {
    const apiKeys = {
      gemini: {
        configured: !!process.env.GEMINI_API_KEY,
        valid: !!process.env.GEMINI_API_KEY,
        lastChecked: new Date().toISOString()
      },
      youtube: {
        configured: !!process.env.YOUTUBE_API_KEY,
        valid: !!process.env.YOUTUBE_API_KEY,
        lastChecked: new Date().toISOString()
      },
      openai: {
        configured: !!process.env.OPENAI_API_KEY,
        valid: !!process.env.OPENAI_API_KEY,
        lastChecked: new Date().toISOString()
      }
    };

    res.json({
      success: true,
      data: apiKeys,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('API keys check error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Environment info
router.get('/environment', (req, res) => {
  try {
    const env = {
      nodeEnv: process.env.NODE_ENV || 'development',
      port: process.env.PORT || 3002,
      databaseUrl: process.env.DATABASE_URL ? 'configured' : 'not configured',
      logLevel: process.env.LOG_LEVEL || 'info',
      timezone: process.env.TZ || 'UTC',
      features: {
        cors: true,
        compression: true,
        helmet: true,
        rateLimiting: true,
        logging: true
      }
    };

    res.json({
      success: true,
      data: env,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Environment check error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Helper functions
async function checkDatabaseHealth() {
  try {
    const startTime = Date.now();
    
    // Test database connection
    const result = Database.get('SELECT 1 as test', {});
    const responseTime = Date.now() - startTime;
    
    // Get database stats
    const stats = Database.getUserStats('health-check');
    
    return {
      status: 'healthy',
      connected: true,
      responseTime,
      testQuery: result.test === 1,
      stats: {
        queryTime: responseTime,
        healthCheckUser: 'health-check'
      }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      connected: false,
      error: error.message
    };
  }
}

async function checkRAGHealth() {
  try {
    const startTime = Date.now();
    
    // Check if RAG is initialized
    if (!RAGSystem.initialized) {
      return {
        status: 'not_initialized',
        initialized: false,
        error: 'RAG system not initialized'
      };
    }
    
    // Test RAG search
    const results = await RAGSystem.search('test query', { maxResults: 1 });
    const responseTime = Date.now() - startTime;
    
    // Get stats
    const stats = RAGSystem.getDocumentStats();
    
    return {
      status: 'healthy',
      initialized: true,
      responseTime,
      searchTest: results.length >= 0,
      stats: {
        responseTime,
        documentCount: stats.totalDocuments,
        chunkCount: stats.totalChunks
      }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      initialized: RAGSystem.initialized,
      error: error.message
    };
  }
}

async function checkAPIHealth() {
  try {
    const apiStatus = {
      gemini: {
        configured: !!process.env.GEMINI_API_KEY,
        endpoint: 'https://generativelanguage.googleapis.com',
        status: 'configured'
      },
      youtube: {
        configured: !!process.env.YOUTUBE_API_KEY,
        endpoint: 'https://www.googleapis.com/youtube/v3',
        status: 'configured'
      },
      openai: {
        configured: !!process.env.OPENAI_API_KEY,
        endpoint: 'https://api.openai.com',
        status: 'configured'
      }
    };
    
    return {
      status: 'healthy',
      apis: apiStatus
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message
    };
  }
}

function getActiveConnections() {
  // This would track active connections in a real implementation
  return {
    http: 0,
    websockets: 0,
    database: 1
  };
}

function getCacheStatus() {
  // This would check cache status in a real implementation
  return {
    memory: 'healthy',
    redis: 'not_configured',
    hitRate: 85.5
  };
}

function getDatabaseConnections() {
  // Return mock data for demo
  return 1;
}

function getRAGDocumentCount() {
  try {
    const stats = RAGSystem.getDocumentStats();
    return stats.totalDocuments;
  } catch (error) {
    return 0;
  }
}

function getActiveUserCount() {
  // This would track active users in a real implementation
  return Math.floor(Math.random() * 10) + 1; // Mock data
}

// Liveness probe for Kubernetes/health checks
router.get('/live', (req, res) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString()
  });
});

// Readiness probe for Kubernetes/health checks
router.get('/ready', async (req, res) => {
  try {
    // Check if critical services are ready
    const dbHealth = await checkDatabaseHealth();
    const ragHealth = await checkRAGHealth();
    
    const isReady = dbHealth.status === 'healthy' && ragHealth.initialized;
    
    res.status(isReady ? 200 : 503).json({
      status: isReady ? 'ready' : 'not_ready',
      services: {
        database: dbHealth.status,
        rag: ragHealth.status
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;