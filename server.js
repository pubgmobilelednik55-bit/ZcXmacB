const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const BOT_TOKEN = '8941919975:AAFdQwhk4gf_qb2JFd2D3aqhUgIYleBcGIA';
const ADMIN_ID = 7271550202; // Sizning Telegram IDingiz
const ADMIN_PASSWORD = 'gemini'; // Admin panel paroli

// Express va Botni sozlash
const app = express();
const bot = new Telegraf(BOT_TOKEN);

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// Rasmlarni saqlash uchun Multer sozlamalari
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './uploads/';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// SQLite Ma'lumotlar bazasini yaratish va ulash
const db = new sqlite3.Database('./zcpinbot.db', (err) => {
  if (err) console.error('Baza ulanishida xatolik:', err);
  else console.log('SQLite bazaga muvaffaqiyatli ulandi.');
});

// Jadval tuzilmalarini yaratish
db.serialize(() => {
  // Foydalanuvchilar jadvali
  db.run(`CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    fullname TEXT,
    balance INTEGER DEFAULT 0,
    total_orders INTEGER DEFAULT 0,
    spent_money INTEGER DEFAULT 0,
    language TEXT DEFAULT 'uz'
  )`);

  // Bo'limlar (Kategoriyalar) jadvali
  db.run(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    description TEXT,
    image_url TEXT
  )`);

  // Xizmatlar (Paketlar) jadvali
  db.run(`CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER,
    title TEXT,
    price INTEGER,
    FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE CASCADE
  )`);

  // Buyurtmalar jadvali
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER,
    username TEXT,
    player_id TEXT,
    service_title TEXT,
    price INTEGER,
    status TEXT DEFAULT 'Kutilmoqda'
  )`);

  // Promokodlar jadvali
  db.run(`CREATE TABLE IF NOT EXISTS promos (
    code TEXT PRIMARY KEY,
    reward INTEGER,
    max_uses INTEGER DEFAULT 10,
    used_count INTEGER DEFAULT 0
  )`);

  // Foydalanilgan promokodlar tarixi (bitta odam qayta ishlatolmasligi uchun)
  db.run(`CREATE TABLE IF NOT EXISTS promo_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER,
    code TEXT
  )`);

  // Reklama bannerlari jadvali
  db.run(`CREATE TABLE IF NOT EXISTS banners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_url TEXT
  )`);

  // Standart PUBG Mobile bo'limini tekshirish va yo'q bo'lsa yaratish
  db.get("SELECT * FROM categories WHERE title = 'PUBG Mobile'", (err, row) => {
    if (!row) {
      db.run("INSERT INTO categories (title, description, image_url) VALUES ('PUBG Mobile', 'UC tezkor donat xizmati', '/uploads/pubg_logo.png')");
      // Default xizmatlarni qo'shish
      setTimeout(() => {
        db.get("SELECT id FROM categories WHERE title = 'PUBG Mobile'", (err, cat) => {
          if (cat) {
            const defaultServices = [
              ['60 UC', 13000],
              ['120 UC', 25000],
              ['325 UC', 60000],
              ['660 UC', 122000],
              ['1800 UC', 320000]
            ];
            defaultServices.forEach(srv => {
              db.run("INSERT INTO services (category_id, title, price) VALUES (?, ?, ?)", [cat.id, srv[0], srv[1]]);
            });
          }
        });
      }, 1000);
    }
  });
});

// Express Serveringiz manzili (Render.com ga qo'yganda o'zgaradi)
let webAppUrl = 'https://animezcbot.onrender.com/';

// --- TELEGRAM BOT QISMI ---

