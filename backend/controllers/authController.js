const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'konya112_gizli_anahtar_2026';

const DEFAULT_PERM = {
    dashboard: true, araclar: true, tutanak: true,
    istasyonYonetim: false, aracYonetim: false, personelYonetim: false,
    yonetimSeviyesi: 'personel'
};

async function ensureIslemLogTable() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS tbl_islem_loglari (
            id INT AUTO_INCREMENT PRIMARY KEY,
            islem_tipi VARCHAR(80) NOT NULL,
            hedef_tablo VARCHAR(80) NOT NULL,
            hedef_id INT NULL,
            actor_ad_soyad VARCHAR(120) NULL,
            actor_tc_no VARCHAR(20) NULL,
            actor_seviye VARCHAR(30) NULL,
            aciklama TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_hedef (hedef_tablo, hedef_id),
            INDEX idx_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
}

async function logIslemAuth({ islem_tipi, hedef_tablo, hedef_id = null, actor = {}, aciklama = '' }) {
    try {
        await ensureIslemLogTable();
        await db.query(
            'INSERT INTO tbl_islem_loglari (islem_tipi, hedef_tablo, hedef_id, actor_ad_soyad, actor_tc_no, actor_seviye, aciklama) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                islem_tipi,
                hedef_tablo,
                hedef_id,
                actor.ad_soyad || null,
                actor.tc_no || null,
                actor.seviye || null,
                aciklama || null
            ]
        );
    } catch (e) {
        console.error('Auth islem log yazma hatasi:', e.message);
    }
}

function actorInfoFromRow(row) {
    let seviye = 'personel';
    try {
        const perm = row?.perm_json ? JSON.parse(row.perm_json) : DEFAULT_PERM;
        seviye = (perm.yonetimSeviyesi || 'personel').toString().toLowerCase();
    } catch (e) {}
    return {
        ad_soyad: row?.ad_soyad || null,
        tc_no: row?.tc_no || null,
        seviye
    };
}

async function ensureAuthColumns() {
    const [cols] = await db.query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tbl_personeller'"
    );
    const names = cols.map(c => c.COLUMN_NAME);

    if (!names.includes('sifre_hash')) {
        try { await db.query("ALTER TABLE tbl_personeller ADD COLUMN sifre_hash VARCHAR(255) NULL"); } catch (e) {}
    }
    if (!names.includes('onay_durumu')) {
        try { await db.query("ALTER TABLE tbl_personeller ADD COLUMN onay_durumu TINYINT(1) NOT NULL DEFAULT 1"); } catch (e) {}
    }
    if (!names.includes('sifre_degistirmeli')) {
        try { await db.query("ALTER TABLE tbl_personeller ADD COLUMN sifre_degistirmeli TINYINT(1) NOT NULL DEFAULT 0"); } catch (e) {}
    }
    if (!names.includes('kayit_durumu')) {
        try {
            await db.query("ALTER TABLE tbl_personeller ADD COLUMN kayit_durumu VARCHAR(20) NOT NULL DEFAULT 'onayli'");
            await db.query("UPDATE tbl_personeller SET kayit_durumu = CASE WHEN onay_durumu = 1 THEN 'onayli' ELSE 'beklemede' END");
        } catch (e) {}
    }
}

