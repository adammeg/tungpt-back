# Setup Guide for ChatGPT Clone Backend

## Prerequisites

1. **Node.js** (v14 or higher)
2. **MongoDB** (local or cloud)
3. **npm** or **yarn**

## MongoDB Setup

### Option 1: Local MongoDB (Recommended for Development)

#### Windows:
1. Download MongoDB Community Server from [MongoDB Download Center](https://www.mongodb.com/try/download/community)
2. Install MongoDB as a service
3. MongoDB will run on `mongodb://localhost:27017`

#### macOS:
```bash
# Using Homebrew
brew tap mongodb/brew
brew install mongodb-community
brew services start mongodb/brew/mongodb-community
```

#### Linux (Ubuntu/Debian):
```bash
# Import MongoDB public GPG key
wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -

# Create list file for MongoDB
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list

# Update package database
sudo apt-get update

# Install MongoDB
sudo apt-get install -y mongodb-org

# Start MongoDB
sudo systemctl start mongod
sudo systemctl enable mongod
```

### Option 2: MongoDB Atlas (Cloud - Recommended for Production)

1. Go to [MongoDB Atlas](https://www.mongodb.com/atlas)
2. Create a free account
3. Create a new cluster
4. Get your connection string
5. Update `config.env` with your MongoDB Atlas connection string

## Installation

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Configure Environment:**
   - Copy `config.env` and update the values
   - Make sure MongoDB is running (if using local)

3. **Start the Server:**
   ```bash
   # Development mode (with auto-restart)
   npm run dev
   
   # Production mode
   npm start
   ```

## Quick Start with Docker (Alternative)

If you prefer using Docker:

```bash
# Start MongoDB with Docker
docker run -d --name mongodb -p 27017:27017 mongo:latest

# Install dependencies
npm install

# Start the application
npm run dev
```

## Verification

Once the server is running, you should see:
- ✅ Connected to MongoDB
- 🚀 Server running on port 5000
- 🔌 Socket.IO server initialized

## API Endpoints

The server will be available at:
- **API Base URL:** `http://localhost:5000/api`
- **Health Check:** `http://localhost:5000/health`
- **API Documentation:** `http://localhost:5000/api`

## Frontend Integration

The frontend (in `chatgpt-interface/` folder) is configured to connect to:
- **Backend API:** `http://localhost:5000`
- **WebSocket:** `http://localhost:5000`

## Troubleshooting

### MongoDB Connection Issues:
1. Make sure MongoDB is running
2. Check if the port 27017 is available
3. Verify your connection string in `config.env`

### Port Issues:
1. Make sure port 5000 is available
2. Change the port in `config.env` if needed

### Dependencies Issues:
1. Delete `node_modules` and `package-lock.json`
2. Run `npm install` again

## Next Steps

1. Start the backend server
2. Navigate to the frontend folder: `cd chatgpt-interface`
3. Install frontend dependencies: `npm install`
4. Start the frontend: `npm run dev`
5. Open `http://localhost:3000` in your browser
