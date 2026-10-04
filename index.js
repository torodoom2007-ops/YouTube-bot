const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

// ==========================================
// 1. טעינת משתני סביבה
// ==========================================
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const YOUTUBE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const YOUTUBE_REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN;

// מפתחות AI מופרדים בפסיק: "KEY1,KEY2,KEY3"
const AI_KEYS = (process.env.GEMINI_API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);

if (!TELEGRAM_TOKEN || !YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET || !YOUTUBE_REFRESH_TOKEN || AI_KEYS.length === 0) {
  console.error("❌ שגיאה: אחד או יותר ממשתני הסביבה חסרים!");
  process.exit(1);
}

// ==========================================
// 2. אתחול הבוט וה-APIs
// ==========================================
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// מנגנון רוטציית מפתחות AI
let currentKeyIndex = 0;

function getAIClient() {
  const apiKey = AI_KEYS[currentKeyIndex];
  return new GoogleGenAI({ apiKey });
}

function rotateAIKey() {
  currentKeyIndex = (currentKeyIndex + 1) % AI_KEYS.length;
  console.log(`🔄 מפתח AI הוחלף למפתח אינדקס: ${currentKeyIndex}`);
}

async function generateMetadataWithAI(promptText) {
  let attempts = 0;
  while (attempts < AI_KEYS.length) {
    try {
      const ai = getAIClient();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `אתה מומחה לשיווק סרטים ביוטיוב. קבל את הנושא/הכותרת הבאה: "${promptText}".
צור תגובה במבנה JSON מדויק בלבד ללא Markdown כדלקמן:
{
  "title": "כותרת מפתה ביוטיוב עם אימוג'ים (עד 90 תווים)",
  "description": "תיאור ארוך, מושך ומפורט של הסרטון עם קריאה לפעולה",
  "tags": ["תג1", "תג2", "תג3", "תג4", "תג5"]
}`
      });

      const cleanJsonText = response.text.replace(/```json|```/g, '').trim();
      return JSON.parse(cleanJsonText);
    } catch (err) {
      console.warn(`⚠️ שגיאה במפתח AI מס' ${currentKeyIndex}: ${err.message}. מנסה מפתח הבא...`);
      rotateAIKey();
      attempts++;
    }
  }
  throw new Error("❌ כל מפתחות ה-AI נכשלו או הגיעו למגבלת הקרדיטים.");
}

// אתחול YouTube OAuth2
const oauth2Client = new google.auth.OAuth2(
  YOUTUBE_CLIENT_ID,
  YOUTUBE_CLIENT_SECRET,
  'https://developers.google.com/oauthplayground'
);

oauth2Client.setCredentials({ refresh_token: YOUTUBE_REFRESH_TOKEN });
const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

// תור העלאות בזיכרון
const uploadQueue = [];

// ==========================================
// 3. טיפול בהודעות טלגרם
// ==========================================
console.log("🚀 Movie Auto-Publisher Bot is running...");

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  if (msg.text && msg.text.startsWith('/')) return;

  // בדיקה אם הועבר וידאו
  if (msg.video) {
    const fileId = msg.video.file_id;
    const caption = msg.caption || "סרטון חדש בעולם הסרטים";

    bot.sendMessage(chatId, "📥 הסרטון התקבל! מוריד ומעבד נתונים בעזרת AI...");

    try {
      // 1. הורדת קובץ הוידאו מטלגרם
      const filePath = await bot.downloadFile(fileId, './downloads');

      // 2. יצירת Metadata בעזרת AI (כותרת, תיאור, תגיות)
      const metadata = await generateMetadataWithAI(caption);

      // 3. הכנסה לתור
      uploadQueue.push({
        filePath,
        metadata,
        chatId
      });

      bot.sendMessage(
        chatId,
        `✅ **הסרטון נוסף לתור ההעלאות!**\n\n` +
        `🎬 **כותרת שנבחרה:** ${metadata.title}\n` +
        `📉 **מיקום בתור:** ${uploadQueue.length}`
      );
    } catch (error) {
      console.error("Error processing video:", error);
      bot.sendMessage(chatId, `❌ שגיאה בעיבוד הסרטון: ${error.message}`);
    }
  } else {
    bot.sendMessage(chatId, "🎥 אנא שלח קובץ וידאו (בצירוף כיתוב/נושא) כדי להעלות אותו ליוטיוב.");
  }
});

// ==========================================
// 4. מתזמן העלאה ליוטיוב (Cron Job)
// ==========================================
// מתוך מגבלות ה-API של יוטיוב (10,000 יחידות ביום), מומלץ להעלות אחת לכמה שעות (למשל כל 4 שעות).
cron.schedule('0 */4 * * *', async () => {
  if (uploadQueue.length === 0) return;

  const item = uploadQueue.shift();
  console.log(`🎬 מתחיל העלאה ליוטיוב: ${item.metadata.title}`);

  try {
    const res = await youtube.videos.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title: item.metadata.title,
          description: `${item.metadata.description}\n\n${item.metadata.tags.map(t => `#${t}`).join(' ')}`,
          tags: item.metadata.tags,
          categoryId: '24' // 24 = Entertainment / Movies
        },
        status: {
          privacyStatus: 'public', // ציבורי
          selfDeclaredMadeForKids: false
        }
      },
      media: {
        body: fs.createReadStream(item.filePath)
      }
    });

    bot.sendMessage(item.chatId, `🎉 **הסרטון הועלה בהצלחה ליוטיוב!**\n🔗 https://www.youtube.com/watch?v=${res.data.id}`);

    // ניקוי הקובץ המקומי
    if (fs.existsSync(item.filePath)) {
      fs.unlinkSync(item.filePath);
    }
  } catch (error) {
    console.error("YouTube Upload Error:", error);
    bot.sendMessage(item.chatId, `❌ שגיאה בהעלאה ליוטיוב: ${error.message}`);
  }
});
