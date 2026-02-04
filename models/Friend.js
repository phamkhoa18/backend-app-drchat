const mongoose = require('mongoose');

const friendSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  friendId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'blocked', 'declined'],
    default: 'pending'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Index to prevent duplicate friendships
friendSchema.index({ userId: 1, friendId: 1 }, { unique: true });

// Index for querying friends
friendSchema.index({ userId: 1, status: 1 });
friendSchema.index({ friendId: 1, status: 1 });

module.exports = mongoose.model('Friend', friendSchema);

