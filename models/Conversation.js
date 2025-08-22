const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant', 'system'],
    required: true
  },
  content: {
    type: String,
    required: true,
    maxlength: 10000 // Increased limit for longer conversations
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  tokens: {
    type: Number,
    default: 0
  },
  model: {
    type: String,
    enum: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
    default: 'gpt-4o-mini'
  },
  // For file attachments
  attachments: [{
    filename: String,
    url: String,
    mimetype: String,
    size: Number
  }],
  // For message metadata
  metadata: {
    processingTime: Number, // Time taken to generate response
    error: String, // If there was an error
    retryCount: {
      type: Number,
      default: 0
    }
  },
  // For message threading and context
  parentMessageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  threadId: {
    type: String,
    index: true
  }
}, {
  timestamps: true
});

const conversationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: {
    type: String,
    maxlength: 200,
    default: 'New Conversation'
  },
  messages: [messageSchema],
  model: {
    type: String,
    enum: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
    default: 'gpt-4o-mini'
  },
  totalTokens: {
    type: Number,
    default: 0
  },
  totalMessages: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  // Conversation metadata
  metadata: {
    lastActivity: {
      type: Date,
      default: Date.now
    },
    messageCount: {
      type: Number,
      default: 0
    },
    averageResponseTime: {
      type: Number,
      default: 0
    },
    favoriteTopics: [{
      type: String,
      trim: true
    }],
    tags: [{
      type: String,
      trim: true
    }]
  },
  // Privacy and sharing settings
  isPublic: {
    type: Boolean,
    default: false
  },
  isArchived: {
    type: Boolean,
    default: false,
    index: true
  },
  // Conversation settings
  settings: {
    autoSave: {
      type: Boolean,
      default: true
    },
    maxMessages: {
      type: Number,
      default: 100
    },
    maxTokens: {
      type: Number,
      default: 4000
    }
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
conversationSchema.index({ userId: 1, createdAt: -1 });
conversationSchema.index({ userId: 1, 'metadata.lastActivity': -1 });
conversationSchema.index({ userId: 1, isArchived: 1 });
conversationSchema.index({ title: 'text' }); // Text search on title
conversationSchema.index({ 'messages.content': 'text' }); // Text search on messages

// Virtual for conversation duration
conversationSchema.virtual('duration').get(function() {
  if (this.messages.length < 2) return 0;
  const firstMessage = this.messages[0].timestamp;
  const lastMessage = this.messages[this.messages.length - 1].timestamp;
  return lastMessage - firstMessage;
});

// Virtual for conversation summary
conversationSchema.virtual('summary').get(function() {
  if (this.messages.length === 0) return 'Empty conversation';
  
  const userMessages = this.messages.filter(msg => msg.role === 'user');
  if (userMessages.length === 0) return 'No user messages';
  
  // Return first user message as summary
  return userMessages[0].content.substring(0, 100) + (userMessages[0].content.length > 100 ? '...' : '');
});

// Update conversation title based on first user message
conversationSchema.methods.updateTitle = function() {
  const userMessages = this.messages.filter(msg => msg.role === 'user');
  if (userMessages.length > 0) {
    const firstMessage = userMessages[0].content;
    this.title = firstMessage.substring(0, 50) + (firstMessage.length > 50 ? '...' : '');
  }
  return this.save();
};

// Add message to conversation
conversationSchema.methods.addMessage = function(messageData) {
  const message = {
    role: messageData.role,
    content: messageData.content,
    timestamp: new Date(),
    tokens: messageData.tokens || 0,
    model: messageData.model || this.model,
    attachments: messageData.attachments || [],
    metadata: messageData.metadata || {},
    parentMessageId: messageData.parentMessageId,
    threadId: messageData.threadId
  };

  this.messages.push(message);
  this.totalTokens += message.tokens || 0;
  this.totalMessages += 1;
  this.metadata.lastActivity = new Date();
  this.metadata.messageCount = this.messages.length;

  // Update average response time
  if (message.role === 'assistant' && message.metadata.processingTime) {
    const assistantMessages = this.messages.filter(msg => msg.role === 'assistant');
    const totalTime = assistantMessages.reduce((sum, msg) => sum + (msg.metadata.processingTime || 0), 0);
    this.metadata.averageResponseTime = totalTime / assistantMessages.length;
  }

  // Auto-update title if it's still default
  if (this.title === 'New Conversation' && message.role === 'user') {
    this.title = message.content.substring(0, 50) + (message.content.length > 50 ? '...' : '');
  }

  return this.save();
};

// Get conversation statistics
conversationSchema.methods.getStats = function() {
  const userMessages = this.messages.filter(msg => msg.role === 'user');
  const assistantMessages = this.messages.filter(msg => msg.role === 'assistant');
  
  return {
    totalMessages: this.messages.length,
    userMessages: userMessages.length,
    assistantMessages: assistantMessages.length,
    totalTokens: this.totalTokens,
    averageTokensPerMessage: this.messages.length > 0 ? this.totalTokens / this.messages.length : 0,
    duration: this.duration,
    averageResponseTime: this.metadata.averageResponseTime
  };
};

// Archive conversation
conversationSchema.methods.archive = function() {
  this.isArchived = true;
  this.isActive = false;
  return this.save();
};

// Restore conversation
conversationSchema.methods.restore = function() {
  this.isArchived = false;
  this.isActive = true;
  return this.save();
};

// Clear conversation messages
conversationSchema.methods.clearMessages = function() {
  this.messages = [];
  this.totalTokens = 0;
  this.totalMessages = 0;
  this.metadata.messageCount = 0;
  this.metadata.averageResponseTime = 0;
  return this.save();
};

// Export conversation
conversationSchema.methods.export = function() {
  return {
    id: this._id,
    title: this.title,
    model: this.model,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
    stats: this.getStats(),
    messages: this.messages.map(msg => ({
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
      model: msg.model,
      attachments: msg.attachments
    }))
  };
};

// Static method to find user conversations with pagination
conversationSchema.statics.findUserConversations = function(userId, options = {}) {
  const {
    page = 1,
    limit = 20,
    sort = { 'metadata.lastActivity': -1 },
    filter = {}
  } = options;

  const query = { userId, ...filter };
  
  return this.find(query)
    .sort(sort)
    .skip((page - 1) * limit)
    .limit(limit)
    .select('title model totalTokens totalMessages metadata.lastActivity createdAt isArchived')
    .lean();
};

// Static method to search conversations
conversationSchema.statics.searchConversations = function(userId, searchTerm, options = {}) {
  const {
    page = 1,
    limit = 20,
    sort = { 'metadata.lastActivity': -1 }
  } = options;

  const query = {
    userId,
    $or: [
      { title: { $regex: searchTerm, $options: 'i' } },
      { 'messages.content': { $regex: searchTerm, $options: 'i' } }
    ]
  };

  return this.find(query)
    .sort(sort)
    .skip((page - 1) * limit)
    .limit(limit)
    .select('title model totalTokens totalMessages metadata.lastActivity createdAt')
    .lean();
};

// Static method to get conversation analytics
conversationSchema.statics.getUserAnalytics = function(userId, days = 30) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  return this.aggregate([
    {
      $match: {
        userId: mongoose.Types.ObjectId(userId),
        createdAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: null,
        totalConversations: { $sum: 1 },
        totalMessages: { $sum: '$totalMessages' },
        totalTokens: { $sum: '$totalTokens' },
        averageMessagesPerConversation: { $avg: '$totalMessages' },
        averageTokensPerConversation: { $avg: '$totalTokens' }
      }
    }
  ]);
};

module.exports = mongoose.model('Conversation', conversationSchema);
