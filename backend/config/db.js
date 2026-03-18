const mysql = require('mysql2');
const path = require('path');

// .env dosyasının yerini kesin olarak bulmasını sağlıyoruz
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',      // Eğer bulamazsa XAMPP varsayılanı olan 'root' kullan
    password: process.env.DB_PASSWORD || '',  // XAMPP'ta varsayılan şifre boştur
    database: process.env.DB_NAME || 'konya_112_lojistik',
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const db = pool.promise();

db.query('SELECT 1')
    .then(() => console.log('✅ Veritabanı Bağlantısı Başarılı.'))
    .catch(err => console.error('❌ Veritabanı Hatası:', err));

module.exports = db;