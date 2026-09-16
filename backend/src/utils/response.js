'use strict';

function send(res, status, data, extra = {}) {
  return res.status(status).json({ success: true, ...extra, data });
}

const ok = (res, data, extra) => send(res, 200, data, extra);
const created = (res, data, extra) => send(res, 201, data, extra);

module.exports = { ok, created };
