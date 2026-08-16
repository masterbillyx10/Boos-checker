const express = require('express');
const path = require('path');
const https = require('https');
const querystring = require('querystring');
const app = express();
const PORT = process.env.PORT || 3000;

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
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
const MAX_SPAWNS_MEMBER = 2; // สิทธิ์คนธรรมดากดได้ 2 ห้อง
const MAX_SPAWNS_VIP = 15;   // สิทธิ์ VIP กดได้ 15 ห้องเต็ม
const ADMIN_USERNAMES = ["hexeditorx10", "valentile"];

let activeUsers = new Map();
let registeredUsers = new Map();
let auditLogs = [];

function addAuditLog(action, username, details) {
    const time = new Date().toLocaleTimeString('th-TH', { 
        timeZone: 'Asia/Bangkok',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    auditLogs.unshift({ time, action, username, details });
    if (auditLogs.length > 50) auditLogs.pop();
}

function sendDiscordAlert(title, description, colorHex, boss, timeText) {
    if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL.trim() === "") return;

    const payload = JSON.stringify({
        username: "WarZ TH Boss Tracker",
        avatar_url: "https://cdn-icons-png.flaticon.com/512/1066/1066371.png",
        embeds: [{
            title: title,
            description: description,
            color: colorHex,
            fields: [
                { name: "📍 เซิร์ฟเวอร์ / ห้อง", value: `TH ${boss.serverName}`, inline: true },
                { name: "🏢 เมือง / พิกัด", value: boss.location, inline: true },
                { name: "⏰ เวลาเกิด (Respawn Time)", value: timeText, inline: false }
            ],
            footer: { text: "WarZ TH Boss Tracker • boos-checker.onrender.com" },
            timestamp: new Date().toISOString()
        }]
    });

    try {
        const url = new URL(DISCORD_WEBHOOK_URL);
        const req = https.request({
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        });
        req.on('error', (e) => console.error("Webhook Error:", e.message));
        req.write(payload);
        req.end();
    } catch(err) {
        console.error("Invalid Webhook URL");
    }
}

setInterval(() => {
    const now = Date.now();
    for (const [id, user] of activeUsers.entries()) {
        if (now - user.lastSeen > 10000) activeUsers.delete(id);
    }

    bosses.forEach(boss => {
        if (boss.nextSpawn) {
            const spawnTime = new Date(boss.nextSpawn).getTime();
            const diffSeconds = Math.floor((spawnTime - now) / 1000);
            const timeFormatted = new Date(boss.nextSpawn).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });

            if (!boss.alertsSent) boss.alertsSent = {};

            if (diffSeconds <= 300 && diffSeconds > 290 && !boss.alertsSent['5min']) {
                boss.alertsSent['5min'] = true;
                sendDiscordAlert(
                    "⏳ บอสใกล้จะเกิดในอีก 5 นาที!",
                    `เตรียมตัวลงห้อง **TH ${boss.serverName}** เมือง **${boss.location}**`,
                    0xf59e0b,
                    boss,
                    `${timeFormatted} น.`
                );
            }

            if (diffSeconds <= 60 && diffSeconds > 50 && !boss.alertsSent['1min']) {
                boss.alertsSent['1min'] = true;
                sendDiscordAlert(
                    "⚠️ บอสใกล้จะเกิดในอีก 1 นาที!",
                    `รีบเตรียมตัว! บอสกำลังจะเกิดในห้อง **TH ${boss.serverName}** เมือง **${boss.location}**`,
                    0xff6b00,
                    boss,
                    `${timeFormatted} น.`
                );
            }

            if (diffSeconds <= 0 && !boss.alertsSent['spawned']) {
                boss.alertsSent['spawned'] = true;
                sendDiscordAlert(
                    "⚔️ BOSS READY FOR FARM! (บอสเกิดแล้ว)",
                    `🔥 **บอสเกิดแล้วตอนนี้!** ลุยได้เลยที่ **TH ${boss.serverName}** เมือง **${boss.location}**`,
                    0x10b981,
                    boss,
                    `พร้อมล่าแล้วตอนนี้!`
                );
            }
        }
    });
}, 1000);

let bosses = [];
let idCounter = 1;

