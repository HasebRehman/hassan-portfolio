// Vercel Serverless Function: /api/chat

const SYSTEM_PROMPT =
  "You are Hassan's Assistant, the chatbot on Hassan's portfolio website. Hassan is a graphic designer and web developer. His services: logo design, brand identity, business cards, social media post design, banners, flyers, and other graphic design work; and also web design and development (WordPress, Shopify, Webflow, Next.js) and AI chatbot integration. Graphic design and logo design are his main services, so when a visitor asks about logos, branding, or any design work, answer as a graphic designer and never redirect them to web design. Greet visitors warmly and find out what they need. Ask only one question at a time (for logos: business name, industry, preferred style/colors, timeline). Keep replies short, maximum 3 sentences. Reply in the same language the visitor uses (English, Urdu, or Roman Urdu). Never invent prices, deadlines, or promises. If asked about pricing or anything you are unsure about, say Hassan will discuss it directly and ask for the visitor's name and email or WhatsApp. Do not answer topics unrelated to Hassan's services.";

module.exports = async function handler(req, res) {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  );

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Only POST is accepted." });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  console.log("[Vercel /api/chat] Environment Check:", {
    GEMINI_API_KEY_DEFINED: Boolean(apiKey),
    GEMINI_MODEL: model,
  });

  if (!apiKey) {
    console.error("[Vercel /api/chat Error] GEMINI_API_KEY environment variable is not configured in Vercel settings.");
    res.status(500).json({
      error: "API key is not configured on the server.",
      reply: "Sorry, the AI service is currently unavailable. Please ensure GEMINI_API_KEY is configured in Vercel environment variables.",
    });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const rawMessages = body.messages || [];

    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      res.status(400).json({
        error: "Invalid request payload. 'messages' array is required.",
        reply: "Invalid message format.",
      });
      return;
    }

    // Validate max message length
    for (const msg of rawMessages) {
      if (msg?.text && msg.text.length > 500) {
        res.status(400).json({
          error: "Message too long.",
          reply: "Your message is too long (maximum 500 characters). Please send a shorter message.",
        });
        return;
      }
    }

    // Keep only last 10 messages
    const recentMessages = rawMessages.slice(-10);
    let formattedContents = recentMessages.map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: (m.text || "").trim() }],
    }));

    // Ensure conversation starts with 'user'
    while (formattedContents.length > 0 && formattedContents[0].role === "model") {
      formattedContents.shift();
    }

    if (formattedContents.length === 0) {
      formattedContents = [{ role: "user", parts: [{ text: "Hello" }] }];
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const geminiPayload = {
      contents: formattedContents,
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        maxOutputTokens: 600,
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(geminiPayload),
    });

    console.log(`[Vercel /api/chat] Gemini Status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Vercel /api/chat] Gemini API Error Body:", errorText);
      res.status(502).json({
        error: "Failed to fetch response from Gemini API.",
        reply: "Sorry, something went wrong. Please try again.",
      });
      return;
    }

    const data = await response.json();
    const candidates = data?.candidates;

    if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
      console.warn("[Vercel /api/chat] No candidates returned:", JSON.stringify(data));
      res.status(200).json({
        reply: "I am unable to answer that right now. Please feel free to ask about Hassan's design or development services!",
      });
      return;
    }

    const firstCandidate = candidates[0];
    const finishReason = firstCandidate?.finishReason || "UNKNOWN";
    console.log(`[Vercel /api/chat] finishReason: ${finishReason}`);

    const botReply =
      firstCandidate?.content?.parts?.[0]?.text?.trim() ||
      "Hi! How can I assist you with your design or development project today?";

    res.status(200).json({ reply: botReply });
  } catch (error) {
    console.error("[Vercel /api/chat] Unhandled Exception:", error);
    res.status(500).json({
      error: "Internal server error.",
      reply: "Sorry, something went wrong. Please try again.",
    });
  }
};
