const express = require('express');
const router = express.Router();
const lojistikController = require('../controllers/lojistikController');

// Mevcut rotalar
router.get('/ozet', lojistikController.getOzet);
router.get('/dashboard', lojistikController.getDashboardData);
router.get('/araclar', lojistikController.getAraclar);
router.get('/islem-loglari', lojistikController.getIslemLoglari);
router.get('/arac-kayitlari/:aracId', lojistikController.getAracKayitlari);
router.get('/istasyonlar', lojistikController.getIstasyonlar);
router.get('/personeller', lojistikController.getPersoneller);
router.post('/istasyon-ekle', lojistikController.addIstasyon);
router.post('/personel-kaydet', lojistikController.savePersonel);
router.put('/istasyon-guncelle/:id', lojistikController.updateIstasyon);
router.put('/personel-perm/:id', lojistikController.updatePersonelPerm);
router.delete('/istasyon-sil/:id', lojistikController.deleteIstasyon);
router.delete('/personel-sil/:id', lojistikController.deletePersonel);

// HATAYI ÇÖZEN KISIM (İsimlerin frontend ile aynı olması şart)
router.post('/arac-kaydet', lojistikController.saveArac); 
router.post('/arac-guncelle', lojistikController.updateArac);
router.post('/arac-kayit-ekle', lojistikController.addAracKaydi);
router.put('/arac-kayit-guncelle/:id', lojistikController.updateAracKaydi);
router.delete('/arac-kayit-sil/:id', lojistikController.deleteAracKaydi);
router.delete('/arac-sil/:id', lojistikController.deleteArac); // Bak buradaki 'arac-sil' frontend ile eşleşmeli

module.exports = router;