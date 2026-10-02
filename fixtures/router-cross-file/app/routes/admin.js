'use strict';

const express = require('express');
const router = express.Router();

router.get('/metrics', (req, res) => {
  res.json({ count: 42 });
});

module.exports = router;
