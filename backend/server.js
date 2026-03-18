const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();
app.use(cors());
app.use(express.json());

// --- FRONTEND DOSYALARINI BAĞLAMA ---
// Sunucunun olduğu klasörden bir üst çıkıp 'frontend' klasörüne odaklanır
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));

// Tarayıcıya localhost:3000 yazınca main.html'i gönderir
app.get('/', (req, res) => {
    res.sendFile(path.join(frontendPath, 'main.html'));
});

// --- DİĞER API ROTALARI ---
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/lojistik', require('./routes/lojistikRoutes'));

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Sistem Hazır: http://localhost:${PORT}`);
});