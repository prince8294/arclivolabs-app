'use strict';

const { assertSafeStartup } = require('../dist/config.js');
const { app } = require('../dist/server.js');

assertSafeStartup();

module.exports = app;
