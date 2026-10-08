const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// ==========================================
// 1. הגדרות ושרת Express עבור Render
// ==========================================
// הכנס את הטוקן שלך או השתמש במשתני סביבה (Environment Variables)
const token = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN_HERE';
const bot = new TelegramBot(token, { polling: true });

// שרת Express מינימלי כדי ש-Render לא יכבה את הבוט בטענה שהפורט לא מאזין
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Movie-ask-bot is running!'));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// מזהה סטיקר לחגיגות (החלף ב-file_id אמיתי של סטיקר מהבוט שלך)
const CELEBRATION_STICKER_ID = 'CAACAgIAAxkBAAE...'; // <- שים פה ID אמיתי

// ==========================================
// 2. מסד נתונים בזיכרון (In-Memory) ומסלולי קידום
// ==========================================
// מאגר נתונים בזיכרון (מוגן מפני דליפות בעזרת ניקוי מחזורי)
const db = {}; 

// 30 רמות בסך הכל (10 לכל מסלול)
const TRACKS = {
    hourly: [
        { threshold: 3, title: "חבר קבוצה 🎖️" },
        { threshold: 5, title: "פטפטן מתחיל 💬" },
        { threshold: 8, title: "מכונת כתיבה ⌨️" },
        { threshold: 10, title: "User Friendly 🤝" },
        { threshold: 15, title: "שולט בקצב 🚀" },
        { threshold: 20, title: "על הסטרואידים 💉" },
        { threshold: 30, title: "בלתי ניתן לעצירה 🌪️" },
        { threshold: 45, title: "סערת טקסט 🌩️" },
        { threshold: 60, title: "אצבעות קסם ✨" },
        { threshold: 80, title: "הייפר-אקטיבי 🔋" }
    ],
    lifetime: [
        { threshold: 2, title: "צעד ראשון 👣" },
        { threshold: 5, title: "נוכח בשטח 👀" },
        { threshold: 10, title: "משפיע עדין 🍃" },
        { threshold: 15, title: "Dynamic User ⚡" },
        { threshold: 25, title: "קול בולט 🗣️" },
        { threshold: 50, title: "עמוד התווך 🏛️" },
        { threshold: 100, title: "אגדה מקומית 🏆" },
        { threshold: 250, title: "אייקון הקבוצה 🌟" },
        { threshold: 500, title: "מנהיג עליון 👑" },
        { threshold: 1000, title: "הבעלים הלא רשמי 🔮" }
    ],
    replies: [
        { threshold: 2, title: "מקשיב קשוב 👂" },
        { threshold: 5, title: "מגיב לעניין ✍️" },
        { threshold: 10, title: "משתתף פעיל 🙋" },
        { threshold: 20, title: "סוציאליסט מדופלם 🎩" },
        { threshold: 35, title: "איש שיחה 🗣️" },
        { threshold: 50, title: "חבר אמת 🫂" },
        { threshold: 75, title: "פסיכולוג הקבוצה 🛋️" },
        { threshold: 100, title: "לב זהב 💛" },
        { threshold: 150, title: "מחבר אנשים 🔗" },
        { threshold: 200, title: "הנשמה של הקבוצה ✨" }
    ]
};

// ==========================================
// 3. פונקציות עזר וניהול זיכרון (Garbage Collection)
// ==========================================
// אתחול משתמש במידה ולא קיים במערכת
function initUser(userId, firstName) {
    if (!db[userId]) {
        db[userId] = {
            firstName: firstName,
            totalMessages: 0,
            replies: 0,
            hourlyTimestamps: [],
            // שומר את האינדקס של הרמה הגבוהה ביותר שהמשתמש הגיע אליה כדי למנוע ספאם
            unlocked: { hourly: -1, lifetime: -1, replies: -1 }
        };
    } else {
        db[userId].firstName = firstName; // עדכון השם במקרה שהשתנה
    }
    return db[userId];
}

// ניקוי הודעות שנשלחו לפני יותר משעה (3,600,000 אלפיות השנייה)
function pruneHourlyTimestamps(user) {
    const oneHourAgo = Date.now() - 3600000;
    user.hourlyTimestamps = user.hourlyTimestamps.filter(ts => ts > oneHourAgo);
}

