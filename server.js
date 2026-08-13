const express = require('express');
const path = require('path');
const https = require('https');
const querystring = require('querystring');
const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_KEY = process.env.ADMIN_KEY || "VALENTILE1234";

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "";
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || "https://boos-checker.onrender.com/api/auth/discord/callback";

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const LOCATIONS = [
    "Norad Military Base",
    "Ridgeway Airport",
    "Crystal Lake Resort",
    "Campos City"
];

const RESPAWN_MINUTES = 60;
const MAX_ACTIVE_SPAWNS_PER_USER = 5; // จำกัดการกด SPAWN ค้างไว้ไม่เกิน 5 ห้อง
const VOTE_RESET_THRESHOLD = 3; // จำนวนโหวตเพื่อ Reset ห้อง

let activeUsers = new Map();
let auditLogs = []; // ประวัติการใช้งานสำหรับแอดมิน

function addAuditLog(action, username, details) {
    const time = new Date().toLocaleTimeString('th-TH');
    auditLogs.unshift({ time, action, username, details });
    if (auditLogs.length > 50) auditLogs.pop(); // เก็บย้อนหลัง 50 รายการ
}

setInterval(() => {
    const now = Date.now();
    for (const [id, user] of activeUsers.entries()) {
        if (now - user.lastSeen > 10000) activeUsers.delete(id);
    }
}, 3000);

let bosses = [];
let idCounter = 1;

// Official 50
for (let i = 1; i <= 50; i++) {
    const serverName = `Official ${String(i).padStart(3, '0')}`;
    const lockedStatus = i > 10; 
    LOCATIONS.forEach(loc => {
        bosses.push({
            id: idCounter++,
            serverType: "Official",
            serverName: serverName,
            location: loc,
            isLocked: lockedStatus,
            allowedUserIds: [],
            allowedUsers: [],
            killedAt: null,
            nextSpawn: null,
            previousNextSpawn: null,
            previousCreatedBy: null,
            previousCreatedById: null,
            resetAt: null,
            createdBy: null,
            createdById: null,
            votes: [] // รายชื่อ User ID ที่กดโหวตแจ้งบอสยังไม่ตาย
        });
    });
}

// Premium 50
for (let i = 1; i <= 50; i++) {
    const serverName = `Premium ${String(i).padStart(3, '0')}`;
    const lockedStatus = i > 10;
    LOCATIONS.forEach(loc => {
        bosses.push({
            id: idCounter++,
            serverType: "Premium",
            serverName: serverName,
            location: loc,
            isLocked: lockedStatus,
            allowedUserIds: [],
            allowedUsers: [],
            killedAt: null,
            nextSpawn: null,
            previousNextSpawn: null,
            previousCreatedBy: null,
            previousCreatedById: null,
            resetAt: null,
            createdBy: null,
            createdById: null,
            votes: []
        });
    });
}

// ---------------- DISCORD OAUTH2 ----------------

app.get('/api/auth/discord/login', (req, res) => {
    if (!DISCORD_CLIENT_ID) return res.status(500).send("ยังไม่ได้ตั้งค่า DISCORD_CLIENT_ID ใน Environment Variables");
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(discordAuthUrl);
});

app.get('/api/auth/discord/callback', (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/?error=no_code');

    const postData = querystring.stringify({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: DISCORD_REDIRECT_URI
    });

    const tokenReq = https.request({
        hostname: 'discord.com',
        path: '/api/oauth2/token',
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData)
        }
    }, (tokenRes) => {
        let body = '';
        tokenRes.on('data', chunk => body += chunk);
        tokenRes.on('end', () => {
            try {
                const tokenData = JSON.parse(body);
                if (!tokenData.access_token) return res.redirect('/?error=token_failed');

                const userReq = https.request({
                    hostname: 'discord.com',
                    path: '/api/users/@me',
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
                }, (userRes) => {
                    let userBody = '';
                    userRes.on('data', chunk => userBody += chunk);
                    userRes.on('end', () => {
                        try {
                            const userData = JSON.parse(userBody);
                            const queryParams = querystring.stringify({
                                discord_id: userData.id,
                                username: userData.username,
                                avatar: userData.avatar
                            });
                            res.redirect(`/?${queryParams}`);
                        } catch (e) {
                            res.redirect('/?error=user_fetch_failed');
                        }
                    });
                });
                userReq.end();
            } catch (e) {
                res.redirect('/?error=token_parse_failed');
            }
        });
    });

    tokenReq.write(postData);
    tokenReq.end();
});

