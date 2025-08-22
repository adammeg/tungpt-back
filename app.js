require('dotenv').config({ path: './config.env' });
var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const http = require('http');
const socketIo = require('socket.io');

// Import middleware
const { logRequest, logErrorMiddleware } = require('./utils/logger');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { sanitize } = require('./middleware/validation');

// Import routes
var authRouter = require('./routes/auth');
var chatRouter = require('./routes/chat');
var subscriptionRouter = require('./routes/subscription');
var adminRouter = require('./routes/admin');
var uploadRouter = require('./routes/upload');
var historyRouter = require('./routes/history');
var realtimeRouter = require('./routes/realtime');

var app = express();

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO with CORS configuration
const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Store active users and their socket connections
const activeUsers = new Map(); // userId -> socketId
const userSockets = new Map(); // socketId -> userId
const typingUsers = new Map(); // conversationId -> Set of typing userIds

// Socket.IO authentication middleware
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return next(new Error('Authentication error: No token provided'));
    }

    const jwt = require('jsonwebtoken');
    const User = require('./models/User');
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user || !user.isActive) {
      return next(new Error('Authentication error: Invalid token or user inactive'));
    }

    socket.userId = user._id.toString();
    socket.user = user;
    next();
  } catch (error) {
    next(new Error('Authentication error: ' + error.message));
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`🔌 User ${socket.userId} connected: ${socket.id}`);
  
  // Store user connection
  activeUsers.set(socket.userId, socket.id);
  userSockets.set(socket.id, socket.userId);
  
  // Update user's online status
  socket.emit('connected', {
    userId: socket.userId,
    message: 'Successfully connected to chat server'
  });

  // Join user to their personal room
  socket.join(`user:${socket.userId}`);

  // Handle joining conversation room
  socket.on('join-conversation', (conversationId) => {
    socket.join(`conversation:${conversationId}`);
    console.log(`👥 User ${socket.userId} joined conversation: ${conversationId}`);
    
    socket.emit('joined-conversation', {
      conversationId,
      message: 'Joined conversation room'
    });
  });

  // Handle leaving conversation room
  socket.on('leave-conversation', (conversationId) => {
    socket.leave(`conversation:${conversationId}`);
    console.log(`👋 User ${socket.userId} left conversation: ${conversationId}`);
    
    // Remove from typing indicators
    const typingInConversation = typingUsers.get(conversationId);
    if (typingInConversation) {
      typingInConversation.delete(socket.userId);
      if (typingInConversation.size === 0) {
        typingUsers.delete(conversationId);
      }
      socket.to(`conversation:${conversationId}`).emit('typing-stopped', {
        conversationId,
        userId: socket.userId,
        username: socket.user.username
      });
    }
  });

  // Handle typing indicators
  socket.on('typing-start', (data) => {
    const { conversationId } = data;
    
    if (!typingUsers.has(conversationId)) {
      typingUsers.set(conversationId, new Set());
    }
    typingUsers.get(conversationId).add(socket.userId);
    
    socket.to(`conversation:${conversationId}`).emit('typing-start', {
      conversationId,
      userId: socket.userId,
      username: socket.user.username
    });
  });

  socket.on('typing-stop', (data) => {
    const { conversationId } = data;
    
    const typingInConversation = typingUsers.get(conversationId);
    if (typingInConversation) {
      typingInConversation.delete(socket.userId);
      if (typingInConversation.size === 0) {
        typingUsers.delete(conversationId);
      }
      
      socket.to(`conversation:${conversationId}`).emit('typing-stopped', {
        conversationId,
        userId: socket.userId,
        username: socket.user.username
      });
    }
  });

  // Handle real-time message streaming
  socket.on('stream-message', async (data) => {
    const { conversationId, message, model } = data;
    
    try {
      const Conversation = require('./models/Conversation');
      const User = require('./models/User');
      
      // Verify conversation exists and user has access
      const conversation = await Conversation.findOne({
        _id: conversationId,
        userId: socket.userId
      });

      if (!conversation) {
        socket.emit('error', { message: 'Conversation not found or access denied' });
        return;
      }

      // Add user message to conversation
      await conversation.addMessage({
        role: 'user',
        content: message,
        model: model || conversation.model
      });

      // Emit user message to conversation room
      io.to(`conversation:${conversationId}`).emit('message-sent', {
        conversationId,
        message: {
          role: 'user',
          content: message,
          timestamp: new Date(),
          userId: socket.userId,
          username: socket.user.username
        }
      });

      // Start AI response streaming
      await streamAIResponse(socket, conversation, model);

    } catch (error) {
      console.error('Stream message error:', error);
      socket.emit('error', { message: 'Failed to process message' });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`🔌 User ${socket.userId} disconnected: ${socket.id}`);
    
    // Remove from active users
    activeUsers.delete(socket.userId);
    userSockets.delete(socket.id);
    
    // Remove from all typing indicators
    typingUsers.forEach((users, conversationId) => {
      if (users.has(socket.userId)) {
        users.delete(socket.userId);
        if (users.size === 0) {
          typingUsers.delete(conversationId);
        }
        io.to(`conversation:${conversationId}`).emit('typing-stopped', {
          conversationId,
          userId: socket.userId,
          username: socket.user.username
        });
      }
    });
  });
});

