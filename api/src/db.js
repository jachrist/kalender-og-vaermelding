// Datalag for Hytteportal — Azure SQL (serverless) via mssql.
//
// mssql er en ren JS-driver (Tedious), så ingen native modul å kompilere.
// Tilkobling styres av miljøvariabler (se local.settings.json.example):
//   - SQL_CONNECTION_STRING  (valgfritt — hele tilkoblingsstrengen)
//   eller de diskrete:
//   - SQL_SERVER    (f.eks. hytteportal.database.windows.net)
//   - SQL_DATABASE  (f.eks. hytteportal)
//   - SQL_USER, SQL_PASSWORD
//
// Skjema opprettes/migreres idempotent ved første tilkobling, og de fire
// hyttene + admin (fra ADMIN_EMAIL) seedes. Se docs/arkitektur.md.

const sql = require("mssql");
const { randomUUID } = require("node:crypto");

// De fire hyttene familien eier. Seedes ved første oppstart.
const CABINS = [
  { name: "Gartha rød", sort_order: 1 },
  { name: "Gartha hvit", sort_order: 2 },
  { name: "Gartha anneks", sort_order: 3 },
  { name: "Skeikampen", sort_order: 4 },
];

let poolPromise = null;

function buildConfig() {
  if (process.env.SQL_CONNECTION_STRING) {
    return process.env.SQL_CONNECTION_STRING;
  }
  const server = process.env.SQL_SERVER;
  if (!server) {
    throw new Error(
      "Mangler databasekonfig: sett SQL_CONNECTION_STRING eller SQL_SERVER/SQL_DATABASE/SQL_USER/SQL_PASSWORD."
    );
  }
  return {
    server,
    database: process.env.SQL_DATABASE || "hytteportal",
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    options: {
      encrypt: true,
      // Azure SQL bruker gyldig sertifikat; sett SQL_TRUST_CERT=true kun for
      // lokal SQL Server med selvsignert sertifikat.
      trustServerCertificate: process.env.SQL_TRUST_CERT === "true",
    },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    // Serverless Azure SQL kan «auto-pause» — gi den tid til å våkne.
    connectionTimeout: 60000,
    requestTimeout: 60000,
  };
}

// Lazy singleton: første kall oppretter poolen og kjører migrering + seeding.
// Ved feil nullstilles løftet slik at neste kall prøver på nytt.
async function getPool() {
  if (!poolPromise) {
    poolPromise = (async () => {
      const pool = new sql.ConnectionPool(buildConfig());
      await pool.connect();
      await migrate(pool);
      await seed(pool);
      return pool;
    })().catch((err) => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

// Binder parametere på en request. Aksepterer enten en array (posisjonelle
// '?'-plassholdere oversettes til @p0, @p1 …) eller et objekt (navngitte
// @-parametere brukes direkte). Returnerer den ferdige SQL-teksten.
function bind(request, text, params) {
  if (Array.isArray(params)) {
    let i = 0;
    return text.replace(/\?/g, () => {
      const name = `p${i}`;
      request.input(name, params[i]);
      i += 1;
      return `@${name}`;
    });
  }
  if (params && typeof params === "object") {
    for (const [key, value] of Object.entries(params)) request.input(key, value);
  }
  return text;
}

// SELECT som returnerer alle rader.
async function query(text, params) {
  const pool = await getPool();
  const request = pool.request();
  const result = await request.query(bind(request, text, params));
  return result.recordset || [];
}

// SELECT som returnerer første rad (eller undefined).
async function queryOne(text, params) {
  return (await query(text, params))[0];
}

// INSERT/UPDATE/DELETE. Returnerer antall berørte rader.
async function exec(text, params) {
  const pool = await getPool();
  const request = pool.request();
  const result = await request.query(bind(request, text, params));
  return result.rowsAffected[0] || 0;
}

// Kjører fn innenfor en serialiserbar transaksjon. fn får en query-funksjon
// med samme signatur som query() ovenfor, men bundet til transaksjonen.
// Brukes der lese-så-skrive må være atomisk (FCFS-booking, faste utgifter).
async function withTx(fn) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const txQuery = async (text, params) => {
      const request = new sql.Request(tx);
      const result = await request.query(bind(request, text, params));
      return result.recordset || [];
    };
    const result = await fn(txQuery);
    await tx.commit();
    return result;
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* rollback kan feile hvis transaksjonen allerede er avbrutt */
    }
    throw err;
  }
}

