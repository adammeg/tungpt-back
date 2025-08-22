# 🚀 Production Deployment Guide

This guide will help you deploy your ChatGPT Clone backend to production and connect it to your Vercel frontend at `https://tungpt-front.vercel.app`.

## 📋 Prerequisites

- **Server**: Ubuntu 20.04+ or CentOS 8+ (recommended)
- **Domain**: A domain name for your backend API
- **SSL Certificate**: For HTTPS (Let's Encrypt recommended)
- **MongoDB**: Either MongoDB Atlas (cloud) or local MongoDB
- **Node.js**: Version 16+ installed on server

## 🔧 Server Setup

### 1. Update System
```bash
sudo apt update && sudo apt upgrade -y
```

### 2. Install Node.js
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 3. Install PM2 (Process Manager)
```bash
sudo npm install -g pm2
```

### 4. Install Nginx
```bash
sudo apt install nginx -y
sudo systemctl enable nginx
sudo systemctl start nginx
```

### 5. Install Docker (Optional - for containerized deployment)
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

## 📁 Project Setup

### 1. Clone/Upload Project
```bash
# Option 1: Clone from Git
git clone <your-repo-url>
cd chatgpt-clone-backend

# Option 2: Upload via SCP/SFTP
# Upload your project files to the server
```

### 2. Configure Environment
```bash
# Copy and edit the environment file
cp config.env.example config.env
nano config.env
```

**Required Environment Variables:**
```env
NODE_ENV=production
PORT=5000
HOST=0.0.0.0

# Frontend URL
FRONTEND_URL=https://tungpt-front.vercel.app

# MongoDB (use your actual connection string)
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/chatgpt-clone

# JWT Secret (generate a strong secret)
JWT_SECRET=your-super-secure-jwt-secret-key-here

# Session Secret (generate a strong secret)
SESSION_SECRET=your-super-secure-session-secret-key-here

# OpenAI API Key
OPENAI_API_KEY=your-openai-api-key-here

# Other configurations as needed...
```

### 3. Install Dependencies
```bash
npm install --production
```

## 🚀 Deployment Options

### Option 1: Direct Deployment with PM2

1. **Run the deployment script:**
```bash
chmod +x deploy.sh
./deploy.sh
```

2. **Or manually deploy:**
```bash
# Create necessary directories
mkdir -p logs uploads temp

# Start with PM2
pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save

# Setup PM2 to start on system boot
pm2 startup
```

### Option 2: Docker Deployment

1. **Build and run with Docker Compose:**
```bash
# Update docker-compose.yml with your domain
sed -i 's/your-domain.com/your-actual-domain.com/g' docker-compose.yml

# Build and start services
docker-compose up -d

# Check status
docker-compose ps
```

2. **Or build manually:**
```bash
# Build the image
docker build -t chatgpt-clone-backend .

# Run the container
docker run -d \
  --name chatgpt-backend \
  -p 5000:5000 \
  --env-file config.env \
  -v $(pwd)/logs:/app/logs \
  -v $(pwd)/uploads:/app/uploads \
  chatgpt-clone-backend
```

## 🌐 Domain & SSL Setup

### 1. Configure Domain DNS
Point your domain to your server's IP address:
```
A    api.yourdomain.com    YOUR_SERVER_IP
```

### 2. Install SSL Certificate (Let's Encrypt)
```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Get SSL certificate
sudo certbot --nginx -d api.yourdomain.com

# Auto-renewal
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

### 3. Configure Nginx
```bash
# Copy the provided nginx.conf
sudo cp nginx.conf /etc/nginx/nginx.conf

# Update with your domain
sudo sed -i 's/your-domain.com/api.yourdomain.com/g' /etc/nginx/nginx.conf

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

## 🔗 Frontend Configuration

Update your Vercel frontend to connect to your production backend:

### 1. Environment Variables in Vercel
Add these environment variables in your Vercel project settings:
```env
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
NEXT_PUBLIC_SOCKET_URL=https://api.yourdomain.com
```

### 2. Update API Configuration
In your frontend code, update the API base URL:
```typescript
// lib/api.ts
const baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
```

```typescript
// lib/socket.ts
const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:5000';
```

## 📊 Monitoring & Maintenance

### 1. PM2 Commands
```bash
# Check status
pm2 status

# View logs
pm2 logs

# Restart application
pm2 restart chatgpt-clone-backend

# Monitor resources
pm2 monit
```

### 2. Docker Commands
```bash
# Check container status
docker-compose ps

# View logs
docker-compose logs -f app

# Restart services
docker-compose restart

# Update and rebuild
docker-compose pull
docker-compose up -d --build
```

### 3. Nginx Commands
```bash
# Check status
sudo systemctl status nginx

# View logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# Reload configuration
sudo systemctl reload nginx
```

## 🔒 Security Checklist

- [ ] **Firewall**: Configure UFW or iptables
- [ ] **SSL**: HTTPS enabled with valid certificate
- [ ] **Secrets**: Strong JWT and session secrets
- [ ] **Rate Limiting**: Enabled in Nginx and application
- [ ] **CORS**: Properly configured for your frontend domain
- [ ] **Database**: MongoDB with authentication
- [ ] **Logs**: Proper logging and monitoring
- [ ] **Backups**: Regular database and file backups

### Firewall Setup
```bash
# Install UFW
sudo apt install ufw

# Configure firewall
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

## 🚨 Troubleshooting

### Common Issues:

1. **CORS Errors**
   - Check CORS configuration in `app.js`
   - Verify frontend URL in environment variables
   - Check Nginx CORS headers

2. **Socket.IO Connection Issues**
   - Verify WebSocket proxy configuration in Nginx
   - Check Socket.IO CORS settings
   - Ensure proper SSL configuration

3. **Database Connection**
   - Verify MongoDB connection string
   - Check network connectivity
   - Ensure MongoDB is running

4. **Rate Limiting**
   - Check rate limit configuration
   - Verify IP whitelisting if needed
   - Monitor logs for rate limit errors

### Debug Commands:
```bash
# Check application logs
pm2 logs chatgpt-clone-backend

# Check Nginx logs
sudo tail -f /var/log/nginx/error.log

# Test API endpoint
curl -X GET https://api.yourdomain.com/health

# Test WebSocket connection
wscat -c wss://api.yourdomain.com/socket.io/
```

## 📈 Performance Optimization

1. **Enable Gzip Compression** (already in Nginx config)
2. **Use CDN** for static assets
3. **Database Indexing** for MongoDB collections
4. **Caching** with Redis (optional)
5. **Load Balancing** for high traffic

## 🔄 Updates & Maintenance

### Regular Maintenance Tasks:
1. **Security Updates**: `sudo apt update && sudo apt upgrade`
2. **Node.js Updates**: Update Node.js version when needed
3. **Dependency Updates**: `npm audit fix`
4. **Log Rotation**: Configure log rotation for large log files
5. **Backup**: Regular database and file backups

### Update Process:
```bash
# Pull latest code
git pull origin main

# Install dependencies
npm install --production

# Restart application
pm2 restart chatgpt-clone-backend

# Or with Docker
docker-compose up -d --build
```

## 🎉 Success!

Your ChatGPT Clone backend is now deployed and ready to serve your Vercel frontend at `https://tungpt-front.vercel.app`!

**API Endpoints:**
- Health Check: `https://api.yourdomain.com/health`
- API Base: `https://api.yourdomain.com/api`
- WebSocket: `wss://api.yourdomain.com/socket.io`

**Next Steps:**
1. Test the connection from your frontend
2. Monitor logs for any issues
3. Set up monitoring and alerts
4. Configure backups
5. Set up CI/CD for automated deployments
