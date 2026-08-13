const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const LOCATIONS = [
    "Norad Military Base",
    "Ridgeway Airport",
    "Crystal Lake Resort",
    "Campos City"
];

// ตั้งเวลาบอสเกิดเป็น 1 ชั่วโมง (60 นาที)
const RESPAWN_MINUTES = 60; 

let bosses = [];
let idCounter = 1;

// สร้างข้อมูล Official 50 และ Premium 50
for (let i = 1; i <= 50; i++) {
    const serverName = `Official ${String(i).padStart(3, '0')}`;
    LOCATIONS.forEach(loc => {
        bosses.push({
            id: idCounter++,
            serverType: "Official",
            serverName: serverName,
            location: loc,
            killedAt: null,
            nextSpawn: null,
            previousNextSpawn: null, // สำหรับทำ Undo
            resetAt: null            // เวลาที่กด Reset
        });
    });
}

for (let i = 1; i <= 50; i++) {
    const serverName = `Premium ${String(i).padStart(3, '0')}`;
    LOCATIONS.forEach(loc => {
        bosses.push({
            id: idCounter++,
            serverType: "Premium",
            serverName: serverName,
            location: loc,
            killedAt: null,
            nextSpawn: null,
            previousNextSpawn: null,
            resetAt: null
        });
    });
}

// API ดึงข้อมูล
app.get('/api/bosses', (req, res) => {
    let result = bosses;
    const { serverType, location } = req.query;

    if (serverType) result = result.filter(b => b.serverType === serverType);
    if (location) result = result.filter(b => b.location === location);

    res.json(result);
});

// 1. API SPAWN (คีย์เวลาบอส)
app.post('/api/bosses/spawn', (req, res) => {
    const { id } = req.body;
    const boss = bosses.find(b => b.id === id);
    
    if (boss) {
        if (boss.nextSpawn && new Date(boss.nextSpawn) > new Date()) {
            return res.status(400).json({ success: false, message: "ช่องนี้กำลังใช้งานอยู่" });
        }

        const now = new Date();
        // คำนวณเวลาเกิดถัดไป ให้ลงล็อค 60 นาทีพอดี (60 * 60 * 1000 มิลลิวินาที)
        const nextSpawnTime = new Date(now.getTime() + (60 * 60 * 1000));
        
        boss.killedAt = now.toISOString();
        boss.nextSpawn = nextSpawnTime.toISOString();
        boss.previousNextSpawn = null;
        boss.resetAt = null;
        return res.json({ success: true, boss });
    }
    
    res.status(404).json({ success: false, message: "Boss not found" });
});

// 2. API RESET (รีเซ็ตช่อง)
app.post('/api/bosses/reset', (req, res) => {
    const { id } = req.body;
    const boss = bosses.find(b => b.id === id);
    if (boss) {
        if (boss.nextSpawn) {
            boss.previousNextSpawn = boss.nextSpawn; // เก็บเวลาเดิมไว้ทำ Undo
            boss.resetAt = new Date().toISOString();  // บันทึกเวลาที่กด Reset
        }
        boss.killedAt = null;
        boss.nextSpawn = null;
        return res.json({ success: true, boss });
    }
    res.status(404).json({ success: false, message: "Boss not found" });
});

// 3. API UNDO (เลิกการรีเซ็ต - เงื่อนไขภายใน 3 นาที)
app.post('/api/bosses/undo', (req, res) => {
    const { id } = req.body;
    const boss = bosses.find(b => b.id === id);
    if (boss) {
        if (!boss.previousNextSpawn || !boss.resetAt) {
            return res.status(400).json({ success: false, message: "ไม่มีข้อมูลสำหรับ Undo" });
        }

        const now = new Date();
        const resetTime = new Date(boss.resetAt);
        const diffMinutes = (now - resetTime) / (1000 * 60);

        // เช็คว่าเกิน 3 นาทีหรือยัง
        if (diffMinutes > 3) {
            return res.status(400).json({ success: false, message: "เกินระยะเวลา 3 นาที ไม่สามารถ Undo ได้" });
        }

        // คืนค่าเวลาเดิม
        boss.nextSpawn = boss.previousNextSpawn;
        boss.previousNextSpawn = null;
        boss.resetAt = null;
        return res.json({ success: true, boss });
    }
    res.status(404).json({ success: false, message: "Boss not found" });
});

app.listen(PORT, () => {
    console.log(`Boss Timer Server running on port ${PORT}`);
});