// ---------------- API หน้าเว็บหลัก ----------------

app.get('/api/bosses', (req, res) => {
    const { serverType, location, userId, username } = req.query;

    if (userId && userId !== 'null' && userId !== 'guest') {
        const finalName = (username && username !== 'null' && username !== 'undefined' && username.trim() !== '') ? username : "Guest";
        activeUsers.set(userId, {
            id: userId,
            username: finalName,
            lastSeen: Date.now()
        });
    }

    let filtered = bosses;
    if (serverType) filtered = filtered.filter(b => b.serverType === serverType);
    if (location) filtered = filtered.filter(b => b.location === location);

    const customizedBosses = filtered.map(b => {
        const isUserAllowed = userId && b.allowedUserIds && b.allowedUserIds.includes(userId);
        const isLockedForThisUser = b.isLocked && !isUserAllowed;
        return {
            ...b,
            isLocked: isLockedForThisUser,
            voteCount: b.votes ? b.votes.length : 0,
            hasVoted: userId && b.votes ? b.votes.includes(userId) : false
        };
    });

    res.json({
        serverTime: Date.now(),
        onlineCount: activeUsers.size || 1,
        bosses: customizedBosses
    });
});

app.post('/api/bosses/spawn', (req, res) => {
    const { id, username, userId } = req.body;
    const boss = bosses.find(b => b.id === Number(id));
    
    if (boss) {
        const isUserAllowed = userId && boss.allowedUserIds && boss.allowedUserIds.includes(userId);
        if (boss.isLocked && !isUserAllowed) {
            return res.status(403).json({ success: false, message: "ห้องนี้ต้องได้รับการปลดล็อก VIP เฉพาะบุคคล" });
        }
        if (boss.nextSpawn && new Date(boss.nextSpawn) > new Date()) {
            return res.status(400).json({ success: false, message: "ช่องนี้กำลังใช้งานอยู่" });
        }

        // ตรวจสอบจำนวน SPAWN ค้างไว้ของผู้ใช้
        const userActiveSpawns = bosses.filter(b => b.createdById === userId && b.nextSpawn && new Date(b.nextSpawn) > new Date());
        if (userActiveSpawns.length >= MAX_ACTIVE_SPAWNS_PER_USER) {
            return res.status(400).json({ success: false, message: `คุณกด SPAWN ค้างไว้เกิน ${MAX_ACTIVE_SPAWNS_PER_USER} ห้องแล้ว! กรุณารอบอสเกิดหรือกด RESET ห้องเดิมก่อน` });
        }

        const now = new Date();
        boss.killedAt = now.toISOString();
        boss.nextSpawn = new Date(now.getTime() + RESPAWN_MINUTES * 60000).toISOString();
        boss.createdBy = username || "Guest";
        boss.createdById = userId || null;
        boss.previousNextSpawn = null;
        boss.previousCreatedBy = null;
        boss.previousCreatedById = null;
        boss.resetAt = null;
        boss.votes = [];

        addAuditLog("SPAWN", username || "Guest", `${boss.serverName} (${boss.location})`);
        return res.json({ success: true, boss });
    }
    res.status(404).json({ success: false, message: "Boss not found" });
});

app.post('/api/bosses/reset', (req, res) => {
    const { id, userId, username } = req.body;
    const boss = bosses.find(b => b.id === Number(id));
    
    if (boss) {
        if (boss.createdById && boss.createdById !== userId) {
            return res.status(403).json({ success: false, message: "คุณไม่ใช่เจ้าของช่องนี้ ไม่สามารถกด RESET ได้" });
        }

        if (boss.nextSpawn) {
            boss.previousNextSpawn = boss.nextSpawn;
            boss.previousCreatedBy = boss.createdBy;
            boss.previousCreatedById = boss.createdById;
            boss.resetAt = new Date().toISOString();
        }
        boss.killedAt = null;
        boss.nextSpawn = null;
        boss.createdBy = null;
        boss.createdById = null;
        boss.votes = [];

        addAuditLog("RESET", username || "Guest", `${boss.serverName} (${boss.location})`);
        return res.json({ success: true, boss });
    }
    res.status(404).json({ success: false, message: "Boss not found" });
});

