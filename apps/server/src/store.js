import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { seedState } from "./seed.js";
const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = process.env.DATA_FILE
  ? path.resolve(process.env.DATA_FILE)
  : path.join(__dirname, "..", "data.json");

const DATABASE_URL = process.env.DATABASE_URL || "";
const USE_POSTGRES = Boolean(DATABASE_URL);
const STORAGE_TABLE = "app_state_store";
const pool = USE_POSTGRES ? new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSL_DISABLE === "true" ? false : { rejectUnauthorized: false }
}) : null;

let pgUpdatedAt = null;
let writeQueue = Promise.resolve();

const normalizeState = (parsed) => ({
  ...seedState,
  ...(parsed || {}),
  accounts: (parsed || {}).accounts || [],
  suppliers: (parsed || {}).suppliers || [],
  purchases: (parsed || {}).purchases || []
});

const writeStateFile = (state) => {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), "utf8");
};

const readStateFile = () => {
  if (!fs.existsSync(DATA_FILE)) {
    writeStateFile(seedState);
    return structuredClone(seedState);
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return normalizeState(parsed);
  } catch {
    writeStateFile(seedState);
    return structuredClone(seedState);
  }
};

const ensurePgStore = async () => {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${STORAGE_TABLE} (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      state JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
};

const writeStatePg = async (state) => {
  if (!pool) return;
  await ensurePgStore();
  await pool.query(`
    INSERT INTO ${STORAGE_TABLE} (id, state, updated_at)
    VALUES (1, $1::jsonb, NOW())
    ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW();
  `, [JSON.stringify(state)]);
  pgUpdatedAt = new Date().toISOString();
};

const readStatePg = async () => {
  if (!pool) return null;
  await ensurePgStore();
  const result = await pool.query(`SELECT state, updated_at FROM ${STORAGE_TABLE} WHERE id = 1;`);
  if (result.rows.length) {
    pgUpdatedAt = result.rows[0].updated_at ? new Date(result.rows[0].updated_at).toISOString() : null;
    return normalizeState(result.rows[0].state || {});
  }
  const seed = readStateFile();
  await writeStatePg(seed);
  return seed;
};

let cachedState = USE_POSTGRES ? await readStatePg() : readStateFile();

const persistState = (state) => {
  if (!USE_POSTGRES) {
    writeStateFile(state);
    return;
  }
  writeQueue = writeQueue
    .then(() => writeStatePg(state))
    .catch((error) => {
      console.error("Postgres state write failed:", error?.message || error);
    });
};

export const getState = () => cachedState;

export const getStoreMeta = () => ({
  mode: USE_POSTGRES ? "postgres" : "file",
  dataFile: DATA_FILE,
  postgresTable: USE_POSTGRES ? STORAGE_TABLE : null,
  updatedAt: USE_POSTGRES
    ? pgUpdatedAt
    : (fs.existsSync(DATA_FILE) ? fs.statSync(DATA_FILE).mtime.toISOString() : null)
});

export const updateState = (updater) => {
  const next = updater(structuredClone(cachedState));
  cachedState = next;
  persistState(cachedState);
  return cachedState;
};

export const replaceState = (nextState) => {
  cachedState = normalizeState(nextState);
  persistState(cachedState);
  return cachedState;
};

const runMigrations = () => {
  if (!cachedState) return;
  const products = cachedState.products || [];
  const productMap = new Map(products.map((p) => [p.id, p]));
  let migrated = false;
  
  const migratedSales = (cachedState.sales || []).map((sale) => {
    let saleMigrated = false;
    const nextLines = (sale.lines || []).map((line) => {
      if (line.invoicePrice === undefined) {
        const prod = productMap.get(line.productId);
        const fallbackInvoice = prod ? Number(prod.invoicePrice || 0) : 0;
        saleMigrated = true;
        migrated = true;
        return {
          ...line,
          invoicePrice: fallbackInvoice
        };
      }
      return line;
    });
    if (saleMigrated) {
      return {
        ...sale,
        lines: nextLines
      };
    }
    return sale;
  });
  
  if (migrated) {
    cachedState.sales = migratedSales;
    persistState(cachedState);
    console.log("Migrated sales lines with missing invoicePrice and persisted state.");
  }
};

runMigrations();