// AI Response Streaming Function
async function streamAIResponse(socket, conversation, model) {
  const OpenAI = require('openai');
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  try {
    // Prepare messages for OpenAI
    const messages = conversation.messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // Emit typing indicator for AI
    socket.to(`conversation:${conversation._id}`).emit('ai-typing-start', {
      conversationId: conversation._id,
      message: 'AI is thinking...'
    });

    // Create streaming response
    const stream = await openai.chat.completions.create({
      model: model || conversation.model,
      messages: messages,
      max_tokens: 4000,
      temperature: 0.7,
      stream: true
    });

    let fullResponse = '';
    let tokenCount = 0;

    // Stream the response
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullResponse += content;
        tokenCount++;
        
        // Emit streaming chunk
        socket.emit('ai-stream-chunk', {
          conversationId: conversation._id,
          chunk: content,
          isComplete: false
        });
        
        // Also emit to conversation room for other users
        socket.to(`conversation:${conversation._id}`).emit('ai-stream-chunk', {
          conversationId: conversation._id,
          chunk: content,
          isComplete: false
        });
      }
    }

    // Add AI response to conversation
    await conversation.addMessage({
      role: 'assistant',
      content: fullResponse,
      model: model || conversation.model,
      tokens: tokenCount,
      metadata: {
        processingTime: Date.now() - Date.now() // You can calculate actual time
      }
    });

    // Emit completion
    socket.emit('ai-stream-complete', {
      conversationId: conversation._id,
      message: {
        role: 'assistant',
        content: fullResponse,
        timestamp: new Date(),
        tokens: tokenCount
      }
    });

    // Emit to conversation room
    socket.to(`conversation:${conversation._id}`).emit('ai-stream-complete', {
      conversationId: conversation._id,
      message: {
        role: 'assistant',
        content: fullResponse,
        timestamp: new Date(),
        tokens: tokenCount
      }
    });

    // Stop AI typing indicator
    socket.to(`conversation:${conversation._id}`).emit('ai-typing-stop', {
      conversationId: conversation._id
    });

    // Update user usage
    const User = require('./models/User');
    const user = await User.findById(socket.userId);
    if (user) {
      user.incrementUsage(1, tokenCount);
      await user.save();
    }

  } catch (error) {
    console.error('AI streaming error:', error);
    
    // Emit error
    socket.emit('ai-stream-error', {
      conversationId: conversation._id,
      error: 'Failed to generate AI response'
    });
    
    // Stop AI typing indicator
    socket.to(`conversation:${conversation._id}`).emit('ai-typing-stop', {
      conversationId: conversation._id
    });
  }
}

// Make io available to routes
app.set('io', io);
app.set('activeUsers', activeUsers);
app.set('typingUsers', typingUsers);

// Connect to MongoDB with enhanced options
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatgpt-clone', {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  bufferCommands: false
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// Enhanced security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for API server
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Compression middleware
app.use(compression());

// Enhanced rate limiting - more lenient for development
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 100 : 1000, // More lenient in development
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: Math.ceil(15 * 60 / 60) // minutes
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks and static files
    return req.path === '/health' || req.path.startsWith('/api/upload/files/');
  }
});

// Specific rate limits for different endpoints - more lenient for development
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 5 : 50, // Much more lenient in development
  message: {
    success: false,
    error: 'Too many authentication attempts, please try again later.'
  }
});

const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: process.env.NODE_ENV === 'production' ? 10 : 100, // More lenient in development
  message: {
    success: false,
    error: 'Too many chat requests, please slow down.'
  }
});

app.use('/api/', limiter);
app.use('/api/auth', authLimiter);
app.use('/api/chat', chatLimiter);

// CORS configuration for frontend
const allowedOrigins = [
  'http://localhost:3000',
  'https://tungpt-front.vercel.app',
  process.env.FRONTEND_URL
].filter(Boolean); // Remove any undefined values

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-Total-Count', 'X-Page-Count']
}));

// Session configuration with enhanced security
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/chatgpt-clone',
    ttl: 24 * 60 * 60, // 1 day
    autoRemove: 'native',
    touchAfter: 24 * 3600 // 24 hours
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 1 day
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax'
  },
  name: 'sessionId' // Change default session name
}));

// Enhanced logging
app.use(logger('combined', { stream: require('./utils/logger').logger.stream }));

// Request logging middleware
app.use(logRequest);

// Body parsing middleware with increased limits
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf; // Store raw body for webhook verification
  }
}));
app.use(express.urlencoded({ 
  extended: false,
  limit: '10mb'
}));