// Startup: root personel yoksa oluştur
async function ensureRootUser() {
    try {
        const [cols] = await db.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tbl_personeller'"
        );
        const colNames = cols.map(c => c.COLUMN_NAME);
        if (!colNames.includes('sifre_hash')) return false; // migration henüz tamamlanmadı

        const [rows] = await db.query("SELECT id, sifre_hash FROM tbl_personeller WHERE tc_no = 'root' LIMIT 1");
        if (rows.length > 0) {
            // Eski kayıtlarda root var ama şifre yoksa onar.
            if (!rows[0].sifre_hash) {
                const hash = await bcrypt.hash('Konya112!', 10);
                const rootPerm = {
                    dashboard: true, araclar: true, tutanak: true,
                    istasyonYonetim: true, aracYonetim: true, personelYonetim: true,
                    yonetimSeviyesi: 'root'
                };
                await db.query(
                    `UPDATE tbl_personeller
                     SET ad_soyad = ?, gorev = ?, sifre_hash = ?, onay_durumu = 1, sifre_degistirmeli = 0, perm_json = ?
                     WHERE id = ?`,
                    ['SİSTEM YÖNETİCİSİ', 'Sistem Yöneticisi', hash, JSON.stringify(rootPerm), rows[0].id]
                );
                console.log('✅ Root kullanıcı onarıldı. TC: root  Şifre: Konya112!');
            }
            return true;
        }

        const hash = await bcrypt.hash('Konya112!', 10);
        const rootPerm = {
            dashboard: true, araclar: true, tutanak: true,
            istasyonYonetim: true, aracYonetim: true, personelYonetim: true,
            yonetimSeviyesi: 'root'
        };
        await db.query(
            `INSERT INTO tbl_personeller (ad_soyad, tc_no, gorev, istasyon_adi, sifre_hash, onay_durumu, sifre_degistirmeli, perm_json)
             VALUES (?, ?, ?, ?, ?, 1, 0, ?)`,
            ['SİSTEM YÖNETİCİSİ', 'root', 'Sistem Yöneticisi', null, hash, JSON.stringify(rootPerm)]
        );
        console.log('✅ Root kullanıcı oluşturuldu. TC: root  Şifre: Konya112!');
        return true;
    } catch (e) {
        console.error('ensureRootUser hata:', e.message);
        return false;
    }
}

// Uygulama başladığında root'u hazırla; migration gecikirse kısa aralıklarla tekrar dene.
setTimeout(() => {
    ensureRootUser();

    let deneme = 0;
    const maxDeneme = 8;
    const timer = setInterval(async () => {
        deneme += 1;
        const ok = await ensureRootUser();
        if (ok || deneme >= maxDeneme) {
            clearInterval(timer);
        }
    }, 3000);
}, 3000);

