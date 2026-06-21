const { MongoClient } = require("mongodb");

const mongoUrl = process.env.MONGO_URL;
const client = new MongoClient(mongoUrl);

// Mirrors `db = client[os.environ['DB_NAME']]`
const db = client.db(process.env.DB_NAME);

async function connect() {
  await client.connect();
  return db;
}

module.exports = { client, db, connect };
