const express = require('express');
const router = express.Router();
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const { requireAuth, checkMessageLimit, updateUsage } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { validate, schemas } = require('../middleware/validation');
const { logInfo, logWarn } = require('../utils/logger');
const OpenAI = require('openai');

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Get user conversations with pagination and filtering
router.get('/conversations', requireAuth, asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const sort = req.query.sort || 'lastActivity'; // lastActivity, createdAt, title
  const filter = req.query.filter || 'all'; // all, active, archived
  const search = req.query.search || '';

  let sortOption = { 'metadata.lastActivity': -1 };
  if (sort === 'createdAt') sortOption = { createdAt: -1 };
  if (sort === 'title') sortOption = { title: 1 };

  let filterOption = {};
  if (filter === 'active') filterOption = { isArchived: false };
  if (filter === 'archived') filterOption = { isArchived: true };

  let conversations;
  let total;

  if (search) {
    // Search conversations
    conversations = await Conversation.searchConversations(req.user.id, search, {
      page,
      limit,
      sort: sortOption
    });
    
    // Get total count for search results
    const searchQuery = {
      userId: req.user.id,
      ...filterOption,
      $or: [
        { title: { $regex: search, $options: 'i' } },
        { 'messages.content': { $regex: search, $options: 'i' } }
      ]
    };
    total = await Conversation.countDocuments(searchQuery);
  } else {
    // Get regular conversations
    conversations = await Conversation.findUserConversations(req.user.id, {
      page,
      limit,
      sort: sortOption,
      filter: filterOption
    });
    
    // Get total count
    const query = { userId: req.user.id, ...filterOption };
    total = await Conversation.countDocuments(query);
  }

  res.json({
    success: true,
    data: {
      conversations,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    }
  });
}));

// Get conversation analytics
router.get('/analytics', requireAuth, asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  
  const [conversationStats, userStats] = await Promise.all([
    Conversation.getUserAnalytics(req.user.id, days),
    User.findById(req.user.id).select('usage')
  ]);

  const stats = conversationStats[0] || {
    totalConversations: 0,
    totalMessages: 0,
    totalTokens: 0,
    averageMessagesPerConversation: 0,
    averageTokensPerConversation: 0
  };

  // Get recent activity
  const recentConversations = await Conversation.find({ userId: req.user.id })
    .sort({ 'metadata.lastActivity': -1 })
    .limit(5)
    .select('title metadata.lastActivity totalMessages');

  // Get conversation count by model
  const modelStats = await Conversation.aggregate([
    {
      $match: {
        userId: req.user.id,
        createdAt: { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) }
      }
    },
    {
      $group: {
        _id: '$model',
        count: { $sum: 1 },
        totalTokens: { $sum: '$totalTokens' }
      }
    }
  ]);

  res.json({
    success: true,
    data: {
      period: `${days} days`,
      conversations: stats,
      usage: userStats.usage,
      recentActivity: recentConversations,
      modelUsage: modelStats
    }
  });
}));

// Create new conversation
router.post('/conversations', requireAuth, validate(schemas.createConversation), asyncHandler(async (req, res) => {
  const { title, model } = req.body;

  console.log('🔍 Creating conversation with:', { title, model, userId: req.user.id });

  const conversation = new Conversation({
    userId: req.user.id,
    title: title || 'New Conversation',
    model: model || 'gpt-4o-mini'
  });

  await conversation.save();

  console.log('✅ Conversation saved:', {
    _id: conversation._id,
    title: conversation.title,
    model: conversation.model
  });

  logInfo('New conversation created', {
    userId: req.user.id,
    conversationId: conversation._id,
    model: conversation.model
  });

  const responseData = {
    success: true,
    data: {
      conversation: {
        _id: conversation._id,
        title: conversation.title,
        model: conversation.model,
        messages: conversation.messages || [],
        totalTokens: conversation.totalTokens || 0,
        totalMessages: conversation.totalMessages || 0,
        metadata: conversation.metadata || {},
        settings: conversation.settings || {},
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt
      }
    }
  };

  console.log('📤 Sending response:', JSON.stringify(responseData, null, 2));

  res.status(201).json(responseData);
}));

// Get specific conversation with messages
router.get('/conversations/:id', requireAuth, asyncHandler(async (req, res) => {
  const conversation = await Conversation.findOne({
    _id: req.params.id,
    userId: req.user.id
  });

  if (!conversation) {
    return res.status(404).json({
      success: false,
      error: 'Conversation not found'
    });
  }

  // Update last activity
  conversation.metadata.lastActivity = new Date();
  await conversation.save();

  res.json({
    success: true,
    data: {
      conversation: {
        _id: conversation._id,
        title: conversation.title,
        model: conversation.model,
        messages: conversation.messages,
        totalTokens: conversation.totalTokens,
        totalMessages: conversation.totalMessages,
        metadata: conversation.metadata,
        settings: conversation.settings,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        stats: conversation.getStats()
      }
    }
  });
}));

