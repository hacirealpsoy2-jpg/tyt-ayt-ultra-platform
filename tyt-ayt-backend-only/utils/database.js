const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs-extra');

class DatabaseManager {
  constructor() {
    this.db = null;
    this.dbPath = path.join(__dirname, '../../database/ultra_platform.db');
  }

  async init() {
    try {
      // Ensure database directory exists
      await fs.ensureDir(path.dirname(this.dbPath));

      // Connect to SQLite database
      this.db = new Database(this.dbPath, { 
        verbose: console.log,
        fileMustExist: false 
      });

      // Enable foreign keys
      this.db.pragma('foreign_keys = ON');

      // Create tables
      await this.createTables();

      console.log('✅ Database initialized successfully');
    } catch (error) {
      console.error('❌ Database initialization failed:', error);
      throw error;
    }
  }

  async createTables() {
    // Users table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        profile_data TEXT DEFAULT '{}'
      )
    `);

    // Chat history table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_history (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        message TEXT NOT NULL,
        is_user BOOLEAN NOT NULL,
        response TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT DEFAULT '{}',
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Learning progress table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS learning_progress (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        subject TEXT NOT NULL, -- 'english', 'python', 'math', etc.
        lesson_id TEXT,
        progress_value REAL DEFAULT 0,
        completed BOOLEAN DEFAULT FALSE,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT DEFAULT '{}',
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Python code executions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS python_executions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        code TEXT NOT NULL,
        output TEXT,
        error TEXT,
        execution_time REAL,
        success BOOLEAN DEFAULT FALSE,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // RAG documents table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rag_documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT NOT NULL,
        tags TEXT DEFAULT '[]',
        embedding TEXT, -- JSON array of embeddings
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // YouTube video cache table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS youtube_videos (
        id TEXT PRIMARY KEY,
        video_id TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        duration INTEGER,
        view_count INTEGER,
        like_count INTEGER,
        channel_title TEXT,
        published_at DATETIME,
        thumbnail_url TEXT,
        transcript TEXT,
        analysis_result TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // User achievements table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS achievements (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        achievement_type TEXT NOT NULL,
        achievement_name TEXT NOT NULL,
        description TEXT,
        earned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT DEFAULT '{}',
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Study sessions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS study_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        duration INTEGER NOT NULL, -- in minutes
        topics_covered TEXT DEFAULT '[]',
        productivity_score REAL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    console.log('✅ Database tables created successfully');
  }

  // Generic query methods
  run(sql, params = {}) {
    try {
      return this.db.run(sql, params);
    } catch (error) {
      console.error('Database run error:', error);
      throw error;
    }
  }

  get(sql, params = {}) {
    try {
      return this.db.get(sql, params);
    } catch (error) {
      console.error('Database get error:', error);
      throw error;
    }
  }

  all(sql, params = {}) {
    try {
      return this.db.all(sql, params);
    } catch (error) {
      console.error('Database all error:', error);
      throw error;
    }
  }

  // Chat history methods
  saveChatMessage(userId, sessionId, message, isUser, response = null, metadata = {}) {
    const id = require('uuid').v4();
    this.run(
      `INSERT INTO chat_history (id, user_id, session_id, message, is_user, response, metadata) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, sessionId, message, isUser, response, JSON.stringify(metadata)]
    );
    return id;
  }

  getChatHistory(userId, sessionId, limit = 50) {
    return this.all(
      `SELECT * FROM chat_history 
       WHERE user_id = ? AND session_id = ? 
       ORDER BY timestamp DESC LIMIT ?`,
      [userId, sessionId, limit]
    );
  }

  // Learning progress methods
  updateProgress(userId, subject, lessonId, progressValue, completed = false, metadata = {}) {
    const id = require('uuid').v4();
    this.run(
      `INSERT INTO learning_progress (id, user_id, subject, lesson_id, progress_value, completed, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, subject, lessonId, progressValue, completed, JSON.stringify(metadata)]
    );
    return id;
  }

  getUserProgress(userId, subject = null) {
    const sql = subject 
      ? `SELECT * FROM learning_progress WHERE user_id = ? AND subject = ? ORDER BY timestamp DESC`
      : `SELECT * FROM learning_progress WHERE user_id = ? ORDER BY timestamp DESC`;
    const params = subject ? [userId, subject] : [userId];
    return this.all(sql, params);
  }

  // Python execution methods
  savePythonExecution(userId, code, output = null, error = null, success = false, executionTime = 0) {
    const id = require('uuid').v4();
    this.run(
      `INSERT INTO python_executions (id, user_id, code, output, error, execution_time, success)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, code, output, error, executionTime, success]
    );
    return id;
  }

  getUserExecutions(userId, limit = 20) {
    return this.all(
      `SELECT * FROM python_executions WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?`,
      [userId, limit]
    );
  }

  // RAG methods
  saveRAGDocument(title, content, category, tags = [], embedding = null) {
    const id = require('uuid').v4();
    this.run(
      `INSERT INTO rag_documents (id, title, content, category, tags, embedding)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, title, content, category, JSON.stringify(tags), embedding ? JSON.stringify(embedding) : null]
    );
    return id;
  }

  searchRAGDocuments(query, limit = 10) {
    // Simple text search - in production, use embeddings
    return this.all(
      `SELECT * FROM rag_documents 
       WHERE content LIKE ? OR title LIKE ? 
       ORDER BY created_at DESC LIMIT ?`,
      [`%${query}%`, `%${query}%`, limit]
    );
  }

  getRAGDocumentsByCategory(category) {
    return this.all(
      `SELECT * FROM rag_documents WHERE category = ? ORDER BY created_at DESC`,
      [category]
    );
  }

  // YouTube video methods
  saveYouTubeVideo(videoData) {
    const id = require('uuid').v4();
    this.run(
      `INSERT OR REPLACE INTO youtube_videos 
       (id, video_id, title, description, duration, view_count, like_count, channel_title, published_at, thumbnail_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        videoData.videoId,
        videoData.title,
        videoData.description,
        videoData.duration,
        videoData.viewCount,
        videoData.likeCount,
        videoData.channelTitle,
        videoData.publishedAt,
        videoData.thumbnailUrl
      ]
    );
    return id;
  }

  getYouTubeVideo(videoId) {
    return this.get(
      `SELECT * FROM youtube_videos WHERE video_id = ?`,
      [videoId]
    );
  }

  // Achievement methods
  saveAchievement(userId, achievementType, achievementName, description, metadata = {}) {
    const id = require('uuid').v4();
    this.run(
      `INSERT INTO achievements (id, user_id, achievement_type, achievement_name, description, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, userId, achievementType, achievementName, description, JSON.stringify(metadata)]
    );
    return id;
  }

  getUserAchievements(userId) {
    return this.all(
      `SELECT * FROM achievements WHERE user_id = ? ORDER BY earned_at DESC`,
      [userId]
    );
  }

  // Study session methods
  saveStudySession(userId, subject, duration, topicsCovered = [], productivityScore = null) {
    const id = require('uuid').v4();
    this.run(
      `INSERT INTO study_sessions (id, user_id, subject, duration, topics_covered, productivity_score)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, userId, subject, duration, JSON.stringify(topicsCovered), productivityScore]
    );
    return id;
  }

  getUserStudySessions(userId, limit = 50) {
    return this.all(
      `SELECT * FROM study_sessions WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?`,
      [userId, limit]
    );
  }

  // Statistics methods
  getUserStats(userId) {
    const chatCount = this.get(
      `SELECT COUNT(*) as count FROM chat_history WHERE user_id = ?`,
      [userId]
    ).count;

    const totalStudyTime = this.get(
      `SELECT SUM(duration) as total FROM study_sessions WHERE user_id = ?`,
      [userId]
    ).total || 0;

    const pythonExecutions = this.get(
      `SELECT COUNT(*) as count FROM python_executions WHERE user_id = ? AND success = 1`,
      [userId]
    ).count;

    const achievements = this.get(
      `SELECT COUNT(*) as count FROM achievements WHERE user_id = ?`,
      [userId]
    ).count;

    return {
      chatCount,
      totalStudyTime,
      pythonExecutions,
      achievements
    };
  }
}

module.exports = new DatabaseManager();