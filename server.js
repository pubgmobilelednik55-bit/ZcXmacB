const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const BOT_TOKEN = '8967240691:AAGsYKLNxDoync5ujOA_j2t__f1v6OYlj-o';
const ADMIN_ID = '8655609546'; // Admin paneli faqat ushbu ID uchun ochiq

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const DB_FILE = path.join(__dirname, 'database.json');

// Ma'lumotlarni xavfsiz o'qish (Fayl buzilishi yoki bo'sh bo'lib qolishidan himoyalangan)
function readDB() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            const initialData = { users: {}, orders: [] };
            fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf-8');
            return initialData;
        }
        const data = fs.readFileSync(DB_FILE, 'utf-8');
        if (!data || data.trim() === "") {
            return { users: {}, orders: [] };
        }
        return JSON.parse(data);
    } catch (e) {
        console.error("Bazani o'qishda xatolik yuz berdi:", e);
        return { users: {}, orders: [] };
    }
}

// Ma'lumotlarni ishonchli (atomic) yozish (Balanslar o'chib ketishining oldini oladi)
function writeDB(data) {
    try {
        const tempPath = DB_FILE + '.tmp';
        fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
        fs.renameSync(tempPath, DB_FILE); // Faylni to'liq yozib bo'lgach asliga almashtiradi
    } catch (e) {
        console.error("Bazaga yozishda xatolik yuz berdi:", e);
    }
}

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Bot /start bosilganda (Foydalanuvchini kutib olish)
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || '';
    const firstName = msg.from.first_name || '';

    const db = readDB();
    if (!db.users[msg.from.id]) {
        db.users[msg.from.id] = {
            id: msg.from.id,
            username: username.toLowerCase(),
            first_name: firstName,
            balance: 0,
            isBanned: false
        };
        writeDB(db);
    }

    const welcomeMessage = `👋 Xush kelibsiz, ${firstName} \n\nBizni xizmatlarimizdan foydalaning, vaqtingizni va pulingizni tejang. Rivojlanish vaqti keldi!\n\n✨ Biz bilan juda qulay!\n\n🙏 Bizning xizmatlarimizdan foydalanganingiz uchun rahmat!`;

    bot.sendMessage(chatId, welcomeMessage, {
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: "🚀 Ilovani ochish",
                        web_app: { url: `https://SAYTINGIZ_LINKI.com` } // DeploY qilingach shu yerga sayt linki qo'yiladi
                    }
                ],
                [
                    {
                        text: "📢 News Kanalimiz",
                        url: "https://t.me/ZcPinNews"
                    }
                ]
            ]
        }
    });
});

// Foydalanuvchini Mini App bilan sinxronlash
app.post('/api/user/sync', (req, res) => {
    const { id, username, first_name } = req.body;
    if (!id) return res.status(400).json({ error: 'ID talab qilinadi' });

    const db = readDB();
    const cleanUsername = (username || '').toLowerCase();

    if (!db.users[id]) {
        db.users[id] = {
            id: id,
            username: cleanUsername,
            first_name: first_name || 'Foydalanuvchi',
            balance: 0,
            isBanned: false
        };
    } else {
        db.users[id].username = cleanUsername;
        db.users[id].first_name = first_name || db.users[id].first_name;
    }
    
    writeDB(db);
    res.json(db.users[id]);
});

// Buyurtma yaratish API
app.post('/api/order', (req, res) => {
    const { userId, game, item, price, playerId } = req.body;
    const db = readDB();
    const user = db.users[userId];

    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    if (user.isBanned) return res.status(403).json({ error: 'Siz bloklangansiz!' });
    if (user.balance < price) return res.status(400).json({ error: 'Balansda mablag\' yetarli emas!' });

    user.balance -= price;

    const orderId = Math.floor(1000 + Math.random() * 9000); // 4 xonali buyurtma ID si

    const newOrder = {
        id: orderId,
        userId: userId,
        username: user.username,
        game: game,
        item: item,
        price: price,
        playerId: playerId || 'Kiritilmagan',
        status: 'Kutilmoqda',
        date: new Date().toLocaleString()
    };

    db.orders.push(newOrder);
    writeDB(db);

    // Adminga xabar berish
    const adminMsg = `🚨 YANGI BUYURTMA!\n\n👤 Foydalanuvchi: @${user.username || 'yo\'q'} (ID: ${userId})\n🎮 O'yin: ${game}\n📦 Maxsulot: ${item}\n🆔 Player ID: ${playerId}\n💰 Narxi: ${price.toLocaleString()} so'm\n🔢 Buyurtma ID: #${newOrder.id}`;
    bot.sendMessage(ADMIN_ID, adminMsg);

    res.json({ success: true, orderId: newOrder.id, balance: user.balance });
});