app.post('/api/bosses/undo', (req, res) => {
    const { id, username, userId } = req.body;
    const boss = bosses.find(b => b.id === Number(id));
    
    if (boss) {
        if (!boss.previousNextSpawn || !boss.resetAt) {
            return res.status(400).json({ success: false, message: "ไม่มีข้อมูลสำหรับ Undo" });
        }

        const now = new Date();
        const resetTime = new Date(boss.resetAt);
        const diffMinutes = (now - resetTime) / (1000 * 60);

        if (diffMinutes > 3) {
            return res.status(400).json({ success: false, message: "เกินระยะเวลา 3 นาที ไม่สามารถ Undo ได้" });
        }

        boss.nextSpawn = boss.previousNextSpawn;
        boss.createdBy = boss.previousCreatedBy || username || "Guest";
        boss.createdById = boss.previousCreatedById || userId || null;
        
        boss.previousNextSpawn = null;
        boss.previousCreatedBy = null;
        boss.previousCreatedById = null;
        boss.resetAt = null;
        boss.votes = [];

        addAuditLog("UNDO", username || "Guest", `${boss.serverName} (${boss.location})`);
        return res.json({ success: true, boss });
    }
    res.status(404).json({ success: false, message: "Boss not found" });
});

// API สำหรับระบบโหวตรายงานบอสยังไม่ตาย (Vote Reset)
app.post('/api/bosses/vote-reset', (req, res) => {
    const { id, userId, username } = req.body;
    const boss = bosses.find(b => b.id === Number(id));

    if (!boss || !boss.nextSpawn || new Date(boss.nextSpawn) <= new Date()) {
        return res.status(400).json({ success: false, message: "ช่องนี้ไม่ได้กำลังนับถอยหลัง" });
    }

    if (!userId) {
        return res.status(401).json({ success: false, message: "กรุณาเข้าสู่ระบบก่อนลงโหวต" });
    }

    if (boss.createdById === userId) {
        return res.status(400).json({ success: false, message: "คุณเป็นเจ้าของช่อง สามารถกด RESET ได้โดยตรง" });
    }

    if (!boss.votes) boss.votes = [];

    if (boss.votes.includes(userId)) {
        return res.status(400).json({ success: false, message: "คุณได้ลงโหวตช่องนี้ไปแล้ว" });
    }

    boss.votes.push(userId);
    addAuditLog("VOTE_REPORT", username || "Guest", `${boss.serverName} (${boss.location}) [${boss.votes.length}/${VOTE_RESET_THRESHOLD}]`);

    // หากโหวตครบ 3 คน -> สั่ง Reset ทันที
    if (boss.votes.length >= VOTE_RESET_THRESHOLD) {
        boss.previousNextSpawn = boss.nextSpawn;
        boss.previousCreatedBy = boss.createdBy;
        boss.previousCreatedById = boss.createdById;
        boss.resetAt = new Date().toISOString();

        boss.killedAt = null;
        boss.nextSpawn = null;
        boss.createdBy = null;
        boss.createdById = null;
        boss.votes = [];

        addAuditLog("AUTO_RESET_BY_VOTE", "SYSTEM", `${boss.serverName} (${boss.location})`);
        return res.json({ success: true, message: `โหวตครบ ${VOTE_RESET_THRESHOLD} คนแล้ว! ระบบทำการ Reset ช่องนี้เรียบร้อย`, reset: true });
    }

    res.json({ success: true, message: `ลงโหวตเรียบร้อย (${boss.votes.length}/${VOTE_RESET_THRESHOLD})`, reset: false });
});

// ---------------- API ADMIN ----------------

app.post('/api/admin/data', (req, res) => {
    const { adminKey } = req.body;
    if (adminKey !== ADMIN_KEY) return res.status(401).json({ success: false, message: "รหัสผ่านแอดมินไม่ถูกต้อง" });

    const onlineList = Array.from(activeUsers.values());
    res.json({ 
        success: true, 
        onlineUsers: onlineList, 
        bosses: bosses,
        auditLogs: auditLogs
    });
});

