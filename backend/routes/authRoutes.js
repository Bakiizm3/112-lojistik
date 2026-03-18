const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/kayit-ol', authController.kayitOl);
router.post('/login', authController.login);
router.post('/onay-guncelle', authController.onayGuncelle);
router.post('/sifre-belirle', authController.sifreBelirle);
router.post('/sifre-degistir', authController.sifreDegistir);
router.post('/sifre-sifirla', authController.sifreSifirla);

module.exports = router;