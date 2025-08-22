const express = require('express');
const router = express.Router();
const Conversation = require('../models/Conversation');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { logInfo, logWarn } = require('../utils/logger');

// Get real-time server status
router.get('/status', requireAuth, asyncHandler(async (req, res) => {
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
      })),
      serverInfo: {
        socketConnections: io.engine.clientsCount,
        uptime: process.uptime(),
        memory: process.memoryUsage()
      }
    }
  });
}));

// Get active users in a conversation
router.get('/conversations/:id/active-users', requireAuth, asyncHandler(async (req, res) => {
  const activeUsers = req.app.get('activeUsers');
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

  // Get users who are currently in this conversation room
  const io = req.app.get('io');
  const room = io.sockets.adapter.rooms.get(`conversation:${conversationId}`);
  
  const activeUserIds = room ? Array.from(room) : [];
  const activeUserDetails = [];

  for (const socketId of activeUserIds) {
    const userId = req.app.get('userSockets').get(socketId);
    if (userId && userId !== req.user.id) {
      activeUserDetails.push({
        userId,
        socketId,
        isTyping: false // You can enhance this to check typing status
      });
    }
  }

  res.json({
    success: true,
    data: {
      conversationId,
      activeUsers: activeUserDetails,
      count: activeUserDetails.length
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

// Send notification to user
router.post('/notify/:userId', requireAuth, asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { message, type = 'info', data = {} } = req.body;

  const io = req.app.get('io');
  const activeUsers = req.app.get('activeUsers');

  // Check if target user is online
  const targetSocketId = activeUsers.get(userId);
  
  if (!targetSocketId) {
    return res.status(404).json({
      success: false,
      error: 'User is not online'
    });
  }

  // Send notification to specific user
  io.to(targetSocketId).emit('notification', {
    type,
    message,
    data,
    timestamp: new Date(),
    from: req.user.id
  });

  logInfo('Notification sent', {
    from: req.user.id,
    to: userId,
    type,
    message
  });

  res.json({
    success: true,
    data: {
      sent: true,
      recipient: userId,
      message
    }
  });
}));

// Broadcast message to all connected users
router.post('/broadcast', requireAuth, asyncHandler(async (req, res) => {
  const { message, type = 'info', data = {} } = req.body;

  // Only allow admin users to broadcast
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Admin access required for broadcasting'
    });
  }

  const io = req.app.get('io');

  // Broadcast to all connected users
  io.emit('broadcast', {
    type,
    message,
    data,
    timestamp: new Date(),
    from: req.user.id
  });

  logInfo('Broadcast sent', {
    from: req.user.id,
    type,
    message
  });

  res.json({
    success: true,
    data: {
      sent: true,
      message: 'Broadcast sent to all connected users'
    }
  });
}));

// Get server statistics
router.get('/stats', requireAuth, asyncHandler(async (req, res) => {
  // Only allow admin users to view stats
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Admin access required'
    });
  }

  const io = req.app.get('io');
  const activeUsers = req.app.get('activeUsers');
  const typingUsers = req.app.get('typingUsers');

  const stats = {
    connections: {
      total: io.engine.clientsCount,
      activeUsers: activeUsers.size
    },
    conversations: {
      active: typingUsers.size,
      totalTypingUsers: Array.from(typingUsers.values()).reduce((sum, users) => sum + users.size, 0)
    },
    server: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage()
    }
  };

  res.json({
    success: true,
    data: stats
  });
}));

// Force disconnect a user (admin only)
router.post('/disconnect/:userId', requireAuth, asyncHandler(async (req, res) => {
  // Only allow admin users to disconnect others
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Admin access required'
    });
  }

  const { userId } = req.params;
  const activeUsers = req.app.get('activeUsers');
  const io = req.app.get('io');

  const socketId = activeUsers.get(userId);
  
  if (!socketId) {
    return res.status(404).json({
      success: false,
      error: 'User is not connected'
    });
  }

  // Force disconnect the user
  io.sockets.sockets.get(socketId)?.disconnect(true);

  logWarn('User force disconnected', {
    adminId: req.user.id,
    targetUserId: userId,
    socketId
  });

  res.json({
    success: true,
    data: {
      disconnected: true,
      userId,
      socketId
    }
  });
}));

module.exports = router;
