const mongoose = require('mongoose');

const callHistorySchema = new mongoose.Schema({
  chat: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: true
  },
  caller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  callType: {
    type: String,
    enum: ['voice', 'video'],
    required: true
  },
  status: {
    type: String,
    enum: ['missed', 'answered', 'declined', 'cancelled'],
    required: true
  },
  duration: {
    type: Number, // in seconds
    default: 0
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
  endedAt: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for faster queries
callHistorySchema.index({ chat: 1, createdAt: -1 });
callHistorySchema.index({ caller: 1, createdAt: -1 });
callHistorySchema.index({ receiver: 1, createdAt: -1 });

module.exports = mongoose.model('CallHistory', callHistorySchema);

