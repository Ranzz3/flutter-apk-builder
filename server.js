const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const fs = require('fs-extra');
const path = require('path');
const uuid = require('uuid');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const moment = require('moment');
const { exec, spawn } = require('child_process');

// ═══════════════════════════════════════════
//  KONFIGURASI
// ═══════════════════════════════════════════
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const SERVERS_DIR = path.join(__dirname, 'servers');
const EGGS_DIR = path.join(__dirname, 'eggs');
const TEMP_DIR = path.join(__dirname, 'temp');

[ DATA_DIR, SERVERS_DIR, EGGS_DIR, TEMP_DIR ].forEach(dir => {
    fs.ensureDirSync(dir);
});

// ═══════════════════════════════════════════
//  DATABASE
// ═══════════════════════════════════════════
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SERVERS_FILE = path.join(DATA_DIR, 'servers.json');
const API_KEYS_FILE = path.join(DATA_DIR, 'apikeys.json');

if (!fs.existsSync(USERS_FILE)) fs.writeJsonSync(USERS_FILE, []);
if (!fs.existsSync(SERVERS_FILE)) fs.writeJsonSync(SERVERS_FILE, []);
if (!fs.existsSync(API_KEYS_FILE)) fs.writeJsonSync(API_KEYS_FILE, []);

// ═══════════════════════════════════════════
//  EXPRESS + SOCKET.IO
// ═══════════════════════════════════════════
const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    maxHttpBufferSize: 100 * 1024 * 1024
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(__dirname));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/servers', express.static(SERVERS_DIR));

// Multer untuk file upload
const upload = multer({ dest: TEMP_DIR });

// ═══════════════════════════════════════════
//  MODEL
// ═══════════════════════════════════════════
const Users = {
    all: () => fs.readJsonSync(USERS_FILE),
    find: (id) => Users.all().find(u => u.id === id),
    findByEmail: (email) => Users.all().find(u => u.email === email),
    create: (data) => {
        const users = Users.all();
        users.push(data);
        fs.writeJsonSync(USERS_FILE, users);
        return data;
    },
    update: (id, data) => {
        const users = Users.all();
        const idx = users.findIndex(u => u.id === id);
        if (idx !== -1) {
            users[idx] = { ...users[idx], ...data };
            fs.writeJsonSync(USERS_FILE, users);
        }
        return users[idx];
    }
};

const Servers = {
    all: () => fs.readJsonSync(SERVERS_FILE),
    find: (id) => Servers.all().find(s => s.id === id),
    findByUser: (userId) => Servers.all().filter(s => s.userId === userId),
    create: (data) => {
        const servers = Servers.all();
        servers.push(data);
        fs.writeJsonSync(SERVERS_FILE, servers);
        return data;
    },
    update: (id, data) => {
        const servers = Servers.all();
        const idx = servers.findIndex(s => s.id === id);
        if (idx !== -1) {
            servers[idx] = { ...servers[idx], ...data };
            fs.writeJsonSync(SERVERS_FILE, servers);
        }
        return servers[idx];
    },
    delete: (id) => {
        const servers = Servers.all().filter(s => s.id !== id);
        fs.writeJsonSync(SERVERS_FILE, servers);
    }
};

// ═══════════════════════════════════════════
//  SERVER PROCESS MANAGER
// ═══════════════════════════════════════════
const serverProcesses = new Map();