// Send message to conversation (updated for real-time integration)
router.post('/conversations/:id/messages', requireAuth, checkMessageLimit, validate(schemas.sendMessage), asyncHandler(async (req, res) => {
  const { message, model, attachments } = req.body;
  
  const conversation = await Conversation.findOne({
    _id: req.params.id,
    userId: req.user.id
  });

  if (!conversation) {
    return res.status(404).json({
      success: false,
      error: 'Conversation not found'
    });
  }

  const startTime = Date.now();

  try {
    // Add user message
    await conversation.addMessage({
      role: 'user',
      content: message,
      model: model || conversation.model,
      attachments: attachments || []
    });

    // Get Socket.IO instance
    const io = req.app.get('io');
    const activeUsers = req.app.get('activeUsers');

    // Emit real-time message to conversation room
    io.to(`conversation:${conversation._id}`).emit('message-sent', {
      conversationId: conversation._id,
      message: {
        role: 'user',
        content: message,
        timestamp: new Date(),
        userId: req.user.id,
        username: req.user.username
      }
    });

    // Prepare messages for OpenAI
    const messages = conversation.messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // Emit AI typing indicator
    io.to(`conversation:${conversation._id}`).emit('ai-typing-start', {
      conversationId: conversation._id,
      message: 'AI is thinking...'
    });

    // Call OpenAI API with streaming
    const OpenAI = require('openai');
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const completion = await openai.chat.completions.create({
      model: model || conversation.model,
      messages: messages,
      max_tokens: 4000,
      temperature: 0.7,
      stream: true
    });

    let fullResponse = '';
    let tokenCount = 0;

    // Stream the response
    for await (const chunk of completion) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullResponse += content;
        tokenCount++;
        
        // Emit streaming chunk
        io.to(`conversation:${conversation._id}`).emit('ai-stream-chunk', {
          conversationId: conversation._id,
          chunk: content,
          isComplete: false
        });
      }
    }

    // Add assistant message
    await conversation.addMessage({
      role: 'assistant',
      content: fullResponse,
      model: model || conversation.model,
      tokens: tokenCount,
      metadata: {
        processingTime: Date.now() - startTime
      }
    });

    // Update user usage
    await updateUsage(req, res, () => {});

    // Emit completion
    io.to(`conversation:${conversation._id}`).emit('ai-stream-complete', {
      conversationId: conversation._id,
      message: {
        role: 'assistant',
        content: fullResponse,
        timestamp: new Date(),
        tokens: tokenCount
      }
    });

    // Stop AI typing indicator
    io.to(`conversation:${conversation._id}`).emit('ai-typing-stop', {
      conversationId: conversation._id
    });

    logInfo('Message sent successfully', {
      userId: req.user.id,
      conversationId: conversation._id,
      model: model || conversation.model,
      tokens: tokenCount,
      processingTime: Date.now() - startTime
    });

    res.json({
      success: true,
      data: {
        message: {
          role: 'assistant',
          content: fullResponse,
          timestamp: new Date(),
          tokens: tokenCount,
          model: model || conversation.model,
          metadata: {
            processingTime: Date.now() - startTime
          }
        },
        conversation: {
          id: conversation._id,
          title: conversation.title,
          totalTokens: conversation.totalTokens,
          totalMessages: conversation.totalMessages
        }
      }
    });

  } catch (error) {
    logWarn('OpenAI API error', {
      userId: req.user.id,
      conversationId: conversation._id,
      error: error.message
    });

    // Emit error via Socket.IO
    const io = req.app.get('io');
    io.to(`conversation:${conversation._id}`).emit('ai-stream-error', {
      conversationId: conversation._id,
      error: 'Failed to generate response'
    });

    // Stop AI typing indicator
    io.to(`conversation:${conversation._id}`).emit('ai-typing-stop', {
      conversationId: conversation._id
    });

    // Add error message to conversation
    await conversation.addMessage({
      role: 'assistant',
      content: 'Sorry, I encountered an error while processing your request. Please try again.',
      metadata: {
        error: error.message,
        processingTime: Date.now() - startTime
      }
    });

    res.status(500).json({
      success: false,
      error: 'Failed to generate response',
      details: error.message
    });
  }
}));

// Update conversation title
router.put('/conversations/:id/title', requireAuth, validate(schemas.updateConversationTitle), asyncHandler(async (req, res) => {
  const { title } = req.body;

  const conversation = await Conversation.findOneAndUpdate(
    {
      _id: req.params.id,
      userId: req.user.id
    },
    { title: title },
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
        title: conversation.title
      }
    }
  });
}));

// Archive conversation
router.post('/conversations/:id/archive', requireAuth, asyncHandler(async (req, res) => {
  const conversation = await Conversation.findOne({
    _id: req.params.id,
    userId: req.user.id
  });

  if (!conversation) {
    return res.status(404).json({
      success: false,
      error: 'Conversation not found'
    });
  }

  await conversation.archive();

  res.json({
    success: true,
    message: 'Conversation archived successfully'
  });
}));

// Restore conversation
router.post('/conversations/:id/restore', requireAuth, asyncHandler(async (req, res) => {
  const conversation = await Conversation.findOne({
    _id: req.params.id,
    userId: req.user.id
  });

  if (!conversation) {
    return res.status(404).json({
      success: false,
      error: 'Conversation not found'
    });
  }

  await conversation.restore();

  res.json({
    success: true,
    message: 'Conversation restored successfully'
  });
}));

