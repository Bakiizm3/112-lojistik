const mysql = require('mysql2');
require('dotenv').config();

const rawDb = mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
});

rawDb.connect((err) => {
    if (err) {
        console.error('MySQL baglanti hatasi:', err.message);
        return;
    }
    console.log('MySQL baglandi');
});

module.exports = rawDb.promise();