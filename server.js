const http = require("http");
const fs = require("fs");
const path = require("path");

// Simple .env loader
function loadEnv() {
  const envFiles = [".env.local", ".env"];
  for (const file of envFiles) {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf8");
      content.split("\n").forEach((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim();
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      });
    }
  }
}

loadEnv();

const PORT = process.env.PORT || 3000;
const SYSTEM_PROMPT =
  "You are Hassan's Assistant, the chatbot on Hassan's portfolio website. Hassan is a graphic designer and web developer. His services: logo design, brand identity, business cards, social media post design, banners, flyers, and other graphic design work; and also web design and development (WordPress, Shopify, Webflow, Next.js) and AI chatbot integration. Graphic design and logo design are his main services, so when a visitor asks about logos, branding, or any design work, answer as a graphic designer and never redirect them to web design. Greet visitors warmly and find out what they need. Ask only one question at a time (for logos: business name, industry, preferred style/colors, timeline). Keep replies short, maximum 3 sentences. Reply in the same language the visitor uses (English, Urdu, or Roman Urdu). Never invent prices, deadlines, or promises. If asked about pricing or anything you are unsure about, say Hassan will discuss it directly and ask for the visitor's name and email or WhatsApp. Do not answer topics unrelated to Hassan's services.";

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 15;

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (rateLimitMap.get(ip) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  if (timestamps.length >= MAX_REQUESTS) {
    rateLimitMap.set(ip, timestamps);
    return true;
  }
  timestamps.push(now);
  rateLimitMap.set(ip, timestamps);
  return false;
}

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Handle CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Handle /api/chat route
  if (pathname === "/api/chat" && req.method === "POST") {
    let bodyData = "";
    req.on("data", (chunk) => {
      bodyData += chunk;
    });

    req.on("end", async () => {
      const clientIp =
        req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1";

      const isApiKeyDefined = Boolean(process.env.GEMINI_API_KEY);
      const isModelDefined = Boolean(process.env.GEMINI_MODEL);

      console.log("[Chat Debug] Environment Check:", {
        GEMINI_API_KEY_DEFINED: isApiKeyDefined,
        GEMINI_MODEL_DEFINED: isModelDefined,
      });

      if (isRateLimited(clientIp)) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Rate limit exceeded.",
            reply:
              "You are sending messages too quickly. Please wait a moment before trying again.",
          })
        );
        return;
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Server configuration error.",
            reply: "Sorry, something went wrong. Please try again.",
          })
        );
        return;
      }

      try {
        const body = JSON.parse(bodyData || "{}");
        const rawMessages = body.messages || [];

        if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid messages format." }));
          return;
        }

        // Validate max length
        for (const m of rawMessages) {
          if (m.text && m.text.length > 500) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                reply:
                  "Your message is too long (maximum 500 characters). Please send a shorter message.",
              })
            );
            return;
          }
        }

        // Last 10 messages
        const recent = rawMessages.slice(-10);
        let contents = recent.map((m) => ({
          role: m.role === "user" ? "user" : "model",
          parts: [{ text: (m.text || "").trim() }],
        }));

        while (contents.length > 0 && contents[0].role === "model") {
          contents.shift();
        }

        if (contents.length === 0) {
          contents = [{ role: "user", parts: [{ text: "Hello" }] }];
        }

        const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

        const geminiRes = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            contents,
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
          }),
        });

        console.log(`[Gemini Response] HTTP Status: ${geminiRes.status} ${geminiRes.statusText}`);

        if (!geminiRes.ok) {
          const errBody = await geminiRes.text();
          console.error("[Gemini API Error] Full Response Body:", errBody);
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              reply: "Sorry, something went wrong. Please try again.",
            })
          );
          return;
        }

        const data = await geminiRes.json();
        const candidates = data?.candidates;

        if (!candidates || candidates.length === 0) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              reply:
                "I am unable to answer that right now. Please feel free to ask about Hassan's services!",
            })
          );
          return;
        }

        const firstCandidate = candidates[0];
        const finishReason = firstCandidate?.finishReason || "UNKNOWN";
        console.log(`[Gemini Response] finishReason: ${finishReason}`);

        const botReply =
          candidates[0]?.content?.parts?.[0]?.text?.trim() ||
          "Hi! How can I assist you with your project today?";

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reply: botReply }));
      } catch (err) {
        console.error("[Local Server Error]:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            reply: "Sorry, something went wrong. Please try again.",
          })
        );
      }
    });
    return;
  }

  // Handle Static File Serving
  let filePath = path.join(
    __dirname,
    pathname === "/" ? "index.html" : pathname
  );

  // Security: prevent directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("<h1>404 Not Found</h1>");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n🚀 Portfolio & AI Chatbot running locally at http://localhost:${PORT}`);
  console.log(`📡 AI Endpoint active at http://localhost:${PORT}/api/chat`);
  console.log(`🤖 Using Model: ${process.env.GEMINI_MODEL || "gemini-2.5-flash"}\n`);
});
