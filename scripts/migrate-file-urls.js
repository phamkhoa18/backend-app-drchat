#!/usr/bin/env node

/**
 * Migration script to convert full URLs to relative paths in messages
 * 
 * This script updates all messages in the database that have full URLs
 * (like http://172.20.10.3:3000/uploads/file.jpg) to relative paths
 * (like /uploads/file.jpg)
 * 
 * Usage: node scripts/migrate-file-urls.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Message = require('../models/Message');

// Helper function to normalize file URL to relative path
function normalizeFileUrl(url) {
  if (!url) return url;
  
  // If it's already a relative path, return as is
  if (url.startsWith('/')) {
    return url;
  }
  
  // If it's a full URL, extract the path
  try {
    const urlObj = new URL(url);
    return urlObj.pathname;
  } catch (e) {
    // If URL parsing fails, try to extract path manually
    const match = url.match(/\/uploads\/[^?#]+/);
    if (match) {
      return match[0];
    }
    // Fallback: return as is if we can't parse it
    return url;
  }
}

async function migrateFileUrls() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatlocal';
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB');

    // Find all messages with file URLs that are full URLs
    console.log('\n🔍 Finding messages with full URLs...');
    const messages = await Message.find({
      'file.url': { $exists: true, $ne: null }
    });

    console.log(`Found ${messages.length} messages with file URLs`);

    let updatedCount = 0;
    let skippedCount = 0;

    // Process each message
    for (const message of messages) {
      const originalUrl = message.file.url;
      
      // Skip if already a relative path
      if (originalUrl.startsWith('/')) {
        skippedCount++;
        continue;
      }

      // Normalize the URL
      const normalizedUrl = normalizeFileUrl(originalUrl);
      
      // Only update if URL changed
      if (normalizedUrl !== originalUrl) {
        message.file.url = normalizedUrl;
        await message.save();
        updatedCount++;
        console.log(`  ✓ Updated: ${originalUrl} → ${normalizedUrl}`);
      } else {
        skippedCount++;
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`  Total messages with files: ${messages.length}`);
    console.log(`  Updated: ${updatedCount}`);
    console.log(`  Skipped (already relative): ${skippedCount}`);
    console.log('\n✅ Migration completed successfully!');

  } catch (error) {
    console.error('❌ Error during migration:', error);
    process.exit(1);
  } finally {
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run migration
migrateFileUrls();

