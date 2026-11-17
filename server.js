const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

// --- ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ ---
const db = new Database('jumagram.db');
db.pragma('journal_mode = WAL');

// Создаем таблицы, если их нет
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password TEXT,
    is_admin INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user TEXT,
    to_user TEXT,
    text TEXT,
    time TEXT
  );
`);

// Создаем главного админа по умолчанию (логин: admin, пароль: admin123)
// Поменяйте пароль после первого входа!
const adminExists = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (username, password, is_admin) VALUES (?, ?, 1)').run('admin', hash);
}

// --- НАСТРОЙКА СЕРВЕРА ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname))); // Раздаем статику из корня
app.use(express.json()); // Для парсинга JSON в админке

// --- API ДЛЯ АДМИНКИ ---
// Получить всех пользователей и сообщения (только для админа)
app.get('/api/admin/data', (req, res) => {
    // В реальном проекте здесь нужна авторизация (например, проверка токена)
    try {
        const users = db.prepare('SELECT username, is_admin FROM users').all();
        const messages = db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 100').all();
        res.json({ users, messages });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Удалить пользователя
app.post('/api/admin/delete-user', (req, res) => {
    const { username } = req.body;
    db.prepare('DELETE FROM users WHERE username = ?').run(username);
    db.prepare('DELETE FROM messages WHERE from_user = ? OR to_user = ?').run(username, username);
    res.json({ success: true });
});

// Удалить сообщение
app.post('/api/admin/delete-message', (req, res) => {
    const { id } = req.body;
    db.prepare('DELETE FROM messages WHERE id = ?').run(id);
    res.json({ success: true });
});

// --- SOCKET.IO (ЧАТ) ---
const onlineUsers = new Set(); // socketId -> username

io.on('connection', (socket) => {
    socket.on('register', ({ username, password }, cb) => {
        if (!username || !password) return cb({ error: 'Заполните все поля' });
        username = username.toLowerCase().trim();
        if (username.length < 3) return cb({ error: 'Юзернейм минимум 3 символа' });

        let user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

        if (user) {
            // Вход
            if (!bcrypt.compareSync(password, user.password)) {
                return cb({ error: 'Неверный пароль' });
            }
        } else {
            // Регистрация
            const hash = bcrypt.hashSync(password, 10);
            db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hash);
            user = { username, is_admin: 0 };
        }

        socket.username = username;
        onlineUsers.add(socket.id);

        // Отправляем список всех пользователей (для чата)
        const allUsers = db.prepare('SELECT username FROM users').all().map(u => u.username);
        io.emit('users', allUsers);

        // Отправляем историю сообщений пользователя
        const history = db.prepare(`
            SELECT from_user as "from", to_user as "to", text, time 
            FROM messages 
            WHERE from_user = ? OR to_user = ?
        `).all(username, username);
        
        cb({ success: true, username, history, is_admin: user.is_admin === 1 });
    });

    socket.on('message', ({ to, text }) => {
        const from = socket.username;
        if (!from || !to || !text?.trim()) return;

        const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        
        // Сохраняем в БД
        db.prepare('INSERT INTO messages (from_user, to_user, text, time) VALUES (?, ?, ?, ?)')
          .run(from, to.toLowerCase(), text.trim(), time);

        const msg = { from, to: to.toLowerCase(), text: text.trim(), time };
        
        // Отправляем получателю и отправителю
        const recipientSocketId = [...onlineUsers].find(id => io.sockets.sockets.get(id)?.username === to.toLowerCase());
        
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('message', msg);
        }
        socket.emit('message', msg);
    });

    socket.on('disconnect', () => {
        onlineUsers.delete(socket.id);
    });
});

// --- ЗАПУСК ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Jumagram запущен на порту ${PORT}`);
    console.log(`База данных: jumagram.db`);
});
