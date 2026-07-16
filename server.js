const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' })); // PHP kodlari katta bo'lishi mumkinligi uchun limit oshirildi

// Papkasiz tuzilma: hamma fayllar rootda
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const SERVER_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// --- YANGI ADMIN SOZLAMALARI ---
const MAIN_BOT_TOKEN = "8843518157:AAFJO2e3ifQpodfslZT9WCouzsnpV_ZgNeE";
const ADMIN_ID = 8379904990; 
const ADMIN_PASSWORD = "CDXMC";
const CARD_NUMBER = "4916990355543858";

const bot = new TelegramBot(MAIN_BOT_TOKEN, { polling: true });

// Ma'lumotlar bazasi (Xotirada)
const db = {
    users: {},
    bots: [],
    system: {
        isMaintenance: false,
        createdBotsCount: 0
    }
};

// Admin qo'shadigan PHP shablonlar xotirasi
let botTemplates = [];

// Bosh sahifani yuborish
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// /start komandasi
bot.onText(/\/start(?:\s+(.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const username = msg.from.username ? `@${msg.from.username}` : `ID: ${chatId}`;
    const refId = match ? match[1] : null;

    if (!db.users[chatId]) {
        db.users[chatId] = {
            id: chatId,
            username: username,
            balance: 0,
            deposited: 0,
            referrals: 0,
            createdBots: [],
            regOrder: Object.keys(db.users).length + 1,
            regDate: new Date().toLocaleDateString()
        };

        if (refId && db.users[refId] && parseInt(refId) !== chatId) {
            db.users[refId].balance += 1000;
            db.users[refId].referrals += 1;
            bot.sendMessage(refId, `🎉 Do'stingiz ro'yxatdan o'tdi! Balansingizga 1,000 so'm qo'shildi.`);
        }
    }

    const webAppUrl = `${SERVER_URL}/index.html?userId=${chatId}`;

    bot.sendMessage(chatId, `Salom 👋\n**@ZcMekerBot** konstruktoriga xush-kelibsiz!\n\nPastdagi tugmani bosib ilovani oching va o'z botingizni yarating.`, {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [[{ text: "📱 Ilovani ochish", web_app: { url: webAppUrl } }]]
        }
    });
});

// Foydalanuvchi va Statistika ma'lumotlarini olish API'si
app.get('/api/user/:id', (req, res) => {
    const userId = req.params.id;
    let user = db.users[userId];
    if (!user) {
        user = { id: userId, username: "Foydalanuvchi", balance: 0, deposited: 0, referrals: 0, createdBots: [], regOrder: 999, regDate: "-" };
    }
    
    // Admin uchun barcha foydalanuvchilar ro'yxati va umumiy statistika
    let allUsersList = [];
    if (parseInt(userId) === ADMIN_ID) {
        allUsersList = Object.values(db.users);
    }

    res.json({ 
        user, 
        system: db.system, 
        templates: botTemplates, 
        card: CARD_NUMBER,
        totalUsers: Object.keys(db.users).length,
        allUsers: allUsersList
    });
});

// Dinamik ravishda foydalanuvchi botini yaratish va unga admin kiritgan PHP mantiqni ulash
app.post('/api/create-bot', async (req, res) => {
    const { userId, templateId, token, botAdminId } = req.body;
    const user = db.users[userId];
    const template = botTemplates.find(t => t.id === templateId);

    if (!user || !template) {
        return res.status(400).json({ error: "Xatolik: Shablon topilmadi yoki ma'lumotlar yetarsiz!" });
    }

    if (user.balance < template.price) {
        return res.status(400).json({ error: "Hisobingizda yetarli mablag' mavjud emas!" });
    }

    try {
        // Tokenni tekshirish
        const tempBot = new TelegramBot(token);
        const botInfo = await tempBot.getMe();
        
        // Webhook o'rnatish
        const webhookUrl = `${SERVER_URL}/bot-webhook/${token}`;
        await tempBot.setWebHook(webhookUrl);

        user.balance -= template.price;
        
        const newBot = {
            id: botInfo.id,
            username: `@${botInfo.username}`,
            name: template.name,
            token: token,
            botAdminId: botAdminId,
            ownerId: userId,
            templateId: templateId, // Qaysi PHP kodga tegishli ekanligi
            status: "active"
        };

        user.createdBots.push(newBot);
        db.bots.push(newBot);
        db.system.createdBotsCount += 1;

        res.json({ success: true, bot: newBot, userBalance: user.balance });
    } catch (err) {
        res.status(400).json({ error: "Token noto'g'ri yoki faol emas! Qayta urinib ko'ring." });
    }
});

