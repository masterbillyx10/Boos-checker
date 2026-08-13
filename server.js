const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ข้อมูลบอสในระบบ (ระยะเวลาเกิดเป็นนาที)
let bosses = [
    { id: 1, name: "Boss Alpha", respawnMinutes: 60, killedAt: null, nextSpawn: null },
    { id: 2, name: "Boss Beta", respawnMinutes: 120, killedAt: null, nextSpawn: null },
    { id: 3, name: "Boss Gamma", respawnMinutes: 180, killedAt: null, nextSpawn: null }
];

// API ดึงสถานะบอสทั้งหมด
app.get('/api/bosses', (req, res) => {
    res.json(bosses);
});

// API บันทึกการตายของบอส
app.post('/api/bosses/kill', (req, res) => {
    const { id } = req.body;
    const boss = bosses.find(b => b.id === id);
    
    if (boss) {
        const now = new Date();
        boss.killedAt = now.toISOString();
        // คำนวณเวลาเกิดรอบถัดไป
        const nextSpawnTime = new Date(now.getTime() + boss.respawnMinutes * 60000);
        boss.nextSpawn = nextSpawnTime.toISOString();
        return res.json({ success: true, boss });
    }
    
    res.status(404).json({ success: false, message: "Boss not found" });
});

// API รีเซ็ตสถานะบอส
app.post('/api/bosses/reset', (req, res) => {
    const { id } = req.body;
    const boss = bosses.find(b => b.id === id);
    if (boss) {
        boss.killedAt = null;
        boss.nextSpawn = null;
        return res.json({ success: true, boss });
    }
    res.status(404).json({ success: false, message: "Boss not found" });
});

app.listen(PORT, () => {
    console.log(`Boss Timer Server running on port ${PORT}`);
});