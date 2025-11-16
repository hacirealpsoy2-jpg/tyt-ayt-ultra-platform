const express = require('express');
const Database = require('../utils/database');

const router = express.Router();

// Get user profile and stats
router.get('/profile', async (req, res) => {
  try {
    const { userId = 'demo-user' } = req.query;

    // Get user statistics
    const stats = Database.getUserStats(userId);
    
    // Get learning progress
    const progress = Database.getUserProgress(userId);
    
    // Get achievements
    const achievements = Database.getUserAchievements(userId);
    
    // Get study sessions
    const studySessions = Database.getUserStudySessions(userId, 10);
    
    // Get recent chat sessions (mock data for demo)
    const recentChats = Database.getChatHistory(userId, 'recent', 5);

    // Calculate study streak (simplified)
    const studyDates = studySessions.map(session => 
      new Date(session.timestamp).toDateString()
    ).filter((date, index, arr) => arr.indexOf(date) === index);
    
    const studyStreak = calculateStudyStreak(studyDates);

    const profile = {
      userId,
      basicInfo: {
        totalStudyTime: stats.totalStudyTime,
        chatCount: stats.chatCount,
        pythonExecutions: stats.pythonExecutions,
        achievements: stats.achievements
      },
      learningProgress: {
        totalLessons: progress.length,
        subjects: getSubjectBreakdown(progress),
        recentActivity: studySessions.slice(0, 5)
      },
      achievements: {
        total: achievements.length,
        recent: achievements.slice(0, 3),
        categories: getAchievementCategories(achievements)
      },
      studyMetrics: {
        streak: studyStreak,
        averageSessionTime: calculateAverageSession(studySessions),
        mostActiveSubject: getMostActiveSubject(progress),
        weeklyGoal: {
          target: 420, // 7 hours per week
          completed: calculateWeeklyProgress(studySessions),
          percentage: Math.round((calculateWeeklyProgress(studySessions) / 420) * 100)
        }
      },
      recentActivity: {
        chats: recentChats.length,
        lastStudySession: studySessions[0]?.timestamp || null,
        lastChat: recentChats[0]?.timestamp || null
      }
    };

    res.json({
      success: true,
      data: profile,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      error: 'Failed to retrieve user profile',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Update user progress
router.post('/progress', async (req, res) => {
  try {
    const {
      userId = 'demo-user',
      subject,
      lessonId = null,
      progressValue,
      completed = false,
      metadata = {}
    } = req.body;

    if (!subject || progressValue === undefined) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'subject and progressValue are required'
      });
    }

    const progressId = Database.updateProgress(
      userId,
      subject,
      lessonId,
      progressValue,
      completed,
      metadata
    );

    // Check for achievements
    await checkAchievements(userId, subject, progressValue, completed);

    res.json({
      success: true,
      data: {
        progressId,
        subject,
        progressValue,
        completed,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Update progress error:', error);
    res.status(500).json({
      error: 'Failed to update progress',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Log study session
router.post('/study-session', async (req, res) => {
  try {
    const {
      userId = 'demo-user',
      subject,
      duration,
      topicsCovered = [],
      productivityScore = null
    } = req.body;

    if (!subject || !duration) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'subject and duration are required'
      });
    }

    const sessionId = Database.saveStudySession(
      userId,
      subject,
      duration,
      topicsCovered,
      productivityScore
    );

    res.json({
      success: true,
      data: {
        sessionId,
        subject,
        duration,
        topicsCovered,
        productivityScore,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Log study session error:', error);
    res.status(500).json({
      error: 'Failed to log study session',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get user achievements
router.get('/achievements', async (req, res) => {
  try {
    const { userId = 'demo-user', category = null } = req.query;

    const achievements = Database.getUserAchievements(userId);
    
    const filteredAchievements = category 
      ? achievements.filter(ach => ach.achievement_type === category)
      : achievements;

    const formattedAchievements = filteredAchievements.map(ach => ({
      id: ach.id,
      type: ach.achievement_type,
      name: ach.achievement_name,
      description: ach.achievement,
      earnedAt: ach.earned_at,
      metadata: JSON.parse(ach.metadata || '{}')
    }));

    res.json({
      success: true,
      data: {
        userId,
        category,
        totalAchievements: formattedAchievements.length,
        achievements: formattedAchievements
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Get achievements error:', error);
    res.status(500).json({
      error: 'Failed to retrieve achievements',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get study statistics
router.get('/statistics', async (req, res) => {
  try {
    const { userId = 'demo-user', period = 'week' } = req.query;

    const sessions = Database.getUserStudySessions(userId, 100);
    
    // Filter by period
    const filteredSessions = filterByPeriod(sessions, period);
    
    // Calculate statistics
    const stats = {
      period,
      totalSessions: filteredSessions.length,
      totalTime: filteredSessions.reduce((sum, session) => sum + session.duration, 0),
      averageSessionTime: calculateAverageSession(filteredSessions),
      sessionsBySubject: getSessionsBySubject(filteredSessions),
      weeklyProgress: calculateWeeklyProgress(filteredSessions),
      dailyBreakdown: getDailyBreakdown(filteredSessions),
      productivityTrend: getProductivityTrend(filteredSessions)
    };

    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Get statistics error:', error);
    res.status(500).json({
      error: 'Failed to retrieve statistics',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get learning roadmap
router.get('/roadmap', async (req, res) => {
  try {
    const { userId = 'demo-user', subject = null } = req.query;

    const progress = Database.getUserProgress(userId, subject);
    const roadmap = generateLearningRoadmap(progress, subject);

    res.json({
      success: true,
      data: {
        subject,
        currentLevel: roadmap.currentLevel,
        nextMilestones: roadmap.nextMilestones,
        recommendations: roadmap.recommendations,
        progress: roadmap.progress,
        estimatedCompletion: roadmap.estimatedCompletion
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Get roadmap error:', error);
    res.status(500).json({
      error: 'Failed to generate learning roadmap',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Helper functions
function calculateStudyStreak(studyDates) {
  if (studyDates.length === 0) return 0;
  
  const sortedDates = studyDates.sort((a, b) => new Date(b) - new Date(a));
  const today = new Date().toDateString();
  
  let streak = 0;
  let currentDate = new Date();
  
  for (const studyDate of sortedDates) {
    const studyDateObj = new Date(studyDate);
    const dayDiff = Math.floor((currentDate - studyDateObj) / (1000 * 60 * 60 * 24));
    
    if (dayDiff === streak) {
      streak++;
      currentDate = new Date(studyDateObj);
    } else {
      break;
    }
  }
  
  return streak;
}

function getSubjectBreakdown(progress) {
  const subjects = {};
  progress.forEach(p => {
    if (!subjects[p.subject]) {
      subjects[p.subject] = { total: 0, completed: 0, progress: 0 };
    }
    subjects[p.subject].total++;
    if (p.completed) {
      subjects[p.subject].completed++;
    }
    subjects[p.subject].progress = (subjects[p.subject].completed / subjects[p.subject].total) * 100;
  });
  return subjects;
}

function getAchievementCategories(achievements) {
  const categories = {};
  achievements.forEach(ach => {
    if (!categories[ach.achievement_type]) {
      categories[ach.achievement_type] = 0;
    }
    categories[ach.achievement_type]++;
  });
  return categories;
}

function calculateAverageSession(sessions) {
  if (sessions.length === 0) return 0;
  const totalTime = sessions.reduce((sum, session) => sum + session.duration, 0);
  return Math.round(totalTime / sessions.length);
}

function getMostActiveSubject(progress) {
  const subjectCounts = {};
  progress.forEach(p => {
    subjectCounts[p.subject] = (subjectCounts[p.subject] || 0) + 1;
  });
  
  const mostActive = Object.keys(subjectCounts).reduce((a, b) => 
    subjectCounts[a] > subjectCounts[b] ? a : b
  );
  
  return mostActive;
}

function calculateWeeklyProgress(sessions) {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  
  const weeklySessions = sessions.filter(session => 
    new Date(session.timestamp) >= oneWeekAgo
  );
  
  return weeklySessions.reduce((sum, session) => sum + session.duration, 0);
}

function filterByPeriod(sessions, period) {
  const now = new Date();
  let startDate = new Date();
  
  switch (period) {
    case 'day':
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'week':
      startDate.setDate(now.getDate() - 7);
      break;
    case 'month':
      startDate.setMonth(now.getMonth() - 1);
      break;
    case 'year':
      startDate.setFullYear(now.getFullYear() - 1);
      break;
    default:
      startDate.setDate(now.getDate() - 7);
  }
  
  return sessions.filter(session => new Date(session.timestamp) >= startDate);
}

function getSessionsBySubject(sessions) {
  const subjects = {};
  sessions.forEach(session => {
    if (!subjects[session.subject]) {
      subjects[session.subject] = { sessions: 0, totalTime: 0 };
    }
    subjects[session.subject].sessions++;
    subjects[session.subject].totalTime += session.duration;
  });
  return subjects;
}

function getDailyBreakdown(sessions) {
  const dailyStats = {};
  sessions.forEach(session => {
    const date = new Date(session.timestamp).toDateString();
    if (!dailyStats[date]) {
      dailyStats[date] = { sessions: 0, totalTime: 0 };
    }
    dailyStats[date].sessions++;
    dailyStats[date].totalTime += session.duration;
  });
  return dailyStats;
}

function getProductivityTrend(sessions) {
  // Simple productivity trend calculation
  const recentSessions = sessions.slice(0, 10);
  const avgScore = recentSessions.reduce((sum, session) => 
    sum + (session.productivity_score || 0), 0) / recentSessions.length;
  
  return {
    recentAverage: Math.round(avgScore * 100) / 100,
    trend: avgScore > 0.7 ? 'increasing' : avgScore < 0.4 ? 'decreasing' : 'stable'
  };
}

function generateLearningRoadmap(progress, subject) {
  // This would be a more sophisticated algorithm in a real implementation
  const roadmap = {
    currentLevel: 'Başlangıç',
    nextMilestones: [
      'Temel konuları tamamla',
      'İlk proje yap',
      'Quiz geç',
      'İleri seviye konular'
    ],
    recommendations: [
      'Düzenli çalışma planı oluştur',
      'Günlük 30 dakika pratik yap',
      'Video dersleri izle',
      'Soru çözümü yap'
    ],
    progress: {
      completed: progress.filter(p => p.completed).length,
      total: progress.length,
      percentage: progress.length > 0 ? 
        Math.round((progress.filter(p => p.completed).length / progress.length) * 100) : 0
    },
    estimatedCompletion: '2-3 ay'
  };
  
  return roadmap;
}

async function checkAchievements(userId, subject, progressValue, completed) {
  // This would check for various achievement conditions
  // and award achievements when criteria are met
  
  const achievementChecks = [
    {
      condition: (p) => p.subject === subject && p.completed,
      type: 'subject_progress',
      name: `${subject} Geliştiricisi`,
      description: `${subject} konularında ilerleme kaydettiniz!`
    },
    {
      condition: (p) => p.progressValue >= 100,
      type: 'milestone',
      name: 'Hedef Başarı',
      description: 'Önemli bir milestonu tamamladınız!'
    }
  ];
  
  for (const check of achievementChecks) {
    if (check.condition({ subject, progressValue, completed })) {
      Database.saveAchievement(
        userId,
        check.type,
        check.name,
        check.description
      );
    }
  }
}

module.exports = router;