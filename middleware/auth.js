const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Middleware to check if user is authenticated
const requireAuth = async (req, res, next) => {
  try {
    const token = req.cookies.token || req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid token or user inactive.' });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token.' });
  }
};

// Middleware to check subscription status
const requireSubscription = (plan = 'free') => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const plans = ['free', 'basic', 'premium'];
    const userPlanIndex = plans.indexOf(req.user.subscription.plan);
    const requiredPlanIndex = plans.indexOf(plan);

    if (userPlanIndex < requiredPlanIndex) {
      return res.status(403).json({ 
        error: `This feature requires a ${plan} subscription or higher.`,
        currentPlan: req.user.subscription.plan,
        requiredPlan: plan
      });
    }

    // Check if subscription is active
    if (req.user.subscription.status !== 'active') {
      return res.status(403).json({ 
        error: 'Your subscription is not active.',
        status: req.user.subscription.status
      });
    }

    next();
  };
};

// Middleware to check message limits
const checkMessageLimit = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    // Reset monthly usage if needed
    req.user.resetMonthlyUsage();

    if (!req.user.canSendMessage()) {
      const limits = {
        free: 20,
        basic: 100,
        premium: 1000
      };
      
      return res.status(429).json({
        error: 'Message limit reached for this month.',
        currentUsage: req.user.usage.messagesThisMonth,
        limit: limits[req.user.subscription.plan],
        plan: req.user.subscription.plan
      });
    }

    next();
  } catch (error) {
    res.status(500).json({ error: 'Error checking message limits.' });
  }
};

// Middleware to update usage after message
const updateUsage = async (req, res, next) => {
  try {
    if (req.user) {
      req.user.usage.messagesThisMonth += 1;
      await req.user.save();
    }
    next();
  } catch (error) {
    console.error('Error updating usage:', error);
    next();
  }
};

module.exports = {
  requireAuth,
  requireSubscription,
  checkMessageLimit,
  updateUsage
};
