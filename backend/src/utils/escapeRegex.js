'use strict';

module.exports = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