// LOGIN
exports.login = async (req, res) => {
    try {
        await ensureAuthColumns();
        const { tc_no, sifre } = req.body;
        if (!tc_no || !sifre) {
            return res.status(400).json({ mesaj: 'TC no ve şifre zorunludur.' });
        }

        const [rows] = await db.query(
            'SELECT * FROM tbl_personeller WHERE tc_no = ? LIMIT 1',
            [tc_no.toString().trim()]
        );

        if (rows.length === 0) {
            return res.status(401).json({ mesaj: 'Hatalı kullanıcı adı veya şifre.' });
        }

        const p = rows[0];

        const kayitDurumu = (p.kayit_durumu || (p.onay_durumu ? 'onayli' : 'beklemede')).toString().toLowerCase();
        if (kayitDurumu === 'reddedildi') {
            return res.status(403).json({ mesaj: 'Kayıt talebiniz reddedildi. Lütfen yöneticinizle iletişime geçin.' });
        }
        if (kayitDurumu === 'askida') {
            return res.status(403).json({ mesaj: 'Hesabınız askıya alınmıştır. Lütfen yöneticinizle iletişime geçin.' });
        }
        if (!p.onay_durumu || kayitDurumu === 'beklemede') {
            return res.status(403).json({ mesaj: 'Hesabınız henüz onaylanmamış. Yöneticinizle iletişime geçin.' });
        }

        if (!p.sifre_hash) {
            // Şifre henüz belirlenmemiş — ilk giriş akışı
            return res.status(200).json({
                ilk_giris: true,
                personel_id: p.id,
                mesaj: 'Şifrenizi henüz belirlemediniz. Lütfen şifre belirleyin.'
            });
        }

        const sifreDogruMu = await bcrypt.compare(sifre, p.sifre_hash);
        if (!sifreDogruMu) {
            return res.status(401).json({ mesaj: 'Hatalı kullanıcı adı veya şifre.' });
        }

        let perm = DEFAULT_PERM;
        try { if (p.perm_json) perm = JSON.parse(p.perm_json); } catch (e) {}

        const tier = (perm.yonetimSeviyesi || 'personel').toString().toLowerCase();

        const token = jwt.sign(
            { id: p.id, tc_no: p.tc_no, tier },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        // Şifre değiştirme zorunluysa
        if (p.sifre_degistirmeli) {
            return res.json({
                sifre_degistirmeli: true,
                token,
                mesaj: 'Şifrenizi değiştirmeniz gerekmektedir.'
            });
        }

        res.json({
            mesaj: 'Giriş başarılı.',
            token,
            kullanici: {
                id: p.id,
                ad_soyad: p.ad_soyad,
                tc_no: p.tc_no,
                gorev: p.gorev || null,
                rol: tier === 'root' ? 'Süper Admin' : tier,
                perm
            }
        });
    } catch (error) {
        console.error('Login hatası:', error);
        res.status(500).json({ mesaj: 'Sunucu hatası.' });
    }
};

// PERSONEL KENDI KAYIT (ONAY BEKLER)
exports.kayitOl = async (req, res) => {
    try {
        await ensureAuthColumns();
        const { ad_soyad, tc_no, sifre, sifre_tekrar } = req.body;
        const adSoyad = (ad_soyad || '').toString().trim().toLocaleUpperCase('tr');
        const tcNo = (tc_no || '').toString().trim();

        if (!adSoyad || !tcNo || !sifre || !sifre_tekrar) {
            return res.status(400).json({ mesaj: 'Ad soyad, TC no ve şifre alanları zorunludur.' });
        }
        if (!/^\d{11}$/.test(tcNo)) {
            return res.status(400).json({ mesaj: 'TC no 11 haneli olmalıdır.' });
        }
        if (sifre !== sifre_tekrar) {
            return res.status(400).json({ mesaj: 'Şifreler eşleşmiyor.' });
        }
        if (String(sifre).length < 6) {
            return res.status(400).json({ mesaj: 'Şifre en az 6 karakter olmalıdır.' });
        }

        const [dup] = await db.query('SELECT id FROM tbl_personeller WHERE tc_no = ? LIMIT 1', [tcNo]);
        if (dup.length) {
            return res.status(400).json({ mesaj: 'Bu TC no ile kayıt zaten mevcut.' });
        }

        const hash = await bcrypt.hash(String(sifre), 10);
        await db.query(
            `INSERT INTO tbl_personeller (ad_soyad, tc_no, gorev, istasyon_adi, sifre_hash, onay_durumu, kayit_durumu, sifre_degistirmeli, perm_json)
             VALUES (?, ?, NULL, NULL, ?, 0, 'beklemede', 0, ?)`,
            [adSoyad, tcNo, hash, JSON.stringify(DEFAULT_PERM)]
        );

        return res.status(201).json({
            mesaj: 'Kaydınız alındı. Müdür veya Süper Yetkili onayı sonrası giriş yapabilirsiniz.'
        });
    } catch (error) {
        console.error('kayitOl hatası:', error);
        return res.status(500).json({ mesaj: 'Sunucu hatası.' });
    }
};

// YÖNETİCİ: PERSONEL ONAY GÜNCELLEME
exports.onayGuncelle = async (req, res) => {
    try {
        await ensureAuthColumns();
        const { hedef_id, onay, islem, actor_tc_no } = req.body;
        if (!hedef_id) return res.status(400).json({ mesaj: 'Hedef personel ID zorunludur.' });

        const [actorRows] = await db.query('SELECT ad_soyad, tc_no, perm_json FROM tbl_personeller WHERE tc_no = ? LIMIT 1', [actor_tc_no || '']);
        let actorPerm = DEFAULT_PERM;
        try { if (actorRows[0]?.perm_json) actorPerm = JSON.parse(actorRows[0].perm_json); } catch (e) {}
        const actorInfo = actorInfoFromRow(actorRows[0]);
        const actorTier = (actorPerm.yonetimSeviyesi || 'personel').toString().toLowerCase();
        if (!['root', 'mudur'].includes(actorTier)) {
            await logIslemAuth({
                islem_tipi: 'YETKISIZ_HESAP_ONAY_DENEMESI',
                hedef_tablo: 'tbl_personeller',
                hedef_id: Number(hedef_id),
                actor: actorInfo,
                aciklama: `Yetkisiz hesap onay islemi denemesi. islem=${(islem || 'onayla').toString()}`
            });
            return res.status(403).json({ mesaj: 'Bu işlem için yetkiniz yok.' });
        }

        const [rows] = await db.query('SELECT ad_soyad FROM tbl_personeller WHERE id = ? LIMIT 1', [hedef_id]);
        if (!rows.length) return res.status(404).json({ mesaj: 'Personel bulunamadı.' });

        const seciliIslem = (islem || '').toString().toLowerCase();
        if (seciliIslem === 'reddet') {
            await db.query('UPDATE tbl_personeller SET onay_durumu = 0, kayit_durumu = ? WHERE id = ?', ['reddedildi', hedef_id]);
            await logIslemAuth({
                islem_tipi: 'HESAP_RED',
                hedef_tablo: 'tbl_personeller',
                hedef_id: Number(hedef_id),
                actor: actorInfo,
                aciklama: `${rows[0].ad_soyad} hesabinin kayit talebi reddedildi.`
            });
            return res.json({ mesaj: `${rows[0].ad_soyad} için kayıt talebi reddedildi.` });
        }
        if (seciliIslem === 'askiya_al') {
            await db.query('UPDATE tbl_personeller SET onay_durumu = 0, kayit_durumu = ? WHERE id = ?', ['askida', hedef_id]);
            await logIslemAuth({
                islem_tipi: 'HESAP_ASKIYA_ALMA',
                hedef_tablo: 'tbl_personeller',
                hedef_id: Number(hedef_id),
                actor: actorInfo,
                aciklama: `${rows[0].ad_soyad} hesabi askiya alindi.`
            });
            return res.json({ mesaj: `${rows[0].ad_soyad} için hesap askıya alındı.` });
        }

        const yeniDurum = onay ? 1 : 0;
        const yeniKayitDurumu = onay ? 'onayli' : 'beklemede';
        await db.query('UPDATE tbl_personeller SET onay_durumu = ?, kayit_durumu = ? WHERE id = ?', [yeniDurum, yeniKayitDurumu, hedef_id]);
        await logIslemAuth({
            islem_tipi: onay ? 'HESAP_ONAY' : 'HESAP_ONAY_KALDIRMA',
            hedef_tablo: 'tbl_personeller',
            hedef_id: Number(hedef_id),
            actor: actorInfo,
            aciklama: onay
                ? `${rows[0].ad_soyad} hesabi onaylandi.`
                : `${rows[0].ad_soyad} hesabinin onayi kaldirildi.`
        });
        return res.json({
            mesaj: onay
                ? `${rows[0].ad_soyad} için giriş onayı verildi.`
                : `${rows[0].ad_soyad} için giriş onayı kaldırıldı.`
        });
    } catch (error) {
        console.error('onayGuncelle hatası:', error);
        return res.status(500).json({ mesaj: 'Sunucu hatası.' });
    }
};

// İLK GİRİŞ / ŞİFRE BELİRLEME
exports.sifreBelirle = async (req, res) => {
    try {
        const { personel_id, yeni_sifre, yeni_sifre_tekrar } = req.body;
        if (!personel_id || !yeni_sifre) {
            return res.status(400).json({ mesaj: 'Personel ID ve yeni şifre zorunludur.' });
        }
        if (yeni_sifre !== yeni_sifre_tekrar) {
            return res.status(400).json({ mesaj: 'Şifreler eşleşmiyor.' });
        }
        if (yeni_sifre.length < 6) {
            return res.status(400).json({ mesaj: 'Şifre en az 6 karakter olmalıdır.' });
        }

        const [rows] = await db.query('SELECT * FROM tbl_personeller WHERE id = ? LIMIT 1', [personel_id]);
        if (!rows.length) return res.status(404).json({ mesaj: 'Personel bulunamadı.' });
        const p = rows[0];

        const hash = await bcrypt.hash(yeni_sifre, 10);
        await db.query(
            'UPDATE tbl_personeller SET sifre_hash = ?, sifre_degistirmeli = 0 WHERE id = ?',
            [hash, personel_id]
        );

        let perm = DEFAULT_PERM;
        try { if (p.perm_json) perm = JSON.parse(p.perm_json); } catch (e) {}
        const tier = (perm.yonetimSeviyesi || 'personel').toString().toLowerCase();

        const token = jwt.sign({ id: p.id, tc_no: p.tc_no, tier }, JWT_SECRET, { expiresIn: '8h' });

        res.json({
            mesaj: 'Şifre başarıyla belirlendi.',
            token,
            kullanici: {
                id: p.id,
                ad_soyad: p.ad_soyad,
                tc_no: p.tc_no,
                gorev: p.gorev || null,
                rol: tier === 'root' ? 'Süper Admin' : tier,
                perm
            }
        });
    } catch (error) {
        console.error('Şifre belirleme hatası:', error);
        res.status(500).json({ mesaj: 'Sunucu hatası.' });
    }
};

// ŞİFRE DEĞİŞTİRME (giriş yapılmış kullanıcı için)
exports.sifreDegistir = async (req, res) => {
    try {
        const { personel_id, eski_sifre, yeni_sifre, yeni_sifre_tekrar } = req.body;
        if (!personel_id || !yeni_sifre) {
            return res.status(400).json({ mesaj: 'Zorunlu alanlar eksik.' });
        }
        if (yeni_sifre !== yeni_sifre_tekrar) {
            return res.status(400).json({ mesaj: 'Şifreler eşleşmiyor.' });
        }
        if (yeni_sifre.length < 6) {
            return res.status(400).json({ mesaj: 'Şifre en az 6 karakter olmalıdır.' });
        }

        const [rows] = await db.query('SELECT * FROM tbl_personeller WHERE id = ? LIMIT 1', [personel_id]);
        if (!rows.length) return res.status(404).json({ mesaj: 'Personel bulunamadı.' });
        const p = rows[0];

        // Eski şifre varsa doğrula
        if (p.sifre_hash && eski_sifre) {
            const dogru = await bcrypt.compare(eski_sifre, p.sifre_hash);
            if (!dogru) return res.status(401).json({ mesaj: 'Mevcut şifre hatalı.' });
        }

        const hash = await bcrypt.hash(yeni_sifre, 10);
        await db.query('UPDATE tbl_personeller SET sifre_hash = ?, sifre_degistirmeli = 0 WHERE id = ?', [hash, personel_id]);
        res.json({ mesaj: 'Şifre başarıyla güncellendi.' });
    } catch (error) {
        console.error('Şifre değiştirme hatası:', error);
        res.status(500).json({ mesaj: 'Sunucu hatası.' });
    }
};

// YÖNETİCİ: Şifre Sıfırla (sifre_hash = null, sifre_degistirmeli = 1)
exports.sifreSifirla = async (req, res) => {
    try {
        const { hedef_id, actor_tc_no } = req.body;
        if (!hedef_id) return res.status(400).json({ mesaj: 'Hedef personel ID zorunludur.' });

        // Actor'ün yetkisini kontrol et
        const [actorRows] = await db.query('SELECT ad_soyad, tc_no, perm_json FROM tbl_personeller WHERE tc_no = ? LIMIT 1', [actor_tc_no || '']);
        let actorPerm = DEFAULT_PERM;
        try { if (actorRows[0]?.perm_json) actorPerm = JSON.parse(actorRows[0].perm_json); } catch (e) {}
        const actorInfo = actorInfoFromRow(actorRows[0]);
        const actorTier = (actorPerm.yonetimSeviyesi || 'personel').toString().toLowerCase();
        if (!['root', 'mudur'].includes(actorTier)) {
            await logIslemAuth({
                islem_tipi: 'YETKISIZ_SIFRE_SIFIRLAMA_DENEMESI',
                hedef_tablo: 'tbl_personeller',
                hedef_id: Number(hedef_id),
                actor: actorInfo,
                aciklama: 'Yetkisiz sifre sifirlama denemesi.'
            });
            return res.status(403).json({ mesaj: 'Yetkiniz yok.' });
        }

        const [rows] = await db.query('SELECT ad_soyad FROM tbl_personeller WHERE id = ? LIMIT 1', [hedef_id]);
        if (!rows.length) return res.status(404).json({ mesaj: 'Personel bulunamadı.' });

        // Şifreyi sil + zorunlu değiştirme flag
        await db.query('UPDATE tbl_personeller SET sifre_hash = NULL, sifre_degistirmeli = 1 WHERE id = ?', [hedef_id]);
        await logIslemAuth({
            islem_tipi: 'PERSONEL_SIFRE_SIFIRLAMA',
            hedef_tablo: 'tbl_personeller',
            hedef_id: Number(hedef_id),
            actor: actorInfo,
            aciklama: `${rows[0].ad_soyad} adli personelin sifresi sifirlandi.`
        });
        res.json({ mesaj: `${rows[0].ad_soyad} adlı personelin şifresi sıfırlandı. Bir sonraki girişte yeni şifre belirleyecek.` });
    } catch (error) {
        console.error('Şifre sıfırlama hatası:', error);
        res.status(500).json({ mesaj: 'Sunucu hatası.' });
    }
};
