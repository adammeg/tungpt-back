const express = require('express');
const router = express.Router();
const Conversation = require('../models/Conversation');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { logInfo } = require('../utils/logger');

// Get chat history with advanced filtering
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    sort = 'lastActivity',
    filter = 'all',
    search = '',
    model = '',
    dateFrom = '',
    dateTo = '',
    minMessages = '',
    maxMessages = ''
  } = req.query;

  // Build query
  const query = { userId: req.user.id };

  // Filter by status
  if (filter === 'active') query.isArchived = false;
  if (filter === 'archived') query.isArchived = true;

  // Filter by model
  if (model) query.model = model;

  // Filter by date range
  if (dateFrom || dateTo) {
    query.createdAt = {};
    if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
    if (dateTo) query.createdAt.$lte = new Date(dateTo);
  }

  // Filter by message count
  if (minMessages || maxMessages) {
    query.totalMessages = {};
    if (minMessages) query.totalMessages.$gte = parseInt(minMessages);
    if (maxMessages) query.totalMessages.$lte = parseInt(maxMessages);
  }

  // Search functionality
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { 'messages.content': { $regex: search, $options: 'i' } }
    ];
  }

  // Sort options
  let sortOption = { 'metadata.lastActivity': -1 };
  switch (sort) {
    case 'createdAt':
      sortOption = { createdAt: -1 };
      break;
    case 'title':
      sortOption = { title: 1 };
      break;
    case 'totalMessages':
      sortOption = { totalMessages: -1 };
      break;
    case 'totalTokens':
      sortOption = { totalTokens: -1 };
      break;
  }

  // Execute query
  const conversations = await Conversation.find(query)
    .sort(sortOption)
    .skip((page - 1) * limit)
    .limit(limit)
    .select('title model totalTokens totalMessages metadata.lastActivity createdAt isArchived metadata.tags')
    .lean();

  const total = await Conversation.countDocuments(query);

  res.json({
    success: true,
    data: {
      conversations,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      },
      filters: {
        sort,
        filter,
        search,
        model,
        dateFrom,
        dateTo,
        minMessages,
        maxMessages
      }
    }
  });
}));

// Search conversations with full-text search
router.get('/search', requireAuth, asyncHandler(async (req, res) => {
  const { q: query, page = 1, limit = 20 } = req.query;

  if (!query || query.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Search query is required'
    });
  }

  // Use MongoDB text search
  const conversations = await Conversation.find({
    userId: req.user.id,
    $text: { $search: query }
  })
  .sort({ score: { $meta: 'textScore' } })
  .skip((page - 1) * limit)
  .limit(limit)
  .select('title model totalTokens totalMessages metadata.lastActivity createdAt score')
  .lean();

  const total = await Conversation.countDocuments({
    userId: req.user.id,
    $text: { $search: query }
  });

  res.json({
    success: true,
    data: {
      conversations,
      query,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
}));

// Get conversation statistics and analytics
router.get('/stats', requireAuth, asyncHandler(async (req, res) => {
  const { days = 30 } = req.query;
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Basic statistics
  const [totalConversations, activeConversations, archivedConversations] = await Promise.all([
    Conversation.countDocuments({ userId: req.user.id }),
    Conversation.countDocuments({ userId: req.user.id, isArchived: false }),
    Conversation.countDocuments({ userId: req.user.id, isArchived: true })
  ]);

  // Recent activity
  const recentConversations = await Conversation.countDocuments({
    userId: req.user.id,
    createdAt: { $gte: startDate }
  });

  // Model usage statistics
  const modelStats = await Conversation.aggregate([
    {
      $match: { userId: req.user.id }
    },
    {
      $group: {
        _id: '$model',
        count: { $sum: 1 },
        totalTokens: { $sum: '$totalTokens' },
        totalMessages: { $sum: '$totalMessages' }
      }
    }
  ]);

  // Monthly activity
  const monthlyActivity = await Conversation.aggregate([
    {
      $match: {
        userId: req.user.id,
        createdAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' }
        },
        conversations: { $sum: 1 },
        messages: { $sum: '$totalMessages' },
        tokens: { $sum: '$totalTokens' }
      }
    },
    {
      $sort: { '_id.year': 1, '_id.month': 1 }
    }
  ]);

  // Most active days
  const dailyActivity = await Conversation.aggregate([
    {
      $match: {
        userId: req.user.id,
        'metadata.lastActivity': { $gte: startDate }
      }
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$metadata.lastActivity' }
        },
        conversations: { $sum: 1 }
      }
    },
    {
      $sort: { conversations: -1 }
    },
    {
      $limit: 10
    }
  ]);

  // Average conversation metrics
  const avgMetrics = await Conversation.aggregate([
    {
      $match: { userId: req.user.id }
    },
    {
      $group: {
        _id: null,
        avgMessages: { $avg: '$totalMessages' },
        avgTokens: { $avg: '$totalTokens' },
        avgDuration: { $avg: '$duration' }
      }
    }
  ]);

  res.json({
    success: true,
    data: {
      period: `${days} days`,
      overview: {
        totalConversations,
        activeConversations,
        archivedConversations,
        recentConversations
      },
      modelUsage: modelStats,
      monthlyActivity,
      dailyActivity,
      averages: avgMetrics[0] || {
        avgMessages: 0,
        avgTokens: 0,
        avgDuration: 0
      }
    }
  });
}));