// Clear conversation messages
router.post('/conversations/:id/clear', requireAuth, asyncHandler(async (req, res) => {
  const conversation = await Conversation.findOne({
    _id: req.params.id,
    userId: req.user.id
  });

  if (!conversation) {
    return res.status(404).json({
      success: false,
      error: 'Conversation not found'
    });
  }

  await conversation.clearMessages();

  res.json({
    success: true,
    message: 'Conversation messages cleared successfully'
  });
}));

// Export conversation
router.get('/conversations/:id/export', requireAuth, asyncHandler(async (req, res) => {
  const conversation = await Conversation.findOne({
    _id: req.params.id,
    userId: req.user.id
  });

  if (!conversation) {
    return res.status(404).json({
      success: false,
      error: 'Conversation not found'
    });
  }

  const exportData = conversation.export();

  res.json({
    success: true,
    data: exportData
  });
}));

// Delete conversation
router.delete('/conversations/:id', requireAuth, asyncHandler(async (req, res) => {
  const conversation = await Conversation.findOneAndDelete({
    _id: req.params.id,
    userId: req.user.id
  });

  if (!conversation) {
    return res.status(404).json({
      success: false,
      error: 'Conversation not found'
    });
  }

  logInfo('Conversation deleted', {
    userId: req.user.id,
    conversationId: conversation._id,
    title: conversation.title
  });

  res.json({
    success: true,
    message: 'Conversation deleted successfully'
  });
}));

// Bulk operations
router.post('/conversations/bulk', requireAuth, asyncHandler(async (req, res) => {
  const { action, conversationIds } = req.body;

  if (!conversationIds || !Array.isArray(conversationIds) || conversationIds.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid conversation IDs'
    });
  }

  let result;
  let message;

  switch (action) {
    case 'archive':
      result = await Conversation.updateMany(
        { _id: { $in: conversationIds }, userId: req.user.id },
        { isArchived: true, isActive: false }
      );
      message = 'Conversations archived successfully';
      break;

    case 'restore':
      result = await Conversation.updateMany(
        { _id: { $in: conversationIds }, userId: req.user.id },
        { isArchived: false, isActive: true }
      );
      message = 'Conversations restored successfully';
      break;

    case 'delete':
      result = await Conversation.deleteMany({
        _id: { $in: conversationIds },
        userId: req.user.id
      });
      message = 'Conversations deleted successfully';
      break;

    default:
      return res.status(400).json({
        success: false,
        error: 'Invalid action'
      });
  }

  res.json({
    success: true,
    message: message,
    data: {
      modifiedCount: result.modifiedCount || result.deletedCount
    }
  });
}));

// Get available AI models
router.get('/models', requireAuth, asyncHandler(async (req, res) => {
  const models = [
    {
      id: 'gpt-4o-mini',
      name: 'GPT-4o Mini',
      description: 'Fast and efficient model for most tasks',
      maxTokens: 16384,
      pricing: {
        input: 0.00015,
        output: 0.0006
      }
    },
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      description: 'Most capable model for complex tasks',
      maxTokens: 128000,
      pricing: {
        input: 0.005,
        output: 0.015
      }
    },
    {
      id: 'gpt-3.5-turbo',
      name: 'GPT-3.5 Turbo',
      description: 'Good balance of speed and capability',
      maxTokens: 16384,
      pricing: {
        input: 0.0005,
        output: 0.0015
      }
    }
  ];

  res.json({
    success: true,
    data: {
      models
    }
  });
}));

// Get real-time connection status
router.get('/realtime/status', requireAuth, asyncHandler(async (req, res) => {
  const io = req.app.get('io');
  const activeUsers = req.app.get('activeUsers');
  const typingUsers = req.app.get('typingUsers');

  const isConnected = activeUsers.has(req.user.id);
  const userConversations = await Conversation.find({ userId: req.user.id }).select('_id title');

  res.json({
    success: true,
    data: {
      isConnected,
      activeUsers: activeUsers.size,
      userConversations: userConversations.map(conv => ({
        id: conv._id,
        title: conv.title,
        hasTypingUsers: typingUsers.has(conv._id.toString())
      }))
    }
  });
}));

// Get typing users for a conversation
router.get('/conversations/:id/typing', requireAuth, asyncHandler(async (req, res) => {
  const typingUsers = req.app.get('typingUsers');
  const conversationId = req.params.id;

  // Verify conversation access
  const conversation = await Conversation.findOne({
    _id: conversationId,
    userId: req.user.id
  });

  if (!conversation) {
    return res.status(404).json({
      success: false,
      error: 'Conversation not found'
    });
  }

  const typingInConversation = typingUsers.get(conversationId) || new Set();
  const typingUsersList = Array.from(typingInConversation);

  res.json({
    success: true,
    data: {
      conversationId,
      typingUsers: typingUsersList,
      count: typingUsersList.length
    }
  });
}));

module.exports = router;