function startServerProcess(serverId) {
    const serverData = Servers.find(serverId);
    if (!serverData) return false;
    
    // Hentikan proses lama jika ada
    stopServerProcess(serverId);
    
    const serverDir = path.join(SERVERS_DIR, serverId);
    const mainFile = serverData.environment?.SERVER_FILE || 'index.js';
    const mainPath = path.join(serverDir, mainFile);
    
    if (!fs.existsSync(mainPath)) {
        io.to(`server-${serverId}`).emit('console-output', {
            serverId,
            data: `[ERROR] File ${mainFile} tidak ditemukan di ${serverDir}\n`
        });
        return false;
    }
    
    try {
        const proc = spawn('node', [ mainPath ], {
            cwd: serverDir,
            env: {
                ...process.env,
                NODE_ENV: serverData.environment?.NODE_ENV || 'production',
                PORT: serverData.environment?.PORT || serverData.port || '3000'
            },
            stdio: ['pipe', 'pipe', 'pipe']
        });
        
        proc.stdout.on('data', (data) => {
            const output = data.toString();
            io.to(`server-${serverId}`).emit('console-output', { serverId, data: output });
        });
        
        proc.stderr.on('data', (data) => {
            const output = data.toString();
            io.to(`server-${serverId}`).emit('console-output', { serverId, data: `[ERR] ${output}` });
        });
        
        proc.on('close', (code) => {
            io.to(`server-${serverId}`).emit('console-output', {
                serverId,
                data: `\n[PROCESS EXITED] Code: ${code}\n`
            });
            serverProcesses.delete(serverId);
            Servers.update(serverId, { status: 'stopped', lastExitCode: code });
            io.emit('server-status-change', { serverId, status: 'stopped' });
        });
        
        proc.on('error', (err) => {
            io.to(`server-${serverId}`).emit('console-output', {
                serverId,
                data: `\n[ERROR] ${err.message}\n`
            });
            serverProcesses.delete(serverId);
        });
        
        serverProcesses.set(serverId, proc);
        Servers.update(serverId, { status: 'running', lastStartedAt: Date.now() });
        io.emit('server-status-change', { serverId, status: 'running' });
        
        return true;
    } catch (e) {
        io.to(`server-${serverId}`).emit('console-output', {
            serverId,
            data: `\n[FATAL] ${e.message}\n`
        });
        return false;
    }
}

function stopServerProcess(serverId) {
    const proc = serverProcesses.get(serverId);
    if (proc) {
        try {
            proc.kill('SIGTERM');
            setTimeout(() => {
                if (proc.killed === false) proc.kill('SIGKILL');
            }, 5000);
        } catch (e) {}
        serverProcesses.delete(serverId);
    }
    Servers.update(serverId, { status: 'stopped' });
    io.emit('server-status-change', { serverId, status: 'stopped' });
    return true;
}

function sendCommand(serverId, command) {
    const proc = serverProcesses.get(serverId);
    if (proc && proc.stdin) {
        proc.stdin.write(command + '\n');
        return true;
    }
    return false;
}

// ═══════════════════════════════════════════
//  API ROUTES
// ═══════════════════════════════════════════

