const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_KEY = process.env.ADMIN_KEY || "VALENTILE1234";

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const LOCATIONS = [
    "Norad Military Base",
    "Ridgeway Airport",
    "Crystal Lake Resort",
    "Campos City"
];

const RESPAWN_MINUTES = 60;
let activeUsers = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [id, user] of activeUsers.entries()) {
        if (now - user.lastSeen > 10000) activeUsers.delete(id);
    }
}, 3000);

let bosses = [];
let idCounter = 1;

// สร้างห้อง Official 001 - 050 (001-010 ฟรี / 011-050 ล็อค)
for (let i = 1; i <= 50; i++) {
    const serverName = `Official ${String(i).padStart(3, '0')}`;
    const lockedStatus = i > 10; // ห้องเกิน 10 ให้ล็อคทั้งหมด
    LOCATIONS.forEach(loc => {
        bosses.push({
            id: idCounter++,
            serverType: "Official",
            serverName: serverName,
            location: loc,
            isLocked: lockedStatus,
            killedAt: null,
            nextSpawn: null,
            previousNextSpawn: null,
            resetAt: null,
            createdBy: null
        });
    });
}

// สร้างห้อง Premium 001 - 050 (001-010 ฟรี / 011-050 ล็อค)
for (let i = 1; i <= 50; i++) {
    const serverName = `Premium ${String(i).padStart(3, '0')}`;
    const lockedStatus = i > 10; // ห้องเกิน 10 ให้ล็อคทั้งหมด
    LOCATIONS.forEach(loc => {
        bosses.push({
            id: idCounter++,
            serverType: "Premium",
            serverName: serverName,
            location: loc,
            isLocked: lockedStatus,
            killedAt: null,
            nextSpawn: null,
            previousNextSpawn: null,
            resetAt: null,
            createdBy: null
        });
    });
}

app.get('/api/bosses', (req, res) => {
    const { serverType, location, userId, username } = req.query;

    if (userId) {
        activeUsers.set(userId, {
            id: userId,
            username: username || "Guest",
            lastSeen: Date.now()
        });
    }

    let result = bosses;
    if (serverType) result = result.filter(b => b.serverType === serverType);
    if (location) result = result.filter(b => b.location === location);

    res.json({
        serverTime: Date.now(),
        onlineCount: activeUsers.size || 1,
        bosses: result
    });
});

app.post('/api/bosses/spawn', (req, res) => {
    const { id, username } = req.body;
    const boss = bosses.find(b => b.id === id);
    
    if (boss) {
        if (boss.isLocked) {
            return res.status(403).json({ success: false, message: "ห้องนี้ต้องได้รับการปลดล็อก VIP" });
        }
        if (boss.nextSpawn && new Date(boss.nextSpawn) > new Date()) {
            return res.status(400).json({ success: false, message: "ช่องนี้กำลังใช้งานอยู่" });
        }

        const now = new Date();
        boss.killedAt = now.toISOString();
        boss.nextSpawn = new Date(now.getTime() + RESPAWN_MINUTES * 60000).toISOString();
        boss.createdBy = username || "Guest";
        boss.previousNextSpawn = null;
        boss.resetAt = null;
        return res.json({ success: true, boss });
    }
    res.status(404).json({ success: false, message: "Boss not found" });
});

app.post('/api/bosses/reset', (req, res) => {
    const { id } = req.body;
    const boss = bosses.find(b => b.id === id);
    if (boss) {
        if (boss.nextSpawn) {
            boss.previousNextSpawn = boss.nextSpawn;
            boss.resetAt = new Date().toISOString();
        }
        boss.killedAt = null;
        boss.nextSpawn = null;
        boss.createdBy = null;
        return res.json({ success: true, boss });
    }
    res.status(404).json({ success: false, message: "Boss not found" });
});

app.post('/api/bosses/undo', (req, res) => {
    const { id, username } = req.body;
    const boss = bosses.find(b => b.id === id);
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
        boss.createdBy = username || "Guest";
        boss.previousNextSpawn = null;
        boss.resetAt = null;
        return res.json({ success: true, boss });
    }
    res.status(404).json({ success: false, message: "Boss not found" });
});

// Admin APIs
app.post('/api/admin/data', (req, res) => {
    const { adminKey } = req.body;
    if (adminKey !== ADMIN_KEY) {
        return res.status(401).json({ success: false, message: "รหัสผ่านแอดมินไม่ถูกต้อง" });
    }

    const onlineList = Array.from(activeUsers.values());
    res.json({
        success: true,
        onlineUsers: onlineList,
        bosses: bosses
    });
});

app.post('/api/admin/toggle-lock', (req, res) => {
    const { adminKey, bossId, isLocked } = req.body;
    if (adminKey !== ADMIN_KEY) {
        return res.status(401).json({ success: false, message: "รหัสผ่านแอดมินไม่ถูกต้อง" });
    }

    const boss = bosses.find(b => b.id === bossId);
    if (boss) {
        boss.isLocked = isLocked;
        return res.json({ success: true, message: `อัปเดตสถานะห้องเรียบร้อย`, boss });
    }
    res.status(404).json({ success: false, message: "ไม่พบข้อมูลห้อง" });
});

app.post('/api/admin/kick-user', (req, res) => {
    const { adminKey, targetUserId } = req.body;
    if (adminKey !== ADMIN_KEY) {
        return res.status(401).json({ success: false, message: "รหัสผ่านแอดมินไม่ถูกต้อง" });
    }

    if (activeUsers.has(targetUserId)) {
        activeUsers.delete(targetUserId);
        return res.json({ success: true, message: `เตะผู้ใช้เรียบร้อย` });
    }
    res.status(404).json({ success: false, message: "ไม่พบผู้ใช้ในระบบ" });
});

app.listen(PORT, () => {
    console.log(`Boss Timer Server running on port ${PORT}`);
});
