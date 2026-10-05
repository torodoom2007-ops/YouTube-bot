const { Telegraf } = require('telegraf');

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL; // Render מספקת את זה אוטומטית

if (!BOT_TOKEN) {
  console.error('ERROR: BOT_TOKEN is missing!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// לוגיקה בסיסית של הבוט
bot.start((ctx) => ctx.reply('שלום! הבוט מחובר ועובד ב-Render 🚀'));
bot.help((ctx) => ctx.reply('איך אפשר לעזור?'));

bot.on('text', (ctx) => {
  const userText = ctx.message.text;
  // לוגיקה מותאמת אישית
  ctx.reply(`קיבלתי: "${userText}"`);
});

// הגדרת הרצה: Webhook בשרת ענן, Polling בפיתוח מקומי
if (RENDER_EXTERNAL_URL) {
  const webhookPath = `/telegram-webhook/${BOT_TOKEN}`;
  const fullWebhookUrl = `${RENDER_EXTERNAL_URL}${webhookPath}`;

  bot.telegram.setWebhook(fullWebhookUrl).then(() => {
    console.log(`Webhook set to: ${fullWebhookUrl}`);
  });

  bot.startWebhook(webhookPath, null, PORT);
  console.log(`Server listening on port ${PORT}`);
} else {
  console.log('Running in local polling mode...');
  bot.launch();
}

// יציאה נקייה בעת הפסקה
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
