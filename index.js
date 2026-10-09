const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// ==========================================
// 1. הגדרות שרת (Render Keep-Alive) והגדרות בוט
// ==========================================
const token = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN_HERE';
const bot = new TelegramBot(token, { polling: true });

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Movie-run-bot Gamification is running!'));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// ==========================================
// 2. מסד נתונים פנימי וקבועים
// ==========================================
const db = {}; // מבנה: db[chatId].users[userId] = { messages, level, credits, firstName }
const DEV_ADMIN_ID = '8017590244'; // ה-ID שלך כמפתח (כוח על הכל)

const PREMIUM_EMOJIS = [
    '5461136335173598840', '5435933711893797296', '5458660222102945723',
    '5407064810040864883', '5409008750893734809', '5370900768796711127',
    '5370870691140737817', '5195100606250889609', '5431449001532594346'
];

// מודל הדרגות הדיפולטיבי (מנהלים יוכלו לערוך בהמשך)
const LEVELS = [
    { threshold: 0,   id: 0, title: "🎟️ צופה מן השורה", reward: "טקסט בלבד", credits: 0 },
    { threshold: 10,  id: 1, title: "🎬 חובב קולנוע", reward: "מדבקות וגיפים", credits: 0 },
    { threshold: 50,  id: 2, title: "🗣️ מבקר סרטים", reward: "הודעות קוליות ווידאו עגול", credits: 0 },
    { threshold: 150, id: 3, title: "📽️ מקרן זהב", reward: "+2 ⚡ לפרסום קישורים", credits: 2 },
    { threshold: 300, id: 4, title: "🎭 במאי הקהילה", reward: "סקרים + 2 ⚡", credits: 2 },
    { threshold: 500, id: 5, title: "🌟 מפיק ראשי", reward: "נעיצה + 2 ⚡", credits: 2 }
];

// ==========================================
// 3. פונקציות עזר: ניהול משתמשים ובדיקת אדמינים
// ==========================================
function initChatAndUser(chatId, userId, firstName) {
    if (!db[chatId]) db[chatId] = { users: {}, customPromo: null };
    if (!db[chatId].users[userId]) {
        db[chatId].users[userId] = {
            firstName: firstName,
            messages: 0,
            level: 0,
            credits: 0
        };
    } else {
        db[chatId].users[userId].firstName = firstName;
    }
    return db[chatId].users[userId];
}

async function isAdmin(chatId, userId) {
    if (userId.toString() === DEV_ADMIN_ID) return true;
    try {
        const admins = await bot.getChatAdministrators(chatId);
        return admins.some(admin => admin.user.id.toString() === userId.toString());
    } catch (e) {
        return false;
    }
}

// ==========================================
// 4. ניהול הרשאות אמיתיות (ללא קבצים/סרטים)
// ==========================================
async function applyPermissions(chatId, userId, levelId) {
    let permissions = {
        can_send_messages: true,
        can_send_documents: false, // חסימה מוחלטת לקבצים וסרטים
        can_send_photos: false,
        can_send_videos: false,
        can_add_web_page_previews: false // תמיד סגור (מנוהל דרך ה-⚡)
    };

    if (levelId >= 1) { // דרגה 1: סטיקרים וגיפים
        permissions.can_send_other_messages = true;
    }
    if (levelId >= 2) { // דרגה 2: קוליות ווידאו עגול (Notes)
        permissions.can_send_voice_notes = true;
        permissions.can_send_video_notes = true;
    }
    if (levelId >= 4) { // דרגה 4: סקרים
        permissions.can_send_polls = true;
    }
    if (levelId >= 5) { // דרגה 5: נעיצות והוספת חברים
        permissions.can_pin_messages = true;
        permissions.can_invite_users = true;
    }

    try {
        await bot.restrictChatMember(chatId, userId, permissions);
    } catch (err) {
        console.log(`Failed to update permissions for ${userId} (bot might lack admin rights).`);
    }
}