// Foydalanuvchining o'z buyurtmalarini olish
app.get('/api/orders/:userId', (req, res) => {
    const { userId } = req.params;
    const db = readDB();
    const userOrders = db.orders.filter(o => String(o.userId) === String(userId));
    res.json(userOrders);
});

// Admin panel uchun barcha buyurtmalar ro'yxati
app.get('/api/admin/orders', (req, res) => {
    const db = readDB();
    res.json(db.orders);
});

// Admin: Buyurtma holatini o'zgartirish (Bajarildi / Rad etildi)
app.post('/api/admin/order/status', (req, res) => {
    const { orderId, status } = req.body;
    const db = readDB();
    const orderIndex = db.orders.findIndex(o => o.id === parseInt(orderId));

    if (orderIndex === -1) return res.status(404).json({ error: 'Buyurtma topilmadi' });

    const order = db.orders[orderIndex];
    if (order.status !== 'Kutilmoqda') {
        return res.status(400).json({ error: 'Bu buyurtma allaqachon bajarilgan' });
    }

    order.status = status;
    const user = db.users[order.userId];

    if (status === 'Bajarildi') {
        if (user) {
            bot.sendMessage(order.userId, `Buyurtma bajarildi ✔️\n\n🎮 O'yin: ${order.game}\n📦 Maxsulot: ${order.item}\n🆔 Player ID: ${order.playerId}\n🔢 Buyurtma ID: #${order.id}`);
        }
    } else if (status === 'Rad etildi') {
        if (user) {
            user.balance += order.price;
            bot.sendMessage(order.userId, `❌ Buyurtmangiz rad etildi va mablag' balansingizga qaytarildi.\n🔢 Buyurtma ID: #${order.id}`);
        }
    }

    writeDB(db);
    res.json({ success: true, orders: db.orders });
});

// Admin: Statistika API (Nolga tushmaydigan dinamik hisob-kitob)
app.get('/api/admin/stats', (req, res) => {
    const db = readDB();
    const totalUsers = Object.keys(db.users).length;
    const totalOrders = db.orders.length;
    res.json({ totalUsers, totalOrders });
});

// Admin: Foydalanuvchi balansini boshqarish
app.post('/api/admin/balance', (req, res) => {
    const { username, amount, action } = req.body;
    const db = readDB();
    const cleanUsername = username.replace('@', '').toLowerCase();
    const userKey = Object.keys(db.users).find(key => db.users[key].username === cleanUsername);

    if (!userKey) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

    const value = parseInt(amount);
    if (action === 'add') {
        db.users[userKey].balance += value;
        bot.sendMessage(userKey, `💰 Hisobingizga ${value.toLocaleString()} so'm qo'shildi! Balans: ${db.users[userKey].balance.toLocaleString()} so'm.`);
    } else {
        db.users[userKey].balance = Math.max(0, db.users[userKey].balance - value);
        bot.sendMessage(userKey, `📉 Hisobingizdan ${value.toLocaleString()} so'm ayirildi. Balans: ${db.users[userKey].balance.toLocaleString()} so'm.`);
    }

    writeDB(db);
    res.json({ success: true, user: db.users[userKey] });
});

// Admin: Foydalanuvchini ban qilish
app.post('/api/admin/ban', (req, res) => {
    const { username, banStatus } = req.body;
    const db = readDB();
    const cleanUsername = username.replace('@', '').toLowerCase();
    const userKey = Object.keys(db.users).find(key => db.users[key].username === cleanUsername);

    if (!userKey) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

    db.users[userKey].isBanned = banStatus;
    writeDB(db);

    bot.sendMessage(userKey, banStatus ? `❌ Siz admin tomonidan bloklandingiz.` : `✅ Siz blokdan chiqarildingiz!`);
    res.json({ success: true });
});

// Admin: Xabar tarqatish (Barcha ro'yxatdan o'tganlarga)
app.post('/api/admin/broadcast', (req, res) => {
    const { message } = req.body;
    const db = readDB();
    const userKeys = Object.keys(db.users);

    userKeys.forEach(chatId => {
        bot.sendMessage(chatId, `📢 TEZKOR XABAR:\n\n${message}`).catch(() => {});
    });

    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Node.js server ${PORT}-portda barqaror ishga tushdi.`);
});