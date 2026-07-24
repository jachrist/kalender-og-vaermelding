const router = require("express").Router();
const { query } = require("../db");
const { json, withHandler } = require("../http");
const { requireAuth } = require("../auth");

// GET /api/cabins — list de fire hyttene (krever innlogging).
router.get(
  "/cabins",
  withHandler(async (req) => {
    await requireAuth(req);
    const rows = await query("SELECT id, name FROM cabins ORDER BY sort_order, name");
    return json(rows);
  })
);

module.exports = router;