app.post('/api/admin/grant-user-room', (req, res) => {
    const { adminKey, bossId, targetUserId, targetUsername } = req.body;
    if (adminKey !== ADMIN_KEY) return res.status(401).json({ success: false, message: "รหัสผ่านแอดมินไม่ถูกต้อง" });

    const boss = bosses.find(b => b.id === Number(bossId));
    if (boss) {
        if (!boss.allowedUserIds) boss.allowedUserIds = [];
        if (!boss.allowedUsers) boss.allowedUsers = [];

        if (!boss.allowedUserIds.includes(targetUserId)) {
            boss.allowedUserIds.push(targetUserId);
            boss.allowedUsers.push(targetUsername || "Guest");
        }
        addAuditLog("ADMIN_GRANT", "ADMIN", `${boss.serverName} -> ${targetUsername}`);
        return res.json({ success: true, message: `ปลดล็อกห้อง ${boss.serverName} ให้คุณ ${targetUsername} เรียบร้อยแล้ว!`, boss });
    }
    res.status(404).json({ success: false, message: "ไม่พบข้อมูลห้อง" });
});

app.post('/api/admin/revoke-user-room', (req, res) => {
    const { adminKey, bossId, targetUserId } = req.body;
    if (adminKey !== ADMIN_KEY) return res.status(401).json({ success: false, message: "รหัสผ่านแอดมินไม่ถูกต้อง" });

    const boss = bosses.find(b => b.id === Number(bossId));
    if (boss) {
        const idx = boss.allowedUserIds.indexOf(targetUserId);
        if (idx !== -1) {
            boss.allowedUserIds.splice(idx, 1);
            boss.allowedUsers.splice(idx, 1);
        }
        addAuditLog("ADMIN_REVOKE", "ADMIN", `${boss.serverName} (User ID: ${targetUserId})`);
        return res.json({ success: true, message: `ยกเลิกสิทธิ์ใช้งานห้อง ${boss.serverName} เรียบร้อย`, boss });
    }
    res.status(404).json({ success: false, message: "ไม่พบข้อมูลห้อง" });
});

app.post('/api/admin/toggle-global-lock', (req, res) => {
    const { adminKey, bossId, isLocked } = req.body;
    if (adminKey !== ADMIN_KEY) return res.status(401).json({ success: false, message: "รหัสผ่านแอดมินไม่ถูกต้อง" });

    const boss = bosses.find(b => b.id === Number(bossId));
    if (boss) {
        boss.isLocked = isLocked;
        if (isLocked) {
            boss.allowedUserIds = [];
            boss.allowedUsers = [];
        }
        return res.json({ success: true, message: `อัปเดตสถานะห้อง ${boss.serverName} เรียบร้อย` });
    }
    res.status(404).json({ success: false, message: "ไม่พบข้อมูลห้อง" });
});

app.post('/api/admin/unlock-all', (req, res) => {
    const { adminKey } = req.body;
    if (adminKey !== ADMIN_KEY) return res.status(401).json({ success: false, message: "รหัสผ่านแอดมินไม่ถูกต้อง" });

    bosses.forEach(b => {
        b.isLocked = false;
        b.allowedUserIds = [];
        b.allowedUsers = [];
    });
    addAuditLog("ADMIN_UNLOCK_ALL", "ADMIN", "ทุกห้อง");
    res.json({ success: true, message: "ปลดล็อคห้องทั้งหมดแบบสาธารณะเรียบร้อยแล้ว!" });
});

app.post('/api/admin/lock-all', (req, res) => {
    const { adminKey } = req.body;
    if (adminKey !== ADMIN_KEY) return res.status(401).json({ success: false, message: "รหัสผ่านแอดมินไม่ถูกต้อง" });

    bosses.forEach(b => {
        const roomNum = parseInt(b.serverName.split(' ')[1]);
        b.isLocked = roomNum > 10;
        b.allowedUserIds = [];
        b.allowedUsers = [];
    });
    addAuditLog("ADMIN_LOCK_ALL", "ADMIN", "ห้อง 011-050");
    res.json({ success: true, message: "สั่งล็อคห้องมาตรฐาน (011-050) ทั้งหมดเรียบร้อยแล้ว!" });
});

app.post('/api/admin/kick-user', (req, res) => {
    const { adminKey, targetUserId } = req.body;
    if (adminKey !== ADMIN_KEY) return res.status(401).json({ success: false, message: "รหัสผ่านแอดมินไม่ถูกต้อง" });

    if (activeUsers.has(targetUserId)) {
        activeUsers.delete(targetUserId);
        addAuditLog("ADMIN_KICK", "ADMIN", `User ID: ${targetUserId}`);
        return res.json({ success: true, message: `เตะผู้ใช้ออกเรียบร้อย` });
    }
    res.status(404).json({ success: false, message: "ไม่พบผู้ใช้ในระบบ" });
});

app.listen(PORT, () => {
    console.log(`Boss Timer Server running on port ${PORT}`);
});