// Official 50 ห้อง (เปิดฟรี 5 ห้องแรก 001-005, ล็อค 006-050)
for (let i = 1; i <= 50; i++) {
    const serverName = `Official ${String(i).padStart(3, '0')}`;
    const lockedStatus = i > 5; 
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
            alertsSent: {}
        });
    });
}

// Premium 50 ห้อง (เปิดฟรี 5 ห้องแรก 001-005, ล็อค 006-050)
for (let i = 1; i <= 50; i++) {
    const serverName = `Premium ${String(i).padStart(3, '0')}`;
    const lockedStatus = i > 5;
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
            alertsSent: {}
        });
    });
}

function checkUserRole(userId, username) {
    if (username && ADMIN_USERNAMES.includes(username.toLowerCase())) {
        return "ADMIN";
    }
    if (userId && bosses.some(b => b.allowedUserIds && b.allowedUserIds.includes(userId))) {
        return "VIP";
    }
    return "MEMBER";
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
        const userInfo = { id: userId, username: finalName, lastSeen: Date.now() };
        activeUsers.set(userId, userInfo);
        registeredUsers.set(userId, userInfo);
    }

    let filtered = bosses;
    if (serverType) filtered = filtered.filter(b => b.serverType === serverType);
    if (location) filtered = filtered.filter(b => b.location === location);

    const currentUserRole = checkUserRole(userId, username);
    const isAdmin = currentUserRole === "ADMIN";

    const customizedBosses = filtered.map(b => {
        const isUserAllowed = isAdmin || (userId && b.allowedUserIds && b.allowedUserIds.includes(userId));
        const isLockedForThisUser = b.isLocked && !isUserAllowed;
        const creatorRole = checkUserRole(b.createdById, b.createdBy);

        return {
            ...b,
            isLocked: isLockedForThisUser,
            creatorRole: creatorRole
        };
    });

    res.json({
        serverTime: Date.now(),
        onlineCount: activeUsers.size || 1,
        userRole: currentUserRole,
        bosses: customizedBosses
    });
});

app.post('/api/bosses/spawn', (req, res) => {
    const { id, username, userId } = req.body;
    const boss = bosses.find(b => b.id === Number(id));
    
    if (boss) {
        const userRole = checkUserRole(userId, username);
        const isAdmin = userRole === "ADMIN";
        const isVip = userRole === "VIP";
        const isUserAllowed = isAdmin || (userId && boss.allowedUserIds && boss.allowedUserIds.includes(userId));

        if (boss.isLocked && !isUserAllowed) {
            return res.status(403).json({ success: false, message: "ห้องนี้ถูกล็อคสำหรับสมาชิก VIP เท่านั้น" });
        }

        if (boss.nextSpawn && new Date(boss.nextSpawn) > new Date()) {
            return res.status(400).json({ success: false, message: "ช่องนี้กำลังใช้งานอยู่" });
        }

        const nowTime = new Date();
        const userActiveSpawns = bosses.filter(b => b.createdById === userId && b.nextSpawn && new Date(b.nextSpawn) > nowTime);
        
        // กำหนดโควตาตามยศ: คนธรรมดา 2 ห้อง | VIP 15 ห้อง
        const maxAllowed = isVip ? MAX_SPAWNS_VIP : MAX_SPAWNS_MEMBER;
        if (!isAdmin && userActiveSpawns.length >= maxAllowed) {
            if (!isVip) {
                return res.status(400).json({ success: false, message: `สมาชิกทั่วไปกด SPAWN ค้างไว้ได้สูงสุด ${MAX_SPAWNS_MEMBER} ห้อง! กรุณาปลดล็อค VIP เพื่อใช้งานได้ ${MAX_SPAWNS_VIP} ห้อง` });
            } else {
                return res.status(400).json({ success: false, message: `คุณกด SPAWN ค้างไว้ครบโควตา VIP (${MAX_SPAWNS_VIP} ห้อง) แล้ว!` });
            }
        }

        boss.killedAt = nowTime.toISOString();
        boss.nextSpawn = new Date(nowTime.getTime() + RESPAWN_MINUTES * 60000).toISOString();
        boss.createdBy = username || "Guest";
        boss.createdById = userId || null;
        boss.previousNextSpawn = null;
        boss.previousCreatedBy = null;
        boss.previousCreatedById = null;
        boss.resetAt = null;
        boss.alertsSent = {};

        const spawnTimeFormatted = new Date(boss.nextSpawn).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
        
        sendDiscordAlert(
            "💀 บอสถูกฆ่าแล้ว เริ่มนับเวลาถอยหลัง!",
            `ผู้เล่น **[${userRole}] ${username || 'Guest'}** ได้กดเริ่มจับเวลาบอส`,
            0xef4444,
            boss,
            `จะเกิดเวลา ${spawnTimeFormatted} น.`
        );

        addAuditLog("SPAWN", username || "Guest", `${boss.serverName} (${boss.location})`);
        return res.json({ success: true, boss });
    }
    res.status(404).json({ success: false, message: "Boss not found" });
});

