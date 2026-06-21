const express = require("express");
const Ably = require("ably");
const { db } = require("../utils/db");
const { asyncHandler, isoNow, oid, docOut } = require("../utils/helpers");
const { authenticate } = require("../middlewares/auth");

const ably = new Ably.Rest(process.env.ABLY_API_KEY);

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
      message,
      created_at: isoNow()
    };

    const result = await db.collection("chat_messages").insertOne(doc);
    doc._id = result.insertedId;

    const channelObj = ably.channels.get(channel);
    await channelObj.publish("message", {
      sender_id: req.user.id,
      message,
      created_at: doc.created_at
    });

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
      
    res.json(messages.reverse().map(docOut));
  }));

  api.use("/chat", router);
};
