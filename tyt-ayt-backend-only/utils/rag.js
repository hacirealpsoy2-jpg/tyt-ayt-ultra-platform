const Database = require('./database');
const fs = require('fs-extra');
const path = require('path');
const natural = require('natural');

class RAGSystem {
  constructor() {
    this.initialized = false;
    this.knowledgeBase = new Map();
    this.documentChunks = new Map();
    this.stopWords = new Set([
      've', 'veya', 'ama', 'çünkü', 'ki', 'için', 'olarak', 'ile', 'da', 'de',
      'the', 'is', 'are', 'and', 'or', 'but', 'because', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'
    ]);
  }

  async init() {
    try {
      console.log('🧠 Initializing RAG System...');
      
      // Load knowledge base from files
      await this.loadKnowledgeBase();
      
      // Process and chunk documents
      await this.processDocuments();
      
      // Create embeddings for chunks
      await this.createEmbeddings();
      
      this.initialized = true;
      console.log(`✅ RAG System initialized with ${this.documentChunks.size} document chunks`);
    } catch (error) {
      console.error('❌ RAG System initialization failed:', error);
      throw error;
    }
  }

  async loadKnowledgeBase() {
    const ragDataPath = path.join(__dirname, '../../rag_data');
    
    if (await fs.pathExists(ragDataPath)) {
      const files = await fs.readdir(ragDataPath);
      
      for (const file of files) {
        if (file.endsWith('.json') || file.endsWith('.txt')) {
          const filePath = path.join(ragDataPath, file);
          const content = await fs.readFile(filePath, 'utf-8');
          
          let documents = [];
          if (file.endsWith('.json')) {
            documents = JSON.parse(content);
          } else {
            documents = [{ title: file, content: content, category: 'general' }];
          }
          
          for (const doc of documents) {
            await this.addDocument(doc);
          }
        }
      }
    }

    // Add default TYT-AYT knowledge if no documents exist
    if (this.documentChunks.size === 0) {
      await this.loadDefaultKnowledge();
    }
  }

  async loadDefaultKnowledge() {
    const defaultDocuments = [
      {
        title: 'TYT Matematik Konuları',
        content: 'TYT Matematik konuları: Sayılar ve İşlemler, Kümeler, Mantık, Fonksiyonlar, Polinomlar, Denklemler ve Eşitsizlikler, Diziler ve Seriler, Trigonometri, Analitik Geometri, İstatistik ve Olasılık.',
        category: 'tyt-matematik',
        tags: ['matematik', 'tyt', 'sayılar', 'fonksiyonlar', 'geometri']
      },
      {
        title: 'TYT Türkçe Konuları',
        content: 'TYT Türkçe konuları: Anlam Bilgisi, Cümle Bilgisi, Anlatım Biçimleri, Paragraf, Okuma Anlama, Dil Bilgisi, Yazım Kuralları, Noktalama İşaretleri.',
        category: 'tyt-turkce',
        tags: ['türkçe', 'tyt', 'dil', 'anlam', 'cümle', 'paragraf']
      },
      {
        title: 'TYT Fen Bilimleri',
        content: 'TYT Fen Bilimleri konuları: Fizik (Mekanik, Elektrik, Manyetizma, Dalgalar), Kimya (Atom, Periyodik Sistem, Kimyasal Türler), Biyoloji (Canlıların Özellikleri, Hücre, Metabolizma).',
        category: 'tyt-fen',
        tags: ['fizik', 'kimya', 'biyoloji', 'tyt', 'fen', 'hücre', 'atom']
      },
      {
        title: 'AYT Matematik',
        content: 'AYT Matematik konuları: Türev, İntegral, Diziler ve Seriler, Trigonometri, Analitik Geometri, Olasılık, İstatistik, Kompleks Sayılar, Matrisler.',
        category: 'ayt-matematik',
        tags: ['matematik', 'ayt', 'türev', 'integral', 'trigonometri', 'analitik']
      },
      {
        title: 'İngilizce Gramer Konuları',
        content: 'İngilizce gramer konuları: Tenses (Zamanlar), Conditionals (Koşul Cümleleri), Passive Voice (Edilgen Çatı), Reported Speech (Dolaylı Anlatım), Modal Verbs (Modal Fiiller), Articles (Artikeller).',
        category: 'english-grammar',
        tags: ['english', 'grammar', 'tenses', 'conditionals', 'passive', 'modal']
      },
      {
        title: 'Python Temel Konuları',
        content: 'Python temel konuları: Variables (Değişkenler), Data Types (Veri Tipleri), Operators (Operatörler), Control Flow (Kontrol Akışı), Loops (Döngüler), Functions (Fonksiyonlar), Classes and Objects (Sınıflar ve Nesneler), Exception Handling (Hata Yönetimi).',
        category: 'python-basics',
        tags: ['python', 'programming', 'variables', 'functions', 'loops', 'classes']
      },
      {
        title: 'Sağlık ve Çalışma Tavsiyeleri',
        content: 'Çalışma verimliliği için: Düzenli uyku (7-8 saat), Sağlıklı beslenme, Düzenli egzersiz, Molalar vermek, Pomodoro tekniği, Not alma teknikleri, Aktif öğrenme yöntemleri.',
        category: 'health-study',
        tags: ['sağlık', 'çalışma', 'uyku', 'beslenme', 'egzersiz', 'pomodoro']
      }
    ];

    for (const doc of defaultDocuments) {
      await this.addDocument(doc);
    }

    console.log('📚 Default TYT-AYT knowledge loaded');
  }

