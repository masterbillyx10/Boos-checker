const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// จุดเกิดบอส 4 เมืองหลัก
const LOCATIONS = [
    "Norad Military Base",
    "Ridgeway Airport",
    "Crystal Lake Resort",
    "Campos City"
];

// ระยะเวลาคูลดาวน์บอส (ตั้งไว้ 120 นาที หรือปรับเปลี่ยนตามเกมจริงได้)
const RESPAWN_MINUTES = 120; 

// สร้างรายการบอสสำหรับ 50 Official + 50 Premium
let bosses = [];
let idCounter = 1;

// สร้างเซิร์ฟเวอร์ Official 001 - 050
for (let i = 1; i <= 50; i++) {
    const serverName = `Official ${String(i).padStart(3, '0')}`;
    LOCATIONS.forEach(loc => {
        bosses.push({
            id: idCounter++,
            serverType: "Official",
            serverName: serverName,
            location: loc,
            killedAt: null,
            nextSpawn: null
        });
    });
}

// สร้างเซิร์ฟเวอร์ Premium 001 - 050
for (let i = 1; i <= 50; i++) {
    const serverName = `Premium ${String(i).padStart(3, '0')}`;
    LOCATIONS.forEach(loc => {
        bosses.push({
            id: idCounter++,
            serverType: "Premium",
            serverName: serverName,
            location: loc,
            killedAt: null,
            nextSpawn: null
        });
    });
}

// API ดึงข้อมูลบอสทั้งหมด (หรือกรองตาม Query)
app.get('/api/bosses', (req, res) => {
    let result = bosses;
    const { serverType, serverName, location } = req.query;

    if (serverType) result = result.filter(b => b.serverType === serverType);
    if (serverName) result = result.filter(b => b.serverName === serverName);
    if (location) result = result.filter(b => b.location === location);

    res.json(result);
});

// API บันทึกการตายของบอส
app.post('/api/bosses/kill', (req, res) => {
    const { id, customMinutes } = req.body;
    const boss = bosses.find(b => b.id === id);
    
    if (boss) {
        const now = new Date();
        const cooldown = customMinutes ? parseInt(customMinutes) : RESPAWN_MINUTES;
        
        boss.killedAt = now.toISOString();
        boss.nextSpawn = new Date(now.getTime() + cooldown * 60000).toISOString();
        return res.json({ success: true, boss });
    }
    
    res.status(404).json({ success: false, message: "Boss not found" });
});

// API รีเซ็ตบอส
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
