# ChatGPT Clone Backend API

A complete backend API server for a ChatGPT-like application built with Node.js, Express, MongoDB, and OpenAI API. Features user authentication, subscription management with Konnect payments, and a comprehensive chat system.

## 🚀 Features

### 🔐 Authentication System
- User registration and login
- JWT-based authentication with cookies
- Password hashing with bcrypt
- Session management
- Profile management

### 💬 Chat System
- Real-time chat with OpenAI models
- **Live message streaming** with typing indicators
- **Real-time AI response streaming** (like ChatGPT)
- Conversation history and management
- Multiple AI models (GPT-4o, GPT-4o Mini, GPT-3.5 Turbo)
- Message limits based on subscription tier
- Token usage tracking
- **Typing indicators** for user activity
- **Real-time notifications** and broadcasts

### 💳 Subscription System
- Free tier (20 messages/month)
- Basic plan (30 TND/month, 100 messages)
- Premium plan (60 TND/month, 1000 messages)
- Konnect integration for Tunisian payments
- Webhook handling for subscription events

### 🛡️ Security Features
- Password hashing with bcrypt
- JWT token authentication
- Rate limiting
- Input validation
- CORS protection
- Helmet security headers
- Session management

## 📋 Prerequisites

- Node.js (v14 or higher)
- MongoDB (local or cloud)
- OpenAI API key
- Konnect account (for Tunisian payments)

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd chatgpt-clone-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Create a `config.env` file in the root directory:
   ```env
   # OpenAI Configuration
   OPENAI_API_KEY=your_openai_api_key_here

   # Database Configuration
   MONGODB_URI=mongodb://localhost:27017/chatgpt-clone

   # Session Secret
   SESSION_SECRET=your-super-secret-session-key-change-this-in-production

   # JWT Secret
   JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

   # Konnect Configuration (Tunisian Payment Solution)
   KONNECT_MERCHANT_ID=your_konnect_merchant_id
   KONNECT_SECRET_KEY=your_konnect_secret_key
   KONNECT_API_URL=https://api.konnect.network/api/v2
   KONNECT_WEBHOOK_SECRET=your_konnect_webhook_secret

   # Frontend Configuration
   FRONTEND_URL=http://localhost:3000

   # App Configuration
   PORT=5000
   NODE_ENV=development
   ```

4. **Set up MongoDB**
   
   Make sure MongoDB is running locally or update the `MONGODB_URI` to point to your cloud database.

5. **Set up Konnect (for Tunisian payments)**
   
   - Create a Konnect merchant account
   - Get your merchant ID and secret key from the Konnect dashboard
   - Configure your webhook endpoint in Konnect dashboard
   - Update the API URL if needed (sandbox vs production)

6. **Start the server**
   ```bash
   # Development mode
   npm run dev
   
   # Production mode
   npm start
   ```

   The API server will be available at `http://localhost:5000`

## 📚 API Documentation

### Base URL
```
http://localhost:5000/api
```

### Authentication Endpoints

#### Register User
```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "johndoe",
  "email": "john@example.com",
  "password": "password123"
}
```

