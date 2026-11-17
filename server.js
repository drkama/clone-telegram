const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 1. Явно указываем, где лежит папка public
const publicPath = __dirname;
app.use(express.static(publicPath));

// 2. Явный маршрут для главной страницы (исправляет "Cannot GET /")
app.get('/', (req, res) => {
    const indexPath = path.join(publicPath, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send('Ошибка: Файл index.html не найден в папке public. Проверьте структуру репозитория на GitHub.');
    }
});

// Хранилище в памяти (при перезапуске всё сбросится)
const users = {};      // username -> { socketId, password }
const messages = [];   // { from, to, text, time }

io.on('connection', (socket) => {
    console.log('Подключился:', socket.id);

    // Регистрация / вход
    socket.on('register', ({ username, password }, cb) => {
        if (!username || !password) return cb({ error: 'Заполните все поля' });
        username = username.toLowerCase().trim();
        if (username.length < 3) return cb({ error: 'Юзернейм минимум 3 символа' });

        if (users[username]) {
            // Вход — проверяем пароль
            if (users[username].password !== password) {
                return cb({ error: 'Неверный пароль' });
            }
        } else {
            // Регистрация
            users[username] = { password };
        }

        users[username].socketId = socket.id;
        socket.username = username;

        // Уведомляем всех о новом онлайне
        io.emit('users', Object.keys(users));

        // Отправляем пользователю его историю сообщений
        const history = messages.filter(m => m.from === username || m.to === username);
        cb({ success: true, username, history });
    });

    // Отправка сообщения
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

        // Отправляем получателю, если онлайн
        const recipient = users[msg.to];
        if (recipient?.socketId) {
            io.to(recipient.socketId).emit('message', msg);
        }
        // Эхо отправителю (для отображения)
        socket.emit('message', msg);
    });

    socket.on('disconnect', () => {
        if (socket.username && users[socket.username]) {
            users[socket.username].socketId = null;
        }
        io.emit('users', Object.keys(users));
    });
});

// Render автоматически задает порт через process.env.PORT
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер успешно запущен на порту ${PORT}`);
    console.log(`Раздача статики из папки: ${publicPath}`);
});
