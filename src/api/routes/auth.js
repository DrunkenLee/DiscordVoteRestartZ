import express from 'express';
import {
  exchangeDiscordOAuthCode,
  getDiscordOAuthUrl,
  login,
  me,
  register,
  registerWithDiscordOAuthCode,
} from '../../Controllers/zmusers.controller.js';

const router = express.Router();

router.post('/login', login);
router.post('/register', register);
router.get('/me', me);
router.get('/discord/url', getDiscordOAuthUrl);
router.post('/discord/exchange', exchangeDiscordOAuthCode);
router.post('/discord/register', registerWithDiscordOAuthCode);

export default router;
