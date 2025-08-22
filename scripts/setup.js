#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Setting up ChatGPT Clone Backend...\n');

// Check if Node.js version is compatible
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);

if (majorVersion < 14) {
  console.error('❌ Node.js version 14 or higher is required');
  console.error(`Current version: ${nodeVersion}`);
  process.exit(1);
}

console.log(`✅ Node.js version: ${nodeVersion}`);

// Check if package.json exists
if (!fs.existsSync('package.json')) {
  console.error('❌ package.json not found. Please run this script from the project root.');
  process.exit(1);
}

// Check if config.env exists
if (!fs.existsSync('config.env')) {
  console.log('⚠️  config.env not found. Creating from template...');
  const configTemplate = `# Server Configuration
PORT=5000
NODE_ENV=development

# MongoDB Configuration
MONGODB_URI=mongodb://localhost:27017/chatgpt-clone

# Session Configuration
SESSION_SECRET=your-super-secret-session-key-change-this-in-production

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=7d

# OpenAI Configuration
OPENAI_API_KEY=your-openai-api-key

# Frontend URL
FRONTEND_URL=http://localhost:3000

# Other configurations will be added as needed
`;
  
  fs.writeFileSync('config.env', configTemplate);
  console.log('✅ Created config.env template');
}

// Create necessary directories
const directories = ['logs', 'uploads', 'scripts'];
directories.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`✅ Created directory: ${dir}`);
  }
});

// Install dependencies
console.log('\n📦 Installing dependencies...');
try {
  execSync('npm install', { stdio: 'inherit' });
  console.log('✅ Dependencies installed successfully');
} catch (error) {
  console.error('❌ Failed to install dependencies');
  process.exit(1);
}

// Check MongoDB connection
console.log('\n🔍 Checking MongoDB connection...');
try {
  const mongoose = require('mongoose');
  require('dotenv').config();
  
  mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatgpt-clone', {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    bufferCommands: false
  })
  .then(() => {
    console.log('✅ MongoDB connection successful');
    mongoose.connection.close();
    console.log('\n🎉 Setup completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Update config.env with your actual values');
    console.log('2. Start the server: npm run dev');
    console.log('3. Navigate to chatgpt-interface/ and run: npm install && npm run dev');
  })
  .catch(err => {
    console.log('⚠️  MongoDB connection failed. This is expected if MongoDB is not running.');
    console.log('Please install and start MongoDB, or use MongoDB Atlas.');
    console.log('See setup.md for detailed instructions.');
    console.log('\n🎉 Setup completed (MongoDB needs to be configured)!');
  });
} catch (error) {
  console.log('⚠️  Could not test MongoDB connection');
  console.log('Please install and start MongoDB, or use MongoDB Atlas.');
  console.log('See setup.md for detailed instructions.');
  console.log('\n🎉 Setup completed (MongoDB needs to be configured)!');
}