bot.start(async (ctx) => {
  const from = ctx.from;
  
  // Foydalanuvchini bazaga qo'shish yoki yangilash
  db.run(`INSERT INTO users (telegram_id, username, fullname) 
          VALUES (?, ?, ?) 
          ON CONFLICT(telegram_id) DO UPDATE SET 
          username = excluded.username, fullname = excluded.fullname`, 
          [from.id, from.username || 'NoUsername', from.first_name]);

  await ctx.reply(
    `Salom 👋\nZcPinBotga xush kelibsiz 😅\n\nArzon va tezkor donat qilish uchun ilovani oching tugmasini bosing 🚀`,
    Markup.keyboard([
      [Markup.button.webApp('🚀 Ilovani ochish', webAppUrl)]
    ]).resize()
  );
});

// Admin tugmalari (bajarildi / rad etildi bosilganda)
bot.action(/order_(approve|reject)_(.+)_(.+)/, async (ctx) => {
  const action = ctx.match[1];
  const orderId = ctx.match[2];
  const userId = ctx.match[3];

  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Siz admin emassiz!");

  if (action === 'approve') {
    db.run("UPDATE orders SET status = 'Bajarildi' WHERE id = ?", [orderId]);
    db.get("SELECT * FROM orders WHERE id = ?", [orderId], (err, order) => {
      if (order) {
        db.run("UPDATE users SET total_orders = total_orders + 1, spent_money = spent_money + ? WHERE telegram_id = ?", [order.price, order.telegram_id]);
        bot.telegram.sendMessage(userId, `✅ **Sizning #${orderId} raqamli buyurtmangiz muvaffaqiyatli bajarildi!**\n\nDonat o'yiningizga tushirildi. ZcPinBot xizmatidan foydalanganingiz uchun rahmat! 😎`);
      }
    });
    await ctx.editMessageText(`✅ Buyurtma #${orderId} tasdiqlandi va bajarildi.`);
  } else {
    db.get("SELECT * FROM orders WHERE id = ?", [orderId], (err, order) => {
      if (order) {
        // Pulni balansga qaytarish
        db.run("UPDATE users SET balance = balance + ? WHERE telegram_id = ?", [order.price, order.telegram_id]);
        db.run("UPDATE orders SET status = 'Rad etildi' WHERE id = ?", [orderId]);
        bot.telegram.sendMessage(userId, `❌ **Sizning #${orderId} raqamli buyurtmangiz rad etildi!**\n\nKetgan mablag' (${order.price} so'm) balansingizga qaytarildi. Iltimos, Player ID'ni to'g'ri kiritganingizni tekshiring.`);
      }
    });
    await ctx.editMessageText(`❌ Buyurtma #${orderId} rad etildi. Mablag' foydalanuvchiga qaytarildi.`);
  }
});

// --- API QISMI (MINI APP UCHUN) ---

// Foydalanuvchi ma'lumotlarini olish
app.get('/api/user/:id', (req, res) => {
  const userId = req.params.id;
  db.get("SELECT * FROM users WHERE telegram_id = ?", [userId], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.json({ telegram_id: userId, balance: 0, spent_money: 0, total_orders: 0 });
    res.json(user);
  });
});

