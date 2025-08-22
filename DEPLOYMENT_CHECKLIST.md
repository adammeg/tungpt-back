# 🚀 Quick Deployment Checklist

## ✅ Pre-Deployment Checklist

### Server Setup
- [ ] Server with Ubuntu 20.04+ or CentOS 8+
- [ ] Node.js 16+ installed
- [ ] Domain name pointing to server IP
- [ ] SSL certificate (Let's Encrypt)
- [ ] MongoDB Atlas or local MongoDB running

### Environment Configuration
- [ ] `config.env` file created with production settings
- [ ] MongoDB connection string configured
- [ ] JWT_SECRET set (strong random string)
- [ ] SESSION_SECRET set (strong random string)
- [ ] OPENAI_API_KEY configured
- [ ] FRONTEND_URL set to `https://tungpt-front.vercel.app`

### Security
- [ ] Strong passwords for all services
- [ ] Firewall configured (UFW)
- [ ] SSH key authentication enabled
- [ ] Root login disabled

## 🚀 Deployment Steps

### Option 1: PM2 Deployment (Recommended)
```bash
# 1. Upload project to server
# 2. Configure config.env
# 3. Run deployment script
chmod +x deploy.sh
./deploy.sh
```

### Option 2: Docker Deployment
```bash
# 1. Update docker-compose.yml with your domain
# 2. Configure config.env
# 3. Build and run
docker-compose up -d
```

## 🔗 Frontend Configuration

### Vercel Environment Variables
Add these to your Vercel project settings:
```env
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
NEXT_PUBLIC_SOCKET_URL=https://api.yourdomain.com
```

### Update Frontend Code
```typescript
// lib/api.ts
const baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

// lib/socket.ts
const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:5000';
```

## ✅ Post-Deployment Verification

### API Health Check
```bash
curl https://api.yourdomain.com/health
```

### Frontend Connection Test
1. Visit `https://tungpt-front.vercel.app`
2. Try to register/login
3. Test chat functionality
4. Check WebSocket connection

### Monitoring
```bash
# PM2 status
pm2 status

# View logs
pm2 logs

# Nginx status
sudo systemctl status nginx
```

## 🚨 Common Issues & Solutions

### CORS Errors
- Check `config.env` FRONTEND_URL
- Verify Nginx CORS headers
- Check browser console for errors

### Socket.IO Connection Issues
- Verify WebSocket proxy in Nginx
- Check SSL certificate
- Test with `wscat -c wss://api.yourdomain.com/socket.io/`

### Database Connection
- Verify MongoDB connection string
- Check network connectivity
- Ensure MongoDB is running

## 📊 Maintenance Commands

```bash
# Restart application
pm2 restart chatgpt-clone-backend

# Update dependencies
npm install --production

# View logs
pm2 logs

# Monitor resources
pm2 monit

# Update with Docker
docker-compose up -d --build
```

## 🔒 Security Reminders

- [ ] Regular security updates: `sudo apt update && sudo apt upgrade`
- [ ] Monitor logs for suspicious activity
- [ ] Regular database backups
- [ ] Keep dependencies updated
- [ ] Monitor SSL certificate expiration

## 📞 Support

If you encounter issues:
1. Check the logs: `pm2 logs` or `docker-compose logs`
2. Verify environment variables
3. Test API endpoints manually
4. Check firewall and network settings
5. Review the full `DEPLOYMENT.md` guide

---

**🎉 Your ChatGPT Clone is now live at:**
- **Frontend**: https://tungpt-front.vercel.app
- **Backend API**: https://api.yourdomain.com
- **Health Check**: https://api.yourdomain.com/health
