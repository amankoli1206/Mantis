'use strict';

const express = require('express');

const app = express();

app.use(express.json());

// GET /health — liveness probe, no params
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// GET /users — list all users
app.get('/users', (req, res) => {
  res.json([]);
});

// GET /users/:id — fetch a single user by id
app.get('/users/:id', (req, res) => {
  const { id } = req.params;
  res.json({ id });
});

// POST /users — create a new user; reads req.body.email
app.post('/users', (req, res) => {
  const email = req.body.email;
  res.status(201).json({ email });
});

// PUT /users/:id — update a user; reads req.body.email
app.put('/users/:id', (req, res) => {
  const { id } = req.params;
  const email = req.body.email;
  res.json({ id, email });
});

// DELETE /users/:id — permanently remove a user
app.delete('/users/:id', (req, res) => {
  res.status(204).send();
});

module.exports = app;