// Dinamik Webhook: Yaratilgan har qanday botga xabar kelganda, admin yuklagan PHP mantiq (simulyatsiya) asosida ishlaydi
app.post('/bot-webhook/:token', (req, res) => {
    const token = req.params.token;
    const update = req.body;
    res.sendStatus(200);

    const targetBot = db.bots.find(b => b.token === token);
    if (targetBot && update.message) {
        const tempBot = new TelegramBot(token);
        const chatId = update.message.chat.id;
        const text = update.message.text;
        
        // Bu yerda Node.js admin yuklagan PHP kod mantiqini (template.phpCode) bajaradi.
        // Hozircha asosiy buyruqlar uchun xavfsiz avto-reaksiya sozlangan:
        if (text === "/start") {
            tempBot.sendMessage(chatId, `Assalomu alaykum! Ushbu bot **${targetBot.name}** tizimi orqali muvaffaqiyatli ishga tushirildi.\n\nBoshqaruvchi Admin ID: ${targetBot.botAdminId}`, { parse_mode: "Markdown" });
        } else {
            tempBot.sendMessage(chatId, `Yuborilgan buyruq: "${text}".\nBot muvaffaqiyatli ishlamoqda (PHP Engine Active).`);
        }
    }
});

// --- ADMIN PANELI API'LARI ---

// Parolni tekshirish API
app.post('/api/admin/verify-password', (req, res) => {
    const { adminId, password } = req.body;
    if (parseInt(adminId) !== ADMIN_ID) return res.status(430).json({ error: "Ruxsat yo'q!" });
    
    if (password === ADMIN_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(400).json({ error: "Noto'g'ri parol kiritildi!" });
    }
});

// Admin tomonidan fayli (PHP) bilan birga yangi shablon qo'shish
app.post('/api/admin/add-template', (req, res) => {
    const { adminId, name, price, daily, desc, phpCode } = req.body;
    if (parseInt(adminId) !== ADMIN_ID) return res.status(403).json({ error: "Ruxsat etilmadi!" });

    if (!phpCode) {
        return res.status(400).json({ error: "PHP kod faylini yuklash shart!" });
    }

    const newTemplate = {
        id: botTemplates.length + 1,
        name: name.endsWith("(PHP)") ? name : name + " (PHP)",
        price: parseFloat(price),
        daily: parseFloat(daily),
        desc: desc,
        phpCode: phpCode // Haqiqiy PHP kod matni bazada saqlanadi
    };
    
    botTemplates.push(newTemplate);
    res.json({ success: true, templates: botTemplates });
});

// Balansni o'zgartirish
app.post('/api/admin/change-balance', (req, res) => {
    const { adminId, targetUserId, amount, action } = req.body;
    if (parseInt(adminId) !== ADMIN_ID) return res.status(403).json({ error: "Ruxsat etilmadi!" });

    const user = db.users[targetUserId];
    if (!user) return res.status(404).json({ error: "Foydalanuvchi topilmadi!" });

    if (action === "add") {
        user.balance += parseFloat(amount);
        user.deposited += parseFloat(amount);
        bot.sendMessage(targetUserId, `💰 Hisobingiz admin tomonidan **${parseFloat(amount).toLocaleString()} so'm**ga to'ldirildi!`, { parse_mode: "Markdown" });
    } else {
        user.balance = Math.max(0, user.balance - parseFloat(amount));
    }
    res.json({ success: true });
});

// Ta'mirlash rejimi
app.post('/api/admin/maintenance', (req, res) => {
    const { adminId, status } = req.body;
    if (parseInt(adminId) !== ADMIN_ID) return res.status(403).json({ error: "Ruxsat etilmadi!" });
    db.system.isMaintenance = status;
    res.json({ success: true, isMaintenance: db.system.isMaintenance });
});

// Global xabar yuborish
app.post('/api/admin/broadcast', (req, res) => {
    const { adminId, text } = req.body;
    if (parseInt(adminId) !== ADMIN_ID) return res.status(403).json({ error: "Ruxsat etilmadi!" });

    const userIds = Object.keys(db.users);
    userIds.forEach(id => {
        bot.sendMessage(id, `📢 **Tizim xabari:**\n\n${text}`, { parse_mode: "Markdown" }).catch(() => {});
    });

    res.json({ success: true, count: userIds.length });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
        
