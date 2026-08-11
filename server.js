const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const moment = require('moment');
const geoip = require('geoip-lite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());

// Konfigurasi
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = '8650738683:AAGwbBb5oDu0pCOh3ptfZAsoLnDeSmORvLU';
const OWNER_ID = 1402999777;
const USERS_FILE = path.join(__dirname, 'users.json');
const LOG_FILE = path.join(__dirname, 'server.log');
const PENDING_FILE = path.join(__dirname, 'pending_approvals.json');

// Inisialisasi database
if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
}
if (!fs.existsSync(PENDING_FILE)) {
    fs.writeFileSync(PENDING_FILE, JSON.stringify({ pending: [] }, null, 2));
}

// Inisialisasi Bot Telegram
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ANSI Colors
const c = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgBlue: '\x1b[44m',
    bgMagenta: '\x1b[45m',
    bgCyan: '\x1b[46m',
};

// Fungsi helper
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           req.headers['cf-connecting-ip'] ||
           req.connection?.remoteAddress ||
           req.socket?.remoteAddress ||
           'Unknown';
}

function loadUsers() {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function saveUsers(data) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

function loadPending() {
    return JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
}

function savePending(data) {
    fs.writeFileSync(PENDING_FILE, JSON.stringify(data, null, 2));
}

function logToFile(message) {
    const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
    fs.appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`);
}

// Fungsi generate OTP
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Fungsi generate pairing code
function generatePairingCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Fungsi spam OTP
async function spamOTP(target, count, type) {
    const otpList = [
        'Rumah123', 'OLX', 'Shopee', 'Tokopedia', 'Gojek', 'Grab', 'Traveloka',
        'Bukalapak', 'Lazada', 'Blibli', 'JD.ID', 'Zalora', 'Sociolla',
        'OVO', 'DANA', 'LinkAja', 'GoPay', 'ShopeePay', 'SeaBank',
        'Akulaku', 'Kredivo', 'HomeCredit', 'Adakami', 'EasyCash',
        'PinjamDuit', 'UangMe', 'Julo', 'Tunaiku', 'RupiahCepat',
        'Telegram', 'WhatsApp', 'Instagram', 'Facebook', 'TikTok',
        'Netflix', 'Disney', 'Spotify', 'YouTube', 'Vidio',
        'Alfamart', 'Indomaret', 'McDonalds', 'KFC', 'Starbucks',
        'BCA', 'Mandiri', 'BNI', 'BRI', 'CIMB', 'Danamon'
    ];

    const apis = [
        'https://api.random.com/v1/sms',
        'https://sms-gateway.free/api/send',
        'https://otp-provider.io/send',
    ];

    const results = [];
    
    for (let i = 0; i < count; i++) {
        const otp = generateOTP();
        const service = otpList[Math.floor(Math.random() * otpList.length)];
        const api = apis[Math.floor(Math.random() * apis.length)];
        
        try {
            // Simulasi pengiriman OTP via WhatsApp
            const message = `*${service}*\nKode OTP Anda: *${otp}*\nBerlaku 5 menit\n\nJangan bagikan kode ini kepada siapapun.`;
            
            results.push({
                number: i + 1,
                service: service,
                otp: otp,
                target: target,
                status: 'sent',
                time: moment().format('HH:mm:ss')
            });
            
            console.log(`${c.green}[OTP ${i+1}/${count}]${c.reset} ${service} -> ${otp} -> ${target}`);
            
            // Delay antara pengiriman
            await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
            
        } catch (error) {
            results.push({
                number: i + 1,
                service: service,
                otp: otp,
                target: target,
                status: 'failed',
                time: moment().format('HH:mm:ss')
            });
        }
    }
    
    return results;
}

// Fungsi spam pairing code
async function spamPairing(target, count) {
    const results = [];
    
    for (let i = 0; i < count; i++) {
        const pairingCode = generatePairingCode();
        
        try {
            const message = `*WhatsApp Web Pairing Code*\nKode: *${pairingCode}*\nBerlaku 2 menit\n\nGunakan kode ini untuk menghubungkan WhatsApp Web.`;
            
            results.push({
                number: i + 1,
                code: pairingCode,
                target: target,
                status: 'sent',
                time: moment().format('HH:mm:ss')
            });
            
            console.log(`${c.cyan}[PAIR ${i+1}/${count}]${c.reset} Code: ${pairingCode} -> ${target}`);
            
            await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 700));
            
        } catch (error) {
            results.push({
                number: i + 1,
                code: pairingCode,
                target: target,
                status: 'failed',
                time: moment().format('HH:mm:ss')
            });
        }
    }
    
    return results;
}

// Bot Telegram Commands
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'User';
    const isOwner = chatId === OWNER_ID;
    
    const menuText = `
╔══════════════════════════╗
║  🐍 RANZ WORM V3 BOT 🐍  ║
╠══════════════════════════╣
║  Welcome, ${firstName}!
╠══════════════════════════╣
║  📋 MAIN MENU:
║
║  /start   - Show menu
║  /status  - Server status
║  /users   - Registered users
║  /pending - Pending approvals
║  /help    - Help & info
║
${isOwner ? `
║  👑 OWNER MENU:
║  /approve [id] - Approve user
║  /reject [id]  - Reject user
║  /delete [id]  - Delete user
║  /broadcast    - Broadcast msg
║  /stats        - Full statistics
` : `
║  📝 REGISTER:
║  /register [username] [password]
║  /myid     - Get your ID
`}
╠══════════════════════════╣
║  t.me/Ranzkecebet
║  @Ranzkecebet
╚══════════════════════════╝
    `;
    
    bot.sendMessage(chatId, menuText, { parse_mode: 'Markdown' });
});

bot.onText(/\/register (.+) (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const username = match[1].trim();
    const password = match[2].trim();
    
    const users = loadUsers();
    const pending = loadPending();
    
    // Cek apakah username sudah ada
    const existingUser = users.users.find(u => u.username === username);
    if (existingUser) {
        return bot.sendMessage(chatId, '❌ Username already exists.');
    }
    
    // Cek apakah sudah pending
    const existingPending = pending.pending.find(p => p.username === username);
    if (existingPending) {
        return bot.sendMessage(chatId, '⏳ Your registration is already pending approval.');
    }
    
    // Tambah ke pending
    const pendingId = crypto.randomBytes(4).toString('hex');
    pending.pending.push({
        id: pendingId,
        username: username,
        password: password,
        telegramId: chatId,
        telegramName: msg.from.first_name,
        requestedAt: moment().format('YYYY-MM-DD HH:mm:ss'),
        status: 'pending'
    });
    savePending(pending);
    
    // Kirim notifikasi ke owner
    const ownerMsg = `
╔══════════════════════════╗
║  🔔 NEW REGISTRATION!   ║
╠══════════════════════════╣
║  ID       : ${pendingId}
║  Username : ${username}
║  Telegram : @${msg.from.username || 'N/A'}
║  Name     : ${msg.from.first_name}
║  Time     : ${moment().format('HH:mm:ss')}
╠══════════════════════════╣
║  /approve_${pendingId}
║  /reject_${pendingId}
╚══════════════════════════╝
    `;
    
    bot.sendMessage(OWNER_ID, ownerMsg);
    
    // Notifikasi ke user
    bot.sendMessage(chatId, `
╔══════════════════════════╗
║  ⏳ PENDING APPROVAL    ║
╠══════════════════════════╣
║  ID       : ${pendingId}
║  Username : ${username}
║  Status   : Waiting...
║
║  Owner akan memverifikasi
║  permintaan Anda.
╚══════════════════════════╝
    `);
});

// Bot handler untuk tombol approve/reject
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const messageId = callbackQuery.message.message_id;
    
    if (chatId !== OWNER_ID) {
        return bot.answerCallbackQuery(callbackQuery.id, { text: 'Unauthorized!' });
    }
    
    const pending = loadPending();
    
    if (data.startsWith('approve_')) {
        const pendingId = data.replace('approve_', '');
        const pendingUser = pending.pending.find(p => p.id === pendingId);
        
        if (!pendingUser) {
            return bot.answerCallbackQuery(callbackQuery.id, { text: 'Not found!' });
        }
        
        const users = loadUsers();
        users.users.push({
            id: crypto.randomBytes(8).toString('hex'),
            username: pendingUser.username,
            password: pendingUser.password,
            telegramId: pendingUser.telegramId,
            registeredAt: moment().format('YYYY-MM-DD HH:mm:ss'),
            status: 'active'
        });
        saveUsers(users);
        
        // Hapus dari pending
        pending.pending = pending.pending.filter(p => p.id !== pendingId);
        savePending(pending);
        
        // Update message owner
        bot.editMessageText(`
╔══════════════════════════╗
║  ✅ APPROVED!           ║
╠══════════════════════════╣
║  Username : ${pendingUser.username}
║  Status   : Active
╚══════════════════════════╝
        `, { chat_id: chatId, message_id: messageId });
        
        // Notifikasi ke user
        bot.sendMessage(pendingUser.telegramId, `
╔══════════════════════════╗
║  ✅ REGISTRATION APPROVED!
╠══════════════════════════╣
║  Username : ${pendingUser.username}
║  Status   : Active
║
║  Silakan login di:
║  ${process.env.CODESPACE_URL || 'Server URL'}
╚══════════════════════════╝
        `);
        
        bot.answerCallbackQuery(callbackQuery.id, { text: 'Approved!' });
    }
    
    if (data.startsWith('reject_')) {
        const pendingId = data.replace('reject_', '');
        const pendingUser = pending.pending.find(p => p.id === pendingId);
        
        if (!pendingUser) {
            return bot.answerCallbackQuery(callbackQuery.id, { text: 'Not found!' });
        }
        
        pending.pending = pending.pending.filter(p => p.id !== pendingId);
        savePending(pending);
        
        bot.editMessageText(`
╔══════════════════════════╗
║  ❌ REJECTED!           ║
╠══════════════════════════╣
║  Username : ${pendingUser.username}
║  Status   : Rejected
╚══════════════════════════╝
        `, { chat_id: chatId, message_id: messageId });
        
        bot.sendMessage(pendingUser.telegramId, '❌ Registrasi Anda ditolak oleh owner.');
        bot.answerCallbackQuery(callbackQuery.id, { text: 'Rejected!' });
    }
});

// Command owner untuk approve/reject via text
bot.onText(/\/approve_(.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId !== OWNER_ID) return;
    
    const pendingId = match[1].trim();
    const pending = loadPending();
    const pendingUser = pending.pending.find(p => p.id === pendingId);
    
    if (!pendingUser) {
        return bot.sendMessage(chatId, 'Pending ID not found.');
    }
    
    const users = loadUsers();
    users.users.push({
        id: crypto.randomBytes(8).toString('hex'),
        username: pendingUser.username,
        password: pendingUser.password,
        telegramId: pendingUser.telegramId,
        registeredAt: moment().format('YYYY-MM-DD HH:mm:ss'),
        status: 'active'
    });
    saveUsers(users);
    
    pending.pending = pending.pending.filter(p => p.id !== pendingId);
    savePending(pending);
    
    bot.sendMessage(chatId, `✅ User ${pendingUser.username} approved!`);
    bot.sendMessage(pendingUser.telegramId, '✅ Registrasi Anda telah disetujui! Silakan login.');
});

bot.onText(/\/reject_(.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId !== OWNER_ID) return;
    
    const pendingId = match[1].trim();
    const pending = loadPending();
    const pendingUser = pending.pending.find(p => p.id === pendingId);
    
    if (!pendingUser) {
        return bot.sendMessage(chatId, 'Pending ID not found.');
    }
    
    pending.pending = pending.pending.filter(p => p.id !== pendingId);
    savePending(pending);
    
    bot.sendMessage(chatId, `❌ User ${pendingUser.username} rejected!`);
    bot.sendMessage(pendingUser.telegramId, '❌ Registrasi Anda ditolak.');
});

bot.onText(/\/users/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId !== OWNER_ID) {
        return bot.sendMessage(chatId, 'Unauthorized.');
    }
    
    const users = loadUsers();
    if (users.users.length === 0) {
        return bot.sendMessage(chatId, 'No registered users.');
    }
    
    let userList = '👥 Registered Users:\n\n';
    users.users.forEach((u, i) => {
        userList += `${i+1}. ${u.username} - ${u.status}\n`;
    });
    
    bot.sendMessage(chatId, userList);
});

bot.onText(/\/pending/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId !== OWNER_ID) {
        return bot.sendMessage(chatId, 'Unauthorized.');
    }
    
    const pending = loadPending();
    if (pending.pending.length === 0) {
        return bot.sendMessage(chatId, 'No pending approvals.');
    }
    
    let pendingList = '⏳ Pending Approvals:\n\n';
    pending.pending.forEach((p, i) => {
        pendingList += `${i+1}. ${p.username} (ID: ${p.id})\n`;
        pendingList += `   Telegram: @${p.telegramName}\n`;
        pendingList += `   /approve_${p.id} | /reject_${p.id}\n\n`;
    });
    
    bot.sendMessage(chatId, pendingList);
});

bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    const users = loadUsers();
    const pending = loadPending();
    
    const statusText = `
╔══════════════════════════╗
║  🐍 SERVER STATUS       ║
╠══════════════════════════╣
║  Status   : Online 🟢
║  Users    : ${users.users.length}
║  Pending  : ${pending.pending.length}
║  Port     : ${PORT}
║  Uptime   : ${process.uptime().toFixed(0)}s
╚══════════════════════════╝
    `;
    
    bot.sendMessage(chatId, statusText);
});

bot.onText(/\/myid/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `Your Telegram ID: ${chatId}`);
});

bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `
📚 Panduan Registrasi:
1. Daftar via Telegram: /register [username] [password]
2. Tunggu persetujuan owner
3. Setelah disetujui, login di website
4. Akses fitur spam OTP & pairing

📞 Contact: t.me/Ranzkecebet
    `);
});

// Print banner
function printBanner() {
    console.clear();
    console.log('');
    console.log(`${c.bgMagenta}${c.bright}${c.white} ╔══════════════════════════════════════════════════════════════╗ ${c.reset}`);
    console.log(`${c.bgMagenta}${c.bright}${c.white} ║    🐍 RANZ WORM V3 - TELEGRAM AUTH + SPAM SYSTEM 🐍       ║ ${c.reset}`);
    console.log(`${c.bgMagenta}${c.bright}${c.white} ║    Engineered by Ranzkecebet | Owner Mode                 ║ ${c.reset}`);
    console.log(`${c.bgMagenta}${c.bright}${c.white} ╚══════════════════════════════════════════════════════════════╝ ${c.reset}`);
    console.log('');
    console.log(`${c.cyan}[+]${c.reset} Bot Token: ${c.yellow}${BOT_TOKEN.substring(0, 20)}...${c.reset}`);
    console.log(`${c.cyan}[+]${c.reset} Owner ID: ${c.yellow}${OWNER_ID}${c.reset}`);
    console.log(`${c.cyan}[+]${c.reset} Server Port: ${c.yellow}${PORT}${c.reset}`);
    console.log(`${c.cyan}[+]${c.reset} Users DB: ${c.yellow}${USERS_FILE}${c.reset}`);
    console.log(`${c.cyan}[+]${c.reset} Bot Status: ${c.green}Active${c.reset}`);
    console.log('');
}

// Routes
app.get('/', (req, res) => {
    const clientIP = getClientIP(req);
    console.log(`${c.blue}[${moment().format('HH:mm:ss')}]${c.reset} ${c.cyan}Visitor:${c.reset} ${c.yellow}${clientIP}${c.reset}`);
    
    res.send(loginPageHTML);
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const clientIP = getClientIP(req);
    const users = loadUsers();
    
    const user = users.users.find(u => u.username === username && u.password === password);
    
    if (!user) {
        return res.json({ status: 'error', message: 'Invalid username or password.' });
    }
    
    if (user.status !== 'active') {
        return res.json({ status: 'error', message: 'Account not active. Wait for approval.' });
    }
    
    // Set session
    res.cookie('session', user.id, { maxAge: 3600000, httpOnly: true });
    
    console.log(`${c.green}[LOGIN]${c.reset} ${username} logged in from ${clientIP}`);
    
    res.json({ 
        status: 'success', 
        message: 'Login successful!',
        userId: user.id,
        username: user.username
    });
});

app.post('/spam-otp', (req, res) => {
    const { target, count, userId } = req.body;
    
    if (!target || !count || !userId) {
        return res.json({ status: 'error', message: 'Missing parameters.' });
    }
    
    console.log(`${c.yellow}[SPAM OTP]${c.reset} Target: ${target}, Count: ${count}, User: ${userId}`);
    
    spamOTP(target, parseInt(count), 'mixed').then(results => {
        res.json({ 
            status: 'success', 
            message: `Sent ${results.length} OTP messages to ${target}`,
            results: results
        });
    });
});

app.post('/spam-pairing', (req, res) => {
    const { target, count, userId } = req.body;
    
    if (!target || !count || !userId) {
        return res.json({ status: 'error', message: 'Missing parameters.' });
    }
    
    console.log(`${c.cyan}[SPAM PAIR]${c.reset} Target: ${target}, Count: ${count}, User: ${userId}`);
    
    spamPairing(target, parseInt(count)).then(results => {
        res.json({ 
            status: 'success', 
            message: `Sent ${results.length} pairing codes to ${target}`,
            results: results
        });
    });
});

app.get('/check-session', (req, res) => {
    const sessionId = req.cookies.session;
    if (!sessionId) {
        return res.json({ status: 'error', message: 'No session.' });
    }
    
    const users = loadUsers();
    const user = users.users.find(u => u.id === sessionId);
    
    if (!user) {
        return res.json({ status: 'error', message: 'Invalid session.' });
    }
    
    res.json({ status: 'success', username: user.username, userId: user.id });
});

// HTML Pages
const loginPageHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ranz System - Login</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Inter:wght@300;400;500;600;700&display=swap');
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Inter', sans-serif;
            background: linear-gradient(135deg, #0a0a0f 0%, #1a0a2e 30%, #0d1b2a 60%, #0a0a0f 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            overflow: hidden;
            position: relative;
        }
        
        .particles {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 0;
        }
        
        .particle {
            position: absolute;
            width: 2px;
            height: 2px;
            background: #8b5cf6;
            border-radius: 50%;
            animation: float 6s infinite;
            opacity: 0;
        }
        
        @keyframes float {
            0% { transform: translateY(100vh) scale(0); opacity: 0; }
            10% { opacity: 1; }
            90% { opacity: 1; }
            100% { transform: translateY(-100vh) scale(1.5); opacity: 0; }
        }
        
        .grid-bg {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: 
                linear-gradient(rgba(139, 92, 246, 0.03) 1px, transparent 1px),
                linear-gradient(90deg, rgba(139, 92, 246, 0.03) 1px, transparent 1px);
            background-size: 50px 50px;
            z-index: 0;
        }
        
        .container {
            position: relative;
            z-index: 1;
            width: 440px;
            max-width: 95%;
        }
        
        .login-card {
            background: rgba(15, 15, 25, 0.8);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid rgba(139, 92, 246, 0.3);
            border-radius: 24px;
            padding: 48px 36px;
            box-shadow: 
                0 0 60px rgba(139, 92, 246, 0.1),
                0 0 120px rgba(139, 92, 246, 0.05),
                inset 0 0 30px rgba(139, 92, 246, 0.05);
            position: relative;
            overflow: hidden;
        }
        
        .login-card::before {
            content: '';
            position: absolute;
            top: -50%;
            left: -50%;
            width: 200%;
            height: 200%;
            background: radial-gradient(circle, rgba(139, 92, 246, 0.1) 0%, transparent 70%);
            animation: rotate 20s linear infinite;
        }
        
        @keyframes rotate {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .card-content {
            position: relative;
            z-index: 1;
        }
        
        .logo-section {
            text-align: center;
            margin-bottom: 32px;
        }
        
        .logo-icon {
            width: 64px;
            height: 64px;
            background: linear-gradient(135deg, #8b5cf6, #6d28d9);
            border-radius: 16px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 16px;
            box-shadow: 0 0 30px rgba(139, 92, 246, 0.4);
            position: relative;
        }
        
        .logo-icon::after {
            content: '';
            position: absolute;
            inset: -3px;
            border-radius: 19px;
            background: linear-gradient(135deg, #8b5cf6, #ec4899, #8b5cf6);
            z-index: -1;
            animation: borderGlow 2s infinite;
        }
        
        @keyframes borderGlow {
            0%, 100% { opacity: 0.5; }
            50% { opacity: 1; }
        }
        
        .logo-icon svg {
            width: 32px;
            height: 32px;
            fill: white;
        }
        
        .system-name {
            font-family: 'Orbitron', sans-serif;
            font-size: 28px;
            font-weight: 900;
            background: linear-gradient(135deg, #8b5cf6, #c084fc, #ec4899);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            letter-spacing: 2px;
            margin-bottom: 4px;
        }
        
        .system-subtitle {
            font-size: 12px;
            color: rgba(255, 255, 255, 0.4);
            font-family: 'Orbitron', sans-serif;
            letter-spacing: 4px;
            text-transform: uppercase;
        }
        
        .input-group {
            margin-bottom: 20px;
            position: relative;
        }
        
        .input-group label {
            display: block;
            font-size: 13px;
            font-weight: 500;
            color: rgba(255, 255, 255, 0.6);
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .input-wrapper {
            position: relative;
        }
        
        .input-wrapper .icon {
            position: absolute;
            left: 16px;
            top: 50%;
            transform: translateY(-50%);
            color: rgba(255, 255, 255, 0.3);
            z-index: 2;
        }
        
        .input-field {
            width: 100%;
            padding: 14px 16px 14px 48px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            color: white;
            font-size: 15px;
            font-family: 'Inter', sans-serif;
            transition: all 0.3s ease;
            outline: none;
        }
        
        .input-field:focus {
            border-color: #8b5cf6;
            box-shadow: 0 0 20px rgba(139, 92, 246, 0.15);
            background: rgba(139, 92, 246, 0.05);
        }
        
        .input-field::placeholder {
            color: rgba(255, 255, 255, 0.2);
        }
        
        .login-btn {
            width: 100%;
            padding: 15px;
            background: linear-gradient(135deg, #8b5cf6, #6d28d9);
            border: none;
            border-radius: 12px;
            color: white;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
            font-family: 'Inter', sans-serif;
            letter-spacing: 1px;
            margin-top: 8px;
        }
        
        .login-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 30px rgba(139, 92, 246, 0.4);
        }
        
        .login-btn:active {
            transform: translateY(0);
        }
        
        .login-btn::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
            transition: left 0.5s;
        }
        
        .login-btn:hover::before {
            left: 100%;
        }
        
        .register-link {
            text-align: center;
            margin-top: 24px;
            padding-top: 24px;
            border-top: 1px solid rgba(255, 255, 255, 0.05);
        }
        
        .register-link p {
            font-size: 13px;
            color: rgba(255, 255, 255, 0.4);
        }
        
        .register-link a {
            color: #8b5cf6;
            text-decoration: none;
            font-weight: 600;
            transition: color 0.3s;
        }
        
        .register-link a:hover {
            color: #c084fc;
        }
        
        .telegram-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(0, 136, 204, 0.2);
            border: 1px solid rgba(0, 136, 204, 0.3);
            border-radius: 20px;
            padding: 6px 14px;
            font-size: 12px;
            color: #2ea6d6;
            margin-top: 10px;
        }
        
        .error-message {
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.3);
            border-radius: 10px;
            padding: 12px;
            color: #ef4444;
            font-size: 13px;
            text-align: center;
            margin-top: 12px;
            display: none;
        }
        
        .error-message.show {
            display: block;
        }
        
        .loading-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.9);
            z-index: 1000;
            flex-direction: column;
            justify-content: center;
            align-items: center;
        }
        
        .loading-overlay.show {
            display: flex;
        }
        
        .verification-box {
            background: rgba(15, 15, 25, 0.9);
            border: 1px solid rgba(139, 92, 246, 0.3);
            border-radius: 20px;
            padding: 40px;
            text-align: center;
            width: 380px;
            max-width: 90%;
        }
        
        .verification-steps {
            display: flex;
            flex-direction: column;
            gap: 16px;
            margin: 24px 0;
        }
        
        .verification-step {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 16px;
            background: rgba(255,255,255,0.03);
            border-radius: 10px;
            border: 1px solid rgba(255,255,255,0.05);
        }
        
        .step-icon {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: rgba(139, 92, 246, 0.2);
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }
        
        .step-icon.complete {
            background: rgba(34, 197, 94, 0.2);
        }
        
        .step-icon.loading {
            animation: pulse 1.5s infinite;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 0.5; }
            50% { opacity: 1; }
        }
        
        .step-text {
            color: rgba(255,255,255,0.6);
            font-size: 13px;
            flex: 1;
            text-align: left;
        }
        
        .step-text.complete {
            color: #22c55e;
        }
        
        .spinner {
            width: 48px;
            height: 48px;
            border: 3px solid rgba(139, 92, 246, 0.2);
            border-top-color: #8b5cf6;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin: 20px auto;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        .dashboard {
            display: none;
        }
        
        .dashboard.show {
            display: block;
        }
        
        .dash-card {
            background: rgba(15, 15, 25, 0.8);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(139, 92, 246, 0.3);
            border-radius: 20px;
            padding: 32px;
            box-shadow: 0 0 40px rgba(139, 92, 246, 0.1);
        }
        
        .dash-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 28px;
            padding-bottom: 20px;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        
        .dash-title {
            font-family: 'Orbitron', sans-serif;
            font-size: 20px;
            font-weight: 700;
            color: white;
        }
        
        .dash-username {
            color: #8b5cf6;
            font-size: 14px;
        }
        
        .menu-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
            margin-bottom: 24px;
        }
        
        .menu-item {
            padding: 16px;
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            text-align: center;
            cursor: pointer;
            transition: all 0.3s;
            color: white;
            font-size: 13px;
        }
        
        .menu-item:hover {
            background: rgba(139, 92, 246, 0.1);
            border-color: rgba(139, 92, 246, 0.3);
        }
        
        .menu-item.active {
            background: rgba(139, 92, 246, 0.2);
            border-color: #8b5cf6;
            box-shadow: 0 0 20px rgba(139, 92, 246, 0.2);
        }
        
        .menu-item-icon {
            font-size: 24px;
            margin-bottom: 8px;
        }
        
        .target-input-section {
            display: none;
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid rgba(255,255,255,0.05);
        }
        
        .target-input-section.show {
            display: block;
        }
        
        .send-btn {
            width: 100%;
            padding: 14px;
            background: linear-gradient(135deg, #ef4444, #dc2626);
            border: none;
            border-radius: 12px;
            color: white;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
            margin-top: 16px;
            letter-spacing: 1px;
        }
        
        .send-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 25px rgba(239, 68, 68, 0.4);
        }
        
        .result-box {
            margin-top: 16px;
            padding: 16px;
            background: rgba(0,0,0,0.3);
            border-radius: 10px;
            max-height: 200px;
            overflow-y: auto;
            font-size: 12px;
            color: rgba(255,255,255,0.7);
            display: none;
        }
        
        .result-box.show {
            display: block;
        }
        
        .result-item {
            padding: 6px 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        
        .logout-btn {
            background: transparent;
            border: 1px solid rgba(239, 68, 68, 0.3);
            color: #ef4444;
            padding: 8px 16px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.3s;
        }
        
        .logout-btn:hover {
            background: rgba(239, 68, 68, 0.1);
        }
        
        .footer-text {
            text-align: center;
            margin-top: 20px;
            font-size: 11px;
            color: rgba(255,255,255,0.2);
            letter-spacing: 2px;
        }
    </style>
</head>
<body>

    <div class="grid-bg"></div>
    <div class="particles" id="particles"></div>

    <!-- Login Page -->
    <div class="container" id="login-page">
        <div class="login-card">
            <div class="card-content">
                <div class="logo-section">
                    <div class="logo-icon">
                        <svg viewBox="0 0 24 24">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                        </svg>
                    </div>
                    <div class="system-name">RANZ SYSTEM</div>
                    <div class="system-subtitle">Authentication Portal</div>
                </div>
                
                <form id="login-form">
                    <div class="input-group">
                        <label>Username</label>
                        <div class="input-wrapper">
                            <span class="icon">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/></svg>
                            </span>
                            <input type="text" class="input-field" id="username" placeholder="Enter username" required>
                        </div>
                    </div>
                    
                    <div class="input-group">
                        <label>Password</label>
                        <div class="input-wrapper">
                            <span class="icon">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                            </span>
                            <input type="password" class="input-field" id="password" placeholder="Enter password" required>
                        </div>
                    </div>
                    
                    <div class="error-message" id="login-error"></div>
                    
                    <button type="submit" class="login-btn">AUTHENTICATE</button>
                </form>
                
                <div class="register-link">
                    <p>Belum punya akun?</p>
                    <a href="https://t.me/RanzWormBot" target="_blank">Daftar via Telegram</a>
                    <div class="telegram-badge">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.05-.2-.07-.05-.17-.03-.24-.02-.1.02-1.73 1.1-4.88 3.22-.46.32-.88.47-1.25.46-.41-.01-1.2-.23-1.79-.42-.72-.24-1.29-.36-1.24-.76.03-.21.31-.42.85-.64 3.34-1.45 5.56-2.41 6.67-2.87 3.17-1.32 3.83-1.55 4.26-1.56.09 0 .3.02.43.13.11.09.14.22.15.26.01.04.02.15.01.24z"/></svg>
                        @RanzWormBot
                    </div>
                </div>
            </div>
        </div>
        <div class="footer-text">ENGINEERED BY RANZKECEBET</div>
    </div>

    <!-- Loading Overlay -->
    <div class="loading-overlay" id="loading-overlay">
        <div class="verification-box">
            <div class="system-name" style="font-size:20px;">VERIFYING</div>
            <div class="spinner"></div>
            <div class="verification-steps">
                <div class="verification-step" id="step1">
                    <div class="step-icon loading">🔐</div>
                    <span class="step-text">Verifying credentials...</span>
                </div>
                <div class="verification-step" id="step2">
                    <div class="step-icon">📡</div>
                    <span class="step-text">Connecting to server...</span>
                </div>
                <div class="verification-step" id="step3">
                    <div class="step-icon">🛡️</div>
                    <span class="step-text">Security check...</span>
                </div>
                <div class="verification-step" id="step4">
                    <div class="step-icon">✅</div>
                    <span class="step-text">Loading dashboard...</span>
                </div>
            </div>
        </div>
    </div>

    <!-- Dashboard -->
    <div class="container dashboard" id="dashboard">
        <div class="dash-card">
            <div class="dash-header">
                <div>
                    <div class="dash-title">DASHBOARD</div>
                    <div class="dash-username" id="dash-username"></div>
                </div>
                <button class="logout-btn" onclick="logout()">LOGOUT</button>
            </div>
            
            <div style="color:rgba(255,255,255,0.6);font-size:13px;margin-bottom:16px;">Pilih Menu:</div>
            
            <div class="menu-grid">
                <div class="menu-item" data-menu="otp" onclick="selectMenu('otp', this)">
                    <div class="menu-item-icon">📱</div>
                    <div>Spam OTP</div>
                </div>
                <div class="menu-item" data-menu="pairing" onclick="selectMenu('pairing', this)">
                    <div class="menu-item-icon">🔗</div>
                    <div>Spam Pairing</div>
                </div>
                <div class="menu-item" data-menu="none" onclick="selectMenu('none', this)">
                    <div class="menu-item-icon">🚫</div>
                    <div>Tidak Ada</div>
                </div>
            </div>
            
            <div class="target-input-section" id="target-section">
                <div class="input-group">
                    <label>Nomor Target (WhatsApp)</label>
                    <div class="input-wrapper">
                        <span class="icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
                        </span>
                        <input type="text" class="input-field" id="target-number" placeholder="628xxxxxxxxxx" required>
                    </div>
                </div>
                
                <div class="input-group">
                    <label>Jumlah</label>
                    <div class="input-wrapper">
                        <input type="number" class="input-field" id="spam-count" value="10" min="1" max="100" required style="padding-left:16px;">
                    </div>
                </div>
                
                <button class="send-btn" onclick="executeSpam()">SEND ATTACK</button>
                
                <div class="result-box" id="result-box"></div>
            </div>
        </div>
    </div>

    <script>
        let selectedMenu = 'none';
        let currentUser = null;
        
        // Generate particles
        function createParticles() {
            const container = document.getElementById('particles');
            for (let i = 0; i < 50; i++) {
                const particle = document.createElement('div');
                particle.className = 'particle';
                particle.style.left = Math.random() * 100 + '%';
                particle.style.animationDelay = Math.random() * 6 + 's';
                particle.style.animationDuration = (4 + Math.random() * 8) + 's';
                particle.style.width = (1 + Math.random() * 3) + 'px';
                particle.style.height = particle.style.width;
                container.appendChild(particle);
            }
        }
        
        createParticles();
        
        // Check existing session
        async function checkSession() {
            try {
                const res = await fetch('/check-session');
                const data = await res.json();
                if (data.status === 'success') {
                    currentUser = data;
                    showDashboard(data.username);
                }
            } catch(e) {}
        }
        
        checkSession();
        
        // Login form
        document.getElementById('login-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value.trim();
            const errorEl = document.getElementById('login-error');
            
            if (!username || !password) {
                errorEl.textContent = 'Please fill all fields.';
                errorEl.classList.add('show');
                return;
            }
            
            // Tampilkan loading
            document.getElementById('loading-overlay').classList.add('show');
            document.getElementById('login-form').querySelector('.login-btn').disabled = true;
            
            // Animasi verifikasi steps
            const steps = ['step1', 'step2', 'step3', 'step4'];
            for (let i = 0; i < steps.length; i++) {
                await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 600));
                const stepEl = document.getElementById(steps[i]);
                const iconEl = stepEl.querySelector('.step-icon');
                iconEl.classList.remove('loading');
                iconEl.classList.add('complete');
                iconEl.textContent = '✓';
                stepEl.querySelector('.step-text').classList.add('complete');
            }
            
            // Kirim login request
            try {
                const res = await fetch('/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                
                const data = await res.json();
                
                if (data.status === 'success') {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    document.getElementById('loading-overlay').classList.remove('show');
                    currentUser = data;
                    showDashboard(data.username);
                } else {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    document.getElementById('loading-overlay').classList.remove('show');
                    errorEl.textContent = data.message || 'Login failed.';
                    errorEl.classList.add('show');
                    document.getElementById('login-form').querySelector('.login-btn').disabled = false;
                }
            } catch(err) {
                document.getElementById('loading-overlay').classList.remove('show');
                errorEl.textContent = 'Connection error. Please try again.';
                errorEl.classList.add('show');
                document.getElementById('login-form').querySelector('.login-btn').disabled = false;
            }
        });
        
        function showDashboard(username) {
            document.getElementById('login-page').style.display = 'none';
            document.getElementById('dashboard').classList.add('show');
            document.getElementById('dash-username').textContent = '@' + username;
        }
        
        function logout() {
            document.cookie = 'session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
            document.getElementById('dashboard').classList.remove('show');
            document.getElementById('login-page').style.display = 'block';
            document.getElementById('username').value = '';
            document.getElementById('password').value = '';
            currentUser = null;
            selectedMenu = 'none';
            document.getElementById('target-section').classList.remove('show');
            document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
        }
        
        function selectMenu(menu, element) {
            selectedMenu = menu;
            document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
            element.classList.add('active');
            
            const targetSection = document.getElementById('target-section');
            if (menu === 'none') {
                targetSection.classList.remove('show');
            } else {
                targetSection.classList.add('show');
                document.getElementById('target-number').focus();
            }
        }
        
        async function executeSpam() {
            const target = document.getElementById('target-number').value.trim();
            const count = document.getElementById('spam-count').value;
            const resultBox = document.getElementById('result-box');
            
            if (!target) {
                alert('Masukkan nomor target!');
                return;
            }
            
            if (!currentUser) {
                alert('Session expired. Silakan login ulang.');
                logout();
                return;
            }
            
            if (selectedMenu === 'none') {
                alert('Pilih menu terlebih dahulu!');
                return;
            }
            
            const sendBtn = document.querySelector('.send-btn');
            sendBtn.disabled = true;
            sendBtn.textContent = 'SENDING...';
            
            resultBox.classList.add('show');
            resultBox.innerHTML = '<div style="color:#8b5cf6;">Processing...</div>';
            
            const endpoint = selectedMenu === 'otp' ? '/spam-otp' : '/spam-pairing';
            
            try {
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        target: target,
                        count: parseInt(count),
                        userId: currentUser.userId
                    })
                });
                
                const data = await res.json();
                
                if (data.status === 'success') {
                    let resultHTML = '<div style="color:#22c55e;margin-bottom:8px;">✅ ' + data.message + '</div>';
                    if (data.results) {
                        data.results.forEach(r => {
                            resultHTML += '<div class="result-item">';
                            if (selectedMenu === 'otp') {
                                resultHTML += '#' + r.number + ' | ' + r.service + ' | OTP: ' + r.otp + ' | <span style="color:#22c55e">' + r.status + '</span>';
                            } else {
                                resultHTML += '#' + r.number + ' | Code: ' + r.code + ' | <span style="color:#22c55e">' + r.status + '</span>';
                            }
                            resultHTML += '</div>';
                        });
                    }
                    resultBox.innerHTML = resultHTML;
                } else {
                    resultBox.innerHTML = '<div style="color:#ef4444;">❌ ' + data.message + '</div>';
                }
            } catch(err) {
                resultBox.innerHTML = '<div style="color:#ef4444;">Connection error</div>';
            }
            
            sendBtn.disabled = false;
            sendBtn.textContent = 'SEND ATTACK';
        }
    </script>
</body>
</html>
`;

// Start server
app.listen(PORT, '0.0.0.0', () => {
    printBanner();
    logToFile('Server started on port ' + PORT);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log(`\n${c.yellow}[!]${c.reset} Shutting down...`);
    bot.stopPolling();
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    console.log(`${c.red}[ERROR]${c.reset} ${err.message}`);
    logToFile('Error: ' + err.message);
});

console.log(`${c.green}[+]${c.reset} System ready. Waiting for connections...`);