app.post('/api/bosses/reset', (req, res) => {
    const { id, userId, username } = req.body;
    const boss = bosses.find(b => b.id === Number(id));
    
    if (boss) {
        const isAdmin = checkUserRole(userId, username) === "ADMIN";

        if (!isAdmin && boss.createdById && boss.createdById !== userId) {
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
        boss.alertsSent = {};

        addAuditLog("RESET", username || "Guest", `${boss.serverName} (${boss.location})`);
        return res.json({ success: true, boss });
    }
    res.status(404).json({ success: false, message: "Boss not found" });
});

app.post('/api/bosses/undo', (req, res) => {
    const { id, username, userId } = req.body;
    const boss = bosses.find(b => b.id === Number(id));
    
    if (boss) {
        const isAdmin = checkUserRole(userId, username) === "ADMIN";

        if (!isAdmin && boss.previousCreatedById && boss.previousCreatedById !== userId) {
            return res.status(403).json({ success: false, message: "คุณไม่ใช่เจ้าของช่องนี้ ไม่สามารถกด UNDO ได้" });
        }

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

        addAuditLog("UNDO", username || "Guest", `${boss.serverName} (${boss.location})`);
        return res.json({ success: true, boss });
    }
    res.status(404).json({ success: false, message: "Boss not found" });
});

// ---------------- API ADMIN ----------------

app.post('/api/admin/data', (req, res) => {
    const { adminUsername } = req.body;
    if (!adminUsername || !ADMIN_USERNAMES.includes(adminUsername.toLowerCase())) {
        return res.status(401).json({ success: false, message: "คุณไม่มีสิทธิ์เข้าถึงหน้า Admin" });
    }

    const allUsersList = Array.from(registeredUsers.values()).map(user => {
        return {
            ...user,
            isOnline: activeUsers.has(user.id),
            role: checkUserRole(user.id, user.username)
        };
    });

    res.json({ 
        success: true, 
        onlineUsers: allUsersList, 
        bosses: bosses,
        auditLogs: auditLogs
    });
});

app.post('/api/admin/grant-user-room', (req, res) => {
    const { adminUsername, serverType, serverName, targetUserId, targetUsername } = req.body;
    if (!adminUsername || !ADMIN_USERNAMES.includes(adminUsername.toLowerCase())) {
        return res.status(401).json({ success: false, message: "คุณไม่มีสิทธิ์ใช้งาน" });
    }

    const matchingBosses = bosses.filter(b => b.serverType === serverType && b.serverName === serverName);
    if (matchingBosses.length > 0) {
        matchingBosses.forEach(boss => {
            if (!boss.allowedUserIds) boss.allowedUserIds = [];
            if (!boss.allowedUsers) boss.allowedUsers = [];

            if (!boss.allowedUserIds.includes(targetUserId)) {
                boss.allowedUserIds.push(targetUserId);
                boss.allowedUsers.push(targetUsername || "Guest");
            }
        });

        addAuditLog("ADMIN_GRANT", adminUsername, `${serverType} ${serverName} -> [VIP] ${targetUsername}`);
        return res.json({ success: true, message: `ปลดล็อกห้อง ${serverType} ${serverName} (ทุกเมือง) ให้คุณ ${targetUsername} เรียบร้อยแล้ว!` });
    }
    res.status(404).json({ success: false, message: "ไม่พบข้อมูลห้อง" });
});

app.post('/api/admin/revoke-user-room', (req, res) => {
    const { adminUsername, serverType, serverName, targetUserId } = req.body;
    if (!adminUsername || !ADMIN_USERNAMES.includes(adminUsername.toLowerCase())) {
        return res.status(401).json({ success: false, message: "คุณไม่มีสิทธิ์ใช้งาน" });
    }

    const matchingBosses = bosses.filter(b => b.serverType === serverType && b.serverName === serverName);
    if (matchingBosses.length > 0) {
        matchingBosses.forEach(boss => {
            const idx = boss.allowedUserIds.indexOf(targetUserId);
            if (idx !== -1) {
                boss.allowedUserIds.splice(idx, 1);
                boss.allowedUsers.splice(idx, 1);
            }
        });

        addAuditLog("ADMIN_REVOKE", adminUsername, `${serverType} ${serverName} (User ID: ${targetUserId})`);
        return res.json({ success: true, message: `ยกเลิกสิทธิ์ห้อง ${serverType} ${serverName} เรียบร้อย` });
    }
    res.status(404).json({ success: false, message: "ไม่พบข้อมูลห้อง" });
});

app.post('/api/admin/toggle-global-lock', (req, res) => {
    const { adminUsername, serverType, serverName, isLocked } = req.body;
    if (!adminUsername || !ADMIN_USERNAMES.includes(adminUsername.toLowerCase())) {
        return res.status(401).json({ success: false, message: "คุณไม่มีสิทธิ์ใช้งาน" });
    }

    const matchingBosses = bosses.filter(b => b.serverType === serverType && b.serverName === serverName);
    if (matchingBosses.length > 0) {
        matchingBosses.forEach(boss => {
            boss.isLocked = isLocked;
            if (isLocked) {
                boss.allowedUserIds = [];
                boss.allowedUsers = [];
            }
        });
        return res.json({ success: true, message: `อัปเดตสถานะห้อง ${serverType} ${serverName} เรียบร้อย` });
    }
    res.status(404).json({ success: false, message: "ไม่พบข้อมูลห้อง" });
});

app.post('/api/admin/unlock-all', (req, res) => {
    const { adminUsername } = req.body;
    if (!adminUsername || !ADMIN_USERNAMES.includes(adminUsername.toLowerCase())) {
        return res.status(401).json({ success: false, message: "คุณไม่มีสิทธิ์ใช้งาน" });
    }

    bosses.forEach(b => {
        b.isLocked = false;
        b.allowedUserIds = [];
        b.allowedUsers = [];
    });
    addAuditLog("ADMIN_UNLOCK_ALL", adminUsername, "ทุกห้อง");
    res.json({ success: true, message: "ปลดล็อคห้องทั้งหมดแบบสาธารณะเรียบร้อยแล้ว!" });
});

app.post('/api/admin/lock-all', (req, res) => {
    const { adminUsername } = req.body;
    if (!adminUsername || !ADMIN_USERNAMES.includes(adminUsername.toLowerCase())) {
        return res.status(401).json({ success: false, message: "คุณไม่มีสิทธิ์ใช้งาน" });
    }

    bosses.forEach(b => {
        const roomNum = parseInt(b.serverName.split(' ')[1]);
        b.isLocked = roomNum > 5;
        b.allowedUserIds = [];
        b.allowedUsers = [];
    });
    addAuditLog("ADMIN_LOCK_ALL", adminUsername, "ห้อง 006-050");
    res.json({ success: true, message: "สั่งล็อคห้องมาตรฐาน (006-050) ทั้งหมดเรียบร้อยแล้ว!" });
});

app.post('/api/admin/kick-user', (req, res) => {
    const { adminUsername, targetUserId } = req.body;
    if (!adminUsername || !ADMIN_USERNAMES.includes(adminUsername.toLowerCase())) {
        return res.status(401).json({ success: false, message: "คุณไม่มีสิทธิ์ใช้งาน" });
    }

    if (activeUsers.has(targetUserId)) {
        activeUsers.delete(targetUserId);
        addAuditLog("ADMIN_KICK", adminUsername, `User ID: ${targetUserId}`);
        return res.json({ success: true, message: `เตะผู้ใช้ออกเรียบร้อย` });
    }
    res.status(404).json({ success: false, message: "ไม่พบผู้ใช้ในระบบออนไลน์" });
});

app.listen(PORT, () => {
    console.log(`Boss Timer Server running on port ${PORT}`);
});
