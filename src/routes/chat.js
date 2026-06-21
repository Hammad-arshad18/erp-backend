const express = require("express");
const Ably = require("ably");
const crypto = require("crypto");
const { db } = require("../utils/db");
const { asyncHandler, isoNow, oid, docOut } = require("../utils/helpers");
const { authenticate } = require("../middlewares/auth");

const ably = new Ably.Rest(process.env.ABLY_API_KEY);

const ALGORITHM = "aes-256-gcm";
// Derive a 32-byte secure key from the existing JWT_SECRET
const ENCRYPTION_KEY = crypto.createHash('sha256').update(String(process.env.JWT_SECRET)).digest();

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `ENC:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(text) {
  if (!text || !text.startsWith('ENC:')) return text; 
  const parts = text.split(':');
  if (parts.length !== 4) return text;
  const [prefix, ivHex, authTagHex, encryptedHex] = parts;
  
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error("Decryption failed:", err);
    return "[Message Decryption Failed]";
  }
}

module.exports = (api) => {
  const router = express.Router();

  router.get("/auth", authenticate, asyncHandler(async (req, res) => {
    const tokenRequestData = await ably.auth.createTokenRequest({ clientId: req.user.id });
    res.json(tokenRequestData);
  }));

  router.post("/send", authenticate, asyncHandler(async (req, res) => {
    const { channel, message } = req.body;
    if (!channel || !message) {
      return res.status(400).json({ error: "Channel and message are required" });
    }

    const doc = {
      channel,
      sender_id: req.user.id,
      message: encrypt(message),
      created_at: isoNow()
    };

    const result = await db.collection("chat_messages").insertOne(doc);
    doc._id = result.insertedId;

    const channelObj = ably.channels.get(channel);
    await channelObj.publish("message", {
      sender_id: req.user.id,
      message, // Plain text over Ably (TLS), since they requested DB encryption
      created_at: doc.created_at
    });

    doc.message = message; // Restore plain text for the API response
    res.json(docOut(doc));
  }));

  router.get("/history/:channel", authenticate, asyncHandler(async (req, res) => {
    const { channel } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    
    const messages = await db.collection("chat_messages")
      .find({ channel })
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();
      
    // Decrypt messages for the frontend
    messages.forEach(msg => {
      msg.message = decrypt(msg.message);
    });
      
    res.json(messages.reverse().map(docOut));
  }));

  router.post("/read", authenticate, asyncHandler(async (req, res) => {
    const { channel } = req.body;
    if (!channel) return res.status(400).json({ error: "Channel is required" });
    
    const readAt = isoNow();
    await db.collection("chat_read_receipts").updateOne(
      { user_id: req.user.id, channel },
      { $set: { last_read_at: readAt } },
      { upsert: true }
    );

    const channelObj = ably.channels.get(channel);
    await channelObj.publish("read", { user_id: req.user.id, last_read_at: readAt });

    res.json({ ok: true });
  }));

  router.get("/read-receipts/:channel", authenticate, asyncHandler(async (req, res) => {
    const receipts = await db.collection("chat_read_receipts")
      .find({ channel: req.params.channel })
      .toArray();
    res.json(receipts);
  }));

  router.get("/unread", authenticate, asyncHandler(async (req, res) => {
    const receipts = await db.collection("chat_read_receipts").find({ user_id: req.user.id }).toArray();
    const readMap = {};
    receipts.forEach(r => readMap[r.channel] = r.last_read_at);

    const messages = await db.collection("chat_messages").find({
      $or: [
        { channel: "general" },
        { channel: { $regex: `direct:.*${req.user.id}.*` } }
      ],
      sender_id: { $ne: req.user.id }
    }).toArray();

    const counts = {};
    messages.forEach(msg => {
      const lastRead = readMap[msg.channel] || "1970-01-01T00:00:00.000Z";
      if (new Date(msg.created_at) > new Date(lastRead)) {
        counts[msg.channel] = (counts[msg.channel] || 0) + 1;
      }
    });

    res.json(counts);
  }));

  api.use("/chat", router);
};
