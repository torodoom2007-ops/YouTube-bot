const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// ==========================================
// 1. הגדרות שרת והגדרות בוט
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
const db = {}; 
const DEV_ADMIN_ID = '8017590244';

// אימוג'ים סטנדרטיים שמפעילים אפקט מסך מלא ודאי בטלגרם כשנשלחים לבד
const FULLSCREEN_EMOJIS = ['🎉', '🎆', '🎈', '🥳', '🎊', '🎇'];

// מודל הדרגות המהיר (Fast-Track) לפי בקשתך
const LEVELS = [
    { threshold: 0,   id: 0, title: "🎟️ צופה מן השורה", reward: "טקסט בלבד", credits: 0 },
    { threshold: 3,   id: 1, title: "🎬 חובב קולנוע", reward: "מדבקות וגיפים", credits: 0 },
    { threshold: 7,   id: 2, title: "🗣️ מבקר סרטים", reward: "קוליות ווידאו עגול", credits: 0 },
    { threshold: 10,  id: 3, title: "📽️ מקרן זהב", reward: "+2 ⚡ לפרסום", credits: 2 },
    { threshold: 30,  id: 4, title: "🎭 במאי הקהילה", reward: "סקרים + 2 ⚡", credits: 2 },
    { threshold: 70,  id: 5, title: "🌟 מפיק ראשי", reward: "נעיצה + 2 ⚡", credits: 2 }
];

// ==========================================
// 3. פונקציות עזר: ניהול משתמשים ובדיקת אדמינים
// ==========================================
function initChatAndUser(chatId, userId, firstName) {
    if (!db[chatId]) db[chatId] = { users: {}, customPromo: null };
    if (!db[chatId].users[userId]) {
        db[chatId].users[userId] = {
            firstName: firstName || "משתמש",
            messages: 0,
            level: 0,
            credits: 0
        };
    } else if (firstName) {
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
        can_send_documents: false,
        can_send_photos: false,
        can_send_videos: false,
        can_add_web_page_previews: false
    };

    if (levelId >= 1) permissions.can_send_other_messages = true;
    if (levelId >= 2) {
        permissions.can_send_voice_notes = true;
        permissions.can_send_video_notes = true;
    }
    if (levelId >= 4) permissions.can_send_polls = true;
    if (levelId >= 5) {
        permissions.can_pin_messages = true;
        permissions.can_invite_users = true;
    }

    try {
        await bot.restrictChatMember(chatId, userId, permissions);
    } catch (err) {
        console.log(`Failed to update permissions for ${userId}`);
    }
}

// ==========================================
// 5. חגיגות והודעות זמניות (עם הגנת קריסות)
// ==========================================
async function triggerCelebration(chatId, userId, firstName, newLevelObj) {
    let rewardText = newLevelObj.credits > 0 
        ? `🎁 <b>בונוס קידום:</b> קיבלת ${newLevelObj.credits} ⚡ לשימוש במערכת!` 
        : `🔓 <b>הרשאות שנפתחו:</b> כעת באפשרותך לשלוח ${newLevelObj.reward}!`;

    let promoTemplate = db[chatId]?.customPromo || 
        `🎊 <b>ברכות {name}! קודמת לדרגת {title}</b> 🎊\n${rewardText}`;
    
    let finalMessage = promoTemplate
        .replace('{name}', `<a href="tg://user?id=${userId}">${firstName}</a>`)
        .replace('{title}', `<b>${newLevelObj.title}</b>`);

    finalMessage += `\n\n<span class="tg-spoiler">🌐 <a href="https://t.me/Movie_run_bot">צור קהילה חכמה משלך!</a></span>`;
    const randomEmoji = FULLSCREEN_EMOJIS[Math.floor(Math.random() * FULLSCREEN_EMOJIS.length)];

    try {
        const msgPromo = await bot.sendMessage(chatId, finalMessage, { parse_mode: 'HTML', disable_web_page_preview: true });
        const msgEmoji = await bot.sendMessage(chatId, randomEmoji);

        // מחיקה בטוחה אחרי 10 שניות
        setTimeout(() => {
            bot.deleteMessage(chatId, msgPromo.message_id).catch(() => {});
            bot.deleteMessage(chatId, msgEmoji.message_id).catch(() => {});
        }, 10000);
    } catch (err) {
        console.log("Error sending celebration:", err.message);
    }
}

