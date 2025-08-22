const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { validate, schemas } = require('../middleware/validation');
const { logInfo, logWarn } = require('../utils/logger');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    
    // Create upload directory if it doesn't exist
    try {
      await fs.mkdir(uploadDir, { recursive: true });
    } catch (error) {
      return cb(error);
    }
    
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'text/plain',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images, text files, and PDFs are allowed.'), false);
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1
  }
});

// Upload single file
router.post('/single', requireAuth, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: 'No file uploaded'
    });
  }

  const file = req.file;
  
  // Create file record in database
  const fileRecord = {
    userId: req.user.id,
    originalName: file.originalname,
    filename: file.filename,
    path: file.path,
    mimetype: file.mimetype,
    size: file.size,
    uploadedAt: new Date()
  };

  // Log file upload
  logInfo('File uploaded', {
    userId: req.user.id,
    filename: file.filename,
    originalName: file.originalname,
    size: file.size,
    mimetype: file.mimetype
  });

  res.json({
    success: true,
    data: {
      file: {
        id: fileRecord.filename, // Using filename as ID for simplicity
        originalName: fileRecord.originalName,
        filename: fileRecord.filename,
        mimetype: fileRecord.mimetype,
        size: fileRecord.size,
        url: `/api/upload/files/${fileRecord.filename}`,
        uploadedAt: fileRecord.uploadedAt
      }
    }
  });
}));

// Upload multiple files
router.post('/multiple', requireAuth, upload.array('files', 5), asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'No files uploaded'
    });
  }

  const files = req.files.map(file => ({
    userId: req.user.id,
    originalName: file.originalname,
    filename: file.filename,
    path: file.path,
    mimetype: file.mimetype,
    size: file.size,
    uploadedAt: new Date()
  }));

  // Log file uploads
  logInfo('Multiple files uploaded', {
    userId: req.user.id,
    count: files.length,
    files: files.map(f => ({ filename: f.filename, size: f.size }))
  });

  res.json({
    success: true,
    data: {
      files: files.map(file => ({
        id: file.filename,
        originalName: file.originalName,
        filename: file.filename,
        mimetype: file.mimetype,
        size: file.size,
        url: `/api/upload/files/${file.filename}`,
        uploadedAt: file.uploadedAt
      }))
    }
  });
}));

// Serve uploaded files
router.get('/files/:filename', requireAuth, asyncHandler(async (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, '../uploads', filename);

  try {
    // Check if file exists
    await fs.access(filePath);
    
    // Set appropriate headers
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 'inline');
    
    // Stream the file
    const fileStream = require('fs').createReadStream(filePath);
    fileStream.pipe(res);

  } catch (error) {
    return res.status(404).json({
      success: false,
      error: 'File not found'
    });
  }
}));

// Delete uploaded file
router.delete('/files/:filename', requireAuth, asyncHandler(async (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, '../uploads', filename);

  try {
    // Check if file exists
    await fs.access(filePath);
    
    // Delete file
    await fs.unlink(filePath);

    logInfo('File deleted', {
      userId: req.user.id,
      filename: filename
    });

    res.json({
      success: true,
      message: 'File deleted successfully'
    });

  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }
    
    logWarn('Error deleting file', {
      userId: req.user.id,
      filename: filename,
      error: error.message
    });

    res.status(500).json({
      success: false,
      error: 'Error deleting file'
    });
  }
}));

// Get user's uploaded files
router.get('/files', requireAuth, asyncHandler(async (req, res) => {
  const uploadDir = path.join(__dirname, '../uploads');
  
  try {
    const files = await fs.readdir(uploadDir);
    const userFiles = [];

    for (const filename of files) {
      if (filename.includes(req.user.id)) {
        const filePath = path.join(uploadDir, filename);
        const stats = await fs.stat(filePath);
        
        userFiles.push({
          id: filename,
          filename: filename,
          size: stats.size,
          uploadedAt: stats.birthtime,
          url: `/api/upload/files/${filename}`
        });
      }
    }

    res.json({
      success: true,
      data: {
        files: userFiles
      }
    });

  } catch (error) {
    res.json({
      success: true,
      data: {
        files: []
      }
    });
  }
}));

// Clean up old files (admin only)
router.post('/cleanup', requireAuth, asyncHandler(async (req, res) => {
  // Check if user is admin (you might want to add admin role to user model)
  if (req.user.email !== 'admin@example.com') {
    return res.status(403).json({
      success: false,
      error: 'Admin access required'
    });
  }

  const uploadDir = path.join(__dirname, '../uploads');
  const files = await fs.readdir(uploadDir);
  const now = Date.now();
  const thirtyDaysAgo = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
  let deletedCount = 0;

  for (const filename of files) {
    const filePath = path.join(uploadDir, filename);
    const stats = await fs.stat(filePath);
    
    // Delete files older than 30 days
    if (now - stats.mtime.getTime() > thirtyDaysAgo) {
      await fs.unlink(filePath);
      deletedCount++;
    }
  }

  logInfo('File cleanup completed', {
    adminId: req.user.id,
    deletedCount: deletedCount
  });

  res.json({
    success: true,
    message: `Cleaned up ${deletedCount} old files`
  });
}));

module.exports = router;
