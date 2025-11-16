const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const Database = require('../utils/database');
const RAGSystem = require('../utils/rag');

const router = express.Router();

// Gemini AI Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';

// Chat session storage (in-memory for demo, use Redis in production)
const activeSessions = new Map();

// Middleware to check API key
const checkApiKey = (req, res, next) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({
      error: 'Gemini API Key not configured',
      message: 'Please set GEMINI_API_KEY in environment variables',
      help: 'Get your API key from https://makersuite.google.com/app/apikey'
    });
  }
  next();
};

// Get chat history for a session
router.get('/history/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { userId = 'demo-user' } = req.query;

    // Get from database
    const chatHistory = Database.getChatHistory(userId, sessionId, 100);
    
    // Also get from active session cache
    const activeSession = activeSessions.get(sessionId);
    
    res.json({
      success: true,
      sessionId,
      history: chatHistory.reverse(),
      activeMessages: activeSession?.messages || []
    });
  } catch (error) {
    console.error('Get chat history error:', error);
    res.status(500).json({
      error: 'Failed to retrieve chat history',
      message: error.message
    });
  }
});

// Send message to AI
router.post('/message', checkApiKey, async (req, res) => {
  try {
    const {
      message,
      sessionId = uuidv4(),
      userId = 'demo-user',
      context = [],
      useRAG = true,
      category = null
    } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({
        error: 'Invalid message',
        message: 'Message must be a non-empty string'
      });
    }

    // Create or get active session
    if (!activeSessions.has(sessionId)) {
      activeSessions.set(sessionId, {
        id: sessionId,
        userId,
        messages: [],
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      });
    }

    const session = activeSessions.get(sessionId);
    session.lastActivity = new Date().toISOString();

    // Add user message to session
    const userMessage = {
      id: uuidv4(),
      content: message.trim(),
      role: 'user',
      timestamp: new Date().toISOString()
    };
    session.messages.push(userMessage);

    // Save to database
    Database.saveChatMessage(userId, sessionId, message.trim(), true, null, {
      source: 'api',
      timestamp: new Date().toISOString()
    });

    // Get context from RAG if enabled
    let ragContext = '';
    let searchResults = [];
    
    if (useRAG) {
      try {
        const ragResults = await RAGSystem.search(message, {
          category,
          maxResults: 3,
          minScore: 0.1
        });
        
        if (ragResults.length > 0) {
          searchResults = ragResults;
          ragContext = ragResults
            .map(result => `Bağlam: ${result.chunk.content}`)
            .join('\n\n');
        }
      } catch (ragError) {
        console.warn('RAG search failed:', ragError.message);
      }
    }

    // Prepare conversation history for context
    const conversationContext = session.messages
      .slice(-10) // Last 10 messages for context
      .map(msg => `${msg.role === 'user' ? 'Kullanıcı' : 'AI'}: ${msg.content}`)
      .join('\n');

    // Create system prompt
    const systemPrompt = `
Sen TYT-AYT öğrencileri için özel olarak tasarlanmış bir AI asistanısın. 

Görevin:
1. TYT ve AYT sınavlarına hazırlanan öğrencilere yardım etmek
2. Türkçe konularında destek vermek
3. İngilizce öğretiminde yardımcı olmak  
4. Python programlama konusunda destek sağlamak
5. Genel öğrenme tavsiyeleri vermek
6. Motivasyon ve çalışma teknikleri konusunda rehberlik etmek

Cevapların:
- Türkçe olsun
- Açık ve anlaşılır olsun
- Pratik örnekler içersin
- Öğrenci seviyesine uygun olsun
- Motive edici olsun

${ragContext ? `\nİlgili bağlam bilgileri:\n${ragContext}` : ''}

${conversationContext ? `\nÖnceki konuşma bağlamı:\n${conversationContext}` : ''}
`;

    // Prepare request to Gemini
    const requestBody = {
      contents: [
        {
          parts: [
            { text: systemPrompt }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 1024,
      },
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        }
      ]
    };

    // Call Gemini API
    const response = await axios.post(
      `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 30000 // 30 seconds
      }
    );

    // Extract AI response
    const aiResponse = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!aiResponse) {
      throw new Error('No response received from Gemini API');
    }

    // Add AI response to session
    const aiMessage = {
      id: uuidv4(),
      content: aiResponse,
      role: 'assistant',
      timestamp: new Date().toISOString(),
      metadata: {
        useRAG,
        searchResults: searchResults.length,
        tokenCount: aiResponse.length
      }
    };
    session.messages.push(aiMessage);

    // Save to database
    Database.saveChatMessage(userId, sessionId, aiResponse, false, null, {
      source: 'gemini-api',
      ragUsed: useRAG,
      searchResults: searchResults.length,
      timestamp: new Date().toISOString()
    });

    // Clean old messages from memory (keep last 50)
    if (session.messages.length > 50) {
      session.messages = session.messages.slice(-50);
    }

    res.json({
      success: true,
      data: {
        sessionId,
        message: {
          id: aiMessage.id,
          content: aiResponse,
          role: 'assistant',
          timestamp: aiMessage.timestamp
        },
        metadata: {
          responseTime: Date.now() - new Date(userMessage.timestamp).getTime(),
          useRAG,
          searchResults: searchResults.length,
          contextUsed: ragContext ? true : false
        },
        searchResults: searchResults.map(result => ({
          title: result.chunk.title,
          category: result.chunk.category,
          score: result.score,
          highlights: result.highlights
        }))
      }
    });

  } catch (error) {
    console.error('Chat message error:', error);
    
    // Handle specific API errors
    let errorMessage = 'Internal server error';
    let statusCode = 500;

    if (error.response) {
      const { status, data } = error.response;
      statusCode = status;
      
      if (status === 403) {
        errorMessage = 'Gemini API access denied - check your API key';
      } else if (status === 429) {
        errorMessage = 'Gemini API rate limit exceeded';
      } else if (status >= 500) {
        errorMessage = 'Gemini API server error';
      } else {
        errorMessage = data.error?.message || 'API request failed';
      }
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = 'Request timeout - try again';
      statusCode = 408;
    }

    res.status(statusCode).json({
      error: 'Chat API error',
      message: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

// Get available categories for RAG
router.get('/categories', async (req, res) => {
  try {
    const categories = RAGSystem.getCategories();
    
    res.json({
      success: true,
      categories: categories.map(category => ({
        name: category,
        displayName: category.split('-').map(word => 
          word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ')
      }))
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      error: 'Failed to retrieve categories',
      message: error.message
    });
  }
});

// Clear chat session
router.delete('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    // Remove from active sessions
    activeSessions.delete(sessionId);
    
    // In a real app, you might also want to mark the session as archived in the database
    
    res.json({
      success: true,
      message: `Session ${sessionId} cleared successfully`
    });
  } catch (error) {
    console.error('Clear session error:', error);
    res.status(500).json({
      error: 'Failed to clear session',
      message: error.message
    });
  }
});

// Get session info
router.get('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = activeSessions.get(sessionId);
    
    if (!session) {
      return res.status(404).json({
        error: 'Session not found',
        message: `Session ${sessionId} does not exist`
      });
    }
    
    res.json({
      success: true,
      session: {
        id: session.id,
        userId: session.userId,
        messageCount: session.messages.length,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        isActive: Date.now() - new Date(session.lastActivity).getTime() < 3600000 // 1 hour
      }
    });
  } catch (error) {
    console.error('Get session info error:', error);
    res.status(500).json({
      error: 'Failed to get session info',
      message: error.message
    });
  }
});

// Health check for chat service
router.get('/health', async (req, res) => {
  try {
    const chatStats = {
      activeSessions: activeSessions.size,
      geminiApiKey: GEMINI_API_KEY ? 'configured' : 'missing',
      ragSystem: RAGSystem.initialized ? 'ready' : 'not initialized'
    };
    
    res.json({
      success: true,
      status: 'healthy',
      stats: chatStats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;