async function migrate(pool) {
  await pool.request().batch(`
    IF OBJECT_ID(N'dbo.members', N'U') IS NULL
    CREATE TABLE members (
      id         NVARCHAR(36)  NOT NULL PRIMARY KEY,
      email      NVARCHAR(320) NOT NULL UNIQUE,
      name       NVARCHAR(200) NOT NULL,
      role       NVARCHAR(20)  NOT NULL CONSTRAINT DF_members_role DEFAULT 'member',  -- 'admin' | 'member'
      created_at DATETIME2     NOT NULL CONSTRAINT DF_members_created DEFAULT SYSUTCDATETIME()
    );

    IF OBJECT_ID(N'dbo.otp_codes', N'U') IS NULL
    CREATE TABLE otp_codes (
      id         NVARCHAR(36)  NOT NULL PRIMARY KEY,
      email      NVARCHAR(320) NOT NULL,
      code_hash  NVARCHAR(64)  NOT NULL,
      expires_at DATETIME2     NOT NULL,
      created_at DATETIME2     NOT NULL CONSTRAINT DF_otp_created DEFAULT SYSUTCDATETIME()
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_otp_email' AND object_id = OBJECT_ID(N'dbo.otp_codes'))
    CREATE INDEX idx_otp_email ON otp_codes(email);

    IF OBJECT_ID(N'dbo.tokens', N'U') IS NULL
    CREATE TABLE tokens (
      token_hash NVARCHAR(64) NOT NULL PRIMARY KEY,
      member_id  NVARCHAR(36) NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      expires_at DATETIME2    NOT NULL,
      created_at DATETIME2    NOT NULL CONSTRAINT DF_tokens_created DEFAULT SYSUTCDATETIME()
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_tokens_member' AND object_id = OBJECT_ID(N'dbo.tokens'))
    CREATE INDEX idx_tokens_member ON tokens(member_id);

    IF OBJECT_ID(N'dbo.cabins', N'U') IS NULL
    CREATE TABLE cabins (
      id         NVARCHAR(36)  NOT NULL PRIMARY KEY,
      name       NVARCHAR(200) NOT NULL UNIQUE,
      sort_order INT           NOT NULL CONSTRAINT DF_cabins_sort DEFAULT 0,
      created_at DATETIME2     NOT NULL CONSTRAINT DF_cabins_created DEFAULT SYSUTCDATETIME()
    );

    -- Reservasjoner på døgnbasis. Inklusiv datointervall (start_date .. end_date,
    -- lagret som 'YYYY-MM-DD'-strenger). FCFS håndheves ved overlappsjekk i route-laget.
    IF OBJECT_ID(N'dbo.bookings', N'U') IS NULL
    CREATE TABLE bookings (
      id          NVARCHAR(36)  NOT NULL PRIMARY KEY,
      cabin_id    NVARCHAR(36)  NOT NULL REFERENCES cabins(id) ON DELETE CASCADE,
      member_id   NVARCHAR(36)  NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      member_name NVARCHAR(200) NOT NULL,
      start_date  NVARCHAR(10)  NOT NULL,
      end_date    NVARCHAR(10)  NOT NULL,
      note        NVARCHAR(1000) NULL,
      created_at  DATETIME2     NOT NULL CONSTRAINT DF_bookings_created DEFAULT SYSUTCDATETIME()
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_bookings_cabin' AND object_id = OBJECT_ID(N'dbo.bookings'))
    CREATE INDEX idx_bookings_cabin ON bookings(cabin_id, start_date, end_date);

    -- Handleliste. Eier kan redigere/slette; alle kan huke av 'bought'.
    IF OBJECT_ID(N'dbo.purchases', N'U') IS NULL
    CREATE TABLE purchases (
      id              NVARCHAR(36)  NOT NULL PRIMARY KEY,
      cabin_id        NVARCHAR(36)  NOT NULL REFERENCES cabins(id) ON DELETE CASCADE,
      title           NVARCHAR(300) NOT NULL,
      comment         NVARCHAR(1000) NULL,
      price           FLOAT         NULL,
      bought          BIT           NOT NULL CONSTRAINT DF_purchases_bought DEFAULT 0,
      bought_by_name  NVARCHAR(200) NULL,
      bought_at       DATETIME2     NULL,
      created_by      NVARCHAR(36)  NULL REFERENCES members(id) ON DELETE SET NULL,
      created_by_name NVARCHAR(200) NOT NULL,
      source          NVARCHAR(20)  NOT NULL CONSTRAINT DF_purchases_source DEFAULT 'manual',  -- 'manual' | 'recurring'
      created_at      DATETIME2     NOT NULL CONSTRAINT DF_purchases_created DEFAULT SYSUTCDATETIME()
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_purchases_cabin' AND object_id = OBJECT_ID(N'dbo.purchases'))
    CREATE INDEX idx_purchases_cabin ON purchases(cabin_id);

    -- Faste utgifter som automatisk materialiseres til handlelista hver måned.
    IF OBJECT_ID(N'dbo.recurring_expenses', N'U') IS NULL
    CREATE TABLE recurring_expenses (
      id               NVARCHAR(36)  NOT NULL PRIMARY KEY,
      cabin_id         NVARCHAR(36)  NOT NULL REFERENCES cabins(id) ON DELETE CASCADE,
      title            NVARCHAR(300) NOT NULL,
      comment          NVARCHAR(1000) NULL,
      price            FLOAT         NULL,
      day_of_month     INT           NOT NULL CONSTRAINT DF_recurring_day DEFAULT 1,   -- 1..28
      active           BIT           NOT NULL CONSTRAINT DF_recurring_active DEFAULT 1,
      last_generated   NVARCHAR(7)   NULL,                                             -- 'YYYY-MM'
      created_by       NVARCHAR(36)  NULL REFERENCES members(id) ON DELETE SET NULL,
      created_by_name  NVARCHAR(200) NOT NULL,
      created_at       DATETIME2     NOT NULL CONSTRAINT DF_recurring_created DEFAULT SYSUTCDATETIME()
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_recurring_cabin' AND object_id = OBJECT_ID(N'dbo.recurring_expenses'))
    CREATE INDEX idx_recurring_cabin ON recurring_expenses(cabin_id);

    -- Vedlikehold. Alle medlemmer kan redigere.
    IF OBJECT_ID(N'dbo.maintenance', N'U') IS NULL
    CREATE TABLE maintenance (
      id               NVARCHAR(36)  NOT NULL PRIMARY KEY,
      cabin_id         NVARCHAR(36)  NOT NULL REFERENCES cabins(id) ON DELETE CASCADE,
      title            NVARCHAR(300) NOT NULL,
      description      NVARCHAR(2000) NULL,
      status           NVARCHAR(20)  NOT NULL CONSTRAINT DF_maintenance_status DEFAULT 'open',  -- 'open' | 'in_progress' | 'done'
      due_date         NVARCHAR(10)  NULL,
      created_by       NVARCHAR(36)  NULL REFERENCES members(id) ON DELETE SET NULL,
      created_by_name  NVARCHAR(200) NOT NULL,
      updated_at       DATETIME2     NOT NULL CONSTRAINT DF_maintenance_updated DEFAULT SYSUTCDATETIME(),
      created_at       DATETIME2     NOT NULL CONSTRAINT DF_maintenance_created DEFAULT SYSUTCDATETIME()
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_maintenance_cabin' AND object_id = OBJECT_ID(N'dbo.maintenance'))
    CREATE INDEX idx_maintenance_cabin ON maintenance(cabin_id);

    -- Felles chat for alle medlemmer. Plain tekst, all historikk beholdes.
    IF OBJECT_ID(N'dbo.chat_messages', N'U') IS NULL
    CREATE TABLE chat_messages (
      id          NVARCHAR(36)  NOT NULL PRIMARY KEY,
      member_id   NVARCHAR(36)  NULL REFERENCES members(id) ON DELETE SET NULL,
      member_name NVARCHAR(200) NOT NULL,
      body        NVARCHAR(MAX) NOT NULL,
      created_at  DATETIME2     NOT NULL CONSTRAINT DF_chat_created DEFAULT SYSUTCDATETIME()
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_chat_created' AND object_id = OBJECT_ID(N'dbo.chat_messages'))
    CREATE INDEX idx_chat_created ON chat_messages(created_at);

    -- Hyttebok per hytte: markdown-innlegg med periode og hvem som var der.
    -- Bilder lagres i Blob Storage og refereres som URL i markdown-teksten (body).
    IF OBJECT_ID(N'dbo.logbook_entries', N'U') IS NULL
    CREATE TABLE logbook_entries (
      id              NVARCHAR(36)  NOT NULL PRIMARY KEY,
      cabin_id        NVARCHAR(36)  NOT NULL REFERENCES cabins(id) ON DELETE CASCADE,
      member_id       NVARCHAR(36)  NULL REFERENCES members(id) ON DELETE SET NULL,
      created_by_name NVARCHAR(200) NOT NULL,
      period_from     NVARCHAR(10)  NULL,   -- 'YYYY-MM-DD'
      period_to       NVARCHAR(10)  NULL,   -- 'YYYY-MM-DD'
      participants    NVARCHAR(MAX) NULL,   -- fritekst: hvem som var der
      body            NVARCHAR(MAX) NOT NULL, -- markdown
      created_at      DATETIME2     NOT NULL CONSTRAINT DF_logbook_created DEFAULT SYSUTCDATETIME(),
      updated_at      DATETIME2     NOT NULL CONSTRAINT DF_logbook_updated DEFAULT SYSUTCDATETIME()
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_logbook_cabin' AND object_id = OBJECT_ID(N'dbo.logbook_entries'))
    CREATE INDEX idx_logbook_cabin ON logbook_entries(cabin_id);
  `);
}

async function seed(pool) {
  // Hytter — idempotent på unikt navn.
  for (const c of CABINS) {
    const request = pool.request();
    request.input("id", randomUUID());
    request.input("name", c.name);
    request.input("sort_order", c.sort_order);
    await request.query(
      `IF NOT EXISTS (SELECT 1 FROM cabins WHERE name = @name)
         INSERT INTO cabins (id, name, sort_order) VALUES (@id, @name, @sort_order)`
    );
  }

  // Admin — fra env, med trygg fallback til eierens e-post.
  const adminEmail = (process.env.ADMIN_EMAIL || "jachrist2709@gmail.com").trim().toLowerCase();
  const adminName = (process.env.ADMIN_NAME || "Administrator").trim();
  const request = pool.request();
  request.input("id", randomUUID());
  request.input("email", adminEmail);
  request.input("name", adminName);
  await request.query(
    `IF NOT EXISTS (SELECT 1 FROM members WHERE email = @email)
       INSERT INTO members (id, email, name, role) VALUES (@id, @email, @name, 'admin')`
  );
}

module.exports = { getPool, query, queryOne, exec, withTx };
