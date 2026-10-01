'use strict';

const express = require('express');
const usersRouter = require('./routes/users');
const productsRouter = require('./routes/products');

const app = express();

app.use(express.json());

// Mount both routers under the /api prefix
app.use('/api', usersRouter);
app.use('/api', productsRouter);

module.exports = app;
