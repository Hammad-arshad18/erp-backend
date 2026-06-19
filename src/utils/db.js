const { MongoClient, ServerApiVersion } = require("mongodb");

const mongoUrl = process.env.MONGO_URL;
const dbName = process.env.DB_NAME;

if (!mongoUrl) {
  throw new Error(
    "MONGO_URL is not set. Configure it in your hosting provider's environment variables.",
  );
}
if (!dbName) {
  throw new Error(
    "DB_NAME is not set. Configure it in your hosting provider's environment variables.",
  );
}

function withDefaultParams(url) {
  if (url.includes("?")) return url;
  return `${url}?retryWrites=true&w=majority`;
}

// autoSelectFamily: false avoids ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR on cloud hosts
// (Render, Railway, etc.) when Node picks the wrong IP family for Atlas SRV records.
const client = new MongoClient(withDefaultParams(mongoUrl), {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  autoSelectFamily: false,
  serverSelectionTimeoutMS: 15000,
});

const db = client.db(dbName);

async function connect() {
  try {
    await client.connect();
    return db;
  } catch (err) {
    const code = err.cause?.code || err.code;
    if (code === "ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR") {
      const hint =
        "MongoDB Atlas TLS handshake failed. Allow your host's IP in Atlas " +
        "(Network Access → Add IP → 0.0.0.0/0 for cloud deploys) and verify MONGO_URL.";
      throw new Error(hint, { cause: err });
    }
    throw err;
  }
}

module.exports = { client, db, connect };
