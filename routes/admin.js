const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { logInfo, logWarn } = require('../utils/logger');

// Admin authorization middleware
const requireAdmin = async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }
    next();
  } catch (error) {
    next(error);
  }
};

// Dashboard analytics
router.get('/dashboard', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // User statistics
  const totalUsers = await User.countDocuments();
  const activeUsers = await User.countDocuments({
    'analytics.lastActive': { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
  });
  const newUsersThisMonth = await User.countDocuments({
    createdAt: { $gte: thisMonth }
  });
  const premiumUsers = await User.countDocuments({
    'subscription.plan': { $in: ['basic', 'premium'] },
    'subscription.status': 'active'
  });

  // Conversation statistics
  const totalConversations = await Conversation.countDocuments();
  const conversationsThisMonth = await Conversation.countDocuments({
    createdAt: { $gte: thisMonth }
  });

  // Revenue statistics (if you have payment tracking)
  const revenueThisMonth = await User.aggregate([
    {
      $match: {
        'subscription.lastPaymentDate': { $gte: thisMonth },
        'subscription.status': 'active'
      }
    },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$subscription.lastPaymentAmount' }
      }
    }
  ]);

  // Usage statistics
  const usageStats = await User.aggregate([
    {
      $group: {
        _id: null,
        totalMessages: { $sum: '$usage.totalMessages' },
        totalTokens: { $sum: '$usage.totalTokens' },
        avgMessagesPerUser: { $avg: '$usage.totalMessages' }
      }
    }
  ]);

  // Plan distribution
  const planDistribution = await User.aggregate([
    {
      $group: {
        _id: '$subscription.plan',
        count: { $sum: 1 }
      }
    }
  ]);

  // Recent activity
  const recentUsers = await User.find()
    .sort({ createdAt: -1 })
    .limit(10)
    .select('username email createdAt subscription.plan');

  const recentConversations = await Conversation.find()
    .populate('userId', 'username email')
    .sort({ createdAt: -1 })
    .limit(10)
    .select('title createdAt totalTokens');

  res.json({
    success: true,
    data: {
      users: {
        total: totalUsers,
        active: activeUsers,
        newThisMonth: newUsersThisMonth,
        premium: premiumUsers
      },
      conversations: {
        total: totalConversations,
        thisMonth: conversationsThisMonth
      },
      revenue: {
        thisMonth: revenueThisMonth[0]?.totalRevenue || 0
      },
      usage: usageStats[0] || {
        totalMessages: 0,
        totalTokens: 0,
        avgMessagesPerUser: 0
      },
      planDistribution,
      recentUsers,
      recentConversations
    }
  });
}));

// User management
router.get('/users', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const search = req.query.search || '';
  const plan = req.query.plan || '';
  const status = req.query.status || '';

  const query = {};

  if (search) {
    query.$or = [
      { username: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } }
    ];
  }

  if (plan) {
    query['subscription.plan'] = plan;
  }

  if (status) {
    query['subscription.status'] = status;
  }

  const users = await User.find(query)
    .select('-password -security')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  const total = await User.countDocuments(query);

  res.json({
    success: true,
    data: {
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
}));

// Get specific user
router.get('/users/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id)
    .select('-password -security');

  if (!user) {
    return res.status(404).json({
      success: false,
      error: 'User not found'
    });
  }

  // Get user's conversations
  const conversations = await Conversation.find({ userId: user._id })
    .sort({ createdAt: -1 })
    .limit(20);

  res.json({
    success: true,
    data: {
      user,
      conversations
    }
  });
}));

// Update user
router.put('/users/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { subscription, isActive, isVerified } = req.body;

  const updateData = {};
  if (subscription) updateData.subscription = subscription;
  if (typeof isActive === 'boolean') updateData.isActive = isActive;
  if (typeof isVerified === 'boolean') updateData.isVerified = isVerified;

  const user = await User.findByIdAndUpdate(
    req.params.id,
    updateData,
    { new: true, runValidators: true }
  ).select('-password -security');

  if (!user) {
    return res.status(404).json({
      success: false,
      error: 'User not found'
    });
  }

  logInfo('Admin updated user', {
    adminId: req.user.id,
    userId: user._id,
    updates: updateData
  });

  res.json({
    success: true,
    data: user
  });
}));

// Delete user
router.delete('/users/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return res.status(404).json({
      success: false,
      error: 'User not found'
    });
  }

  // Delete user's conversations
  await Conversation.deleteMany({ userId: user._id });
  
  // Delete user
  await User.findByIdAndDelete(req.params.id);

  logWarn('Admin deleted user', {
    adminId: req.user.id,
    userId: user._id,
    username: user.username
  });

  res.json({
    success: true,
    message: 'User and associated data deleted successfully'
  });
}));

// System health check
router.get('/health', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: 'connected'
  };

  // Check database connection
  try {
    await User.findOne().select('_id');
  } catch (error) {
    health.database = 'disconnected';
    health.status = 'unhealthy';
  }

  // Check OpenAI connection (optional)
  try {
    const OpenAI = require('openai');
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    await openai.models.list();
    health.openai = 'connected';
  } catch (error) {
    health.openai = 'disconnected';
    health.status = 'warning';
  }

  res.json({
    success: true,
    data: health
  });
}));

// System logs
router.get('/logs', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const fs = require('fs').promises;
  const path = require('path');

  try {
    const logPath = path.join(__dirname, '../logs/combined.log');
    const logContent = await fs.readFile(logPath, 'utf8');
    
    // Get last 100 lines
    const lines = logContent.split('\n').filter(line => line.trim());
    const recentLogs = lines.slice(-100);

    res.json({
      success: true,
      data: {
        logs: recentLogs,
        totalLines: lines.length
      }
    });
  } catch (error) {
    res.json({
      success: true,
      data: {
        logs: [],
        totalLines: 0,
        error: 'Log file not found'
      }
    });
  }
}));

// Analytics endpoints
router.get('/analytics/users', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const userStats = await User.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
        },
        count: { $sum: 1 }
      }
    },
    {
      $sort: { _id: 1 }
    }
  ]);

  res.json({
    success: true,
    data: userStats
  });
}));

router.get('/analytics/usage', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const usageStats = await Conversation.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
        },
        conversations: { $sum: 1 },
        totalTokens: { $sum: '$totalTokens' }
      }
    },
    {
      $sort: { _id: 1 }
    }
  ]);

  res.json({
    success: true,
    data: usageStats
  });
}));

module.exports = router;
