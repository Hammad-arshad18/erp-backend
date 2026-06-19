const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  require("dotenv").config({ path: envPath });
}

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const { client, connect } = require("./src/utils/db");
const { HttpError } = require("./src/utils/helpers");
const registerRoutes = require("./src/routes");
const { onStartup } = require("./src/utils/startup");

const app = express();
app.set("trust proxy", true);

// ---- CORS (mirrors CORSMiddleware config in server.py) ----
const frontendUrl = process.env.FRONTEND_URL || "*";
let origins = frontendUrl !== "*" ? [frontendUrl] : ["*"];
origins = origins.concat(["http://localhost:3000"]);
const allowAll = origins.includes("*");

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (allowAll || origins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  })
);

app.use(cookieParser());
app.use(
  express.json({
    limit: "25mb",
    verify: (req, res, buf) => {
      // Preserve raw body for the Stripe webhook handler.
      req.rawBody = buf;
    },
  })
);

// ---- API routes (prefix /api) ----
const api = express.Router();
registerRoutes(api);
app.use("/api", api);

// ---- 404 (mirror FastAPI default) ----
app.use((req, res) => {
  res.status(404).json({ detail: "Not Found" });
});

// ---- Error handler (maps HttpError -> {"detail": ...}) ----
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ detail: err.detail });
  }
  if (err && err.type === "entity.parse.failed") {
    return res.status(422).json({ detail: [{ type: "json_invalid", loc: ["body"], msg: "JSON decode error" }] });
  }
  console.error(err);
  return res.status(500).json({ detail: "Internal Server Error" });
});

const PORT = parseInt(process.env.PORT || "8001", 10);

async function main() {
  await connect();
  await onStartup();
  app.listen(PORT, () => {
    console.log(`Supermarket CRM backend listening on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

async function shutdown() {
  try {
    await client.close();
  } catch (e) {
    // pass
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