// ==========================================
// 5. לוגיקת החגיגות (עם Premium Emojis)
// ==========================================
async function triggerCelebration(chatId, userId, firstName, newLevelObj) {
    let rewardText = newLevelObj.credits > 0 
        ? `🎁 <b>בונוס קידום:</b> קיבלת ${newLevelObj.credits} ⚡ לשימוש במערכת!` 
        : `🔓 <b>הרשאות שנפתחו:</b> כעת באפשרותך לשלוח ${newLevelObj.reward}!`;

    // תבנית ברירת מחדל או תבנית מותאמת אישית של האדמין
    let promoTemplate = db[chatId]?.customPromo || 
        `🎊 <b>ברכות {name}! קודמת לדרגת {title}</b> 🎊\n${rewardText}`;
    
    // החלפת משתנים בטקסט
    let finalMessage = promoTemplate
        .replace('{name}', `<a href="tg://user?id=${userId}">${firstName}</a>`)
        .replace('{title}', `<b>${newLevelObj.title}</b>`);

    // תוספת הקרדיט בספוילר חובה
    finalMessage += `\n\n<span class="tg-spoiler">🌐 <a href="https://t.me/Movie_run_bot">רוצה מערכת דרגות והרשאות מתקדמת בקבוצה שלך? התחל כאן!</a></span>`;

    // בחירת אימוג'י פרימיום רנדומלי מהרשימה
    const randomEmojiId = PREMIUM_EMOJIS[Math.floor(Math.random() * PREMIUM_EMOJIS.length)];
    const emojiHtml = `<tg-emoji emoji-id="${randomEmojiId}">✨</tg-emoji>`;

    try {
        // שליחת ההודעה לקבוצה + אימוג'י בודד כדי להפעיל אנימציה
        const msgPromo = await bot.sendMessage(chatId, finalMessage, { parse_mode: 'HTML', disable_web_page_preview: true });
        const msgEmoji = await bot.sendMessage(chatId, emojiHtml, { parse_mode: 'HTML' });

        // מחיקה אוטומטית אחרי 10 שניות
        setTimeout(async () => {
            try {
                await bot.deleteMessage(chatId, msgPromo.message_id);
                await bot.deleteMessage(chatId, msgEmoji.message_id);
            } catch (e) {}
        }, 10000);
    } catch (err) {
        console.log("Error sending celebration:", err.message);
    }
}

// ==========================================
// 6. מעקב הודעות והגנת אנטי-ספאם (קישורים תמורת ⚡)
// ==========================================
bot.on('message', async (msg) => {
    if (!msg.from || msg.from.is_bot || msg.chat.type === 'private') return;
    if (msg.text && msg.text.startsWith('/')) return; // התעלמות מפקודות

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userProfile = initChatAndUser(chatId, userId, msg.from.first_name);

    // --- מערכת אנטי-ספאם וקרדיטים (לקישורי טלגרם) ---
    const isTelegramLink = /(https?:\/\/)?(t\.me|telegram\.me)\/.+/i.test(msg.text || msg.caption || "");
    
    if (isTelegramLink) {
        const userIsAdmin = await isAdmin(chatId, userId);
        if (!userIsAdmin) {
            if (userProfile.credits >= 2) {
                userProfile.credits -= 2; // הורדת קרדיטים
                const alertMsg = await bot.sendMessage(chatId, `⚡ <a href="tg://user?id=${userId}">${userProfile.firstName}</a>, השתמשת ב-2 ⚡ כדי לפרסם קישור. (יתרה: ${userProfile.credits} ⚡)`, { parse_mode: 'HTML' });
                setTimeout(() => bot.deleteMessage(chatId, alertMsg.message_id).catch(()=>console.log("no msge")), 5000);
            } else {
                // אין קרדיטים - מחיקת ההודעה ואזהרה
                try {
                    await bot.deleteMessage(chatId, msg.message_id);
                    const warnMsg = await bot.sendMessage(chatId, `🚫 <a href="tg://user?id=${userId}">${userProfile.firstName}</a>, אין לך מספיק קרדיטים (⚡) לפרסום קישורים לערוצים אחרים.\nהתקדם בדרגות או בקש ממנהל!`, { parse_mode: 'HTML' });
                    setTimeout(() => bot.deleteMessage(chatId, warnMsg.message_id).catch(()=>console.log("no msg")), 7000);
                } catch (e) {
                    console.log("Missing delete permissions");
                }
                return; // עוצר פה, ההודעה נמחקה ולא נספרת כמובן
            }
        }
    }

    // --- עדכון הודעות ובדיקת עליית רמה ---
    userProfile.messages += 1;
    let newLevel = userProfile.level;

    for (let i = LEVELS.length - 1; i >= 0; i--) {
        if (userProfile.messages >= LEVELS[i].threshold) {
            newLevel = i;
            break;
        }
    }

    if (newLevel > userProfile.level) {
        const unlockedLevelObj = LEVELS[newLevel];
        userProfile.level = newLevel;
        userProfile.credits += unlockedLevelObj.credits; // הענקת בונוס
        
        await applyPermissions(chatId, userId, newLevel);
        await triggerCelebration(chatId, userId, userProfile.firstName, unlockedLevelObj);
    }
});

// ==========================================
// 7. פקודות: טבלת הדרגות המקצועית, פרופיל, מתנות ועיצוב
// ==========================================

