const express = require('express');
const { Telegraf } = require('telegraf');
const { google } = require('googleapis');
const axios = require('axios');
require('dotenv').config();

// 1. שרת Express לשמירה על ה-Web Service פעיל ב-Render
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('🤖 Telegram to YouTube Bot is running!');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// 2. הגדרת YouTube OAuth2 Client
const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  'https://developers.google.com/oauthplayground'
);

oauth2Client.setCredentials({
  refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
});

const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

// 3. הגדרת הבוט בטלגרם
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

bot.start((ctx) => {
  ctx.reply('שלום! שלח לי סרטון וידאו (עם תיאור/כותרת כטקסט נלווה) ואעלה אותו ישר לערוץ היוטיוב.');
});

bot.on('video', async (ctx) => {
  const video = ctx.message.video;
  const caption = ctx.message.caption || `וידאו מטלגרם - ${new Date().toLocaleDateString('he-IL')}`;

  ctx.reply('⏳ הוידאו התקבל! מוריד מטלגרם ומעלה ליוטיוב...');

  try {
    // קבלת קישור להורדת הקובץ משרתי טלגרם
    const fileLink = await ctx.telegram.getFileLink(video.file_id);

    // הזרמת הקובץ ישירות מטלגרם (Stream)
    const videoStream = await axios({
      method: 'get',
      url: fileLink.href,
      responseType: 'stream',
    });

    // העלאה ליוטיוב
    const response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: caption,
          description: 'הועלה אוטומטית באמצעות הבוט בטלגרם',
        },
        status: {
          privacyStatus: process.env.YOUTUBE_PRIVACY_STATUS || 'unlisted', // 'public', 'private', או 'unlisted'
        },
      },
      media: {
        body: videoStream.data,
      },
    });

    const videoId = response.data.id;
    const youtubeUrl = `https://youtu.be/${videoId}`;

    ctx.reply(`✅ הסרטון הועלה בהצלחה!\n🔗 ${youtubeUrl}`);
  } catch (error) {
    console.error('Upload Error:', error?.response?.data || error.message);
    ctx.reply('❌ אירעה שגיאה בהעלאת הסרטון ליוטיוב. ודא שהקובץ אינו עולה על 20MB.');
  }
});

bot.launch();

// יציאה מסודרת במקרה של ניתוק
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
