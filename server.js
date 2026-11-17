const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const users = {}; 
const messages = []; 

io.on('connection', (socket) => {
    socket.on('register', ({ username, password }, cb) => {
        username = username.toLowerCase().trim();
        if (!username || !password) return cb({ error: 'Заполните все поля' });
        if (username.length < 3) return cb({ error: 'Юзернейм минимум 3 символа' });

        if (users[username]) {
            if (users[username].password !== password) {
                return cb({ error: 'Неверный пароль' });
            }
        } else {
            users[username] = { password };
        }

        users[username].socketId = socket.id;
        socket.username = username;

        io.emit('users', Object.keys(users));

        const history = messages.filter(m => m.from === username || m.to === username);
        cb({ success: true, username, history });
    });

    socket.on('message', ({ to, text }) => {
        const from = socket.username;
        if (!from || !to || !text?.trim()) return;

        const msg = {
            from,
            to: to.toLowerCase(),
            text: text.trim(),
            time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        };
        messages.push(msg);

        const recipient = users[msg.to];
        if (recipient?.socketId) {
            io.to(recipient.socketId).emit('message', msg);
        }
        socket.emit('message', msg);
    });

    socket.on('disconnect', () => {
        if (socket.username && users[socket.username]) {
            users[socket.username].socketId = null;
        }
        io.emit('users', Object.keys(users));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
