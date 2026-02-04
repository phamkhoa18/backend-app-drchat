const mongoose = require('mongoose');
const crypto = require('crypto');

const chatSchema = new mongoose.Schema({
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  isGroup: {
    type: Boolean,
    default: false
  },
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group',
    default: null
  },
  encryptionKey: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

chatSchema.index({ participants: 1 });

chatSchema.pre('save', function (next) {
  if (!this.encryptionKey) {
    this.encryptionKey = crypto.randomBytes(32).toString('base64');
  }
  next();
});

module.exports = mongoose.model('Chat', chatSchema);

