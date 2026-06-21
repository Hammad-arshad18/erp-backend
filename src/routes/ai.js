const { db } = require("../utils/db");
const { asyncHandler, HttpError, oid, decryptSecret } = require("../utils/helpers");
const { authenticate } = require("../middlewares/auth");

module.exports = (api) => {
  api.post("/ai/suggest-category", authenticate, asyncHandler(async (req, res) => {
    const { name } = req.body;
    if (!name) throw new HttpError(400, "Product name is required");

    const sid = req.user.store_id;
    if (!sid) throw new HttpError(400, "No store assigned");
    
    const store = await db.collection("stores").findOne({ _id: oid(sid) });
    if (!store || !store.ai_api_key) {
      throw new HttpError(400, "AI not configured. Please add an API key in Settings.");
    }

    const provider = store.ai_provider || "openai";
    const apiKey = decryptSecret(store.ai_api_key);
    
    let category = "General";

    try {
      if (provider === "openai") {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: "gpt-3.5-turbo",
            messages: [
              { role: "system", content: "You are a helpful POS categorization assistant. Reply with ONLY a single short category name (max 2 words) that best fits the product. No extra text." },
              { role: "user", content: `Product: ${name}` }
            ],
            temperature: 0.3,
            max_tokens: 15
          })
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error.message);
        category = data.choices[0].message.content.trim();
      } else if (provider === "gemini") {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `You are a categorization assistant. Reply with ONLY a single short category name (max 2 words) for the product: ${name}. No extra text or quotes.` }] }]
          })
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error.message);
        category = data.candidates[0].content.parts[0].text.trim();
      } else if (provider === "anthropic") {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: "claude-3-haiku-20240307",
            max_tokens: 15,
            system: "Reply with ONLY a single short category name (max 2 words) for the product provided. No extra text.",
            messages: [{ role: "user", content: `Product: ${name}` }]
          })
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error.message);
        category = data.content[0].text.trim();
      } else if (provider === "groq") {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: "llama3-8b-8192",
            messages: [
              { role: "system", content: "Reply with ONLY a single short category name (max 2 words) for the product. No extra text." },
              { role: "user", content: `Product: ${name}` }
            ],
            temperature: 0.3,
            max_tokens: 15
          })
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error.message);
        category = data.choices[0].message.content.trim();
      }
    } catch (e) {
      console.error("AI Error:", e);
      throw new HttpError(500, `Failed to get suggestion from ${provider}. Error: ${e.message}`);
    }

    res.json({ category });
  }));
};