#### Login User
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "password123"
}
```

#### Get User Profile
```http
GET /api/auth/profile
Authorization: Bearer <jwt_token>
```

#### Update Profile
```http
PUT /api/auth/profile
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "username": "newusername",
  "email": "newemail@example.com"
}
```

#### Logout
```http
POST /api/auth/logout
Authorization: Bearer <jwt_token>
```

### Chat Endpoints

#### Get Conversations
```http
GET /api/chat/conversations
Authorization: Bearer <jwt_token>
```

#### Create Conversation
```http
POST /api/chat/conversations
Authorization: Bearer <jwt_token>
```

#### Get Conversation
```http
GET /api/chat/conversations/:id
Authorization: Bearer <jwt_token>
```

#### Send Message
```http
POST /api/chat/conversations/:id/messages
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "message": "Hello, how are you?",
  "model": "gpt-4o-mini"
}
```

#### Update Conversation Title
```http
PUT /api/chat/conversations/:id/title
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "title": "New Conversation Title"
}
```

#### Delete Conversation
```http
DELETE /api/chat/conversations/:id
Authorization: Bearer <jwt_token>
```

#### Get Available Models
```http
GET /api/chat/models
Authorization: Bearer <jwt_token>
```

### Subscription Endpoints

#### Get Subscription Plans
```http
GET /api/subscription/plans
```

#### Create Checkout Session
```http
POST /api/subscription/create-checkout-session
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "plan": "basic"
}
```

#### Check Payment Status
```http
GET /api/subscription/payment-status/:orderId
Authorization: Bearer <jwt_token>
```

#### Cancel Subscription
```http
POST /api/subscription/cancel
Authorization: Bearer <jwt_token>
```

#### Get Subscription Status
```http
GET /api/subscription/status
Authorization: Bearer <jwt_token>
```

### Utility Endpoints

#### Health Check
```http
GET /health
```

#### API Documentation
```http
GET /api
```

#### Test OpenAI
```http
GET /test-openai
```

### Real-time Chat Endpoints

#### Get Real-time Status
```http
GET /api/realtime/status
Authorization: Bearer <jwt_token>
```

#### Get Active Users in Conversation
```http
GET /api/realtime/conversations/:id/active-users
Authorization: Bearer <jwt_token>
```

#### Get Typing Users
```http
GET /api/realtime/conversations/:id/typing
Authorization: Bearer <jwt_token>
```

#### Send Notification
```http
POST /api/realtime/notify/:userId
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "message": "Hello from admin!",
  "type": "info",
  "data": { "action": "refresh" }
}
```

#### Broadcast Message (Admin Only)
```http
POST /api/realtime/broadcast
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "message": "Server maintenance in 5 minutes",
  "type": "warning"
}
```

#### Get Real-time Statistics (Admin Only)
```http
GET /api/realtime/stats
Authorization: Bearer <jwt_token>
```

### Socket.IO Events

#### Client to Server Events
- `join-conversation` - Join a conversation room
- `leave-conversation` - Leave a conversation room
- `stream-message` - Send a message for real-time streaming
- `typing-start` - Start typing indicator
- `typing-stop` - Stop typing indicator

#### Server to Client Events
- `connected` - Successfully connected to server
- `joined-conversation` - Joined conversation room
- `message-sent` - Message was sent to conversation
- `ai-typing-start` - AI is thinking/typing
- `ai-stream-chunk` - AI response chunk (for streaming)
- `ai-stream-complete` - AI response complete
- `ai-typing-stop` - AI stopped typing
- `ai-stream-error` - AI streaming error
- `typing-start` - User started typing
- `typing-stopped` - User stopped typing
- `notification` - Personal notification
- `broadcast` - Broadcast message to all users

### Real-time Features

#### Message Streaming
The API supports real-time message streaming similar to ChatGPT:

1. **User sends message** → Immediately appears in chat
2. **AI typing indicator** → Shows "AI is thinking..."
3. **Streaming response** → AI response appears word by word
4. **Completion** → Full response saved to database

#### Typing Indicators
- Real-time typing indicators for users
- Debounced typing detection
- Automatic cleanup on disconnect

#### Notifications
- Personal notifications to specific users
- Broadcast messages to all connected users
- Admin-only broadcast functionality

#### Connection Management
- Automatic reconnection on disconnect
- Connection status monitoring
- User presence tracking

## 🗄️ Database Models

### User Schema
```javascript
{
  email: String (required, unique),
  password: String (required, min 6 chars),
  username: String (required, unique),
  subscription: {
    plan: String (enum: ['free', 'basic', 'premium']),
    konnectOrderId: String,
    currentPeriodEnd: Date,
    status: String (enum: ['active', 'canceled', 'pending', 'failed']),
    lastPaymentDate: Date,
    lastPaymentAmount: Number,
    lastPaymentCurrency: String
  },
  usage: {
    messagesThisMonth: Number,
    lastResetDate: Date
  },
  isActive: Boolean,
  lastLogin: Date,
  createdAt: Date
}
```

### Conversation Schema
```javascript
{
  userId: ObjectId (ref: 'User'),
  title: String,
  messages: [{
    role: String (enum: ['user', 'assistant']),
    content: String,
    timestamp: Date,
    tokens: Number
  }],
  model: String,
  totalTokens: Number,
  isActive: Boolean,
  createdAt: Date
}
```

## 💰 Subscription Plans

| Plan | Price | Messages/Month | Features |
|------|-------|----------------|----------|
| Free | 0 TND | 20 | Basic chat, GPT-4o Mini |
| Basic | 30 TND | 100 | All models, basic support |
| Premium | 60 TND | 1000 | All models, priority support |

## 🏗️ Project Structure

```
├── app.js                 # Main application file
├── config.env            # Environment variables
├── package.json          # Dependencies and scripts
├── models/               # Database models
│   ├── User.js
│   └── Conversation.js
├── routes/               # API routes
│   ├── auth.js
│   ├── chat.js
│   └── subscription.js
├── middleware/           # Custom middleware
│   └── auth.js
└── bin/                 # Application startup
    └── www
```

## 🔧 Development

### Adding New Features

1. **New API endpoints**: Add routes in the appropriate route file
2. **Database changes**: Update models and run migrations
3. **Authentication**: Use the `requireAuth` middleware
4. **Validation**: Add input validation middleware

### Testing

Test the OpenAI integration:
```bash
curl http://localhost:5000/test-openai
```

Test the health endpoint:
```bash
curl http://localhost:5000/health
```

## 🚀 Deployment

### Environment Variables for Production
- Set `NODE_ENV=production`
- Use strong, unique secrets for `SESSION_SECRET` and `JWT_SECRET`
- Use production Konnect keys
- Set up proper MongoDB connection string
- Configure `FRONTEND_URL` to your frontend domain

### Recommended Hosting
- **Backend**: Heroku, Railway, DigitalOcean, or AWS
- **Database**: MongoDB Atlas
- **Environment**: Use environment variables for configuration

## 🐛 Troubleshooting

### Common Issues

1. **MongoDB Connection Error**
   - Check if MongoDB is running
   - Verify connection string in `config.env`

2. **OpenAI API Errors**
   - Verify API key is correct
   - Check API quota and billing

3. **Konnect Integration Issues**
   - Ensure webhook endpoint is configured in Konnect dashboard
   - Verify merchant ID and secret key
   - Check webhook signature verification

4. **CORS Issues**
   - Verify `FRONTEND_URL` is correctly set
   - Check if frontend is making requests from the correct origin

5. **Authentication Issues**
   - Clear browser cookies
   - Check JWT token expiration
   - Verify session configuration

## 📄 License

This project is licensed under the MIT License.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📞 Support

For support, please open an issue in the GitHub repository or contact the development team.
