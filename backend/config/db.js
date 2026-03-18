const mysql = require('mysql2');
require('dotenv').config();

const host = process.env.DB_HOST || process.env.MYSQLHOST;
const port = Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306);
const user = process.env.DB_USER || process.env.MYSQLUSER;
const password = process.env.DB_PASS || process.env.DB_PASSWORD || process.env.MYSQLPASSWORD;
const database = process.env.DB_NAME || process.env.MYSQLDATABASE;

const pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

const db = pool.promise();

db.query('SELECT 1')
    .then(() => console.log('MySQL baglandi'))
    .catch((err) => {
        console.error('MySQL baglanti hatasi:', err && (err.message || err));
        if (err && err.code) console.error('MySQL hata kodu:', err.code);
    });

module.exports = db;