const express = require('express');
const path = require('path');
const https = require('https');
const querystring = require('querystring');
const crypto = require('crypto');
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
const MAX_SPAWNS_MEMBER = 2;
const MAX_SPAWNS_VIP = 15;
const ADMIN_USERNAMES = ["hexeditorx10", "valentile"];

let activeUsers = new Map();
let registeredUsers = new Map();
let globalVipUserIds = new Set();
let auditLogs = [];

// ระบบจัดการแคลน (Clans)
// clanId: { id, name, tag, leaderId, leaderUsername, inviteCode, memberIds: [], createdAt }
let clans = new Map();

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

function sendDiscordAlert(title, description, colorHex, boss, timeText, clanTag = "") {
    if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL.trim() === "") return;

    const clanPrefix = clanTag ? `[${clanTag}] ` : "";
    const payload = JSON.stringify({
        username: "WarZ TH Boss Tracker",
        avatar_url: "https://cdn-icons-png.flaticon.com/512/1066/1066371.png",
        embeds: [{
            title: `${clanPrefix}${title}`,
            description: description,
            color: colorHex,
            fields: [
                { name: "📍 เซิร์ฟเวอร์ / ห้อง", value: `TH ${boss.serverName}`, inline: true },
                { name: "🏢 เมือง / พิกัด", value: boss.location, inline: true },
                { name: "⏰ เวลาเกิด (Respawn Time)", value: timeText, inline: false }
            ],
            footer: { text: `WarZ TH Boss Tracker ${clanTag ? `• Clan: ${clanTag}` : ''}` },
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

// ฟังก์ชันสร้างชุดข้อมูล Bosses 100 ห้อง (แยกตาม Workspace)
function createInitialBossList(isClanWorkspace = false) {
    const list = [];
    let idCounter = 1;

    // Official 50 ห้อง
    for (let i = 1; i <= 50; i++) {
        const serverName = `Official ${String(i).padStart(3, '0')}`;
        const lockedStatus = isClanWorkspace ? false : (i > 5); 
        LOCATIONS.forEach(loc => {
            list.push({
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

    // Premium 50 ห้อง
    for (let i = 1; i <= 50; i++) {
        const serverName = `Premium ${String(i).padStart(3, '0')}`;
        const lockedStatus = isClanWorkspace ? false : (i > 5);
        LOCATIONS.forEach(loc => {
            list.push({
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
    return list;
}

// เก็บ Bosses ของ Workspace: 'public' และ 'clan_<id>'
let workspaceBosses = {
    'public': createInitialBossList(false)
};

function getWorkspaceBosses(workspaceId) {
    if (!workspaceBosses[workspaceId]) {
        workspaceBosses[workspaceId] = createInitialBossList(true);
    }
    return workspaceBosses[workspaceId];
}

function getUserClan(userId) {
    if (!userId) return null;
    for (const [id, clan] of clans.entries()) {
        if (clan.leaderId === userId || clan.memberIds.includes(userId)) {
            return clan;
        }
    }
    return null;
}

function checkUserRole(userId, username) {
    if (username && ADMIN_USERNAMES.includes(username.toLowerCase())) {
        return "ADMIN";
    }
    const clan = getUserClan(userId);
    if (clan) {
        if (clan.leaderId === userId) return "CLAN_LEADER";
        return "CLAN_MEMBER";
    }
    if (userId && (globalVipUserIds.has(userId) || workspaceBosses['public'].some(b => b.allowedUserIds && b.allowedUserIds.includes(userId)))) {
        return "VIP";
    }
    return "MEMBER";
}

// Background Interval สำหรับตรวจสอบเวลาบอสเกิดในทุก Workspace
setInterval(() => {
    const now = Date.now();
    for (const [id, user] of activeUsers.entries()) {
        if (now - user.lastSeen > 10000) activeUsers.delete(id);
    }

    Object.keys(workspaceBosses).forEach(wsKey => {
        const bList = workspaceBosses[wsKey];
        const clan = wsKey.startsWith('clan_') ? clans.get(wsKey.replace('clan_', '')) : null;
        const clanTag = clan ? clan.tag : "";

        bList.forEach(boss => {
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
                        `${timeFormatted} น.`,
                        clanTag
                    );
                }

                if (diffSeconds <= 60 && diffSeconds > 50 && !boss.alertsSent['1min']) {
                    boss.alertsSent['1min'] = true;
                    sendDiscordAlert(
                        "⚠️ บอสใกล้จะเกิดในอีก 1 นาที!",
                        `รีบเตรียมตัว! บอสกำลังจะเกิดในห้อง **TH ${boss.serverName}** เมือง **${boss.location}**`,
                        0xff6b00,
                        boss,
                        `${timeFormatted} น.`,
                        clanTag
                    );
                }

                if (diffSeconds <= 0 && !boss.alertsSent['spawned']) {
                    boss.alertsSent['spawned'] = true;
                    sendDiscordAlert(
                        "⚔️ BOSS READY FOR FARM! (บอสเกิดแล้ว)",
                        `🔥 **บอสเกิดแล้วตอนนี้!** ลุยได้เลยที่ **TH ${boss.serverName}** เมือง **${boss.location}**`,
                        0x10b981,
                        boss,
                        `พร้อมล่าแล้วตอนนี้!`,
                        clanTag
                    );
                }
            }
        });
    });
}, 1000);

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
    const { serverType, location, userId, username, workspace } = req.query;

    if (userId && userId !== 'null' && userId !== 'guest') {
        const finalName = (username && username !== 'null' && username !== 'undefined' && username.trim() !== '') ? username : "Guest";
        const userInfo = { id: userId, username: finalName, lastSeen: Date.now() };
        activeUsers.set(userId, userInfo);
        registeredUsers.set(userId, userInfo);
    }

    const userClan = getUserClan(userId);
    const currentUserRole = checkUserRole(userId, username);
    const isAdmin = currentUserRole === "ADMIN";

    let activeWorkspace = 'public';
    if (workspace && workspace.startsWith('clan_')) {
        const clanId = workspace.replace('clan_', '');
        const targetClan = clans.get(clanId);
        if (targetClan && (isAdmin || targetClan.leaderId === userId || targetClan.memberIds.includes(userId))) {
            activeWorkspace = workspace;
        }
    } else if (userClan && !workspace) {
        activeWorkspace = `clan_${userClan.id}`;
    }

    const bosses = getWorkspaceBosses(activeWorkspace);
    let filtered = bosses;
    if (serverType) filtered = filtered.filter(b => b.serverType === serverType);
    if (location) filtered = filtered.filter(b => b.location === location);

    const isGlobalVip = userId && globalVipUserIds.has(userId);
    const isClanMember = activeWorkspace.startsWith('clan_');

    const customizedBosses = filtered.map(b => {
        const isUserAllowed = isAdmin || isGlobalVip || isClanMember || (userId && b.allowedUserIds && b.allowedUserIds.includes(userId));
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
        clan: userClan ? { id: userClan.id, name: userClan.name, tag: userClan.tag, isLeader: userClan.leaderId === userId } : null,
        workspace: activeWorkspace,
        bosses: customizedBosses
    });
});

app.post('/api/bosses/spawn', (req, res) => {
    const { id, username, userId, workspace } = req.body;
    const userClan = getUserClan(userId);
    const userRole = checkUserRole(userId, username);
    const isAdmin = userRole === "ADMIN";
    const isVip = userRole === "VIP" || userRole === "CLAN_LEADER" || userRole === "CLAN_MEMBER";

    let activeWorkspace = 'public';
    if (workspace && workspace.startsWith('clan_')) {
        const clanId = workspace.replace('clan_', '');
        const targetClan = clans.get(clanId);
        if (targetClan && (isAdmin || targetClan.leaderId === userId || targetClan.memberIds.includes(userId))) {
            activeWorkspace = workspace;
        }
    } else if (userClan) {
        activeWorkspace = `clan_${userClan.id}`;
    }

    const bosses = getWorkspaceBosses(activeWorkspace);
    const boss = bosses.find(b => b.id === Number(id));
    
    if (boss) {
        const isClanWs = activeWorkspace.startsWith('clan_');
        const isUserAllowed = isAdmin || isClanWs || (userId && globalVipUserIds.has(userId)) || (userId && boss.allowedUserIds && boss.allowedUserIds.includes(userId));

        if (boss.isLocked && !isUserAllowed) {
            return res.status(403).json({ success: false, message: "ห้องนี้ถูกล็อคสำหรับสมาชิก VIP หรือสมาชิกแคลนเท่านั้น" });
        }

        if (boss.nextSpawn && new Date(boss.nextSpawn) > new Date()) {
            return res.status(400).json({ success: false, message: "ช่องนี้กำลังใช้งานอยู่" });
        }

        const nowTime = new Date();
        const userActiveSpawns = bosses.filter(b => b.createdById === userId && b.nextSpawn && new Date(b.nextSpawn) > nowTime);
        
        const maxAllowed = isVip ? MAX_SPAWNS_VIP : MAX_SPAWNS_MEMBER;
        if (!isAdmin && userActiveSpawns.length >= maxAllowed) {
            if (!isVip) {
                return res.status(400).json({ success: false, message: `สมาชิกทั่วไปกด SPAWN ค้างไว้ได้สูงสุด ${MAX_SPAWNS_MEMBER} ห้อง! กรุณาปลดล็อค VIP หรือเข้าแคลนเพื่อใช้งานได้ ${MAX_SPAWNS_VIP} ห้อง` });
            } else {
                return res.status(400).json({ success: false, message: `คุณกด SPAWN ค้างไว้ครบโควตา (${MAX_SPAWNS_VIP} ห้อง) แล้ว!` });
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
        const clanTag = userClan ? userClan.tag : "";
        
        sendDiscordAlert(
            "💀 บอสถูกฆ่าแล้ว เริ่มนับเวลาถอยหลัง!",
            `ผู้เล่น **[${userRole}] ${username || 'Guest'}** ได้กดเริ่มจับเวลาบอส`,
            0xef4444,
            boss,
            `จะเกิดเวลา ${spawnTimeFormatted} น.`,
            clanTag
        );

        addAuditLog("SPAWN", username || "Guest", `[${activeWorkspace}] ${boss.serverName} (${boss.location})`);
        return res.json({ success: true, boss });
    }
    res.status(404).json({ success: false, message: "Boss not found" });
});

app.post('/api/bosses/reset', (req, res) => {
    const { id, userId, username, workspace } = req.body;
    let activeWorkspace = workspace || 'public';
    const bosses = getWorkspaceBosses(activeWorkspace);
    const boss = bosses.find(b => b.id === Number(id));
    
    if (boss) {
        const userRole = checkUserRole(userId, username);
        const isAdmin = userRole === "ADMIN" || userRole === "CLAN_LEADER";

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

        addAuditLog("RESET", username || "Guest", `[${activeWorkspace}] ${boss.serverName} (${boss.location})`);
        return res.json({ success: true, boss });
    }
    res.status(404).json({ success: false, message: "Boss not found" });
});

app.post('/api/bosses/undo', (req, res) => {
    const { id, username, userId, workspace } = req.body;
    let activeWorkspace = workspace || 'public';
    const bosses = getWorkspaceBosses(activeWorkspace);
    const boss = bosses.find(b => b.id === Number(id));
    
    if (boss) {
        const userRole = checkUserRole(userId, username);
        const isAdmin = userRole === "ADMIN" || userRole === "CLAN_LEADER";

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

        addAuditLog("UNDO", username || "Guest", `[${activeWorkspace}] ${boss.serverName} (${boss.location})`);
        return res.json({ success: true, boss });
    }
    res.status(404).json({ success: false, message: "Boss not found" });
});

// ---------------- API ระบบแคลน (CLAN SYSTEM) ----------------

app.post('/api/clan/join', (req, res) => {
    const { userId, username, inviteCode } = req.body;
    if (!userId || !inviteCode) return res.status(400).json({ success: false, message: "ข้อมูลไม่ครบถ้วน" });

    const existingClan = getUserClan(userId);
    if (existingClan) {
        return res.status(400).json({ success: false, message: `คุณสังกัดอยู่ในแคลน [${existingClan.tag}] ${existingClan.name} อยู่แล้ว` });
    }

    let targetClan = null;
    for (const [id, clan] of clans.entries()) {
        if (clan.inviteCode && clan.inviteCode.toUpperCase() === inviteCode.trim().toUpperCase()) {
            targetClan = clan;
            break;
        }
    }

    if (!targetClan) {
        return res.status(404).json({ success: false, message: "รหัสเชิญแคลนไม่ถูกต้อง หรือไม่มีแคลนนี้ในระบบ" });
    }

    targetClan.memberIds.push(userId);
    addAuditLog("CLAN_JOIN", username || "Guest", `เข้าร่วมแคลน [${targetClan.tag}] ${targetClan.name}`);
    res.json({ success: true, message: `ยินดีต้อนรับเข้าสู่แคลน [${targetClan.tag}] ${targetClan.name}!`, clan: targetClan });
});

app.post('/api/clan/details', (req, res) => {
    const { userId } = req.body;
    const clan = getUserClan(userId);
    if (!clan) return res.status(404).json({ success: false, message: "คุณยังไม่ได้สังกัดแคลนใดๆ" });

    const memberDetails = clan.memberIds.map(mId => {
        const u = registeredUsers.get(mId) || { id: mId, username: "Unknown" };
        return {
            id: mId,
            username: u.username,
            isOnline: activeUsers.has(mId),
            isLeader: clan.leaderId === mId
        };
    });

    // เพิ่มหัวแคลนเข้าลิสต์ถ้ายังไม่มี
    if (!memberDetails.some(m => m.id === clan.leaderId)) {
        const leaderInfo = registeredUsers.get(clan.leaderId) || { id: clan.leaderId, username: clan.leaderUsername };
        memberDetails.unshift({
            id: clan.leaderId,
            username: leaderInfo.username,
            isOnline: activeUsers.has(clan.leaderId),
            isLeader: true
        });
    }

    res.json({
        success: true,
        clan: {
            id: clan.id,
            name: clan.name,
            tag: clan.tag,
            inviteCode: clan.inviteCode,
            leaderId: clan.leaderId,
            leaderUsername: clan.leaderUsername,
            isLeader: clan.leaderId === userId,
            members: memberDetails
        }
    });
});

app.post('/api/clan/kick', (req, res) => {
    const { leaderUserId, targetUserId } = req.body;
    const clan = getUserClan(leaderUserId);
    if (!clan || clan.leaderId !== leaderUserId) {
        return res.status(403).json({ success: false, message: "เฉพาะหัวแคลนเท่านั้นที่มีสิทธิ์เตะสมาชิก" });
    }

    if (targetUserId === clan.leaderId) {
        return res.status(400).json({ success: false, message: "ไม่สามารถเตะตัวเองออกจากตำแหน่งหัวแคลนได้" });
    }

    const idx = clan.memberIds.indexOf(targetUserId);
    if (idx !== -1) {
        clan.memberIds.splice(idx, 1);
        addAuditLog("CLAN_KICK", clan.leaderUsername, `เตะ User ID ${targetUserId} ออกจากแคลน [${clan.tag}]`);
        return res.json({ success: true, message: "เตะสมาชิกออกจากแคลนเรียบร้อยแล้ว" });
    }
    res.status(404).json({ success: false, message: "ไม่พบสมาชิกนี้ในแคลน" });
});

app.post('/api/clan/refresh-invite', (req, res) => {
    const { leaderUserId } = req.body;
    const clan = getUserClan(leaderUserId);
    if (!clan || clan.leaderId !== leaderUserId) {
        return res.status(403).json({ success: false, message: "เฉพาะหัวแคลนเท่านั้นที่มีสิทธิ์รีเซ็ตรหัสเชิญ" });
    }

    clan.inviteCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    addAuditLog("CLAN_INVITE_REFRESH", clan.leaderUsername, `รหัสเชิญใหม่: ${clan.inviteCode}`);
    res.json({ success: true, newInviteCode: clan.inviteCode, message: "สร้างรหัสเชิญใหม่เรียบร้อยแล้ว" });
});

// ---------------- API ADMIN DASHBOARD ----------------

app.post('/api/admin/data', (req, res) => {
    const { adminUsername } = req.body;
    if (!adminUsername || !ADMIN_USERNAMES.includes(adminUsername.toLowerCase())) {
        return res.status(401).json({ success: false, message: "คุณไม่มีสิทธิ์เข้าถึงหน้า Admin" });
    }

    const allUsersList = Array.from(registeredUsers.values()).map(user => {
        const uClan = getUserClan(user.id);
        return {
            ...user,
            isOnline: activeUsers.has(user.id),
            isGlobalVip: globalVipUserIds.has(user.id),
            clan: uClan ? `[${uClan.tag}] ${uClan.name}` : null,
            role: checkUserRole(user.id, user.username)
        };
    });

    const clanList = Array.from(clans.values()).map(c => ({
        ...c,
        memberCount: c.memberIds.length + 1
    }));

    res.json({ 
        success: true, 
        onlineUsers: allUsersList, 
        bosses: workspaceBosses['public'],
        clans: clanList,
        auditLogs: auditLogs
    });
});

app.post('/api/admin/create-clan', (req, res) => {
    const { adminUsername, clanName, clanTag, leaderUserId, leaderUsername } = req.body;
    if (!adminUsername || !ADMIN_USERNAMES.includes(adminUsername.toLowerCase())) {
        return res.status(401).json({ success: false, message: "คุณไม่มีสิทธิ์ใช้งาน" });
    }

    if (!clanName || !clanTag || !leaderUserId) {
        return res.status(400).json({ success: false, message: "กรุณากรอกข้อมูลแคลนและเลือกหัวแคลนให้ครบถ้วน" });
    }

    const existingClan = getUserClan(leaderUserId);
    if (existingClan) {
        return res.status(400).json({ success: false, message: `ผู้ใช้นี้สังกัดอยู่ในแคลน [${existingClan.tag}] อยู่แล้ว` });
    }

    const clanId = crypto.randomBytes(4).toString('hex');
    const inviteCode = crypto.randomBytes(3).toString('hex').toUpperCase();

    const newClan = {
        id: clanId,
        name: clanName.trim(),
        tag: clanTag.trim().toUpperCase(),
        leaderId: leaderUserId,
        leaderUsername: leaderUsername || "Leader",
        inviteCode: inviteCode,
        memberIds: [],
        createdAt: new Date().toISOString()
    };

    clans.set(clanId, newClan);
    // สร้าง 100 ห้องปลดล็อคส่วนตัวของแคลนนี้
    workspaceBosses[`clan_${clanId}`] = createInitialBossList(true);

    addAuditLog("ADMIN_CREATE_CLAN", adminUsername, `สร้างแคลน [${newClan.tag}] ${newClan.name} (หัวแคลน: ${leaderUsername})`);
    res.json({ success: true, message: `สร้างแคลน [${newClan.tag}] ${newClan.name} สำเร็จแล้ว! รหัสเชิญ: ${inviteCode}`, clan: newClan });
});

app.post('/api/admin/delete-clan', (req, res) => {
    const { adminUsername, clanId } = req.body;
    if (!adminUsername || !ADMIN_USERNAMES.includes(adminUsername.toLowerCase())) {
        return res.status(401).json({ success: false, message: "คุณไม่มีสิทธิ์ใช้งาน" });
    }

    const clan = clans.get(clanId);
    if (clan) {
        clans.delete(clanId);
        delete workspaceBosses[`clan_${clanId}`];
        addAuditLog("ADMIN_DELETE_CLAN", adminUsername, `ลบแคลน [${clan.tag}] ${clan.name}`);
        return res.json({ success: true, message: `ลบแคลน [${clan.tag}] ${clan.name} เรียบร้อยแล้ว` });
    }
    res.status(404).json({ success: false, message: "ไม่พบแคลนนี้" });
});

app.post('/api/admin/toggle-global-vip', (req, res) => {
    const { adminUsername, targetUserId, targetUsername } = req.body;
    if (!adminUsername || !ADMIN_USERNAMES.includes(adminUsername.toLowerCase())) {
        return res.status(401).json({ success: false, message: "คุณไม่มีสิทธิ์ใช้งาน" });
    }

    let isNowVip = false;
    if (globalVipUserIds.has(targetUserId)) {
        globalVipUserIds.delete(targetUserId);
        addAuditLog("ADMIN_REVOKE_VIP", adminUsername, `ถอดยศ VIP คุณ ${targetUsername}`);
    } else {
        globalVipUserIds.add(targetUserId);
        isNowVip = true;
        addAuditLog("ADMIN_GRANT_VIP", adminUsername, `แต่งตั้ง 👑 [VIP] ให้คุณ ${targetUsername}`);
    }

    res.json({ 
        success: true, 
        isVip: isNowVip, 
        message: isNowVip ? `แต่งตั้งยศ VIP ให้คุณ ${targetUsername} เรียบร้อยแล้ว!` : `ถอดยศ VIP ของคุณ ${targetUsername} เรียบร้อยแล้ว` 
    });
});

app.post('/api/admin/grant-user-room', (req, res) => {
    const { adminUsername, serverType, serverName, targetUserId, targetUsername } = req.body;
    if (!adminUsername || !ADMIN_USERNAMES.includes(adminUsername.toLowerCase())) {
        return res.status(401).json({ success: false, message: "คุณไม่มีสิทธิ์ใช้งาน" });
    }

    const matchingBosses = workspaceBosses['public'].filter(b => b.serverType === serverType && b.serverName === serverName);
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

    const matchingBosses = workspaceBosses['public'].filter(b => b.serverType === serverType && b.serverName === serverName);
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

    const matchingBosses = workspaceBosses['public'].filter(b => b.serverType === serverType && b.serverName === serverName);
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

    workspaceBosses['public'].forEach(b => {
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

    workspaceBosses['public'].forEach(b => {
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
