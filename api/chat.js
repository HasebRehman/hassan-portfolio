// Vercel Serverless Function: /api/chat

const SYSTEM_PROMPT =
  "You are Sara, the AI assistant on Hassan's portfolio website. Hassan is a designer and developer. His services: Branding & Art Direction (logos, brand identity, guidelines), Social Media Management (content design, ad creatives, campaign visuals), UI Design (clean, modern websites & mobile apps), Website & App Development (WordPress, Shopify, custom web apps, mobile apps), and AI Chatbots. Greet visitors warmly and find out what they need. Keep replies short, concise and friendly, maximum 2-3 sentences. Reply in the same language the visitor uses (English, Urdu, or Roman Urdu). Never invent fixed prices, deadlines, or false promises. If asked about pricing or specifics you are unsure about, explain that Hassan will discuss it directly and invite them to leave their name, email or WhatsApp. Do not answer topics unrelated to Hassan's services.";

const MODELS_TO_TRY = [
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-2.5-flash-lite",
];

function sanitizeAndFormatContents(rawMessages) {
  // 1. Filter out empty texts and previous error fallback strings
  const cleaned = rawMessages
    .filter((m) => m && typeof m.text === "string" && m.text.trim().length > 0)
    .filter(
      (m) =>
        !m.text.includes("Sorry, something went wrong") &&
        !m.text.includes("unable to answer that right now") &&
        !m.text.includes("receiving a lot of messages")
    );

  // 2. Take last 10 messages
  const recent = cleaned.slice(-10);

  // 3. Normalize roles
  const normalized = recent.map((m) => ({
    role: m.role === "user" ? "user" : "model",
    text: m.text.trim(),
  }));

  // 4. Merge consecutive messages with identical role
  const merged = [];
  for (const item of normalized) {
    if (merged.length > 0 && merged[merged.length - 1].role === item.role) {
      merged[merged.length - 1].text += `\n${item.text}`;
    } else {
      merged.push({ ...item });
    }
  }

  // 5. Ensure starts with 'user'
  while (merged.length > 0 && merged[0].role === "model") {
    merged.shift();
  }

  // 6. Ensure ends with 'user'
  while (merged.length > 0 && merged[merged.length - 1].role === "model") {
    merged.pop();
  }

  if (merged.length === 0) {
    merged.push({ role: "user", text: "Hello" });
  }

  return merged.map((m) => ({
    role: m.role,
    parts: [{ text: m.text }],
  }));
}

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

  if (!apiKey) {
    console.error("[Vercel /api/chat Error] GEMINI_API_KEY is not defined in environment variables.");
    res.status(500).json({
      error: "API key is not configured.",
      reply: "Sorry, the AI service is currently unavailable. Please ensure GEMINI_API_KEY is configured in Vercel settings.",
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

    const formattedContents = sanitizeAndFormatContents(rawMessages);

    const preferredModel = process.env.GEMINI_MODEL;
    const modelQueue = [
      ...(preferredModel && !preferredModel.includes("1.5") ? [preferredModel] : []),
      ...MODELS_TO_TRY,
    ];
    // Deduplicate models
    const uniqueModels = Array.from(new Set(modelQueue));

    let lastError = null;
    let botReply = null;

    for (const model of uniqueModels) {
      try {
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

        console.log(`[Vercel /api/chat] Model ${model} -> Status: ${response.status} ${response.statusText}`);

        if (response.status === 429) {
          lastError = "429_RATE_LIMIT";
          // Try next fallback model
          continue;
        }

        if (!response.ok) {
          const errText = await response.text();
          console.error(`[Vercel /api/chat] Error with ${model}:`, errText);
          lastError = errText;
          continue;
        }

        const data = await response.json();
        const candidates = data?.candidates;

        if (candidates && candidates.length > 0) {
          const firstCandidate = candidates[0];
          const text = firstCandidate?.content?.parts?.[0]?.text?.trim();
          if (text) {
            botReply = text;
            break;
          }
        }
      } catch (callErr) {
        console.error(`[Vercel /api/chat] Exception with model ${model}:`, callErr);
        lastError = callErr;
      }
    }

    if (botReply) {
      res.status(200).json({ reply: botReply });
      return;
    }

    if (lastError === "429_RATE_LIMIT") {
      res.status(200).json({
        reply: "I'm receiving a lot of messages right now. Please wait a moment and send your message again!",
      });
      return;
    }

    res.status(200).json({
      reply: "Hi! I am Hassan's assistant. How can I help you with your graphic design or web development project today?",
    });
  } catch (error) {
    console.error("[Vercel /api/chat] Top-level Exception:", error);
    res.status(200).json({
      reply: "Hi! How can I assist you with your project today?",
    });
  }
};