// ניקוי זיכרון גלובלי: רץ כל 15 דקות ומנקה מערכים של משתמשים לא פעילים
setInterval(() => {
    Object.values(db).forEach(user => pruneHourlyTimestamps(user));
}, 15 * 60 * 1000);

// ==========================================
// 4. לוגיקת חגיגות ומחיקה אוטומטית
// ==========================================
async function triggerCelebration(groupChatId, userId, firstName, newRank, trackType) {
    const trackNames = {
        hourly: "קצב שעתי",
        lifetime: "הודעות מצטברות",
        replies: "תגובות ומעורבות חברתית"
    };

    const celebrationText = `🎉 <b>כל הכבוד <a href="tg://user?id=${userId}">${firstName}</a>!</b> 🎉\n\nהגעת להישג חדש במסלול <b>${trackNames[trackType]}</b> והרווחת את התואר:\n🏆 <b>${newRank}</b> 🏆`;

    try {
        // שליחת הודעה קבוצתית וסטיקר
        const groupMsg = await bot.sendMessage(groupChatId, celebrationText, { parse_mode: 'HTML' });
        
        let stickerMsg;
        try {
            stickerMsg = await bot.sendSticker(groupChatId, CELEBRATION_STICKER_ID);
        } catch (e) {
            console.log("לא ניתן לשלוח סטיקר (אולי ה-ID לא תקין).");
        }

        // טיימר להשמדה עצמית (30 שניות) בקבוצה
        setTimeout(async () => {
            try {
                await bot.deleteMessage(groupChatId, groupMsg.message_id);
                if (stickerMsg) {
                    await bot.deleteMessage(groupChatId, stickerMsg.message_id);
                }
            } catch (err) {
                console.error("שגיאה במחיקת הודעת חגיגה בקבוצה:", err.message);
            }
        }, 30000);

        // שליחת הודעה פרטית לתמיד
        try {
            await bot.sendMessage(userId, `היי ${firstName}! מזל טוב!\nהרווחת את התואר <b>${newRank}</b> במסלול ${trackNames[trackType]} בקבוצה! 🏅\nהמשך כך!`, { parse_mode: 'HTML' });
        } catch (err) {
            console.log(`לא ניתן לשלוח הודעה פרטית ל-${firstName}. כנראה לא התחיל שיחה עם הבוט מעולם.`);
        }

    } catch (err) {
        console.error("שגיאה בתהליך החגיגה:", err.message);
    }
}

async function checkMilestonesAndCelebrate(chatId, userId, userProfile) {
    const hourlyCount = userProfile.hourlyTimestamps.length;
    const lifetimeCount = userProfile.totalMessages;
    const replyCount = userProfile.replies;

    const checkTrack = async (trackName, currentValue, trackArray) => {
        let newHighestTierIndex = -1;
        // מוצא את הרמה הגבוהה ביותר שהמשתמש זכאי לה כרגע
        for (let i = 0; i < trackArray.length; i++) {
            if (currentValue >= trackArray[i].threshold) {
                newHighestTierIndex = i;
            }
        }

        // אם המשתמש פתח רמה חדשה שהוא עדיין לא ראה
        if (newHighestTierIndex > userProfile.unlocked[trackName]) {
            const newRank = trackArray[newHighestTierIndex].title;
            userProfile.unlocked[trackName] = newHighestTierIndex;
            await triggerCelebration(chatId, userId, userProfile.firstName, newRank, trackName);
        }
    };

    await checkTrack('hourly', hourlyCount, TRACKS.hourly);
    await checkTrack('lifetime', lifetimeCount, TRACKS.lifetime);
    await checkTrack('replies', replyCount, TRACKS.replies);
}

