'use strict';

const express = require('express');
const app = express();

const apiRouter = express.Router();
apiRouter.get('/users', (req, res) => {
  res.json([]);
});
apiRouter.post('/users', (req, res) => {
  res.status(201).json({});
});

const v1Router = express.Router();
v1Router.get('/items/:id', (req, res) => {
  res.json({});
});

// Mounted with prefix
app.use('/api', apiRouter);

// Mounted with root / trailing slash prefix
app.use('/', v1Router);

// Unmounted router (created and has route, but never mounted with app.use)
const orphanRouter = express.Router();
orphanRouter.get('/orphan', (req, res) => {
  res.send('orphan');
});

module.exports = app;
