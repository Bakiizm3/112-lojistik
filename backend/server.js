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

app.get('/health', (req, res) => {
    res.status(200).json({ ok: true });
});

// --- DİĞER API ROTALARI ---
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/lojistik', require('./routes/lojistikRoutes'));

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sistem Hazir: http://0.0.0.0:${PORT}`);
});

function shutdown(signal) {
    console.log(`${signal} alindi, sunucu kapatiliyor...`);
    server.close(() => {
        console.log('Sunucu guvenli sekilde kapatildi.');
        process.exit(0);
    });

    setTimeout(() => {
        console.error('Zorunlu cikis: sunucu zamaninda kapanmadi.');
        process.exit(1);
    }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));