// ==========================================
// 5. האזנה להודעות ומעקב (Background Tracking)
// ==========================================
bot.on('message', async (msg) => {
    // נתעלם מהודעות שלא מכילות טקסט משמעותי או פקודות של הבוט עצמו (כמו /tags)
    if (!msg.from || msg.from.is_bot) return;
    if (msg.text && msg.text.startsWith('/')) return; // הטיפול בפקודות מתבצע בנפרד
    if (msg.chat.type === 'private') return; // מעקב רק בקבוצות

    const userId = msg.from.id;
    const firstName = msg.from.first_name || 'משתמש';
    const userProfile = initUser(userId, firstName);

    // עדכון מונים (Counters)
    userProfile.totalMessages += 1;
    userProfile.hourlyTimestamps.push(Date.now());
    
    // אם זו תגובה להודעה של משתמש אחר (לא בוט ולא עצמו)
    if (msg.reply_to_message && !msg.reply_to_message.from.is_bot && msg.reply_to_message.from.id !== userId) {
        userProfile.replies += 1;
    }

    // ניקוי חותמות זמן ישנות עבור משתמש זה לפני בדיקת הישגים
    pruneHourlyTimestamps(userProfile);

    // בדיקת הישגים והפעלת חגיגה אם צריך
    await checkMilestonesAndCelebrate(msg.chat.id, userId, userProfile);
});

// ==========================================
// 6. פקודת פרופיל /tags
// ==========================================
bot.onText(/^\/tags$/, async (msg) => {
    const userId = msg.from.id;
    const firstName = msg.from.first_name || 'משתמש';
    const chatId = msg.chat.id;

    // במידה והמשתמש מבקש פרופיל אבל עדיין לא רשום במערכת
    if (!db[userId]) {
        initUser(userId, firstName);
    }

    const profile = db[userId];
    pruneHourlyTimestamps(profile); // עדכון חלון השעה הנוכחי

    const hourlyCount = profile.hourlyTimestamps.length;
    const lifetimeCount = profile.totalMessages;
    const replyCount = profile.replies;

    // פונקציית עזר להוצאת הסטטוס הנוכחי והיעד הבא לכל מסלול
    const getTrackStatus = (trackName, currentVal, trackArray) => {
        const unlockedIndex = profile.unlocked[trackName];
        const currentTitle = unlockedIndex >= 0 ? trackArray[unlockedIndex].title : "טרם הושג 🥚";
        
        const nextTier = unlockedIndex + 1 < trackArray.length ? trackArray[unlockedIndex + 1] : null;
        const toNext = nextTier ? (nextTier.threshold - currentVal) : 0;
        
        return { currentTitle, toNext, nextTierTitle: nextTier ? nextTier.title : "הגעת למקסימום!" };
    };

    const hStatus = getTrackStatus('hourly', hourlyCount, TRACKS.hourly);
    const lStatus = getTrackStatus('lifetime', lifetimeCount, TRACKS.lifetime);
    const rStatus = getTrackStatus('replies', replyCount, TRACKS.replies);

    // בניית ההודעה המסוכמת
    let tagsMessage = `👤 <b>הפרופיל של ${firstName}</b>\n`;
    tagsMessage += `━━━━━━━━━━━━━━━━━━\n\n`;

    tagsMessage += `⏱️ <b>קצב שעתי:</b> ${hourlyCount} הודעות\n`;
    tagsMessage += `🎖️ תואר: <b>${hStatus.currentTitle}</b>\n`;
    if (hStatus.toNext > 0) tagsMessage += `<i>(עוד ${hStatus.toNext} הודעות ל-${hStatus.nextTierTitle})</i>\n\n`;

    tagsMessage += `📚 <b>הודעות מצטברות:</b> ${lifetimeCount} הודעות\n`;
    tagsMessage += `🎖️ תואר: <b>${lStatus.currentTitle}</b>\n`;
    if (lStatus.toNext > 0) tagsMessage += `<i>(עוד ${lStatus.toNext} הודעות ל-${lStatus.nextTierTitle})</i>\n\n`;

    tagsMessage += `🤝 <b>מעורבות ותגובות:</b> ${replyCount} תגובות\n`;
    tagsMessage += `🎖️ תואר: <b>${rStatus.currentTitle}</b>\n`;
    if (rStatus.toNext > 0) tagsMessage += `<i>(עוד ${rStatus.toNext} תגובות ל-${rStatus.nextTierTitle})</i>`;

    bot.sendMessage(chatId, tagsMessage, { parse_mode: 'HTML' });
});

console.log("Bot and Gamification system are running successfully...");
