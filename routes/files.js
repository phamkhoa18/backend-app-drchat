const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const File = require('../models/File');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 200 * 1024 * 1024 // 200MB limit for videos
  },
  fileFilter: (req, file, cb) => {
    // Accept all file types including videos
    cb(null, true);
  }
});

const IMAGE_MAX_EDGE = 1920;
const THUMB_MAX_EDGE = 360;

const getSharpFormat = (mimeType) => {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpeg';
};

const getSharpOptions = (format, isThumb = false) => {
  if (format === 'png') {
    return { compressionLevel: 8 };
  }
  if (format === 'webp') {
    return { quality: isThumb ? 65 : 80 };
  }
  return { quality: isThumb ? 65 : 80, mozjpeg: true };
};

// Upload file with better error handling
router.post('/upload', auth, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      // Handle multer errors
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          // Use 413 to match common reverse proxy semantics
          return res.status(413).json({ 
            message: 'File too large. Maximum size is 200MB',
            maxSizeMB: 200,
            error: err.message 
          });
        }
        return res.status(400).json({ 
          message: 'File upload error',
          error: err.message 
        });
      }
      return res.status(500).json({ 
        message: 'Upload error',
        error: err.message || 'Unknown error'
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      console.error('No file in request');
      return res.status(400).json({ message: 'No file uploaded' });
    }

    console.log('File upload received:', {
      filename: req.file.filename,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      userId: req.user._id
    });

    // Validate file size (double check)
    const maxSize = 200 * 1024 * 1024; // 200MB
    if (req.file.size > maxSize) {
      console.error('File too large:', req.file.size);
      // Delete the uploaded file
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ 
        message: `File too large. Maximum size is ${maxSize / 1024 / 1024}MB` 
      });
    }

    let thumbnailFileName = null;
    let thumbnailPath = null;
    let imageWidth = null;
    let imageHeight = null;

    // Optimize images + create thumbnail (skip GIFs)
    const isImage = req.file.mimetype && req.file.mimetype.startsWith('image/');
    const isGif = req.file.mimetype === 'image/gif';
    const isHeic = req.file.mimetype === 'image/heic' || req.file.mimetype === 'image/heif';

    if (isImage && !isGif && !isHeic) {
      try {
        const ext = path.extname(req.file.filename);
        const baseName = path.basename(req.file.filename, ext);
        thumbnailFileName = `${baseName}-thumb${ext}`;
        thumbnailPath = path.join(uploadsDir, thumbnailFileName);

        const format = getSharpFormat(req.file.mimetype);
        const tempFullPath = `${req.file.path}.tmp`;

        const fullInfo = await sharp(req.file.path)
          .rotate()
          .resize({
            width: IMAGE_MAX_EDGE,
            height: IMAGE_MAX_EDGE,
            fit: 'inside',
            withoutEnlargement: true
          })
          .toFormat(format, getSharpOptions(format))
          .toFile(tempFullPath);

        fs.renameSync(tempFullPath, req.file.path);

        await sharp(req.file.path)
          .rotate()
          .resize({
            width: THUMB_MAX_EDGE,
            height: THUMB_MAX_EDGE,
            fit: 'cover',
            withoutEnlargement: true
          })
          .toFormat(format, getSharpOptions(format, true))
          .toFile(thumbnailPath);

        imageWidth = fullInfo.width || null;
        imageHeight = fullInfo.height || null;
        req.file.size = fs.statSync(req.file.path).size;
      } catch (imageError) {
        console.error('Error optimizing image:', imageError);
        thumbnailFileName = null;
        thumbnailPath = null;
      }
    } else if (isHeic) {
      try {
        const ext = path.extname(req.file.filename);
        const baseName = path.basename(req.file.filename, ext);
        const jpegFileName = `${baseName}.jpg`;
        const jpegPath = path.join(uploadsDir, jpegFileName);
        const tempFullPath = `${jpegPath}.tmp`;

        const fullInfo = await sharp(req.file.path)
          .rotate()
          .resize({
            width: IMAGE_MAX_EDGE,
            height: IMAGE_MAX_EDGE,
            fit: 'inside',
            withoutEnlargement: true
          })
          .toFormat('jpeg', getSharpOptions('jpeg'))
          .toFile(tempFullPath);

        fs.renameSync(tempFullPath, jpegPath);
        fs.unlinkSync(req.file.path);

        req.file.filename = jpegFileName;
        req.file.path = jpegPath;
        req.file.mimetype = 'image/jpeg';

        thumbnailFileName = `${baseName}-thumb.jpg`;
        thumbnailPath = path.join(uploadsDir, thumbnailFileName);

        await sharp(req.file.path)
          .rotate()
          .resize({
            width: THUMB_MAX_EDGE,
            height: THUMB_MAX_EDGE,
            fit: 'cover',
            withoutEnlargement: true
          })
          .toFormat('jpeg', getSharpOptions('jpeg', true))
          .toFile(thumbnailPath);

        imageWidth = fullInfo.width || null;
        imageHeight = fullInfo.height || null;
        req.file.size = fs.statSync(req.file.path).size;
      } catch (imageError) {
        console.error('Error converting HEIC/HEIF:', imageError);
        thumbnailFileName = null;
        thumbnailPath = null;
      }
    }

    const file = new File({
      fileName: req.file.filename,
      originalName: req.file.originalname,
      filePath: req.file.path,
      mimeType: req.file.mimetype || 'application/octet-stream',
      fileSize: req.file.size,
      uploadedBy: req.user._id,
      thumbnailPath,
      thumbnailFileName,
      width: imageWidth,
      height: imageHeight
    });

    await file.save();
    console.log('File saved successfully:', file._id);

    res.json({
      id: file._id,
      fileName: file.fileName,
      originalName: file.originalName,
      url: `/uploads/${file.fileName}`,
      thumbnailUrl: thumbnailFileName ? `/uploads/${thumbnailFileName}` : undefined,
      mimeType: file.mimeType,
      fileSize: file.fileSize,
      width: imageWidth || undefined,
      height: imageHeight || undefined
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    
    // Clean up uploaded file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        console.error('Error deleting file:', unlinkError);
      }
    }

    // Return detailed error for debugging
    res.status(500).json({ 
      message: 'Server error',
      error: error.message || 'Unknown error'
    });
  }
});

// Get file
router.get('/:fileId', auth, async (req, res) => {
  try {
    const { fileId } = req.params;
    const file = await File.findById(fileId);

    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Check if file exists on disk
    if (!fs.existsSync(file.filePath)) {
      return res.status(404).json({ message: 'File not found on server' });
    }

    res.download(file.filePath, file.originalName);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