// Get conversation tags
router.get('/tags', requireAuth, asyncHandler(async (req, res) => {
  const tags = await Conversation.aggregate([
    {
      $match: { userId: req.user.id }
    },
    {
      $unwind: '$metadata.tags'
    },
    {
      $group: {
        _id: '$metadata.tags',
        count: { $sum: 1 }
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);

  res.json({
    success: true,
    data: {
      tags: tags.map(tag => ({
        name: tag._id,
        count: tag.count
      }))
    }
  });
}));

// Get conversations by tag
router.get('/tags/:tag', requireAuth, asyncHandler(async (req, res) => {
  const { tag } = req.params;
  const { page = 1, limit = 20 } = req.query;

  const conversations = await Conversation.find({
    userId: req.user.id,
    'metadata.tags': tag
  })
  .sort({ 'metadata.lastActivity': -1 })
  .skip((page - 1) * limit)
  .limit(limit)
  .select('title model totalTokens totalMessages metadata.lastActivity createdAt')
  .lean();

  const total = await Conversation.countDocuments({
    userId: req.user.id,
    'metadata.tags': tag
  });

  res.json({
    success: true,
    data: {
      tag,
      conversations,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
}));

// Add tag to conversation
router.post('/conversations/:id/tags', requireAuth, asyncHandler(async (req, res) => {
  const { tags } = req.body;

  if (!tags || !Array.isArray(tags)) {
    return res.status(400).json({
      success: false,
      error: 'Tags array is required'
    });
  }

  const conversation = await Conversation.findOneAndUpdate(
    {
      _id: req.params.id,
      userId: req.user.id
    },
    {
      $addToSet: { 'metadata.tags': { $each: tags } }
    },
    { new: true }
  );

  if (!conversation) {
    return res.status(404).json({
      success: false,
      error: 'Conversation not found'
    });
  }

  res.json({
    success: true,
    data: {
      conversation: {
        id: conversation._id,
        tags: conversation.metadata.tags
      }
    }
  });
}));

// Remove tag from conversation
router.delete('/conversations/:id/tags/:tag', requireAuth, asyncHandler(async (req, res) => {
  const { tag } = req.params;

  const conversation = await Conversation.findOneAndUpdate(
    {
      _id: req.params.id,
      userId: req.user.id
    },
    {
      $pull: { 'metadata.tags': tag }
    },
    { new: true }
  );

  if (!conversation) {
    return res.status(404).json({
      success: false,
      error: 'Conversation not found'
    });
  }

  res.json({
    success: true,
    data: {
      conversation: {
        id: conversation._id,
        tags: conversation.metadata.tags
      }
    }
  });
}));

// Export conversation history
router.get('/export', requireAuth, asyncHandler(async (req, res) => {
  const { format = 'json', dateFrom = '', dateTo = '' } = req.query;

  const query = { userId: req.user.id };
  if (dateFrom || dateTo) {
    query.createdAt = {};
    if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
    if (dateTo) query.createdAt.$lte = new Date(dateTo);
  }

  const conversations = await Conversation.find(query)
    .sort({ createdAt: -1 })
    .select('title model messages totalTokens totalMessages metadata createdAt')
    .lean();

  const exportData = {
    exportDate: new Date().toISOString(),
    userId: req.user.id,
    totalConversations: conversations.length,
    conversations: conversations.map(conv => ({
      id: conv._id,
      title: conv.title,
      model: conv.model,
      totalTokens: conv.totalTokens,
      totalMessages: conv.totalMessages,
      createdAt: conv.createdAt,
      messages: conv.messages.map(msg => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        model: msg.model
      }))
    }))
  };

  if (format === 'csv') {
    // Convert to CSV format
    const csvData = conversations.map(conv => ({
      id: conv._id,
      title: conv.title,
      model: conv.model,
      totalTokens: conv.totalTokens,
      totalMessages: conv.totalMessages,
      createdAt: conv.createdAt,
      firstMessage: conv.messages[0]?.content || '',
      lastMessage: conv.messages[conv.messages.length - 1]?.content || ''
    }));

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="chat-history-${new Date().toISOString().split('T')[0]}.csv"`);
    
    // Simple CSV conversion
    const csv = [
      Object.keys(csvData[0] || {}).join(','),
      ...csvData.map(row => Object.values(row).map(val => `"${val}"`).join(','))
    ].join('\n');
    
    res.send(csv);
  } else {
    res.json({
      success: true,
      data: exportData
    });
  }
}));

// Get conversation insights
router.get('/insights', requireAuth, asyncHandler(async (req, res) => {
  const { days = 30 } = req.query;
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Most common topics (simple keyword extraction)
  const conversations = await Conversation.find({
    userId: req.user.id,
    createdAt: { $gte: startDate }
  })
  .select('messages.content')
  .lean();

  // Extract common words from messages
  const wordCount = {};
  conversations.forEach(conv => {
    conv.messages.forEach(msg => {
      if (msg.role === 'user') {
        const words = msg.content.toLowerCase()
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
          .filter(word => word.length > 3);
        
        words.forEach(word => {
          wordCount[word] = (wordCount[word] || 0) + 1;
        });
      }
    });
  });

  const commonTopics = Object.entries(wordCount)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10)
    .map(([word, count]) => ({ word, count }));

  // Conversation patterns
  const patterns = await Conversation.aggregate([
    {
      $match: {
        userId: req.user.id,
        createdAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: {
          hour: { $hour: '$createdAt' },
          dayOfWeek: { $dayOfWeek: '$createdAt' }
        },
        count: { $sum: 1 }
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);

  // Average response time trends
  const responseTimeTrends = await Conversation.aggregate([
    {
      $match: {
        userId: req.user.id,
        createdAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
        },
        avgResponseTime: { $avg: '$metadata.averageResponseTime' },
        conversations: { $sum: 1 }
      }
    },
    {
      $sort: { '_id': 1 }
    }
  ]);

  res.json({
    success: true,
    data: {
      period: `${days} days`,
      commonTopics,
      patterns,
      responseTimeTrends
    }
  });
}));

module.exports = router;
