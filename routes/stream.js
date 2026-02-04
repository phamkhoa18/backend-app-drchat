const express = require('express');
const jwt = require('jsonwebtoken');
const { auth } = require('../middleware/auth');

const router = express.Router();

const getStreamConfig = () => {
  const apiKey = process.env.STREAM_API_KEY;
  const apiSecret = process.env.STREAM_API_SECRET;

  if (!apiKey || !apiSecret) {
    return { apiKey: apiKey || null, apiSecret: apiSecret || null };
  }

  return { apiKey, apiSecret };
};

const createStreamToken = (userId, apiKey, apiSecret) => {
  return jwt.sign(
    {
      user_id: userId,
      apiKey,
    },
    apiSecret,
    {
      algorithm: 'HS256',
      expiresIn: '24h',
      subject: `user/${userId}`,
    }
  );
};

router.get('/token', auth, (req, res) => {
  const streamConfig = getStreamConfig();
  if (!streamConfig.apiKey || !streamConfig.apiSecret) {
    console.error('❌ Stream configuration missing', {
      hasApiKey: !!streamConfig.apiKey,
      hasApiSecret: !!streamConfig.apiSecret,
    });
    return res.status(500).json({
      message: 'Stream configuration is missing',
      hasApiKey: !!streamConfig.apiKey,
      hasApiSecret: !!streamConfig.apiSecret,
    });
  }

  const userId = req.user?._id?.toString();
  if (!userId) {
    return res.status(400).json({ message: 'Invalid user' });
  }

  const token = createStreamToken(userId, streamConfig.apiKey, streamConfig.apiSecret);
  return res.json({
    apiKey: streamConfig.apiKey,
    userId,
    token,
    expiresIn: 24 * 60 * 60,
  });
});

module.exports = router;