// ==========================================
// 6. מעקב הודעות והגנת אנטי-ספאם
// ==========================================
bot.on('message', async (msg) => {
    if (!msg.from || msg.from.is_bot || msg.text?.startsWith('/')) return;
    if (msg.chat.type === 'private') return; // מטופל בפקודת start

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userProfile = initChatAndUser(chatId, userId, msg.from.first_name);

    // --- מערכת קישורים בטוחה ---
    const isTelegramLink = /(https?:\/\/)?(t\.me|telegram\.me)\/.+/i.test(msg.text || msg.caption || "");
    
    if (isTelegramLink) {
        const userIsAdmin = await isAdmin(chatId, userId);
        if (!userIsAdmin) {
            if (userProfile.credits >= 2) {
                userProfile.credits -= 2;
                try {
                    const alertMsg = await bot.sendMessage(chatId, `⚡ <a href="tg://user?id=${userId}">${userProfile.firstName}</a>, השתמשת ב-2 ⚡ לפרסום הקישור. (יתרה: ${userProfile.credits} ⚡)`, { parse_mode: 'HTML' });
                    setTimeout(() => bot.deleteMessage(chatId, alertMsg.message_id).catch(()=>{}), 5000);
                } catch(e) {}
            } else {
                try {
                    await bot.deleteMessage(chatId, msg.message_id);
                    const warnMsg = await bot.sendMessage(chatId, `🚫 <a href="tg://user?id=${userId}">${userProfile.firstName}</a>, אין לך מספיק קרדיטים (⚡) לפרסום קישורים.\nהתקדם בדרגות כדי לקבל קרדיטים!`, { parse_mode: 'HTML' });
                    setTimeout(() => bot.deleteMessage(chatId, warnMsg.message_id).catch(()=>{}), 7000);
                } catch (e) {}
                return; 
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
        userProfile.credits += unlockedLevelObj.credits;
        
        await applyPermissions(chatId, userId, newLevel);
        await triggerCelebration(chatId, userId, userProfile.firstName, unlockedLevelObj);
    }
});

// ==========================================
// 7. פקודות: Start, רשימות, פרופיל ומתנות
// ==========================================

// פקודת /start מרהיבה לפרטי ולקבוצות
bot.onText(/^\/start$/, async (msg) => {
    const chatId = msg.chat.id;
    if (msg.chat.type === 'private') {
        const welcomeTxt = `👋 <b>ברוך הבא למערכת הניהול החכמה!</b>\n\n` +
            `אני בוט שמנהל דרגות, הרשאות ואנטי-ספאם בצורה אוטומטית לקהילות טלגרם.\n\n` +
            `<b>איך מתחילים?</b>\n` +
            `1. הוסף אותי לקבוצה שלך.\n` +
            `2. תן לי הרשאות מנהל (למחוק הודעות ולהגביל משתמשים).\n` +
            `3. אני כבר אדאג לכל השאר!\n\n` +
            `<i>למדריך המלא ולקבוצת התמיכה: <a href="https://t.me/Movie_run_bot">לחץ כאן</a></i>`;
            
        bot.sendMessage(chatId, welcomeTxt, { 
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: {
                inline_keyboard: [[{ text: "➕ הוסף אותי לקבוצה שלך", url: `https://t.me/Movie_run_bot?startgroup=true` }]]
            }
        });
    }
});

// פקודת /ranks - הטבלה האמיתית (עם פינות מעוגלות מקודדות)
bot.onText(/^\/ranks$/, async (msg) => {
    // בניית טבלת Monospace יפהפייה עם פינות עגולות
    let table = `<pre>`;
    table += `╭────────────┬──────┬─────────╮\n`;
    table += `│   הדרגה    │ יעדים│   בונוס │\n`;
    table += `├────────────┼──────┼─────────┤\n`;
    table += `│ 🎟️ צופה    │ 3    │ הרשאות  │\n`;
    table += `│ 🎬 חובב    │ 7    │ הרשאות  │\n`;
    table += `│ 🗣️ מבקר    │ 10   │ הרשאות  │\n`;
    table += `│ 📽️ מקרן    │ 30   │ +2 ⚡    │\n`;
    table += `│ 🎭 במאי    │ 70   │ +2 ⚡    │\n`;
    table += `│ 🌟 מפיק    │ 100+ │ +2 ⚡    │\n`;
    table += `╰────────────┴──────┴─────────╯\n`;
    table += `</pre>`;

    const text = `🏆 <b>מערכת הדרגות הרשמית של הקבוצה</b> 🏆\n\n${table}\n(שימו לב: משתמשים חדשים מוגבלים בפרסום קישורים 🛡️)`;
    
    await bot.sendMessage(msg.chat.id, text, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [[{ text: "📌 לחץ כאן לבדיקת הסטטוס והקרדיטים שלך", callback_data: "check_tags" }]]
        }
    });
});

