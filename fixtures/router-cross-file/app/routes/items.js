'use strict';

const express = require('express');
const itemsRouter = express.Router();

itemsRouter.get('/all', (req, res) => {
  res.json([]);
});

module.exports = { itemsRouter };
