const express = require('express');
const RAGSystem = require('../utils/rag');

const router = express.Router();

// Search knowledge base
router.get('/search', async (req, res) => {
  try {
    const {
      query,
      category = null,
      maxResults = 5,
      minScore = 0.1
    } = req.query;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({
        error: 'Invalid query',
        message: 'Query parameter is required and must be a non-empty string'
      });
    }

    const results = await RAGSystem.search(query.trim(), {
      category,
      maxResults: parseInt(maxResults),
      minScore: parseFloat(minScore)
    });

    const formattedResults = results.map(result => ({
      id: result.chunkId,
      title: result.chunk.title,
      content: result.chunk.content,
      category: result.chunk.category,
      score: Math.round(result.score * 100) / 100,
      highlights: result.highlights,
      metadata: {
        tags: result.chunk.tags,
        chunkIndex: result.chunk.index
      }
    }));

    res.json({
      success: true,
      data: {
        query: query.trim(),
        category,
        totalResults: results.length,
        results: formattedResults,
        hasResults: results.length > 0
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('RAG search error:', error);
    res.status(500).json({
      error: 'Search failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get knowledge categories
router.get('/categories', async (req, res) => {
  try {
    const categories = RAGSystem.getCategories();
    
    const categoryInfo = categories.map(category => ({
      name: category,
      displayName: category.split('-').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ')
    }));

    res.json({
      success: true,
      data: {
        categories: categoryInfo,
        totalCategories: categories.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      error: 'Failed to retrieve categories',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get documents by category
router.get('/documents', async (req, res) => {
  try {
    const { category, limit = 20 } = req.query;

    if (!category) {
      return res.status(400).json({
        error: 'Missing category parameter',
        message: 'Category parameter is required'
      });
    }

    const documents = RAGSystem.getRAGDocumentsByCategory(category);
    
    const formattedDocuments = documents.slice(0, parseInt(limit)).map(doc => ({
      id: doc.id,
      title: doc.title,
      content: doc.content.substring(0, 300) + (doc.content.length > 300 ? '...' : ''),
      category: doc.category,
      tags: JSON.parse(doc.tags || '[]'),
      createdAt: doc.created_at,
      updatedAt: doc.updated_at
    }));

    res.json({
      success: true,
      data: {
        category,
        totalDocuments: documents.length,
        displayedDocuments: formattedDocuments.length,
        documents: formattedDocuments
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({
      error: 'Failed to retrieve documents',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Ask a question with context
router.post('/question', async (req, res) => {
  try {
    const { question, context = [], category = null } = req.body;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({
        error: 'Invalid question',
        message: 'Question is required and must be a non-empty string'
      });
    }

    const qaResult = await RAGSystem.answerQuestion(question.trim(), context);

    res.json({
      success: true,
      data: {
        question: question.trim(),
        context: qaResult.context,
        hasRelevantInfo: qaResult.hasRelevantInfo,
        searchResults: qaResult.searchResults?.length || 0,
        timestamp: qaResult.timestamp
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Question answer error:', error);
    res.status(500).json({
      error: 'Question answering failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get RAG system statistics
router.get('/stats', async (req, res) => {
  try {
    const stats = RAGSystem.getDocumentStats();
    
    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Get RAG stats error:', error);
    res.status(500).json({
      error: 'Failed to retrieve statistics',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get TYT-AYT specific knowledge
router.get('/tyt-ayt', async (req, res) => {
  try {
    const { subject = null, level = null } = req.query;

    let query = 'TYT AYT';
    if (subject) {
      query += ` ${subject}`;
    }
    if (level) {
      query += ` ${level}`;
    }

    const results = await RAGSystem.search(query, {
      category: null, // Search all categories
      maxResults: 10,
      minScore: 0.2 // Higher threshold for specific queries
    });

    // Filter for TYT-AYT related content
    const tytAytResults = results.filter(result => {
      const content = result.chunk.content.toLowerCase();
      const title = result.chunk.title.toLowerCase();
      return content.includes('tyt') || content.includes('ayt') || 
             content.includes('sınav') || title.includes('tyt') || title.includes('ayt');
    });

    const formattedResults = tytAytResults.map(result => ({
      id: result.chunkId,
      title: result.chunk.title,
      content: result.chunk.content,
      category: result.chunk.category,
      score: Math.round(result.score * 100) / 100,
      subject: extractSubject(result.chunk),
      level: extractLevel(result.chunk)
    }));

    res.json({
      success: true,
      data: {
        query,
        subject,
        level,
        totalResults: tytAytResults.length,
        results: formattedResults,
        subjects: getAllSubjects(formattedResults),
        levels: getAllLevels(formattedResults)
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('TYT-AYT knowledge error:', error);
    res.status(500).json({
      error: 'Failed to retrieve TYT-AYT knowledge',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get study tips and techniques
router.get('/study-tips', async (req, res) => {
  try {
    const results = await RAGSystem.search('çalışma tekniği motivasyon verimlilik', {
      category: 'health-study',
      maxResults: 5,
      minScore: 0.3
    });

    const studyTips = results.map(result => ({
      title: result.chunk.title,
      tip: result.chunk.content,
      category: 'study-technique',
      score: result.score
    }));

    res.json({
      success: true,
      data: {
        tips: studyTips,
        totalTips: studyTips.length,
        categories: ['study-technique', 'time-management', 'memory', 'motivation']
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Study tips error:', error);
    res.status(500).json({
      error: 'Failed to retrieve study tips',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Health check for RAG system
router.get('/health', async (req, res) => {
  try {
    const isInitialized = RAGSystem.initialized;
    const stats = isInitialized ? RAGSystem.getDocumentStats() : null;
    
    res.json({
      success: true,
      status: isInitialized ? 'healthy' : 'not initialized',
      initialized: isInitialized,
      stats: stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Helper functions
function extractSubject(chunk) {
  const content = chunk.content.toLowerCase();
  const title = chunk.title.toLowerCase();
  
  if (content.includes('matematik') || title.includes('matematik')) return 'Matematik';
  if (content.includes('türkçe') || title.includes('türkçe')) return 'Türkçe';
  if (content.includes('fen') || content.includes('fizik') || 
      content.includes('kimya') || content.includes('biyoloji')) return 'Fen Bilimleri';
  if (content.includes('sosyal') || content.includes('tarih') || 
      content.includes('coğrafya') || content.includes('felsefe')) return 'Sosyal Bilimler';
  if (content.includes('ingilizce') || title.includes('ingilizce')) return 'İngilizce';
  if (content.includes('python') || title.includes('python')) return 'Python';
  
  return 'Genel';
}

function extractLevel(chunk) {
  const content = chunk.content.toLowerCase();
  const title = chunk.title.toLowerCase();
  
  if (content.includes('tyt') || title.includes('tyt')) return 'TYT';
  if (content.includes('ayt') || title.includes('ayt')) return 'AYT';
  if (content.includes('başlangıç') || content.includes('temel')) return 'Başlangıç';
  if (content.includes('orta') || content.includes('intermediate')) return 'Orta';
  if (content.includes('ileri') || content.includes('advanced')) return 'İleri';
  
  return 'Genel';
}

function getAllSubjects(results) {
  const subjects = new Set();
  results.forEach(result => {
    if (result.subject) subjects.add(result.subject);
  });
  return Array.from(subjects);
}

function getAllLevels(results) {
  const levels = new Set();
  results.forEach(result => {
    if (result.level) levels.add(result.level);
  });
  return Array.from(levels);
}

module.exports = router;