// Cookie parser
app.use(cookieParser());

// Input sanitization middleware
app.use(sanitize);

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/chat', chatRouter);
app.use('/api/subscription', subscriptionRouter);
app.use('/api/admin', adminRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/history', historyRouter);
app.use('/api/realtime', realtimeRouter);

// Health check endpoint with detailed information
app.get('/health', (req, res) => {
  const health = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0',
    memory: process.memoryUsage(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  };

  const statusCode = health.database === 'connected' ? 200 : 503;
  
  res.status(statusCode).json(health);
});

// Development helper endpoint to reset rate limiting
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/reset-rate-limit', (req, res) => {
    // This will help clear rate limiting in development
    res.json({ 
      message: 'Rate limit reset endpoint available in development',
      note: 'Rate limits are more lenient in development mode'
    });
  });
}

// API documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    message: 'ChatGPT Clone API',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    endpoints: {
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        logout: 'POST /api/auth/logout',
        profile: 'GET /api/auth/profile',
        updateProfile: 'PUT /api/auth/profile',
        changePassword: 'PUT /api/auth/change-password'
      },
      chat: {
        conversations: 'GET /api/chat/conversations',
        createConversation: 'POST /api/chat/conversations',
        getConversation: 'GET /api/chat/conversations/:id',
        sendMessage: 'POST /api/chat/conversations/:id/messages',
        updateTitle: 'PUT /api/chat/conversations/:id/title',
        deleteConversation: 'DELETE /api/chat/conversations/:id',
        models: 'GET /api/chat/models',
        analytics: 'GET /api/chat/analytics',
        archive: 'POST /api/chat/conversations/:id/archive',
        restore: 'POST /api/chat/conversations/:id/restore',
        clear: 'POST /api/chat/conversations/:id/clear',
        export: 'GET /api/chat/conversations/:id/export',
        bulk: 'POST /api/chat/conversations/bulk'
      },
      history: {
        list: 'GET /api/history',
        search: 'GET /api/history/search',
        stats: 'GET /api/history/stats',
        tags: 'GET /api/history/tags',
        tagConversations: 'GET /api/history/tags/:tag',
        addTags: 'POST /api/history/conversations/:id/tags',
        removeTag: 'DELETE /api/history/conversations/:id/tags/:tag',
        export: 'GET /api/history/export',
        insights: 'GET /api/history/insights'
      },
      realtime: {
        status: 'GET /api/realtime/status',
        activeUsers: 'GET /api/realtime/conversations/:id/active-users',
        typingUsers: 'GET /api/realtime/conversations/:id/typing',
        notify: 'POST /api/realtime/notify/:userId',
        broadcast: 'POST /api/realtime/broadcast',
        stats: 'GET /api/realtime/stats',
        disconnect: 'POST /api/realtime/disconnect/:userId'
      },
      subscription: {
        plans: 'GET /api/subscription/plans',
        createCheckout: 'POST /api/subscription/create-checkout-session',
        webhook: 'POST /api/subscription/webhook',
        paymentStatus: 'GET /api/subscription/payment-status/:orderId',
        cancel: 'POST /api/subscription/cancel',
        reactivate: 'POST /api/subscription/reactivate',
        status: 'GET /api/subscription/status'
      },
      upload: {
        single: 'POST /api/upload/single',
        multiple: 'POST /api/upload/multiple',
        files: 'GET /api/upload/files',
        serveFile: 'GET /api/upload/files/:filename',
        deleteFile: 'DELETE /api/upload/files/:filename'
      },
      admin: {
        dashboard: 'GET /api/admin/dashboard',
        users: 'GET /api/admin/users',
        userDetails: 'GET /api/admin/users/:id',
        updateUser: 'PUT /api/admin/users/:id',
        deleteUser: 'DELETE /api/admin/users/:id',
        systemHealth: 'GET /api/admin/health',
        logs: 'GET /api/admin/logs',
        analytics: {
          users: 'GET /api/admin/analytics/users',
          usage: 'GET /api/admin/analytics/usage'
        }
      }
    },
    documentation: 'https://github.com/your-repo/chatgpt-clone-backend',
    support: 'support@yourdomain.com'
  });
});

// Test OpenAI route (keeping the original test route)
app.get('/test-openai', async (req, res) => {
  try {
    const OpenAI = require('openai');
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      input: "write a haiku about ai",
      store: true,
    });
    
    console.log(response.output_text);
    res.json({ 
      success: true, 
      output: response.output_text,
      message: 'OpenAI test completed successfully'
    });
  } catch (error) {
    console.error('OpenAI test error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 404 handler
app.use(notFound);

// Error logging middleware
app.use(logErrorMiddleware);

// Error handler
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    mongoose.connection.close();
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    mongoose.connection.close();
  });
});

module.exports = { app, server };
