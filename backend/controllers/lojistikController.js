const db = require('../config/db');

const DEFAULT_PERM = {
    dashboard: true,
    araclar: true,
    tutanak: true,
    istasyonYonetim: false,
    aracYonetim: false,
    personelYonetim: false,
    yonetimSeviyesi: 'personel'
};

const ALLOWED_TIERS = ['personel', 'yetkili', 'mudur', 'root'];

async function ensurePersonelTable() {
    try {
        // Önce tablo oluştur (ya da mevcut kalır)
        await db.query(`
            CREATE TABLE IF NOT EXISTS tbl_personeller (
                id INT AUTO_INCREMENT PRIMARY KEY,
                ad_soyad VARCHAR(120) NOT NULL,
                tc_no VARCHAR(11) UNIQUE,
                istasyon_adi VARCHAR(120) NULL,
                perm_json TEXT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        // Sonra migration kontrol et
        const [columns] = await db.query({
            sql: "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tbl_personeller'",
            timeout: 5000
        });
        
        const columnNames = columns.map(c => c.COLUMN_NAME);

        // gorev kolonu yoksa ekle
        if (!columnNames.includes('gorev')) {
            try {
                await db.query(`ALTER TABLE tbl_personeller ADD COLUMN gorev VARCHAR(60) NULL`);
            } catch (e) { /* zaten varsa hata fırlatır, yoksay */ }
        }

        // Auth kolonları yoksa ekle
        if (!columnNames.includes('sifre_hash')) {
            try { await db.query(`ALTER TABLE tbl_personeller ADD COLUMN sifre_hash VARCHAR(255) NULL`); } catch (e) {}
        }
        if (!columnNames.includes('onay_durumu')) {
            try { await db.query(`ALTER TABLE tbl_personeller ADD COLUMN onay_durumu TINYINT(1) NOT NULL DEFAULT 1`); } catch (e) {}
        }
        if (!columnNames.includes('sifre_degistirmeli')) {
            try { await db.query(`ALTER TABLE tbl_personeller ADD COLUMN sifre_degistirmeli TINYINT(1) NOT NULL DEFAULT 0`); } catch (e) {}
        }
        if (!columnNames.includes('kayit_durumu')) {
            try {
                await db.query(`ALTER TABLE tbl_personeller ADD COLUMN kayit_durumu VARCHAR(20) NOT NULL DEFAULT 'onayli'`);
                await db.query(`UPDATE tbl_personeller SET kayit_durumu = CASE WHEN onay_durumu = 1 THEN 'onayli' ELSE 'beklemede' END`);
            } catch (e) {}
        }

        // Eğer sicil_no var ve tc_no yoksa migration yap
        if (columnNames.includes('sicil_no') && !columnNames.includes('tc_no')) {
            try {
                // tc_no kolonu ekle
                await db.query(`ALTER TABLE tbl_personeller ADD COLUMN tc_no VARCHAR(11) UNIQUE`);
                // Eski sicil_no verileri tc_no'ya kopyala
                await db.query(`UPDATE tbl_personeller SET tc_no = sicil_no WHERE tc_no IS NULL`);
                // tc_no'yu NOT NULL yap
                await db.query(`ALTER TABLE tbl_personeller MODIFY tc_no VARCHAR(11) NOT NULL UNIQUE`);
                // Eski sicil_no'yu kaldır
                await db.query(`ALTER TABLE tbl_personeller DROP COLUMN sicil_no`);
            } catch (migrationError) {
                console.error('Migration failed, dropping and recreating table:', migrationError.message);
                // Migration başarısız ise tabloyu sil ve yeniden oluştur
                await db.query(`DROP TABLE IF EXISTS tbl_personeller`);
                await db.query(`
                    CREATE TABLE tbl_personeller (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        ad_soyad VARCHAR(120) NOT NULL,
                        tc_no VARCHAR(11) NOT NULL UNIQUE,
                        istasyon_adi VARCHAR(120) NULL,
                        perm_json TEXT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
                `);
            }
        }
    } catch (error) {
        console.error('ensurePersonelTable error:', error.message);
        throw error;
    }
}

async function ensureAracKayitTable() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS tbl_arac_kayitlari (
            id INT AUTO_INCREMENT PRIMARY KEY,
            arac_id INT NOT NULL,
            kayit_tipi VARCHAR(20) NOT NULL,
            kayit_tarihi DATETIME NOT NULL,
            aciklama TEXT NOT NULL,
            personel_ids_json TEXT NULL,
            personel_adlari TEXT NULL,
            giren_ad_soyad VARCHAR(120) NULL,
            giren_tc_no VARCHAR(20) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_arac_id (arac_id),
            INDEX idx_kayit_tarihi (kayit_tarihi)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    const [columns] = await db.query({
        sql: "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tbl_arac_kayitlari'",
        timeout: 5000
    });
    const map = new Map(columns.map((c) => [c.COLUMN_NAME, (c.DATA_TYPE || '').toLowerCase()]));

    if (!map.has('personel_ids_json')) {
        await db.query('ALTER TABLE tbl_arac_kayitlari ADD COLUMN personel_ids_json TEXT NULL');
    }
    if (!map.has('personel_adlari')) {
        await db.query('ALTER TABLE tbl_arac_kayitlari ADD COLUMN personel_adlari TEXT NULL');
    }
    if (!map.has('giren_ad_soyad')) {
        await db.query('ALTER TABLE tbl_arac_kayitlari ADD COLUMN giren_ad_soyad VARCHAR(120) NULL');
    }
    if (!map.has('giren_tc_no')) {
        await db.query('ALTER TABLE tbl_arac_kayitlari ADD COLUMN giren_tc_no VARCHAR(20) NULL');
    }
    if (map.get('kayit_tarihi') === 'date') {
        await db.query('ALTER TABLE tbl_arac_kayitlari MODIFY kayit_tarihi DATETIME NOT NULL');
    }
}

async function ensureAracTable() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS tbl_araclar (
            id INT AUTO_INCREMENT PRIMARY KEY,
            plaka VARCHAR(20) NOT NULL UNIQUE,
            istasyon_adi VARCHAR(120) NULL,
            model_yili INT NULL,
            kilometre INT NULL,
            durum VARCHAR(255) NULL,
            muayene_tarihi DATE NULL,
            arac_tipi VARCHAR(80) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    const [columns] = await db.query({
        sql: "SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tbl_araclar'",
        timeout: 5000
    });
    const durumKolon = columns.find((c) => c.COLUMN_NAME === 'durum');
    const veriTipi = (durumKolon?.DATA_TYPE || '').toLowerCase();
    const kolonTipi = (durumKolon?.COLUMN_TYPE || '').toLowerCase();

    if (!durumKolon) {
        await db.query('ALTER TABLE tbl_araclar ADD COLUMN durum VARCHAR(255) NULL');
        return;
    }

    if (!['varchar', 'text', 'mediumtext', 'longtext'].includes(veriTipi) || kolonTipi.includes('enum(')) {
        await db.query('ALTER TABLE tbl_araclar MODIFY COLUMN durum VARCHAR(255) NULL');
    }
}

async function ensureIstasyonTable() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS tbl_istasyonlar (
            id INT AUTO_INCREMENT PRIMARY KEY,
            istasyon_adi VARCHAR(120) NOT NULL,
            istasyon_adresi VARCHAR(255) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    const [columns] = await db.query({
        sql: "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tbl_istasyonlar'",
        timeout: 5000
    });

    const columnNames = columns.map((c) => c.COLUMN_NAME);
    if (!columnNames.includes('istasyon_adresi')) {
        await db.query('ALTER TABLE tbl_istasyonlar ADD COLUMN istasyon_adresi VARCHAR(255) NULL');
    }
}

async function ensureStokTable() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS tbl_stok (
            id INT AUTO_INCREMENT PRIMARY KEY,
            malzeme_adi VARCHAR(120) NOT NULL,
            mevcut_stok INT NOT NULL DEFAULT 0,
            kritik_esik INT NOT NULL DEFAULT 10,
            birim VARCHAR(40) NULL,
            tedarikci VARCHAR(120) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    const [columns] = await db.query({
        sql: "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tbl_stok'",
        timeout: 5000
    });

    const columnNames = columns.map((c) => c.COLUMN_NAME);
    if (!columnNames.includes('birim')) {
        await db.query('ALTER TABLE tbl_stok ADD COLUMN birim VARCHAR(40) NULL');
    }
    if (!columnNames.includes('tedarikci')) {
        await db.query('ALTER TABLE tbl_stok ADD COLUMN tedarikci VARCHAR(120) NULL');
    }
}

function normalizeDateTimeInput(value) {
    const raw = (value || '').toString().trim();
    if (!raw) return null;
    let normalized = raw.replace('T', ' ');
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized += ' 00:00:00';
    if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(normalized)) normalized += ':00';
    if (!/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(normalized)) return null;
    return normalized;
}

const ARAC_DURUM_SECENEKLERI = [
    { key: 'aktif', label: 'Aktif' },
    { key: 'bakimda', label: 'Bakımda' },
    { key: 'arizali', label: 'Arızalı' },
    { key: 'pasif', label: 'Pasif' }
];

function normalizeDurumAnahtari(value) {
    return (value || '')
        .toString()
        .trim()
        .toLocaleLowerCase('tr')
        .replaceAll('ı', 'i')
        .replaceAll('ğ', 'g')
        .replaceAll('ü', 'u')
        .replaceAll('ş', 's')
        .replaceAll('ö', 'o')
        .replaceAll('ç', 'c');
}

function parseAracDurumlari(value) {
    const rawList = Array.isArray(value)
        ? value
        : (value || '').toString().split(/[,|\n]+/);

    const normalized = rawList
        .map((x) => (x || '').toString().trim())
        .filter(Boolean);

    const secilenler = [];
    ARAC_DURUM_SECENEKLERI.forEach((durum) => {
        if (normalized.some((x) => {
            const key = normalizeDurumAnahtari(x);
            return key === normalizeDurumAnahtari(durum.key) || key === normalizeDurumAnahtari(durum.label);
        }) && !secilenler.includes(durum.label)) {
            secilenler.push(durum.label);
        }
    });

    return secilenler;
}

function serializeAracDurumlari(value) {
    return parseAracDurumlari(value).join(', ');
}

function aracDurumuVarMi(value, hedefDurum) {
    return parseAracDurumlari(value).includes(hedefDurum);
}

async function backfillLegacyAracKayitlari(aracId) {
    await ensureAracKayitTable();
    await ensureIslemLogTable();

    const [rows] = await db.query(
        `SELECT id, kayit_tarihi, created_at, giren_ad_soyad, personel_adlari
         FROM tbl_arac_kayitlari
         WHERE arac_id = ?`,
        [aracId]
    );

    for (const row of rows) {
        const hasGiren = !!(row.giren_ad_soyad || '').toString().trim();
        const hasPersonel = !!(row.personel_adlari || '').toString().trim();
        if (hasGiren && hasPersonel) continue;

        let girenAdSoyad = hasGiren ? row.giren_ad_soyad : null;
        if (!girenAdSoyad) {
            const refDate = row.created_at || row.kayit_tarihi;
            const [logRows] = await db.query(
                `SELECT actor_ad_soyad
                 FROM tbl_islem_loglari
                 WHERE actor_ad_soyad IS NOT NULL
                   AND actor_ad_soyad <> ''
                   AND (
                     (islem_tipi = 'ARAC_KAYDI_EKLEME' AND aciklama LIKE ?)
                     OR (hedef_tablo = 'tbl_arac_kayitlari' AND hedef_id = ?)
                   )
                 ORDER BY ABS(TIMESTAMPDIFF(SECOND, created_at, ?)) ASC, id DESC
                 LIMIT 1`,
                [`%arac_id=${Number(aracId)}%`, Number(row.id), refDate]
            );
            girenAdSoyad = logRows[0]?.actor_ad_soyad || 'Bilinmiyor (Eski Kayıt)';
        }

        const personelAdlari = hasPersonel ? row.personel_adlari : 'Belirtilmedi (Eski Kayıt)';

        await db.query(
            `UPDATE tbl_arac_kayitlari
             SET giren_ad_soyad = ?, personel_adlari = ?
             WHERE id = ?`,
            [girenAdSoyad, personelAdlari, Number(row.id)]
        );
    }
}

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

async function logIslem({ islem_tipi, hedef_tablo, hedef_id = null, actor = {}, aciklama = '' }) {
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
}

function getActorFromReq(req) {
    const a = req?.body?.actor || {};
    return {
        ad_soyad: a.ad_soyad || null,
        tc_no: a.tc_no || null,
        seviye: a.seviye || null
    };
}

function isRootOrMudur(actor) {
    const seviye = (actor?.seviye || '').toString().toLowerCase();
    return seviye === 'root' || seviye === 'mudur';
}

function normalizePerm(input) {
    const src = input && typeof input === 'object' ? input : {};
    const tier = (src.yonetimSeviyesi || '').toString().toLowerCase();
    return {
        // Modüller tüm personel tarafından görülür.
        dashboard: true,
        araclar: true,
        tutanak: true,
        istasyonYonetim: !!src.istasyonYonetim,
        aracYonetim: !!src.aracYonetim,
        personelYonetim: !!src.personelYonetim,
        yonetimSeviyesi: ALLOWED_TIERS.includes(tier) ? tier : 'personel'
    };
}

// ÖZET VERİLER
exports.getOzet = async (req, res) => {
    try {
        const [toplam] = await db.query('SELECT COUNT(*) as sayi FROM tbl_araclar');
        const [bakim] = await db.query('SELECT COUNT(*) as sayi FROM tbl_araclar WHERE durum = "Bakımda"');
        res.json({ aktifArac: (toplam[0].sayi || 0) - (bakim[0].sayi || 0), bakimdakiArac: bakim[0].sayi || 0 });
    } catch (error) { res.status(500).json({ mesaj: "Hata" }); }
};

async function safeQuery(sql, params = []) {
    try {
        const [rows] = await db.query(sql, params);
        return rows;
    } catch (e) {
        return [];
    }
}

function sonNgunListesi(gunSayisi) {
    const out = [];
    const n = Math.max(Number(gunSayisi) || 7, 1);
    for (let i = n - 1; i >= 0; i--) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - i);
        out.push(d.toISOString().slice(0, 10));
    }
    return out;
}

exports.getDashboardData = async (req, res) => {
    try {
        await ensureAracTable();
        await ensureAracKayitTable();
        await ensureIslemLogTable();
        await ensurePersonelTable();
        await ensureIstasyonTable();
        await ensureStokTable();

        const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 30);

        const [araclar, istasyonlar, personeller, sonLoglar, stokRows, bugunKayitRows, son24Rows, kayitTrendRows, logTrendRows] = await Promise.all([
            safeQuery('SELECT id, plaka, durum, istasyon_adi, muayene_tarihi FROM tbl_araclar'),
            safeQuery('SELECT id, istasyon_adi, istasyon_adresi FROM tbl_istasyonlar'),
            safeQuery('SELECT id, ad_soyad, istasyon_adi FROM tbl_personeller'),
            safeQuery('SELECT id, islem_tipi, hedef_tablo, hedef_id, actor_ad_soyad, actor_seviye, aciklama, created_at FROM tbl_islem_loglari ORDER BY id DESC LIMIT 20'),
            safeQuery('SELECT id, malzeme_adi, mevcut_stok, kritik_esik FROM tbl_stok'),
            safeQuery('SELECT COUNT(*) AS sayi FROM tbl_arac_kayitlari WHERE DATE(kayit_tarihi) = CURDATE()'),
            safeQuery('SELECT COUNT(*) AS sayi FROM tbl_islem_loglari WHERE created_at >= (NOW() - INTERVAL 1 DAY)'),
            safeQuery(
                `SELECT DATE(kayit_tarihi) AS gun,
                        SUM(CASE WHEN kayit_tipi = 'ariza' THEN 1 ELSE 0 END) AS ariza,
                        SUM(CASE WHEN kayit_tipi = 'servis' THEN 1 ELSE 0 END) AS servis,
                        COUNT(*) AS toplam
                 FROM tbl_arac_kayitlari
                 WHERE kayit_tarihi >= (CURDATE() - INTERVAL ? DAY)
                 GROUP BY DATE(kayit_tarihi)`,
                [days - 1]
            ),
            safeQuery(
                `SELECT DATE(created_at) AS gun, COUNT(*) AS toplam
                 FROM tbl_islem_loglari
                 WHERE created_at >= (CURDATE() - INTERVAL ? DAY)
                 GROUP BY DATE(created_at)`,
                [days - 1]
            )
        ]);

        const aktifArac = araclar.filter((a) => aracDurumuVarMi(a.durum, 'Aktif')).length;
        const bakimdakiArac = araclar.filter((a) => aracDurumuVarMi(a.durum, 'Bakımda')).length;
        const arizaliArac = araclar.filter((a) => aracDurumuVarMi(a.durum, 'Arızalı')).length;
        const pasifArac = araclar.filter((a) => aracDurumuVarMi(a.durum, 'Pasif')).length;
        const kritikStokKalem = stokRows.filter((s) => Number(s.mevcut_stok || 0) <= Number(s.kritik_esik || 0)).length;

        const muayeneYaklasan = araclar
            .filter((a) => !!a.muayene_tarihi)
            .map((a) => {
                const t = new Date(a.muayene_tarihi);
                const diff = Math.ceil((t.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                return {
                    plaka: a.plaka,
                    istasyon_adi: a.istasyon_adi || '-',
                    kalan_gun: diff
                };
            })
            .filter((a) => a.kalan_gun >= 0 && a.kalan_gun <= 30)
            .sort((a, b) => a.kalan_gun - b.kalan_gun)
            .slice(0, 12);

        const arizaliAktif = araclar
            .filter((a) => aracDurumuVarMi(a.durum, 'Arızalı'))
            .map((a) => ({ plaka: a.plaka, istasyon_adi: a.istasyon_adi || '-' }))
            .slice(0, 12);

        const kritikStoklar = stokRows
            .filter((s) => Number(s.mevcut_stok || 0) <= Number(s.kritik_esik || 0))
            .map((s) => ({ malzeme_adi: s.malzeme_adi, mevcut_stok: Number(s.mevcut_stok || 0), kritik_esik: Number(s.kritik_esik || 0) }))
            .slice(0, 12);

        const istasyonsuzAraclar = araclar
            .filter((a) => !(a.istasyon_adi || '').toString().trim())
            .map((a) => ({ plaka: a.plaka, durum: a.durum || '-' }))
            .slice(0, 12);

        const adrssizIstasyonlar = istasyonlar
            .filter((i) => !(i.istasyon_adresi || '').toString().trim())
            .map((i) => ({ istasyon_adi: i.istasyon_adi }))
            .slice(0, 12);

        const istasyonMap = new Map();
        for (const i of istasyonlar) {
            const key = (i.istasyon_adi || '').toString().trim();
            if (!key) continue;
            istasyonMap.set(key, {
                istasyon_adi: key,
                arac_toplam: 0,
                aktif: 0,
                bakimda: 0,
                arizali: 0,
                pasif: 0,
                personel_sayisi: 0,
                kritik_stok_var: kritikStokKalem > 0,
                son_islem_tarihi: null
            });
        }

        for (const a of araclar) {
            const key = (a.istasyon_adi || '').toString().trim();
            if (!key) continue;
            if (!istasyonMap.has(key)) {
                istasyonMap.set(key, {
                    istasyon_adi: key,
                    arac_toplam: 0,
                    aktif: 0,
                    bakimda: 0,
                    arizali: 0,
                    pasif: 0,
                    personel_sayisi: 0,
                    kritik_stok_var: kritikStokKalem > 0,
                    son_islem_tarihi: null
                });
            }
            const row = istasyonMap.get(key);
            row.arac_toplam += 1;
            if (aracDurumuVarMi(a.durum, 'Aktif')) row.aktif += 1;
            if (aracDurumuVarMi(a.durum, 'Bakımda')) row.bakimda += 1;
            if (aracDurumuVarMi(a.durum, 'Arızalı')) row.arizali += 1;
            if (aracDurumuVarMi(a.durum, 'Pasif')) row.pasif += 1;
        }

        for (const p of personeller) {
            const key = (p.istasyon_adi || '').toString().trim();
            if (!key) continue;
            if (!istasyonMap.has(key)) {
                istasyonMap.set(key, {
                    istasyon_adi: key,
                    arac_toplam: 0,
                    aktif: 0,
                    bakimda: 0,
                    arizali: 0,
                    pasif: 0,
                    personel_sayisi: 0,
                    kritik_stok_var: kritikStokKalem > 0,
                    son_islem_tarihi: null
                });
            }
            istasyonMap.get(key).personel_sayisi += 1;
        }

        for (const log of sonLoglar) {
            const aciklama = (log.aciklama || '').toString();
            for (const [istasyonAdi, row] of istasyonMap.entries()) {
                if (aciklama.toLocaleUpperCase('tr').includes(istasyonAdi.toLocaleUpperCase('tr'))) {
                    if (!row.son_islem_tarihi || new Date(log.created_at) > new Date(row.son_islem_tarihi)) {
                        row.son_islem_tarihi = log.created_at;
                    }
                }
            }
        }

        const gunler = sonNgunListesi(days);
        const kayitTrendMap = new Map(kayitTrendRows.map((r) => [new Date(r.gun).toISOString().slice(0, 10), r]));
        const logTrendMap = new Map(logTrendRows.map((r) => [new Date(r.gun).toISOString().slice(0, 10), r]));

        const trends = gunler.map((g) => {
            const kr = kayitTrendMap.get(g) || {};
            const lr = logTrendMap.get(g) || {};
            return {
                gun: g,
                ariza: Number(kr.ariza || 0),
                servis: Number(kr.servis || 0),
                kayit_toplam: Number(kr.toplam || 0),
                islem_toplam: Number(lr.toplam || 0)
            };
        });

        res.json({
            kpis: {
                aktifArac,
                bakimdakiArac,
                arizaliArac,
                pasifArac,
                kritikStokKalem,
                bugunKayit: Number(bugunKayitRows[0]?.sayi || 0),
                son24Islem: Number(son24Rows[0]?.sayi || 0)
            },
            alerts: {
                muayeneYaklasan,
                arizaliAktif,
                kritikStoklar,
                istasyonsuzAraclar,
                adrssizIstasyonlar
            },
            stationSummary: [...istasyonMap.values()].sort((a, b) => a.istasyon_adi.localeCompare(b.istasyon_adi, 'tr')),
            recentLogs: sonLoglar,
            trends
        });
    } catch (error) {
        res.status(500).json({ mesaj: 'Dashboard verisi alınamadı.' });
    }
};

// ARAÇ LİSTESİ
exports.getAraclar = async (req, res) => {
    try {
        await ensureAracTable();
        const [araclar] = await db.query('SELECT * FROM tbl_araclar ORDER BY plaka ASC');
        res.json(araclar);
    } catch (error) { res.status(500).json({ mesaj: "Hata" }); }
};

// İSTASYON LİSTESİ
exports.getIstasyonlar = async (req, res) => {
    try {
        await ensureIstasyonTable();
        const [istasyonlar] = await db.query('SELECT * FROM tbl_istasyonlar ORDER BY istasyon_adi ASC');
        res.json(istasyonlar);
    } catch (error) { res.status(500).json({ mesaj: "Hata" }); }
};

// İSTASYON EKLE
exports.addIstasyon = async (req, res) => {
    try {
        await ensureIstasyonTable();
        const istasyonAdi = (req.body.istasyon_adi || '').toString().trim().toLocaleUpperCase('tr');
        const istasyonAdresi = (req.body.istasyon_adresi || '').toString().trim() || null;
        if (!istasyonAdi) return res.status(400).json({ mesaj: 'İstasyon adı boş olamaz.' });

        const [result] = await db.query(
            'INSERT INTO tbl_istasyonlar (istasyon_adi, istasyon_adresi) VALUES (?, ?)',
            [istasyonAdi, istasyonAdresi]
        );
        await logIslem({
            islem_tipi: 'ISTASYON_EKLEME',
            hedef_tablo: 'tbl_istasyonlar',
            hedef_id: Number(result?.insertId || 0) || null,
            actor: getActorFromReq(req),
            aciklama: `Istasyon eklendi: ${istasyonAdi}${istasyonAdresi ? ` | adres=${istasyonAdresi}` : ''}`
        });
        res.json({ mesaj: 'İstasyon eklendi' });
    } catch (error) {
        res.status(500).json({ mesaj: 'İstasyon eklenemedi.' });
    }
};

// İSTASYON GÜNCELLE
exports.updateIstasyon = async (req, res) => {
    try {
        await ensureIstasyonTable();
        const { id } = req.params;
        const yeniAd = (req.body.istasyon_adi || '').toString().trim().toLocaleUpperCase('tr');
        const yeniAdres = (req.body.istasyon_adresi || '').toString().trim() || null;
        if (!yeniAd) return res.status(400).json({ mesaj: 'İstasyon adı boş olamaz.' });

        const [rows] = await db.query('SELECT istasyon_adi, istasyon_adresi FROM tbl_istasyonlar WHERE id = ?', [id]);
        if (!rows.length) return res.status(404).json({ mesaj: 'İstasyon bulunamadı.' });

        const eskiAd = rows[0].istasyon_adi;
        const eskiAdres = rows[0].istasyon_adresi || null;

        await db.query('UPDATE tbl_istasyonlar SET istasyon_adi = ?, istasyon_adresi = ? WHERE id = ?', [yeniAd, yeniAdres, id]);
        await db.query('UPDATE tbl_araclar SET istasyon_adi = ? WHERE istasyon_adi = ?', [yeniAd, eskiAd]);

        await logIslem({
            islem_tipi: 'ISTASYON_GUNCELLEME',
            hedef_tablo: 'tbl_istasyonlar',
            hedef_id: Number(id),
            actor: getActorFromReq(req),
            aciklama: `Istasyon guncellendi: ${eskiAd} -> ${yeniAd}${eskiAdres || yeniAdres ? ` | adres=${eskiAdres || '-'} -> ${yeniAdres || '-'}` : ''}`
        });

        res.json({ mesaj: 'İstasyon güncellendi' });
    } catch (error) {
        res.status(500).json({ mesaj: 'İstasyon güncellenemedi.' });
    }
};

// İSTASYON SİL
exports.deleteIstasyon = async (req, res) => {
    try {
        await ensureIstasyonTable();
        const { id } = req.params;
        const [rows] = await db.query('SELECT istasyon_adi FROM tbl_istasyonlar WHERE id = ?', [id]);
        if (!rows.length) return res.status(404).json({ mesaj: 'İstasyon bulunamadı.' });

        const istasyonAdi = rows[0].istasyon_adi;
        await db.query('DELETE FROM tbl_istasyonlar WHERE id = ?', [id]);

        // Silinen istasyona bağlı araçları boşa düşür: arayüzde otomatik "Belirtilmedi" görünür.
        await db.query('UPDATE tbl_araclar SET istasyon_adi = NULL WHERE istasyon_adi = ?', [istasyonAdi]);

        await logIslem({
            islem_tipi: 'ISTASYON_SILME',
            hedef_tablo: 'tbl_istasyonlar',
            hedef_id: Number(id),
            actor: getActorFromReq(req),
            aciklama: `Istasyon silindi: ${istasyonAdi}`
        });

        res.json({ mesaj: 'İstasyon silindi' });
    } catch (error) {
        res.status(500).json({ mesaj: 'İstasyon silinemedi.' });
    }
};

// ARAÇ KAYDET (EKLE & DÜZENLE)
exports.saveArac = async (req, res) => {
    try {
        await ensureAracTable();
        const { id, plaka, istasyon_adi, model_yili, kilometre, durum, muayene_tarihi, arac_tipi } = req.body;
        const plakaBuyuk = (plaka || '').toString().trim().toUpperCase();
        const istasyonAdi = (istasyon_adi || '').toString().trim().toLocaleUpperCase('tr');
        const kmDegeri = kilometre === null || kilometre === undefined || kilometre === '' ? null : Number(kilometre);
        const durumMetni = serializeAracDurumlari(durum) || 'Aktif';

        if (!plakaBuyuk || !arac_tipi || !model_yili || !muayene_tarihi) {
            return res.status(400).json({ mesaj: 'Zorunlu alanlar eksik.' });
        }

        if (id) {
            // GÜNCELLEME
            await db.query(
                'UPDATE tbl_araclar SET plaka=?, istasyon_adi=?, model_yili=?, kilometre=?, durum=?, muayene_tarihi=?, arac_tipi=? WHERE id=?',
                [plakaBuyuk, istasyonAdi || null, Number(model_yili), kmDegeri, durumMetni, muayene_tarihi, arac_tipi, id]
            );
            await logIslem({
                islem_tipi: 'ARAC_GUNCELLEME',
                hedef_tablo: 'tbl_araclar',
                hedef_id: Number(id),
                actor: getActorFromReq(req),
                aciklama: `Arac guncellendi: plaka=${plakaBuyuk}, durum=${durumMetni}, istasyon=${istasyonAdi || '-'}`
            });
            res.json({ mesaj: "Güncellendi" });
        } else {
            // YENİ KAYIT
            const [check] = await db.query('SELECT * FROM tbl_araclar WHERE plaka = ?', [plakaBuyuk]);
            if (check.length > 0) return res.status(400).json({ mesaj: "Bu plaka zaten kayıtlı!" });

            const [result] = await db.query(
                'INSERT INTO tbl_araclar (plaka, istasyon_adi, model_yili, kilometre, durum, muayene_tarihi, arac_tipi) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [plakaBuyuk, istasyonAdi || null, Number(model_yili), kmDegeri, 'Aktif', muayene_tarihi, arac_tipi]
            );
            await logIslem({
                islem_tipi: 'ARAC_EKLEME',
                hedef_tablo: 'tbl_araclar',
                hedef_id: Number(result?.insertId || 0) || null,
                actor: getActorFromReq(req),
                aciklama: `Arac eklendi: plaka=${plakaBuyuk}, tip=${arac_tipi}`
            });
            res.json({ mesaj: "Kaydedildi" });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ mesaj: "Hata" });
    }
};

// ARAÇ SİL
exports.deleteArac = async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query('SELECT plaka FROM tbl_araclar WHERE id = ? LIMIT 1', [id]);
        await db.query('DELETE FROM tbl_araclar WHERE id = ?', [id]);
        await logIslem({
            islem_tipi: 'ARAC_SILME',
            hedef_tablo: 'tbl_araclar',
            hedef_id: Number(id),
            actor: getActorFromReq(req),
            aciklama: `Arac silindi: ${rows[0]?.plaka || '-'} (id=${id})`
        });
        res.json({ mesaj: "Silindi" });
    } catch (error) { res.status(500).json({ mesaj: "Hata" }); }
};

// ARAÇ GÜNCELLE (Hızlı tablo üzerinden güncelleme için - Eski fonksiyonun adını koruduk)
exports.updateArac = async (req, res) => {
    try {
        await ensureAracTable();
        const { id, kilometre, durum, istasyon_adi } = req.body;
        const istasyonAdi = (istasyon_adi || '').toString().trim().toLocaleUpperCase('tr');
        const durumMetni = serializeAracDurumlari(durum);
        await db.query('UPDATE tbl_araclar SET kilometre = ?, durum = ?, istasyon_adi = ? WHERE id = ?', [kilometre, durumMetni || null, istasyonAdi || null, id]);
        await logIslem({
            islem_tipi: 'ARAC_HIZLI_GUNCELLEME',
            hedef_tablo: 'tbl_araclar',
            hedef_id: Number(id),
            actor: getActorFromReq(req),
            aciklama: `Hizli guncelleme: durum=${durumMetni || '-'}, km=${kilometre || 0}, istasyon=${istasyonAdi || '-'}`
        });
        res.json({ mesaj: "Başarılı" });
    } catch (error) { res.status(500).json({ mesaj: "Hata" }); }
};

// ARAÇ KAYIT GEÇMİŞİ LİSTELE
exports.getAracKayitlari = async (req, res) => {
    try {
        await ensureAracKayitTable();
        const { aracId } = req.params;
        await backfillLegacyAracKayitlari(Number(aracId));
        const [rows] = await db.query(
            'SELECT id, arac_id, kayit_tipi, kayit_tarihi, aciklama, personel_ids_json, personel_adlari, giren_ad_soyad, giren_tc_no, created_at FROM tbl_arac_kayitlari WHERE arac_id = ? ORDER BY kayit_tarihi DESC, id DESC',
            [aracId]
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ mesaj: 'Araç kayıt geçmişi alınamadı.' });
    }
};

// ARAÇ KAYIT GEÇMİŞİ EKLE
exports.addAracKaydi = async (req, res) => {
    try {
        await ensureAracKayitTable();
        await ensurePersonelTable();
        const { arac_id, kayit_tipi, kayit_tarihi, aciklama, selected_personel_ids, selected_personel_adlari, actor, giren_ad_soyad, giren_tc_no } = req.body;

        const aracId = Number(arac_id);
        const tip = (kayit_tipi || '').toString().trim().toLocaleLowerCase('tr');
        const tarih = normalizeDateTimeInput(kayit_tarihi);
        const aciklamaText = (aciklama || '').toString().trim();

        if (!aracId || !['ariza', 'kaza', 'servis'].includes(tip) || !tarih || !aciklamaText) {
            return res.status(400).json({ mesaj: 'Zorunlu alanlar eksik veya geçersiz.' });
        }

        const [aracRows] = await db.query('SELECT id, plaka FROM tbl_araclar WHERE id = ? LIMIT 1', [aracId]);
        if (!aracRows.length) {
            return res.status(404).json({ mesaj: 'Araç bulunamadı.' });
        }
        const aracPlaka = (aracRows[0]?.plaka || '').toString().trim() || `ID ${aracId}`;

        const personelIdList = Array.isArray(selected_personel_ids)
            ? [...new Set(selected_personel_ids.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0))]
            : [];
        let personelAdlari = '';
        if (personelIdList.length) {
            const [prsRows] = await db.query(
                `SELECT id, ad_soyad
                 FROM tbl_personeller
                 WHERE id IN (${personelIdList.map(() => '?').join(',')})
                 ORDER BY ad_soyad ASC`,
                personelIdList
            );
            const validIds = prsRows.map((p) => Number(p.id));
            personelAdlari = prsRows.map((p) => p.ad_soyad).join(', ');
            personelIdList.length = 0;
            validIds.forEach((id) => personelIdList.push(id));
        }
        if (!personelAdlari && selected_personel_adlari) {
            personelAdlari = String(selected_personel_adlari)
                .split(/\n+|\s*,\s*/)
                .map((x) => x.trim())
                .filter(Boolean)
                .join('\n');
        }

        const actorInfo = getActorFromReq(req);
        const girenAdSoyad = actor?.ad_soyad || actorInfo.ad_soyad || (giren_ad_soyad || '').toString().trim() || null;
        const girenTcNo = actor?.tc_no || actorInfo.tc_no || (giren_tc_no || '').toString().trim() || null;

        await db.query(
            'INSERT INTO tbl_arac_kayitlari (arac_id, kayit_tipi, kayit_tarihi, aciklama, personel_ids_json, personel_adlari, giren_ad_soyad, giren_tc_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                aracId,
                tip,
                tarih,
                aciklamaText,
                personelIdList.length ? JSON.stringify(personelIdList) : null,
                personelAdlari || null,
                girenAdSoyad,
                girenTcNo
            ]
        );

        await logIslem({
            islem_tipi: 'ARAC_KAYDI_EKLEME',
            hedef_tablo: 'tbl_arac_kayitlari',
            hedef_id: null,
            actor: actorInfo,
            aciklama: `Arac kaydi eklendi: plaka=${aracPlaka}, tip=${tip}, tarih=${tarih}`
        });

        res.json({ mesaj: 'Araç kaydı eklendi.' });
    } catch (error) {
        res.status(500).json({ mesaj: 'Araç kaydı eklenemedi.' });
    }
};

// PERSONEL LİSTESİ
exports.getPersoneller = async (req, res) => {
    try {
        await ensurePersonelTable();
        const [rows] = await db.query('SELECT * FROM tbl_personeller ORDER BY ad_soyad ASC');
        const personeller = rows.map((p) => {
            let perm = DEFAULT_PERM;
            try {
                perm = p.perm_json ? normalizePerm(JSON.parse(p.perm_json)) : DEFAULT_PERM;
            } catch (e) {
                perm = DEFAULT_PERM;
            }
            return {
                id: p.id,
                ad_soyad: p.ad_soyad,
                tc_no: p.tc_no,
                gorev: p.gorev || null,
                istasyon_adi: p.istasyon_adi,
                onay_durumu: p.onay_durumu !== undefined ? !!p.onay_durumu : true,
                kayit_durumu: p.kayit_durumu || ((p.onay_durumu !== undefined ? !!p.onay_durumu : true) ? 'onayli' : 'beklemede'),
                sifre_var: !!p.sifre_hash,
                sifre_degistirmeli: !!p.sifre_degistirmeli,
                perm
            };
        });
        res.json(personeller);
    } catch (error) {
        res.status(500).json({ mesaj: 'Personel listesi alınamadı.' });
    }
};

// PERSONEL KAYDET (EKLE/GÜNCELLE)
exports.savePersonel = async (req, res) => {
    try {
        await ensurePersonelTable();
        const { id, ad_soyad, tc_no, istasyon_adi, gorev } = req.body;
        const adSoyad = (ad_soyad || '').toString().trim().toLocaleUpperCase('tr');
        const tcNo = (tc_no || '').toString().trim() || null;
        const istasyonAdi = (istasyon_adi || '').toString().trim().toLocaleUpperCase('tr');
        const gorevVal = (gorev || '').toString().trim() || null;

        if (!adSoyad) {
            return res.status(400).json({ mesaj: 'Ad soyad zorunludur.' });
        }

        if (id) {
            if (tcNo) {
                const [dup] = await db.query('SELECT id FROM tbl_personeller WHERE tc_no = ? AND id <> ?', [tcNo, id]);
                if (dup.length) return res.status(400).json({ mesaj: 'Bu TC no başka personelde kayıtlı.' });
            }

            await db.query(
                'UPDATE tbl_personeller SET ad_soyad = ?, tc_no = ?, gorev = ?, istasyon_adi = ? WHERE id = ?',
                [adSoyad, tcNo, gorevVal, istasyonAdi || null, id]
            );
            await logIslem({
                islem_tipi: 'PERSONEL_GUNCELLEME',
                hedef_tablo: 'tbl_personeller',
                hedef_id: Number(id),
                actor: getActorFromReq(req),
                aciklama: `Personel guncellendi: ${adSoyad}${tcNo ? ' (' + tcNo + ')' : ''}${gorevVal ? ' [' + gorevVal + ']' : ''}`
            });
            return res.json({ mesaj: 'Personel güncellendi.' });
        }

        if (tcNo) {
            const [exists] = await db.query('SELECT id FROM tbl_personeller WHERE tc_no = ?', [tcNo]);
            if (exists.length) return res.status(400).json({ mesaj: 'Bu TC no zaten kayıtlı.' });
        }

        const [result] = await db.query(
            'INSERT INTO tbl_personeller (ad_soyad, tc_no, gorev, istasyon_adi, perm_json) VALUES (?, ?, ?, ?, ?)',
            [adSoyad, tcNo, gorevVal, istasyonAdi || null, JSON.stringify(DEFAULT_PERM)]
        );
        await logIslem({
            islem_tipi: 'PERSONEL_EKLEME',
            hedef_tablo: 'tbl_personeller',
            hedef_id: Number(result?.insertId || 0) || null,
            actor: getActorFromReq(req),
            aciklama: `Personel eklendi: ${adSoyad}${tcNo ? ' (' + tcNo + ')' : ''}${gorevVal ? ' [' + gorevVal + ']' : ''}`
        });
        res.json({ mesaj: 'Personel eklendi.' });
    } catch (error) {
        res.status(500).json({ mesaj: 'Personel kaydedilemedi.' });
    }
};

// PERSONEL YETKİ GÜNCELLE
exports.updatePersonelPerm = async (req, res) => {
    try {
        await ensurePersonelTable();
        const { id } = req.params;
        const perm = normalizePerm(req.body.perm || {});
        const actor = getActorFromReq(req);

        const [actorRows] = await db.query('SELECT perm_json FROM tbl_personeller WHERE tc_no = ? LIMIT 1', [actor.tc_no || '']);
        let actorTier = 'personel';
        try {
            const actorPerm = actorRows[0]?.perm_json ? JSON.parse(actorRows[0].perm_json) : DEFAULT_PERM;
            actorTier = (actorPerm.yonetimSeviyesi || 'personel').toString().toLowerCase();
        } catch (e) {
            actorTier = 'personel';
        }

        if (!['root', 'mudur'].includes(actorTier)) {
            return res.status(403).json({ mesaj: 'Bu işlem için yetkiniz yok.' });
        }

        if (actorTier === 'mudur' && ['mudur', 'root'].includes(perm.yonetimSeviyesi)) {
            return res.status(403).json({ mesaj: 'Müdür seviyesi, Müdür veya Root atayamaz.' });
        }

        const [rows] = await db.query('SELECT id FROM tbl_personeller WHERE id = ?', [id]);
        if (!rows.length) return res.status(404).json({ mesaj: 'Personel bulunamadı.' });

        await db.query('UPDATE tbl_personeller SET perm_json = ? WHERE id = ?', [JSON.stringify(perm), id]);
        await logIslem({
            islem_tipi: 'PERSONEL_YETKI_GUNCELLEME',
            hedef_tablo: 'tbl_personeller',
            hedef_id: Number(id),
            actor,
            aciklama: `Personel yetkisi guncellendi: id=${id}, seviye=${perm.yonetimSeviyesi}`
        });
        res.json({ mesaj: 'Personel yetkileri güncellendi.' });
    } catch (error) {
        res.status(500).json({ mesaj: 'Personel yetkileri güncellenemedi.' });
    }
};

// PERSONEL SİL
exports.deletePersonel = async (req, res) => {
    try {
        await ensurePersonelTable();
        const { id } = req.params;
        const [rows] = await db.query('SELECT ad_soyad, tc_no FROM tbl_personeller WHERE id = ? LIMIT 1', [id]);
        await db.query('DELETE FROM tbl_personeller WHERE id = ?', [id]);
        await logIslem({
            islem_tipi: 'PERSONEL_SILME',
            hedef_tablo: 'tbl_personeller',
            hedef_id: Number(id),
            actor: getActorFromReq(req),
            aciklama: `Personel silindi: ${rows[0]?.ad_soyad || '-'} (${rows[0]?.tc_no || '-'})`
        });
        res.json({ mesaj: 'Personel silindi.' });
    } catch (error) {
        res.status(500).json({ mesaj: 'Personel silinemedi.' });
    }
};

// ARAÇ KAYIT GEÇMİŞİ GÜNCELLE
exports.updateAracKaydi = async (req, res) => {
    try {
        await ensureAracKayitTable();
        const { id } = req.params;
        const { kayit_tipi, kayit_tarihi, aciklama, actor } = req.body;

        if (!isRootOrMudur(actor)) {
            await logIslem({
                islem_tipi: 'YETKISIZ_ARAC_KAYDI_GUNCELLEME_DENEMESI',
                hedef_tablo: 'tbl_arac_kayitlari',
                hedef_id: Number(id),
                actor,
                aciklama: 'Yetkisiz kullanici guncelleme denemesi.'
            });
            return res.status(403).json({ mesaj: 'Bu işlem için yetkiniz yoktur.' });
        }

        const tip = (kayit_tipi || '').toString().trim().toLocaleLowerCase('tr');
        const tarih = normalizeDateTimeInput(kayit_tarihi);
        const aciklamaText = (aciklama || '').toString().trim();

        if (!['ariza', 'kaza', 'servis'].includes(tip) || !tarih || !aciklamaText) {
            return res.status(400).json({ mesaj: 'Zorunlu alanlar eksik veya geçersiz.' });
        }

        const [rows] = await db.query(
            `SELECT k.id, k.arac_id, a.plaka
             FROM tbl_arac_kayitlari k
             LEFT JOIN tbl_araclar a ON a.id = k.arac_id
             WHERE k.id = ?
             LIMIT 1`,
            [id]
        );
        if (!rows.length) return res.status(404).json({ mesaj: 'Kayıt bulunamadı.' });
        const kayitPlaka = (rows[0]?.plaka || '').toString().trim() || `ID ${rows[0]?.arac_id || '-'}`;

        await db.query(
            'UPDATE tbl_arac_kayitlari SET kayit_tipi = ?, kayit_tarihi = ?, aciklama = ? WHERE id = ?',
            [tip, tarih, aciklamaText, id]
        );

        await logIslem({
            islem_tipi: 'ARAC_KAYDI_GUNCELLEME',
            hedef_tablo: 'tbl_arac_kayitlari',
            hedef_id: Number(id),
            actor: actor && Object.keys(actor).length ? actor : getActorFromReq(req),
            aciklama: `Kayit guncellendi: plaka=${kayitPlaka}, tip=${tip}, tarih=${tarih}`
        });

        res.json({ mesaj: 'Araç kaydı güncellendi.' });
    } catch (error) {
        res.status(500).json({ mesaj: 'Araç kaydı güncellenemedi.' });
    }
};

// ARAÇ KAYIT GEÇMİŞİ SİL
exports.deleteAracKaydi = async (req, res) => {
    try {
        await ensureAracKayitTable();
        const { id } = req.params;
        const actor = req.body?.actor || {};

        if (!isRootOrMudur(actor)) {
            await logIslem({
                islem_tipi: 'YETKISIZ_ARAC_KAYDI_SILME_DENEMESI',
                hedef_tablo: 'tbl_arac_kayitlari',
                hedef_id: Number(id),
                actor,
                aciklama: 'Yetkisiz kullanici silme denemesi.'
            });
            return res.status(403).json({ mesaj: 'Bu işlem için yetkiniz yoktur.' });
        }

        const [rows] = await db.query(
            `SELECT k.id, k.arac_id, k.aciklama, a.plaka
             FROM tbl_arac_kayitlari k
             LEFT JOIN tbl_araclar a ON a.id = k.arac_id
             WHERE k.id = ?
             LIMIT 1`,
            [id]
        );
        if (!rows.length) return res.status(404).json({ mesaj: 'Kayıt bulunamadı.' });

        const silinenKayit = rows[0] || {};
        const silinenAciklama = (silinenKayit.aciklama || '').toString().trim();
        const silinenPlaka = (silinenKayit.plaka || '').toString().trim() || `ID ${silinenKayit.arac_id || '-'}`;

        await db.query('DELETE FROM tbl_arac_kayitlari WHERE id = ?', [id]);

        await logIslem({
            islem_tipi: 'ARAC_KAYDI_SILME',
            hedef_tablo: 'tbl_arac_kayitlari',
            hedef_id: Number(id),
            actor: actor && Object.keys(actor).length ? actor : getActorFromReq(req),
            aciklama: silinenAciklama ? `Kayit silindi. Plaka=${silinenPlaka}. Silinen aciklama: ${silinenAciklama}` : `Kayit silindi. Plaka=${silinenPlaka}. Silinen kayitta aciklama yoktu.`
        });

        res.json({ mesaj: 'Araç kaydı silindi.' });
    } catch (error) {
        res.status(500).json({ mesaj: 'Araç kaydı silinemedi.' });
    }
};

// İŞLEM LOGLARI LİSTESİ
exports.getIslemLoglari = async (req, res) => {
    try {
        await ensureIslemLogTable();

        const {
            startDate,
            endDate,
            actor,
            islem_tipi,
            actor_seviye,
            limit,
            page,
            pageSize
        } = req.query;

        const where = [];
        const params = [];

        if (startDate) {
            where.push('DATE(created_at) >= ?');
            params.push(startDate);
        }
        if (endDate) {
            where.push('DATE(created_at) <= ?');
            params.push(endDate);
        }
        if (actor) {
            where.push('(actor_ad_soyad LIKE ? OR actor_tc_no LIKE ?)');
            params.push(`%${actor}%`, `%${actor}%`);
        }
        if (islem_tipi) {
            where.push('islem_tipi = ?');
            params.push(islem_tipi);
        }
        if (actor_seviye) {
            where.push('actor_seviye = ?');
            params.push(actor_seviye.toString().toLowerCase());
        }

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const legacyLimit = Math.min(Math.max(Number(limit) || 0, 0), 1000);
        const safePageSize = Math.min(Math.max(Number(pageSize) || legacyLimit || 50, 1), 200);
        const safePage = Math.max(Number(page) || 1, 1);
        const offset = (safePage - 1) * safePageSize;

        const [countRows] = await db.query(
            `SELECT COUNT(*) AS total
             FROM tbl_islem_loglari
             ${whereSql}`,
            params
        );
        const total = Number(countRows[0]?.total || 0);
        const totalPages = Math.max(Math.ceil(total / safePageSize), 1);

        const [rows] = await db.query(
            `SELECT l.id,
                    l.islem_tipi,
                    l.hedef_tablo,
                    l.hedef_id,
                    l.actor_ad_soyad,
                    l.actor_tc_no,
                    l.actor_seviye,
                    l.aciklama,
                    l.created_at,
                    CASE
                        WHEN l.hedef_tablo = 'tbl_personeller' THEN p.ad_soyad
                        WHEN l.hedef_tablo = 'tbl_araclar' THEN a.plaka
                        WHEN l.hedef_tablo = 'tbl_istasyonlar' THEN i.istasyon_adi
                        ELSE NULL
                    END AS hedef_adi
             FROM tbl_islem_loglari l
             LEFT JOIN tbl_personeller p ON l.hedef_tablo = 'tbl_personeller' AND l.hedef_id = p.id
             LEFT JOIN tbl_araclar a ON l.hedef_tablo = 'tbl_araclar' AND l.hedef_id = a.id
             LEFT JOIN tbl_istasyonlar i ON l.hedef_tablo = 'tbl_istasyonlar' AND l.hedef_id = i.id
             ${whereSql.replaceAll('created_at', 'l.created_at').replaceAll('actor_ad_soyad', 'l.actor_ad_soyad').replaceAll('actor_tc_no', 'l.actor_tc_no').replaceAll('actor_seviye', 'l.actor_seviye').replaceAll('islem_tipi', 'l.islem_tipi')}
             ORDER BY l.id DESC
             LIMIT ${safePageSize} OFFSET ${offset}`,
            params
        );

        res.json({
            items: rows,
            pagination: {
                page: safePage,
                pageSize: safePageSize,
                total,
                totalPages
            }
        });
    } catch (error) {
        res.status(500).json({ mesaj: 'İşlem logları alınamadı.' });
    }
};