// פקודת /tags - הפרופיל האישי
bot.onText(/^\/tags$/, async (msg) => {
    const chatId = msg.chat.id;
    if (msg.chat.type === 'private') return;
    
    const userId = msg.from.id;
    const userProfile = initChatAndUser(chatId, userId, msg.from.first_name);
    
    const currentLvl = LEVELS[userProfile.level];
    const nextLvl = LEVELS[userProfile.level + 1];

    let txt = `👤 <b>הפרופיל של ${userProfile.firstName}</b>\n━━━━━━━━━━━━━━━━━━\n`;
    txt += `🎖️ דרגה נוכחית: <b>${currentLvl.title}</b>\n`;
    txt += `💬 הודעות שנשלחו: <b>${userProfile.messages}</b>\n`;
    txt += `⚡ קרדיטים לפרסום: <b>${userProfile.credits} ⚡</b>\n\n`;
    
    if (nextLvl) {
        txt += `🎯 <b>יעד הבא:</b> ${nextLvl.title} (עוד ${nextLvl.threshold - userProfile.messages} הודעות)`;
    } else {
        txt += `👑 הגעת לדרגה המקסימלית!`;
    }

    bot.sendMessage(chatId, txt, { parse_mode: 'HTML' });
});

// פקודת /gift [כמות] - מתנה עם אנימציה ומחיקה אוטומטית!
bot.onText(/^\/gift\s+(\d+)$/, async (msg, match) => {
    if (!msg.reply_to_message) return bot.sendMessage(msg.chat.id, "יש להגיב על הודעה של המשתמש כדי לתת לו מתנה.");
    
    const chatId = msg.chat.id;
    if (!(await isAdmin(chatId, msg.from.id))) return;
    
    const targetId = msg.reply_to_message.from.id;
    const targetName = msg.reply_to_message.from.first_name;
    const amount = parseInt(match[1]);

    const targetProfile = initChatAndUser(chatId, targetId, targetName);
    targetProfile.credits += amount;

    const giftMsg = `🎁 <b>הפתעה מיוחדת עבור <a href="tg://user?id=${targetId}">${targetName}</a>!</b> 🎁\nמנהלי הקבוצה העניקו לך מתנה של <b>${amount} ⚡</b> לפרסום קישורים!`;
    const randomEmoji = FULLSCREEN_EMOJIS[Math.floor(Math.random() * FULLSCREEN_EMOJIS.length)];

    try {
        const giftSent = await bot.sendMessage(chatId, giftMsg, { parse_mode: 'HTML' });
        const emojiSent = await bot.sendMessage(chatId, randomEmoji);

        // מוחק את הודעת המתנה והאפקט אחרי 15 שניות
        setTimeout(() => {
            bot.deleteMessage(chatId, giftSent.message_id).catch(()=>{});
            bot.deleteMessage(chatId, emojiSent.message_id).catch(()=>{});
        }, 15000);
    } catch (e) {}
});

// פקודת /set_promo לעיצוב אישי של ההודעה ע"י המנהל
bot.onText(/^\/set_promo\s+([\s\S]+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!(await isAdmin(chatId, msg.from.id))) return;
    
    if (!db[chatId]) db[chatId] = { users: {} };
    db[chatId].customPromo = match[1];
    
    bot.sendMessage(chatId, "✅ תבנית הודעת הקידום עודכנה בהצלחה!");
});

// כפתור אינליין "בדוק סטטוס" מהטבלה
bot.on('callback_query', async (query) => {
    if (query.data === 'check_tags') {
        const userId = query.from.id;
        const chatId = query.message.chat.id;
        const userProfile = initChatAndUser(chatId, userId, query.from.first_name);
        
        bot.answerCallbackQuery(query.id, {
            text: `הסטטוס שלך: ${LEVELS[userProfile.level].title} | ${userProfile.credits} ⚡ קרדיטים.`,
            show_alert: true
        }).catch(()=>{}); // הגנה מפני התיישנות כפתור
    }
});

console.log("Fast-Track Version Ready!");
