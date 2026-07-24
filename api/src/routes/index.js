// Samler alle ruter under /api. Monteres av server.js.
const router = require("express").Router();

router.use(require("./health"));
router.use(require("./auth"));
router.use(require("./cabins"));
router.use(require("./members"));
router.use(require("./bookings"));
router.use(require("./purchases"));
router.use(require("./recurring"));
router.use(require("./maintenance"));
router.use(require("./chat"));
router.use(require("./logbook"));
router.use(require("./uploads"));

// Ukjent API-endepunkt -> JSON 404 (så SPA-fallbacken aldri svarer på /api/*).
router.use((_req, res) => res.status(404).json({ error: "Ukjent endepunkt" }));

module.exports = router;