// ----- AUTH -----
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password, firstName, lastName } = req.body;
        
        if (Users.findByEmail(email)) {
            return res.status(400).json({ error: 'Email sudah terdaftar' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const apiKey = 'ptla_' + uuid.v4().replace(/-/g, '');
        
        const user = Users.create({
            id: uuid.v4(),
            username,
            email,
            password: hashedPassword,
            firstName: firstName || username,
            lastName: lastName || '',
            apiKey,
            isAdmin: Users.all().length === 0,
            createdAt: Date.now(),
            updatedAt: Date.now()
        });
        
        const { password: _, ...userData } = user;
        res.json({ success: true, user: userData });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = Users.findByEmail(email);
        
        if (!user) return res.status(401).json({ error: 'Email tidak ditemukan' });
        
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ error: 'Password salah' });
        
        const { password: _, ...userData } = user;
        res.json({ success: true, user: userData });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ----- SERVERS -----
app.get('/api/servers', (req, res) => {
    const userId = req.query.userId;
    const servers = userId ? Servers.findByUser(userId) : Servers.all();
    res.json({ servers });
});

app.get('/api/servers/:id', (req, res) => {
    const server = Servers.find(req.params.id);
    if (!server) return res.status(404).json({ error: 'Server tidak ditemukan' });
    res.json({ server });
});

app.post('/api/servers', async (req, res) => {
    try {
        const { name, userId, eggId, memory, cpu, disk, environment } = req.body;
        
        const serverId = uuid.v4().substring(0, 8);
        const serverDir = path.join(SERVERS_DIR, serverId);
        fs.ensureDirSync(serverDir);
        
        const server = Servers.create({
            id: serverId,
            name,
            userId,
            eggId: eggId || 'nodejs',
            memory: memory || 512,
            cpu: cpu || 100,
            disk: disk || 1024,
            port: Math.floor(Math.random() * 10000) + 10000,
            environment: environment || { SERVER_FILE: 'index.js', NODE_ENV: 'production' },
            status: 'installing',
            createdAt: Date.now(),
            updatedAt: Date.now()
        });
        
        // Buat file default
        const eggFile = path.join(EGGS_DIR, `${eggId || 'nodejs'}.json`);
        if (fs.existsSync(eggFile)) {
            const egg = fs.readJsonSync(eggFile);
            const startupFile = egg.environment?.SERVER_FILE || 'index.js';
            
            const defaultCode = `// ${name} - Created by Pterodactyl Panel
// Egg: ${egg.name}
// Node.js Server

const http = require('http');

const PORT = process.env.PORT || ${server.port};
const NODE_ENV = process.env.NODE_ENV || 'production';

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: 'online',
        server: '${name}',
        port: PORT,
        env: NODE_ENV,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    }));
});

server.listen(PORT, () => {
    console.log(\`✅ Server ${name} running on port \${PORT}\`);
    console.log(\`📦 Environment: \${NODE_ENV}\`);
});
`;
            fs.writeFileSync(path.join(serverDir, startupFile), defaultCode);
            fs.writeFileSync(path.join(serverDir, 'package.json'), JSON.stringify({
                name: serverId,
                version: '1.0.0',
                main: startupFile,
                scripts: { start: `node ${startupFile}` }
            }, null, 2));
        }
        
        // Auto-start
        setTimeout(() => {
            startServerProcess(serverId);
        }, 2000);
        
        res.json({ success: true, server });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/servers/:id/power', (req, res) => {
    const { action } = req.body;
    const serverId = req.params.id;
    
    switch (action) {
        case 'start':
            startServerProcess(serverId);
            break;
        case 'stop':
            stopServerProcess(serverId);
            break;
        case 'restart':
            stopServerProcess(serverId);
            setTimeout(() => startServerProcess(serverId), 2000);
            break;
        case 'kill':
            stopServerProcess(serverId);
            break;
        default:
            return res.status(400).json({ error: 'Action tidak valid' });
    }
    
    res.json({ success: true, action });
});

app.post('/api/servers/:id/command', (req, res) => {
    const { command } = req.body;
    const serverId = req.params.id;
    
    if (sendCommand(serverId, command)) {
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'Server tidak berjalan' });
    }
});

app.delete('/api/servers/:id', (req, res) => {
    const serverId = req.params.id;
    stopServerProcess(serverId);
    
    const serverDir = path.join(SERVERS_DIR, serverId);
    if (fs.existsSync(serverDir)) {
        fs.removeSync(serverDir);
    }
    
    Servers.delete(serverId);
    res.json({ success: true });
});