  async addDocument(document) {
    const id = require('uuid').v4();
    const chunks = this.chunkDocument(document.content);
    
    this.knowledgeBase.set(id, {
      ...document,
      id,
      chunks: chunks.length,
      createdAt: new Date().toISOString()
    });

    // Store chunks for searching
    chunks.forEach((chunk, index) => {
      const chunkId = `${id}_${index}`;
      this.documentChunks.set(chunkId, {
        id: chunkId,
        parentId: id,
        title: document.title,
        content: chunk,
        category: document.category,
        tags: document.tags || [],
        index
      });
    });
  }

  chunkDocument(content, maxLength = 500, overlap = 50) {
    const sentences = content.split(/[.!?]+/);
    const chunks = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length > maxLength && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence + '.';
        
        // Add overlap
        if (chunks.length > 0) {
          const lastChunk = chunks[chunks.length - 1];
          currentChunk = lastChunk.slice(-overlap) + currentChunk;
        }
      } else {
        currentChunk += sentence + '.';
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  async createEmbeddings() {
    // Simple text-based embeddings using TF-IDF
    // In production, use proper vector embeddings like OpenAI embeddings
    
    console.log('🔍 Creating document embeddings...');
    
    for (const [chunkId, chunk] of this.documentChunks) {
      const tokens = this.tokenize(chunk.content);
      const tfidf = this.calculateTFIDF(tokens);
      
      chunk.embedding = tfidf;
    }
  }

  tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\sğüşıöçĞÜŞİÖÇ]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 2 && !this.stopWords.has(token));
  }

  calculateTFIDF(tokens) {
    const termFreq = {};
    const totalTokens = tokens.length;
    
    tokens.forEach(token => {
      termFreq[token] = (termFreq[token] || 0) + 1;
    });

    // Normalize by total tokens
    Object.keys(termFreq).forEach(term => {
      termFreq[term] = termFreq[term] / totalTokens;
    });

    return termFreq;
  }

  async search(query, options = {}) {
    if (!this.initialized) {
      throw new Error('RAG system not initialized');
    }

    const {
      category = null,
      maxResults = 5,
      minScore = 0.1
    } = options;

    // Tokenize query
    const queryTokens = this.tokenize(query);
    const queryEmbedding = this.calculateTFIDF(queryTokens);

    // Calculate similarity scores
    const scores = [];
    
    for (const [chunkId, chunk] of this.documentChunks) {
      if (category && chunk.category !== category) continue;
      
      const score = this.cosineSimilarity(queryEmbedding, chunk.embedding);
      
      if (score >= minScore) {
        scores.push({
          chunkId,
          score,
          chunk,
          highlights: this.highlightMatches(chunk.content, queryTokens)
        });
      }
    }

    // Sort by score and limit results
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, maxResults);
  }

  cosineSimilarity(vec1, vec2) {
    const terms = new Set([...Object.keys(vec1), ...Object.keys(vec2)]);
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (const term of terms) {
      const val1 = vec1[term] || 0;
      const val2 = vec2[term] || 0;
      
      dotProduct += val1 * val2;
      norm1 += val1 * val1;
      norm2 += val2 * val2;
    }

    if (norm1 === 0 || norm2 === 0) return 0;
    
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  highlightMatches(text, queryTokens) {
    let highlighted = text;
    const highlights = [];

    queryTokens.forEach(token => {
      const regex = new RegExp(`\\b${token}\\b`, 'gi');
      const matches = text.match(regex);
      
      if (matches) {
        highlights.push({
          token,
          count: matches.length,
          positions: Array.from(text.matchAll(regex)).map(match => match.index)
        });
        
        highlighted = highlighted.replace(regex, `**${token}**`);
      }
    });

    return highlights;
  }

  async answerQuestion(question, context = []) {
    const searchResults = await this.search(question, { maxResults: 3 });
    
    let contextText = '';
    if (searchResults.length > 0) {
      contextText = searchResults.map(result => result.chunk.content).join('\n\n');
    }
    
    if (context.length > 0) {
      contextText += '\n\n' + context.join('\n');
    }

    return {
      question,
      context: contextText,
      searchResults,
      hasRelevantInfo: searchResults.length > 0,
      timestamp: new Date().toISOString()
    };
  }

  getCategories() {
    const categories = new Set();
    for (const chunk of this.documentChunks.values()) {
      categories.add(chunk.category);
    }
    return Array.from(categories);
  }

  getDocumentStats() {
    const stats = {
      totalDocuments: this.knowledgeBase.size,
      totalChunks: this.documentChunks.size,
      categories: this.getCategories(),
      avgChunksPerDocument: this.documentChunks.size / this.knowledgeBase.size
    };
    
    return stats;
  }
}

module.exports = new RAGSystem();