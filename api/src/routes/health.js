const router = require("express").Router();
const { queryOne } = require("../db");

// GET /api/health — enkel helsesjekk som også verifiserer at databasen svarer.
router.get("/health", async (_req, res) => {
  try {
    await queryOne("SELECT 1 AS ok");
    res.json({ status: "ok", db: "ok" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

module.exports = router;