// פקודת /ranks - הצגת טבלה באמצעות Inline Keyboard
bot.onText(/^\/ranks$/, async (msg) => {
    const inlineKeyboard = LEVELS.map(lvl => [
        { text: lvl.title, callback_data: "ignore" },
        { text: `💬 ${lvl.threshold}`, callback_data: "ignore" },
        { text: `🎁 ${lvl.reward}`, callback_data: "ignore" }
    ]);
    
    // הוספת כותרת לטבלה וכפתור תחתון
    inlineKeyboard.unshift([{ text: "🎖️ דרגה", callback_data: "ignore" }, { text: "💬 יעדים", callback_data: "ignore" }, { text: "🔓 הרשאה/פרס", callback_data: "ignore" }]);
    inlineKeyboard.push([{ text: "📌 לבירור הסטטוס והקרדיטים שלכם לחצו כאן (/tags)", callback_data: "check_tags" }]);

    const text = `🏆 <b>מערכת הדרגות הרשמית של הקבוצה</b> 🏆\n<i>תהיו פעילים, תפתחו דרגות, וקבלו הרשאות!</i>\n\n(שימו לב: שליחת סרטים וקבצים חסומה לחלוטין מטעמי אבטחה 🛡️)`;
    
    await bot.sendMessage(msg.chat.id, text, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: inlineKeyboard }
    });
});

// פקודת /tags - הפרופיל האישי
bot.onText(/^\/tags$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userProfile = initChatAndUser(chatId, userId, msg.from.first_name);
    
    const currentLvl = LEVELS[userProfile.level];
    const nextLvl = LEVELS[userProfile.level + 1];

    let txt = `👤 <b>הפרופיל של ${userProfile.firstName}</b>\n━━━━━━━━━━━━━━━━━━\n`;
    txt += `🎖️ דרגה נוכחית: <b>${currentLvl.title}</b>\n`;
    txt += `💬 הודעות שנשלחו: <b>${userProfile.messages}</b>\n`;
    txt += `⚡ קרדיטים לפרסום: <b>${userProfile.credits} ⚡</b>\n\n`;
    
    if (nextLvl) {
        txt += `🎯 <b>יעד הבא:</b> ${nextLvl.title} (עוד ${nextLvl.threshold - userProfile.messages} הודעות)\n`;
        txt += `🎁 <b>תגמול הבא:</b> ${nextLvl.reward}`;
    } else {
        txt += `👑 הגעת לדרגה המקסימלית!`;
    }

    bot.sendMessage(chatId, txt, { parse_mode: 'HTML' });
});

// פקודת /gift [כמות] - מתנה גמישה למשתמשים (לאדמינים בלבד)
bot.onText(/^\/gift\s+(\d+)$/, async (msg, match) => {
    if (!msg.reply_to_message) return bot.sendMessage(msg.chat.id, "יש להגיב על הודעה של המשתמש כדי לתת לו מתנה.");
    
    const chatId = msg.chat.id;
    if (!(await isAdmin(chatId, msg.from.id))) return; // רק מנהלים
    
    const targetId = msg.reply_to_message.from.id;
    const targetName = msg.reply_to_message.from.first_name;
    const amount = parseInt(match[1]);

    const targetProfile = initChatAndUser(chatId, targetId, targetName);
    targetProfile.credits += amount;

    const giftMsg = `🎁 <b>הפתעה מיוחדת עבור <a href="tg://user?id=${targetId}">${targetName}</a>!</b> 🎁\nמנהלי הקבוצה העניקו לך מתנה אקסקלוסיבית של <b>${amount} ⚡</b>\n\n<i>קרדיטים אלו משמשים כמטבע לפרסום קישורים ופעולות מתקדמות!</i>`;
    
    bot.sendMessage(chatId, giftMsg, { parse_mode: 'HTML' });
});

// פקודת /set_promo [טקסט] - עיצוב אישי של הודעת הקידום (לאדמינים)
bot.onText(/^\/set_promo\s+([\s\S]+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!(await isAdmin(chatId, msg.from.id))) return;
    
    // מאפשר לאדמין לקבוע את התבנית
    if (!db[chatId]) db[chatId] = { users: {} };
    db[chatId].customPromo = match[1];
    
    bot.sendMessage(chatId, "✅ תבנית הודעת הקידום עודכנה בהצלחה עבור קבוצה זו.\n(ודא שהשתמשת בפרמטרים {name} ו-{title})");
});

// לחיצה על כפתור בדיקת סטטוס מהטבלה
bot.on('callback_query', async (query) => {
    if (query.data === 'check_tags') {
        const userId = query.from.id;
        const chatId = query.message.chat.id;
        const userProfile = initChatAndUser(chatId, userId, query.from.first_name);
        
        bot.answerCallbackQuery(query.id, {
            text: `הסטטוס שלך: ${LEVELS[userProfile.level].title} | ${userProfile.credits} ⚡ קרדיטים.`,
            show_alert: true
        });
    } else {
        bot.answerCallbackQuery(query.id); // משתיק לחיצות על משבצות רגילות
    }
});

console.log("Bot Gamification & Anti-Spam is ready!");
