const { Client, LocalAuth } = require('whatsapp-web.js');
const { Telegraf } = require('telegraf');
const qrCodeImage = require('qrcode');

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID; // ה-ID של הצ'אט שלך בטלגרם

if (!BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('ERROR: BOT_TOKEN or TELEGRAM_CHAT_ID is missing!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// הגדרת וואטסאפ
const waClient = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox'] // חובה לריצה בשרתי ענן כמו Render
  }
});

// כשנדרשת סריקת QR - הקוד יוצר תמונה ושולח אותה ישירות אליך בטלגרם
waClient.on('qr', async (qr) => {
  console.log('נוצר קוד QR חדש, שולח לטלגרם...');
  try {
    const qrBuffer = await qrCodeImage.toBuffer(qr);
    await bot.telegram.sendPhoto(TELEGRAM_CHAT_ID, { source: qrBuffer }, {
      caption: '📲 **קוד QR לחיבור וואטסאפ ביזנס**\nפתח וואטסאפ > מכשירים מקושרים > קשר מכשיר וסרוק תמונה זו.'
    });
  } catch (err) {
    console.error('שגיאה ביצירת/שליחת קוד QR:', err);
  }
});

waClient.on('ready', () => {
  console.log('וואטסאפ ביזנס מחובר בהצלחה!');
  bot.telegram.sendMessage(TELEGRAM_CHAT_ID, '✅ וואטסאפ ביזנס מחובר בהצלחה!');
});

// לוגיקה: קבלת הודעה בוואטסאפ והעברה לטלגרם
waClient.on('message', async (msg) => {
  const contact = await msg.getContact();
  const senderName = contact.pushname || contact.number;
  const text = msg.body;

  const textToTelegram = `📱 *הודעת וואטסאפ חדשה*\n👤 *מאת:* ${senderName} (\`${contact.number}\`)\n💬 *תוכן:* ${text}`;

  await bot.telegram.sendMessage(TELEGRAM_CHAT_ID, textToTelegram, { parse_mode: 'Markdown' });
});

// לוגיקה: מענה מטלגרם בחזרה לוואטסאפ (פורמט: מספר:הודעה)
bot.on('text', async (ctx) => {
  if (ctx.chat.id.toString() !== TELEGRAM_CHAT_ID) return;

  const text = ctx.message.text;
  if (text.includes(':')) {
    const [targetNumber, ...msgParts] = text.split(':');
    const messageToSend = msgParts.join(':').trim();
    const formattedNumber = targetNumber.trim().replace('+', '').replace(/[^0-9]/g, '') + '@c.us';

    try {
      await waClient.sendMessage(formattedNumber, messageToSend);
      ctx.reply(`✅ ההודעה נשלחה לוואטסאפ של ${targetNumber}`);
    } catch (err) {
      ctx.reply(`❌ שגיאה בשליחה: ${err.message}`);
    }
  }
});

// הפעלת הבוט והוואטסאפ
bot.launch();
waClient.initialize();

// תמיכה בפורט של Render
const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Bot & WhatsApp Bridge is Running'));
app.listen(PORT, () => console.log(`Web server listening on port ${PORT}`));
