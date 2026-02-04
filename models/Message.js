const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  chat: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    default: ''
  },
  encryption: {
    alg: String,
    iv: String,
    tag: String,
    version: Number,
  },
  type: {
    type: String,
    enum: ['text', 'file', 'image', 'audio', 'video', 'call'],
    default: 'text'
  },
  file: {
    url: String,
    fileName: String,
    fileSize: Number,
    mimeType: String,
    thumbnailUrl: String,
    width: Number,
    height: Number,
    duration: Number, // For audio/video files
    batchId: String,
  },
  callHistory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CallHistory',
    default: null,
  },
  readBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    readAt: {
      type: Date,
      default: Date.now
    }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

messageSchema.index({ chat: 1, createdAt: -1 });
messageSchema.index({ chat: 1, _id: 1 });

module.exports = mongoose.model('Message', messageSchema);

