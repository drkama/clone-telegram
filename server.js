const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));
app.use(express.json());

// Админка (простая)
app.get('/api/admin/users', (req, res) => {
    res.json(Object.keys(users).map(u => ({ username: u, online: !!users[u].socketId })));
});
app.post('/api/admin/delete', (req, res) => {
    const { username } = req.body;
    delete users[username];
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].from === username || messages[i].to === username) messages.splice(i, 1);
    }
    io.emit('users', Object.keys(users));
    res.json({ success: true });
});

const users = {}; // username -> { password, socketId, color }
const messages = []; // { from, to, text, time, is_read }

function getRandomColor() {
    const colors = ['#7c3aed', '#d946ef', '#3b82f6', '#10b981', '#f59e0b', '#ef4444'];
    return colors[Math.floor(Math.random() * colors.length)];
}

io.on('connection', (socket) => {
    socket.on('register', ({ username, password }, cb) => {
        if (!username || !password) return cb({ error: 'Заполните все поля' });
        username = username.toLowerCase().trim();
        if (username.length < 3) return cb({ error: 'Минимум 3 символа' });

        if (users[username]) {
            if (users[username].password !== password) return cb({ error: 'Неверный пароль' });
        } else {
            users[username] = { password, color: getRandomColor(), socketId: null };
        }

        users[username].socketId = socket.id;
        socket.username = username;

        io.emit('users', Object.keys(users).map(u => ({ username: u, color: users[u].color })));

        const history = messages.filter(m => m.from === username || m.to === username);
        cb({ success: true, username, history, is_admin: username === 'кама', color: users[username].color });
    });

    socket.on('mark_read', ({ withUser }) => {
        messages.forEach(m => { if (m.to === socket.username && m.from === withUser) m.is_read = 1; });
        const recipient = users[withUser];
        if (recipient?.socketId) io.to(recipient.socketId).emit('messages_read', { byUser: socket.username });
    });

    socket.on('message', ({ to, text }) => {
        const from = socket.username;
        if (!from || !to || !text?.trim()) return;
        
        const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        const msg = { from, to: to.toLowerCase(), text: text.trim(), time, is_read: 0 };
        messages.push(msg);

        const recipient = users[msg.to];
        if (recipient?.socketId) io.to(recipient.socketId).emit('message', msg);
        socket.emit('message', msg);
    });

    socket.on('disconnect', () => {
        if (socket.username && users[socket.username]) users[socket.username].socketId = null;
        io.emit('users', Object.keys(users).map(u => ({ username: u, color: users[u].color })));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Jumagram on port ${PORT}`));
