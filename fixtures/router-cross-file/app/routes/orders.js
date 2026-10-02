'use strict';

const express = require('express');
const router = express.Router();

router.post('/checkout', (req, res) => {
  res.status(201).json({ id: 1 });
});

exports.ordersRouter = router;
