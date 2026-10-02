'use strict';

const express = require('express');
const usersRouter = require('./routes/users');
const { itemsRouter } = require('./routes/items');
const ordersMod = require('./routes/orders');
const reexportRouter = require('./routes/reexport');
const sharedRouter = require('./routes/shared');

const app = express();

app.use('/users', usersRouter);
app.use('/items', itemsRouter);
app.use('/orders', ordersMod.ordersRouter);
app.use('/admin', reexportRouter);
app.use('/v1', sharedRouter);
app.use('/v2', sharedRouter);

module.exports = app;
