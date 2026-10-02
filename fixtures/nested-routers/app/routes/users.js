'use strict';

const express = require('express');

const router = express.Router();

// GET /api/users and POST /api/users — registered via router.route() chaining
router
  .route('/users')
  .get((req, res) => {
    res.json([]);
  })
  .post((req, res) => {
    const email = req.body.email;
    res.status(201).json({ email });
  });

// GET /api/users/:id — direct router.get() call
router.get('/users/:id', (req, res) => {
  const { id } = req.params;
  res.json({ id });
});

// Mount admin sub-router inside usersRouter
router.use('/admin', require('./admin'));

module.exports = router;