// ----- FILES -----
app.get('/api/servers/:id/files', (req, res) => {
    const serverId = req.params.id;
    const serverDir = path.join(SERVERS_DIR, serverId);
    
    if (!fs.existsSync(serverDir)) {
        return res.status(404).json({ error: 'Server directory not found' });
    }
    
    const listFiles = (dir, basePath = '') => {
        const items = [];
        const files = fs.readdirSync(dir);
        
        files.forEach(file => {
            const fullPath = path.join(dir, file);
            const relativePath = path.join(basePath, file);
            const stats = fs.statSync(fullPath);
            
            items.push({
                name: file,
                path: relativePath,
                size: stats.size,
                isDirectory: stats.isDirectory(),
                modified: stats.mtime.toISOString()
            });
        });
        
        return items;
    };
    
    try {
        const files = listFiles(serverDir);
        res.json({ files });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/servers/:id/files/read', (req, res) => {
    const serverId = req.params.id;
    const filePath = req.query.path;
    const fullPath = path.join(SERVERS_DIR, serverId, filePath);
    
    if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'File tidak ditemukan' });
    }
    
    try {
        const content = fs.readFileSync(fullPath, 'utf8');
        res.json({ content, path: filePath });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/servers/:id/files/write', (req, res) => {
    const serverId = req.params.id;
    const { path: filePath, content } = req.body;
    const fullPath = path.join(SERVERS_DIR, serverId, filePath);
    
    try {
        fs.ensureDirSync(path.dirname(fullPath));
        fs.writeFileSync(fullPath, content, 'utf8');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/servers/:id/files/upload', upload.single('file'), (req, res) => {
    const serverId = req.params.id;
    const uploadPath = req.body.path || '';
    const serverDir = path.join(SERVERS_DIR, serverId);
    const destPath = path.join(serverDir, uploadPath, req.file.originalname);
    
    try {
        fs.ensureDirSync(path.dirname(destPath));
        fs.moveSync(req.file.path, destPath, { overwrite: true });
        res.json({ success: true, path: uploadPath + '/' + req.file.originalname });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/servers/:id/files/delete', (req, res) => {
    const serverId = req.params.id;
    const filePath = req.query.path;
    const fullPath = path.join(SERVERS_DIR, serverId, filePath);
    
    try {
        if (fs.existsSync(fullPath)) {
            fs.removeSync(fullPath);
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ----- EGGS -----
app.get('/api/eggs', (req, res) => {
    const eggs = [];
    const files = fs.readdirSync(EGGS_DIR);
    
    files.forEach(file => {
        if (file.endsWith('.json')) {
            const egg = fs.readJsonSync(path.join(EGGS_DIR, file));
            eggs.push(egg);
        }
    });
    
    res.json({ eggs });
});

// ----- STATS -----
app.get('/api/stats', (req, res) => {
    const servers = Servers.all();
    const running = servers.filter(s => s.status === 'running').length;
    const total = servers.length;
    
    res.json({
        servers: { total, running, stopped: total - running },
        users: Users.all().length,
        uptime: process.uptime(),
        memory: process.memoryUsage()
    });
});

// ═══════════════════════════════════════════
//  SOCKET.IO
// ═══════════════════════════════════════════
io.on('connection', (socket) => {
    console.log(`🔗 Client connected: ${socket.id}`);
    
    socket.on('join-server', (serverId) => {
        socket.join(`server-${serverId}`);
        console.log(`📟 ${socket.id} joined server-${serverId}`);
    });
    
    socket.on('leave-server', (serverId) => {
        socket.leave(`server-${serverId}`);
    });
    
    socket.on('send-command', (data) => {
        sendCommand(data.serverId, data.command);
    });
    
    socket.on('disconnect', () => {
        console.log(`❌ Client disconnected: ${socket.id}`);
    });
});

// ═══════════════════════════════════════════
//  HTML PAGES
// ═══════════════════════════════════════════
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/panel', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'panel.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'panel.html'));
});

app.get('/server/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'panel.html'));
});

// ═══════════════════════════════════════════
//  START
// ═══════════════════════════════════════════
server.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║                                          ║
║   🦖 PTERODACTYL PANEL v1.0             ║
║   Codespace Edition                     ║
║                                          ║
╠══════════════════════════════════════════╣
║   Status   : ONLINE                      ║
║   Port     : ${PORT}                         
║   URL      : http://localhost:${PORT}         
║   Panel    : http://localhost:${PORT}/panel    
║   Login    : http://localhost:${PORT}/login    
║   API      : http://localhost:${PORT}/api      
║   Eggs     : ${fs.readdirSync(EGGS_DIR).filter(f => f.endsWith('.json')).length} loaded                    
║   Servers  : ${Servers.all().length} active                      
║   Users    : ${Users.all().length} registered                   
╠══════════════════════════════════════════╣
║   Egg Node.js siap digunakan!           ║
║   Buat server -> Pilih Egg Node.js      ║
║   Upload kode -> Start server           ║
╚══════════════════════════════════════════╝
    `);
});
