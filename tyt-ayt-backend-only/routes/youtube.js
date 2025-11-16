const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const Database = require('../utils/database');

const router = express.Router();

// YouTube API Configuration
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const YOUTUBE_BASE_URL = 'https://www.googleapis.com/youtube/v3';

// Middleware to check API key
const checkApiKey = (req, res, next) => {
  if (!YOUTUBE_API_KEY) {
    return res.status(500).json({
      error: 'YouTube API Key not configured',
      message: 'Please set YOUTUBE_API_KEY in environment variables',
      help: 'Get your API key from https://console.developers.google.com'
    });
  }
  next();
};

// Helper function to extract video ID from various YouTube URL formats
function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/v\/([^&\n?#]+)/,
    /youtube\.com\/.*[?&]v=([^&\n?#]+)/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

// Search for educational videos
router.get('/search', checkApiKey, async (req, res) => {
  try {
    const {
      q,
      maxResults = 10,
      order = 'relevance',
      type = 'video',
      duration = 'any',
      publishedAfter = null
    } = req.query;

    if (!q) {
      return res.status(400).json({
        error: 'Missing query parameter',
        message: 'Query parameter "q" is required'
      });
    }

    // Build search parameters
    const searchParams = {
      part: 'snippet',
      q: q,
      type: type,
      maxResults: Math.min(parseInt(maxResults), 50), // YouTube API limit
      order: order,
      key: YOUTUBE_API_KEY,
      videoDuration: duration,
      videoEmbeddable: 'true',
      safeSearch: 'moderate'
    };

    // Add published date filter if specified
    if (publishedAfter) {
      searchParams.publishedAfter = publishedAfter;
    }

    // Make request to YouTube Search API
    const response = await axios.get(`${YOUTUBE_BASE_URL}/search`, {
      params: searchParams,
      timeout: 15000
    });

    const searchResults = response.data.items.map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      description: item.snippet.description,
      channelTitle: item.snippet.channelTitle,
      channelId: item.snippet.channelId,
      publishedAt: item.snippet.publishedAt,
      thumbnail: {
        default: item.snippet.thumbnails.default?.url,
        medium: item.snippet.thumbnails.medium?.url,
        high: item.snippet.thumbnails.high?.url
      },
      categoryId: item.snippet.categoryId
    }));

    // Cache search results in database for future reference
    for (const result of searchResults) {
      Database.saveYouTubeVideo({
        videoId: result.videoId,
        title: result.title,
        description: result.description,
        duration: null, // Will be filled when video details are fetched
        viewCount: null,
        likeCount: null,
        channelTitle: result.channelTitle,
        publishedAt: result.publishedAt,
        thumbnailUrl: result.thumbnail.high
      });
    }

    res.json({
      success: true,
      data: {
        query: q,
        totalResults: response.data.pageInfo?.totalResults || 0,
        resultsPerPage: response.data.pageInfo?.resultsPerPage || 0,
        nextPageToken: response.data.nextPageToken,
        items: searchResults
      },
      metadata: {
        requestTime: new Date().toISOString(),
        apiQuotaUsed: 100 // YouTube Search API uses 100 quota per request
      }
    });

  } catch (error) {
    console.error('YouTube search error:', error);
    
    let errorMessage = 'YouTube search failed';
    let statusCode = 500;

    if (error.response) {
      const { status, data } = error.response;
      statusCode = status;
      
      if (status === 403) {
        errorMessage = 'YouTube API access denied - check your API key and quota';
      } else if (status === 429) {
        errorMessage = 'YouTube API rate limit exceeded';
      }
      errorMessage = data.error?.message || errorMessage;
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = 'Request timeout - try again';
      statusCode = 408;
    }

    res.status(statusCode).json({
      error: 'YouTube search error',
      message: errorMessage,
      timestamp: new Date().toISOString()
    });
  }
});

// Analyze a specific video
router.get('/analyze', checkApiKey, async (req, res) => {
  try {
    const { url, videoId } = req.query;

    let actualVideoId = videoId;
    if (url) {
      actualVideoId = extractVideoId(url);
    }

    if (!actualVideoId) {
      return res.status(400).json({
        error: 'Invalid YouTube URL or missing video ID',
        message: 'Provide either a valid YouTube URL or video ID'
      });
    }

    // Check cache first
    const cachedVideo = Database.getYouTubeVideo(actualVideoId);
    const useCache = cachedVideo && 
      (Date.now() - new Date(cachedVideo.updated_at).getTime()) < 3600000; // 1 hour

    let videoData = cachedVideo;

    if (!useCache) {
      // Fetch fresh data from YouTube API
      const response = await axios.get(`${YOUTUBE_BASE_URL}/videos`, {
        params: {
          part: 'snippet,statistics,contentDetails',
          id: actualVideoId,
          key: YOUTUBE_API_KEY
        },
        timeout: 15000
      });

      if (!response.data.items || response.data.items.length === 0) {
        return res.status(404).json({
          error: 'Video not found',
          message: `Video with ID ${actualVideoId} was not found`
        });
      }

      const video = response.data.items[0];
      
      // Parse duration (PT1H2M10S format to seconds)
      const parseDuration = (duration) => {
        const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        const hours = parseInt(match[1] || 0);
        const minutes = parseInt(match[2] || 0);
        const seconds = parseInt(match[3] || 0);
        return hours * 3600 + minutes * 60 + seconds;
      };

      videoData = {
        videoId: actualVideoId,
        title: video.snippet.title,
        description: video.snippet.description,
        duration: parseDuration(video.contentDetails.duration),
        viewCount: parseInt(video.statistics.viewCount || 0),
        likeCount: parseInt(video.statistics.likeCount || 0),
        channelTitle: video.snippet.channelTitle,
        publishedAt: video.snippet.publishedAt,
        thumbnailUrl: video.snippet.thumbnails.high?.url,
        tags: video.snippet.tags || [],
        categoryId: video.snippet.categoryId,
        defaultLanguage: video.snippet.defaultLanguage,
        defaultAudioLanguage: video.snippet.defaultAudioLanguage
      };

      // Cache the video data
      Database.saveYouTubeVideo(videoData);
    }

    // Educational content analysis
    const educationalScore = calculateEducationalScore(videoData);
    const contentType = categorizeContent(videoData.title, videoData.description);
    const difficultyLevel = estimateDifficultyLevel(videoData);
    const keywords = extractKeywords(videoData.title, videoData.description);

    const analysisResult = {
      videoId: actualVideoId,
      basicInfo: {
        title: videoData.title,
        channel: videoData.channelTitle,
        duration: videoData.duration,
        publishedAt: videoData.publishedAt
      },
      statistics: {
        views: videoData.viewCount,
        likes: videoData.likeCount,
        engagement: videoData.likeCount > 0 ? (videoData.viewCount / videoData.likeCount) : null
      },
      educational: {
        score: educationalScore,
        type: contentType,
        difficulty: difficultyLevel,
        isEducational: educationalScore > 0.6,
        subject: keywords.subject || 'Genel'
      },
      analysis: {
        keywords: keywords,
        description: videoData.description?.substring(0, 200) + '...' || 'Açıklama yok',
        thumbnail: videoData.thumbnailUrl
      },
      recommendations: generateRecommendations(videoData, educationalScore, contentType)
    };

    res.json({
      success: true,
      data: analysisResult,
      cached: !!useCache,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('YouTube analyze error:', error);
    
    let errorMessage = 'Video analysis failed';
    let statusCode = 500;

    if (error.response) {
      const { status } = error.response;
      
      if (status === 403) {
        errorMessage = 'YouTube API access denied - check your API key';
      } else if (status === 429) {
        errorMessage = 'YouTube API rate limit exceeded';
      } else if (status === 404) {
        errorMessage = 'Video not found';
      }
    }

    res.status(statusCode).json({
      error: 'YouTube analysis error',
      message: errorMessage,
      timestamp: new Date().toISOString()
    });
  }
});

// Get video transcript (placeholder - would need YouTube Transcript API)
router.get('/transcript', checkApiKey, async (req, res) => {
  try {
    const { videoId } = req.query;

    if (!videoId) {
      return res.status(400).json({
        error: 'Missing video ID',
        message: 'Query parameter "videoId" is required'
      });
    }

    // This is a placeholder - in a real implementation, you would use
    // YouTube's transcript API or a third-party service
    res.json({
      success: true,
      message: 'Transcript feature not yet implemented',
      videoId: videoId,
      availableAt: 'https://www.youtube.com/watch?v=' + videoId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('YouTube transcript error:', error);
    res.status(500).json({
      error: 'Transcript retrieval failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get trending educational content
router.get('/trending', checkApiKey, async (req, res) => {
  try {
    const {
      category = 'education',
      regionCode = 'TR',
      maxResults = 20
    } = req.query;

    const response = await axios.get(`${YOUTUBE_BASE_URL}/videos`, {
      params: {
        part: 'snippet,statistics',
        chart: 'mostPopular',
        regionCode: regionCode,
        videoCategoryId: getCategoryId(category),
        maxResults: Math.min(parseInt(maxResults), 50),
        key: YOUTUBE_API_KEY
      },
      timeout: 15000
    });

    const videos = response.data.items.map(video => ({
      videoId: video.id,
      title: video.snippet.title,
      description: video.snippet.description?.substring(0, 150) + '...' || 'Açıklama yok',
      channelTitle: video.snippet.channelTitle,
      publishedAt: video.snippet.publishedAt,
      thumbnail: video.snippet.thumbnails.high?.url,
      statistics: {
        views: parseInt(video.statistics.viewCount || 0),
        likes: parseInt(video.statistics.likeCount || 0)
      },
      category: category
    }));

    res.json({
      success: true,
      data: {
        category: category,
        region: regionCode,
        totalResults: response.data.pageInfo?.totalResults || 0,
        items: videos
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('YouTube trending error:', error);
    res.status(500).json({
      error: 'Failed to fetch trending videos',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Helper functions
function calculateEducationalScore(videoData) {
  let score = 0;
  const title = videoData.title.toLowerCase();
  const description = videoData.description?.toLowerCase() || '';

  // Educational keywords
  const eduKeywords = ['öğren', 'eğitim', 'ders', 'konu', 'açıklama', 'tutorial', 'lesson', 'course', 'matematik', 'fizik', 'kimya', 'biyoloji', 'türkçe', 'ingilizce', 'python', 'programlama'];
  const eduCount = eduKeywords.filter(keyword => title.includes(keyword) || description.includes(keyword)).length;
  score += Math.min(eduCount * 0.1, 0.4);

  // Channel credibility indicators
  const channelName = videoData.channelTitle.toLowerCase();
  if (channelName.includes('okul') || channelName.includes('üniversite') || channelName.includes('academy') || channelName.includes('edu')) {
    score += 0.2;
  }

  // Duration analysis (educational videos are often longer)
  if (videoData.duration > 300) { // More than 5 minutes
    score += 0.1;
  }

  // View to like ratio (good engagement for educational content)
  if (videoData.likeCount > 0 && videoData.viewCount > 0) {
    const ratio = videoData.likeCount / videoData.viewCount;
    if (ratio > 0.02) { // Good engagement
      score += 0.2;
    }
  }

  return Math.min(score, 1.0);
}

function categorizeContent(title, description) {
  const text = (title + ' ' + (description || '')).toLowerCase();
  
  if (text.includes('matematik') || text.includes('math')) return 'Matematik';
  if (text.includes('fizik') || text.includes('physics')) return 'Fizik';
  if (text.includes('kimya') || text.includes('chemistry')) return 'Kimya';
  if (text.includes('biyoloji') || text.includes('biology')) return 'Biyoloji';
  if (text.includes('türkçe') || text.includes('turkish')) return 'Türkçe';
  if (text.includes('ingilizce') || text.includes('english')) return 'İngilizce';
  if (text.includes('python') || text.includes('programlama') || text.includes('coding')) return 'Python';
  if (text.includes('tyt') || text.includes('ayt') || text.includes('sınav')) return 'Sınav Hazırlığı';
  
  return 'Genel Eğitim';
}

function estimateDifficultyLevel(videoData) {
  const title = videoData.title.toLowerCase();
  const description = videoData.description?.toLowerCase() || '';
  const text = title + ' ' + description;

  const beginnerKeywords = ['başlangıç', 'temel', 'basit', 'beginner', 'basic', 'introduction', 'intro'];
  const intermediateKeywords = ['orta', 'intermediate', 'advanced'];
  const expertKeywords = ['ileri', 'expert', 'advanced', 'professional'];

  if (expertKeywords.some(keyword => text.includes(keyword))) return 'İleri';
  if (intermediateKeywords.some(keyword => text.includes(keyword))) return 'Orta';
  if (beginnerKeywords.some(keyword => text.includes(keyword))) return 'Başlangıç';
  
  return 'Orta'; // Default
}

function extractKeywords(title, description) {
  const text = (title + ' ' + (description || '')).toLowerCase();
  
  const subjects = ['matematik', 'fizik', 'kimya', 'biyoloji', 'türkçe', 'ingilizce', 'python', 'programlama'];
  const levels = ['başlangıç', 'orta', 'ileri', 'temel', 'advanced'];
  const types = ['ders', 'konu', 'soru', 'çözüm', 'açıklama', 'tutorial'];

  const keywords = {
    subject: subjects.find(subject => text.includes(subject)) || 'Genel',
    level: levels.find(level => text.includes(level)) || 'Orta',
    type: types.find(type => text.includes(type)) || 'İçerik'
  };

  return keywords;
}

function generateRecommendations(videoData, score, contentType) {
  const recommendations = [];

  if (score > 0.7) {
    recommendations.push('Bu video yüksek eğitim değeri taşıyor');
  }

  if (videoData.duration > 1800) { // 30 minutes
    recommendations.push('Bu uzun video için not alarak izlemenizi öneririz');
  }

  if (contentType === 'Python') {
    recommendations.push('Python kod örneklerini takip ederek pratik yapın');
  }

  if (contentType === 'Matematik') {
    recommendations.push('Matematik konularında soru çözümü ile pekiştirme yapın');
  }

  return recommendations;
}

function getCategoryId(category) {
  const categoryMap = {
    'education': '27',
    'science': '28',
    'technology': '28',
    'programming': '28'
  };
  return categoryMap[category.toLowerCase()] || '27';
}

module.exports = router;