// Bo'limlarni olish
app.get('/api/categories', (req, res) => {
  db.all("SELECT * FROM categories", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Xizmatlarni bo'lim ID'siga qarab olish
app.get('/api/services/:catId', (req, res) => {
  db.all("SELECT * const from services WHERE category_id = ?", [req.params.catId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Reytingni olish (Spent money bo'yicha)
app.get('/api/rating', (req, res) => {
  db.all("SELECT fullname, spent_money, total_orders FROM users WHERE spent_money > 0 ORDER BY spent_money DESC LIMIT 10", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Bannerlarni olish
app.get('/api/banners', (req, res) => {
  db.all("SELECT * FROM banners", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Promokodni tekshirish va ishlatish
app.post('/api/use-promo', (req, res) => {
  const { telegram_id, code } = req.body;
  
  db.get("SELECT * FROM promos WHERE code = ?", [code], (err, promo) => {
    if (err || !promo) return res.json({ success: false, message: "Promokod xato!" });
    if (promo.used_count >= promo.max_uses) return res.json({ success: false, message: "Ushbu promokoddan foydalanish soni tugagan!" });

    db.get("SELECT * FROM promo_history WHERE telegram_id = ? AND code = ?", [telegram_id, code], (err, history) => {
      if (history) return res.json({ success: false, message: "Siz bu promokodni ishlatib bo'lgansiz!" });

      db.run("UPDATE users SET balance = balance + ? WHERE telegram_id = ?", [promo.reward, telegram_id]);
      db.run("UPDATE promos SET used_count = used_count + 1 WHERE code = ?", [code]);
      db.run("INSERT INTO promo_history (telegram_id, code) VALUES (?, ?)", [telegram_id, code]);

      res.json({ success: true, reward: promo.reward, message: `Muvaffaqiyatli! Balansingizga ${promo.reward} so'm qo'shildi.` });
    });
  });
});

// Buyurtma berish (Donat sotib olish)
app.post('/api/buy', (req, res) => {
  const { telegram_id, service_id, player_id } = req.body;

  db.get("SELECT * FROM users WHERE telegram_id = ?", [telegram_id], (err, user) => {
    if (!user) return res.status(404).json({ error: "Foydalanuvchi topilmadi." });

    db.get("SELECT * FROM services WHERE id = ?", [service_id], (err, service) => {
      if (!service) return res.status(404).json({ error: "Xizmat topilmadi." });

      if (user.balance < service.price) {
        return res.json({ success: false, message: "Mablag' yetarli emas! Balansni to'ldiring." });
      }

      // Balansdan yechish
      db.run("UPDATE users SET balance = balance - ? WHERE telegram_id = ?", [service.price, telegram_id], (err) => {
        if (err) return res.json({ success: false, message: "Xatolik yuz berdi." });

        // Buyurtmani bazaga yozish
        db.run("INSERT INTO orders (telegram_id, username, player_id, service_title, price) VALUES (?, ?, ?, ?, ?)",
          [telegram_id, user.username, player_id, service.title, service.price],
          function (err) {
            if (err) return res.json({ success: false, message: "Buyurtma saqlanmadi." });
            const orderId = this.lastID;

            // Adminga xabar berish
            bot.telegram.sendMessage(ADMIN_ID, 
              `🔔 **YANGI BUYURTMA #` + orderId + `**\n\n` +
              `👤 Foydalanuvchi: ${user.fullname} (@${user.username})\n` +
              `🆔 Foydalanuvchi ID: \`${telegram_id}\`\n` +
              `🎮 Player ID: \`${player_id}\`\n` +
              `📦 Mahsulot: **${service.title}**\n` +
              `💰 Narxi: ${service.price} so'm\n\n` +
              `Tasdiqlaysizmi?`,
              Markup.inlineKeyboard([
                [
                  Markup.button.callback("✅ Bajarildi", `order_approve_${orderId}_${telegram_id}`),
                  Markup.button.callback("❌ Rad etish", `order_reject_${orderId}_${telegram_id}`)
                ]
              ])
            );

            res.json({ success: true, message: "Buyurtma qabul qilindi va adminga yuborildi! Tez orada hisobga tushadi." });
          }
        );
      });
    });
  });
});

// Buyurtmalar tarixi
app.get('/api/orders/:id', (req, res) => {
  db.all("SELECT * FROM orders WHERE telegram_id = ? ORDER BY id DESC", [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});


// --- ADMIN API PANEL FUNKSIYALARI ---

// Parolni tekshirish
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.json({ success: false, message: "Parol noto'g'ri!" });
  }
});

// Jami statistika
app.get('/api/admin/stats', (req, res) => {
  db.get("SELECT COUNT(*) as total_users FROM users", (err, users) => {
    db.get("SELECT COUNT(*) as total_orders, SUM(price) as total_sum FROM orders WHERE status = 'Bajarildi'", (err, orders) => {
      res.json({
        total_users: users.total_users,
        total_orders: orders.total_orders || 0,
        total_revenue: orders.total_sum || 0
      });
    });
  });
});

// Foydalanuvchilar ro'yxati (Bazasi)
app.get('/api/admin/users', (req, res) => {
  db.all("SELECT telegram_id, username, fullname, balance FROM users", (err, rows) => {
    res.json(rows);
  });
});

// Bo'lim qo'shish (Fayl orqali rasm bilan)
app.post('/api/admin/add-category', upload.single('image'), (req, res) => {
  const { title, description } = req.body;
  const image_url = req.file ? `/uploads/${req.file.filename}` : '/uploads/default.png';
  db.run("INSERT INTO categories (title, description, image_url) VALUES (?, ?, ?)", [title, description, image_url], function(err) {
    if (err) return res.json({ success: false });
    res.json({ success: true });
  });
});

// Bo'limni o'chirish
app.delete('/api/admin/category/:id', (req, res) => {
  db.run("DELETE FROM categories WHERE id = ?", [req.params.id], (err) => {
    res.json({ success: !err });
  });
});

// Xizmat qo'shish
app.post('/api/admin/add-service', (req, res) => {
  const { category_id, title, price } = req.body;
  db.run("INSERT INTO services (category_id, title, price) VALUES (?, ?, ?)", [category_id, title, price], (err) => {
    res.json({ success: !err });
  });
});

// Xizmatni o'chirish
app.delete('/api/admin/service/:id', (req, res) => {
  db.run("DELETE FROM services WHERE id = ?", [req.params.id], (err) => {
    res.json({ success: !err });
  });
});

// Foydalanuvchiga pul qo'shish / ayirish
app.post('/api/admin/update-balance', (req, res) => {
  const { telegram_id, amount, action } = req.body; // action: 'add' yoki 'sub'
  const sign = action === 'add' ? '+' : '-';
  db.run(`UPDATE users SET balance = balance ${sign} ? WHERE telegram_id = ?`, [amount, telegram_id], (err) => {
    if (!err) {
      bot.telegram.sendMessage(telegram_id, `🔔 **Balans o'zgarishi!**\n\nSizning balansingizga admin tomonidan ${amount} so'm ${action === 'add' ? 'qo\'shildi' : 'ayrildi'}.`);
    }
    res.json({ success: !err });
  });
});

// Promokod qo'shish
app.post('/api/admin/add-promo', (req, res) => {
  const { code, reward } = req.body;
  db.run("INSERT INTO promos (code, reward, max_uses, used_count) VALUES (?, ?, 10, 0)", [code, reward], (err) => {
    res.json({ success: !err });
  });
});

// Reklama rasmi qo'shish (Banner)
app.post('/api/admin/add-banner', upload.single('image'), (req, res) => {
  if (req.file) {
    const imgUrl = `/uploads/${req.file.filename}`;
    db.run("INSERT INTO banners (image_url) VALUES (?)", [imgUrl], (err) => {
      res.json({ success: !err });
    });
  } else {
    res.json({ success: false });
  }
});

// Banner o'chirish
app.delete('/api/admin/banner/:id', (req, res) => {
  db.run("DELETE FROM banners WHERE id = ?", [req.params.id], (err) => {
    res.json({ success: !err });
  });
});

// Xabar tarqatish (Bot foydalanuvchilariga reklama)
app.post('/api/admin/broadcast', (req, res) => {
  const { message } = req.body;
  db.all("SELECT telegram_id FROM users", (err, users) => {
    if (users) {
      users.forEach(user => {
        bot.telegram.sendMessage(user.telegram_id, message, Markup.keyboard([
          [Markup.button.webApp('🚀 Ilovani ochish', webAppUrl)]
        ]).resize()).catch(err => console.log('Xabar ketmadi:', user.telegram_id));
      });
    }
    res.json({ success: true });
  });
});

// Loyiha fayllarini yaratish (Standart PUBG logosini papka yaratib qo'yish uchun)
if (!fs.existsSync('./uploads')){
  fs.mkdirSync('./uploads');
}

// Botni va Serverni ishga tushirish
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server ${PORT}-portda ishlamoqda...`);
  bot.launch().then(() => console.log("Telegram Bot ishga tushdi."));
});
             
