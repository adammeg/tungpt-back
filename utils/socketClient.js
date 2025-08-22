/**
 * Socket.IO Client Utility for Real-time Chat
 * This file provides a comprehensive client-side implementation for real-time chat features
 */

class SocketClient {
  constructor(serverUrl, token) {
    this.serverUrl = serverUrl;
    this.token = token;
    this.socket = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.eventHandlers = new Map();
    this.typingTimeouts = new Map();
    
    this.init();
  }

  init() {
    try {
      this.socket = io(this.serverUrl, {
        auth: {
          token: this.token
        },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: this.reconnectDelay,
        timeout: 20000
      });

      this.setupEventListeners();
    } catch (error) {
      console.error('Socket initialization error:', error);
    }
  }

  setupEventListeners() {
    // Connection events
    this.socket.on('connect', () => {
      console.log('🔌 Connected to chat server');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.emit('connected');
    });

    this.socket.on('disconnect', (reason) => {
      console.log('🔌 Disconnected from chat server:', reason);
      this.isConnected = false;
      this.emit('disconnected', { reason });
    });

    this.socket.on('connect_error', (error) => {
      console.error('🔌 Connection error:', error);
      this.reconnectAttempts++;
      this.emit('connection_error', { error, attempts: this.reconnectAttempts });
    });

    // Chat events
    this.socket.on('joined-conversation', (data) => {
      console.log('👥 Joined conversation:', data.conversationId);
      this.emit('joined-conversation', data);
    });

    this.socket.on('message-sent', (data) => {
      console.log('💬 Message sent:', data);
      this.emit('message-sent', data);
    });

    this.socket.on('ai-typing-start', (data) => {
      console.log('🤖 AI is typing...');
      this.emit('ai-typing-start', data);
    });

    this.socket.on('ai-stream-chunk', (data) => {
      this.emit('ai-stream-chunk', data);
    });

    this.socket.on('ai-stream-complete', (data) => {
      console.log('✅ AI response complete');
      this.emit('ai-stream-complete', data);
    });

    this.socket.on('ai-typing-stop', (data) => {
      console.log('🤖 AI stopped typing');
      this.emit('ai-typing-stop', data);
    });

    this.socket.on('ai-stream-error', (data) => {
      console.error('❌ AI streaming error:', data);
      this.emit('ai-stream-error', data);
    });

    // Typing indicators
    this.socket.on('typing-start', (data) => {
      console.log('⌨️ User typing:', data.username);
      this.emit('typing-start', data);
    });

    this.socket.on('typing-stopped', (data) => {
      console.log('⌨️ User stopped typing:', data.username);
      this.emit('typing-stopped', data);
    });

    // Notifications
    this.socket.on('notification', (data) => {
      console.log('🔔 Notification received:', data);
      this.emit('notification', data);
    });

    this.socket.on('broadcast', (data) => {
      console.log('📢 Broadcast received:', data);
      this.emit('broadcast', data);
    });

    // Error handling
    this.socket.on('error', (error) => {
      console.error('❌ Socket error:', error);
      this.emit('error', error);
    });
  }

  // Event handling
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  off(event, handler) {
    if (this.eventHandlers.has(event)) {
      const handlers = this.eventHandlers.get(event);
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  emit(event, data) {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event).forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      });
    }
  }

  // Connection management
  connect() {
    if (this.socket && !this.isConnected) {
      this.socket.connect();
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }

  // Conversation management
  joinConversation(conversationId) {
    if (this.socket && this.isConnected) {
      this.socket.emit('join-conversation', { conversationId });
    }
  }

  leaveConversation(conversationId) {
    if (this.socket && this.isConnected) {
      this.socket.emit('leave-conversation', { conversationId });
    }
  }

  // Message streaming
  streamMessage(conversationId, message, model = 'gpt-4o-mini') {
    if (this.socket && this.isConnected) {
      this.socket.emit('stream-message', {
        conversationId,
        message,
        model
      });
    }
  }

  // Typing indicators
  startTyping(conversationId) {
    if (this.socket && this.isConnected) {
      this.socket.emit('typing-start', { conversationId });
    }
  }

  stopTyping(conversationId) {
    if (this.socket && this.isConnected) {
      this.socket.emit('typing-stop', { conversationId });
    }
  }

  // Debounced typing indicator
  debouncedTyping(conversationId, delay = 1000) {
    // Clear existing timeout
    if (this.typingTimeouts.has(conversationId)) {
      clearTimeout(this.typingTimeouts.get(conversationId));
    }

    // Start typing indicator
    this.startTyping(conversationId);

    // Set timeout to stop typing
    const timeout = setTimeout(() => {
      this.stopTyping(conversationId);
      this.typingTimeouts.delete(conversationId);
    }, delay);

    this.typingTimeouts.set(conversationId, timeout);
  }

  // Utility methods
  isConnected() {
    return this.isConnected;
  }

  getSocketId() {
    return this.socket ? this.socket.id : null;
  }

  // Cleanup
  destroy() {
    // Clear all typing timeouts
    this.typingTimeouts.forEach(timeout => clearTimeout(timeout));
    this.typingTimeouts.clear();

    // Clear all event handlers
    this.eventHandlers.clear();

    // Disconnect socket
    this.disconnect();
  }
}

// React Hook for Socket.IO (if using React)
function useSocket(serverUrl, token) {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!serverUrl || !token) return;

    const socketClient = new SocketClient(serverUrl, token);

    socketClient.on('connected', () => {
      setIsConnected(true);
      setError(null);
    });

    socketClient.on('disconnected', () => {
      setIsConnected(false);
    });

    socketClient.on('connection_error', (data) => {
      setError(data.error);
    });

    setSocket(socketClient);

    return () => {
      socketClient.destroy();
    };
  }, [serverUrl, token]);

  return { socket, isConnected, error };
}

// Vue.js Plugin (if using Vue)
const SocketPlugin = {
  install(app, options) {
    const socket = new SocketClient(options.serverUrl, options.token);
    
    app.config.globalProperties.$socket = socket;
    app.provide('socket', socket);
  }
};

// Export for different module systems
if (typeof module !== 'undefined' && module.exports) {
  // CommonJS
  module.exports = { SocketClient, useSocket, SocketPlugin };
} else if (typeof define === 'function' && define.amd) {
  // AMD
  define([], function() {
    return { SocketClient, useSocket, SocketPlugin };
  });
} else {
  // Browser global
  window.SocketClient = SocketClient;
  window.useSocket = useSocket;
  window.SocketPlugin = SocketPlugin;
}
