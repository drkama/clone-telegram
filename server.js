const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const db = new Database('jumagram.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password TEXT,
    is_admin INTEGER DEFAULT 0,
    avatar_color TEXT DEFAULT '#a855f7',
    last_seen TEXT DEFAULT 'недавно'
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user TEXT,
    to_user TEXT,
    text TEXT,
    time TEXT,
    is_read INTEGER DEFAULT 0
  );
`);

// Создаем админа
const adminExists = db.prepare('SELECT * FROM users WHERE username = ?').get('кама');
if (!adminExists) {
    const hash = bcrypt.hashSync('123098', 10);
    db.prepare('INSERT INTO users (username, password, is_admin, avatar_color) VALUES (?, ?, 1, ?)').run('кама', hash, '#e879f9');
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));
app.use(express.json()); 

// --- API ДЛЯ АДМИНКИ ---
app.get('/api/admin/data', (req, res) => {
    try {
        const users = db.prepare('SELECT username, is_admin, last_seen FROM users').all();
        const messages = db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 100').all();
        res.json({ users, messages });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/delete-user', (req, res) => {
    const { username } = req.body;
    db.prepare('DELETE FROM users WHERE username = ?').run(username);
    db.prepare('DELETE FROM messages WHERE from_user = ? OR to_user = ?').run(username, username);
    res.json({ success: true });
});

app.post('/api/admin/delete-message', (req, res) => {
    const { id } = req.body;
    db.prepare('DELETE FROM messages WHERE id = ?').run(id);
    res.json({ success: true });
});

// --- SOCKET.IO (ЧАТ) ---
const onlineUsers = new Map(); // username -> socketId

function getRandomColor() {
    const colors = ['#7c3aed', '#d946ef', '#3b82f6', '#10b981', '#f59e0b', '#ef4444'];
    return colors[Math.floor(Math.random() * colors.length)];
}

io.on('connection', (socket) => {
    socket.on('register', ({ username, password }, cb) => {
        if (!username || !password) return cb({ error: 'Заполните все поля' });
        username = username.toLowerCase().trim();
        
        let user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

        if (user) {
            if (!bcrypt.compareSync(password, user.password)) return cb({ error: 'Неверный пароль' });
        } else {
            const hash = bcrypt.hashSync(password, 10);
            const color = getRandomColor();
            db.prepare('INSERT INTO users (username, password, avatar_color) VALUES (?, ?, ?)').run(username, hash, color);
            user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        }

        socket.username = username;
        onlineUsers.set(username, socket.id);

        // Отправляем обновленный список пользователей
        const allUsers = db.prepare('SELECT username, avatar_color, last_seen FROM users').all();
        io.emit('users', allUsers);

        // История сообщений
        const history = db.prepare(`
            SELECT id, from_user as "from", to_user as "to", text, time, is_read 
            FROM messages WHERE from_user = ? OR to_user = ?
        `).all(username, username);
        
        cb({ success: true, username, history, is_admin: user.is_admin === 1, avatar_color: user.avatar_color });
    });

    socket.on('mark_read', ({ withUser }) => {
        db.prepare('UPDATE messages SET is_read = 1 WHERE to_user = ? AND from_user = ?').run(socket.username, withUser);
        // Сообщаем собеседнику, что мы прочитали
        const recipientSocket = onlineUsers.get(withUser);
        if (recipientSocket) {
            io.to(recipientSocket).emit('messages_read', { byUser: socket.username });
        }
    });

    socket.on('message', ({ to, text }) => {
        const from = socket.username;
        if (!from || !to || !text?.trim()) return;

        const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        
        const info = db.prepare('INSERT INTO messages (from_user, to_user, text, time) VALUES (?, ?, ?, ?)')
          .run(from, to.toLowerCase(), text.trim(), time);

        const msg = { id: info.lastInsertRowid, from, to: to.toLowerCase(), text: text.trim(), time, is_read: 0 };
        
        const recipientSocket = onlineUsers.get(to.toLowerCase());
        if (recipientSocket) {
            io.to(recipientSocket).emit('message', msg);
        }
        socket.emit('message', msg);
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            onlineUsers.delete(socket.username);
            const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            db.prepare('UPDATE users SET last_seen = ? WHERE username = ?').run(time, socket.username);
            const allUsers = db.prepare('SELECT username, avatar_color, last_seen FROM users').all();
            io.emit('users', allUsers);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Jumagram запущен на порту ${PORT}`));
