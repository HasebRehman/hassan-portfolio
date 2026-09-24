const http = require("http");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

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
  "You are Sara, the AI assistant on Hassan's portfolio website. Hassan is a designer and developer. His services: Branding & Art Direction (logos, brand identity, guidelines), Social Media Management (content design, ad creatives, campaign visuals), UI Design (clean, modern websites & mobile apps), Website & App Development (WordPress, Shopify, custom web apps, mobile apps), and AI Chatbots. Greet visitors warmly and find out what they need. Keep replies short, concise and friendly, maximum 2-3 sentences. Reply in the same language the visitor uses (English, Urdu, or Roman Urdu). Never invent fixed prices, deadlines, or false promises. If asked about pricing or specifics you are unsure about, explain that Hassan will discuss it directly and invite them to leave their name, email or WhatsApp. Do not answer topics unrelated to Hassan's services.";

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

  // Handle /api/contact route
  if (pathname === "/api/contact" && req.method === "POST") {
    let bodyData = "";
    req.on("data", (chunk) => {
      bodyData += chunk;
    });

    req.on("end", async () => {
      try {
        let payload = {};
        try {
          payload = JSON.parse(bodyData);
        } catch (e) {
          // If form-urlencoded
          const params = new URLSearchParams(bodyData);
          payload = {
            mail: params.get("mail"),
            phone: params.get("phone"),
            message: params.get("message"),
            budget: params.get("budget"),
          };
        }

        const userEmail = (payload.mail || payload.email || "").trim();
        const userPhone = (payload.phone || "").trim();
        const userMessage = (payload.message || "").trim();
        const userBudget = (payload.budget || "Not specified").trim();

        if (!userEmail || !userMessage) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Email and message are required." }));
          return;
        }

        const gmailUser = process.env.GMAIL_USER || "hassanrehman5890@gmail.com";
        const gmailPass = (process.env.GMAIL_APP_PASS || "").replace(/\s+/g, "");

        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: gmailUser,
            pass: gmailPass,
          },
        });

        // Helper to escape HTML characters
        const escapeHtml = (str) => {
          return String(str || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
        };

        const safeEmail = escapeHtml(userEmail);
        const safePhone = escapeHtml(userPhone);
        const safeMessage = escapeHtml(userMessage).replace(/\n/g, "<br/>");
        const safeBudget = escapeHtml(userBudget);

        // 1. Email notification to Hassan
        const mailToHassan = {
          from: `"Portfolio Contact Form" <${gmailUser}>`,
          to: "hassanrehman5890@gmail.com",
          replyTo: userEmail,
          subject: `New Lead: ${userEmail} (${safeBudget})`,
          html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
  <title>New Project Inquiry</title>
</head>
<body style="margin: 0; padding: 48px 16px; background-color: #0d0c0a; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f5f5f7;">
  <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 560px; background-color: #141312; border-radius: 24px; border: 1px solid #282420; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.6);">
    
    <!-- Top Brand Accent Line -->
    <tr>
      <td style="background: linear-gradient(90deg, #FB8F10 0%, #F3500F 50%, #FE0101 100%); height: 3px;"></td>
    </tr>

    <!-- Header -->
    <tr>
      <td style="padding: 36px 36px 20px 36px;">
        <table width="100%" border="0" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <div style="font-family: 'Poppins', sans-serif; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; color: #ffffff;">
                HASSAN<span style="color: #F3500F;">.</span>
              </div>
              <div style="font-family: 'Poppins', sans-serif; font-size: 13px; color: #8e8880; margin-top: 2px;">Portfolio Lead Notification</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Details Table -->
    <tr>
      <td style="padding: 0 36px 20px 36px;">
        <table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color: #1a1917; border-radius: 16px; border: 1px solid #2a2723;">
          <tr>
            <td style="padding: 15px 20px; border-bottom: 1px solid #24221f; color: #8e8880; font-family: 'Poppins', sans-serif; font-size: 13px; font-weight: 500;">Email:</td>
            <td style="padding: 15px 20px; border-bottom: 1px solid #24221f; color: #ffffff; font-family: 'Poppins', sans-serif; font-size: 14px; font-weight: 500;" align="right">
              <a href="mailto:${safeEmail}" style="color: #FB8F10; text-decoration: none; font-weight: 600;">${safeEmail}</a>
            </td>
          </tr>
          <tr>
            <td style="padding: 15px 20px; border-bottom: 1px solid #24221f; color: #8e8880; font-family: 'Poppins', sans-serif; font-size: 13px; font-weight: 500;">Phone / WhatsApp:</td>
            <td style="padding: 15px 20px; border-bottom: 1px solid #24221f; color: #ffffff; font-family: 'Poppins', sans-serif; font-size: 14px;" align="right">
              ${safePhone ? `<a href="https://wa.me/${safePhone.replace(/[^0-9]/g, '')}" style="color: #25D366; text-decoration: none; font-weight: 600;">${safePhone}</a>` : '<span style="color: #5a554f;">Not provided</span>'}
            </td>
          </tr>
          <tr>
            <td style="padding: 15px 20px; color: #8e8880; font-family: 'Poppins', sans-serif; font-size: 13px; font-weight: 500;">Budget Tier:</td>
            <td style="padding: 15px 20px; color: #ffffff; font-family: 'Poppins', sans-serif; font-size: 14px; font-weight: 600;" align="right">
              ${safeBudget}
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Message -->
    <tr>
      <td style="padding: 0 36px 28px 36px;">
        <div style="font-family: 'Poppins', sans-serif; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: #8e8880; margin-bottom: 8px;">Message:</div>
        <div style="background-color: #1a1917; border-left: 3px solid #F3500F; border-radius: 0 14px 14px 0; padding: 18px 20px; color: #e5e5ea; font-family: 'Poppins', sans-serif; font-size: 14px; line-height: 1.6;">
          ${safeMessage}
        </div>
      </td>
    </tr>

    <!-- Action Button (Hassan Signature Pill) -->
    <tr>
      <td style="padding: 0 36px 36px 36px;">
        <table align="center" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
          <tr>
            <td style="background-color: #ffffff; border-radius: 99px; padding: 4px 5px 4px 22px;">
              <a href="mailto:${safeEmail}" style="text-decoration: none; display: block;">
                <table border="0" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-family: 'Poppins', sans-serif; color: #111111; font-size: 14px; font-weight: 500; padding-right: 16px; white-space: nowrap;">
                      Reply to Client
                    </td>
                    <td style="width: 38px; height: 38px; background-color: #111111; border-radius: 50%; text-align: center; vertical-align: middle;">
                      <span style="color: #ffffff; font-size: 16px; line-height: 38px; display: inline-block;">&#8599;</span>
                    </td>
                  </tr>
                </table>
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="background-color: #0e0d0c; padding: 22px 36px; border-top: 1px solid #221f1c; text-align: center; color: #6e6860; font-family: 'Poppins', sans-serif; font-size: 12px;">
        Submitted via contact form on Hassan's Portfolio
      </td>
    </tr>
  </table>
</body>
</html>
          `,
        };

        // 2. Automated Thank-You confirmation email to the client (Matches Hassan's exact aesthetic)
        const mailToUser = {
          from: `"Hassan Rehman" <${gmailUser}>`,
          to: userEmail,
          subject: `Thanks for reaching out! - Hassan Rehman`,
          html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
  <title>Thanks for reaching out</title>
</head>
<body style="margin: 0; padding: 48px 16px; background-color: #0d0c0a; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f5f5f7;">
  <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 560px; background-color: #141312; border-radius: 24px; border: 1px solid #282420; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.6);">
    
    <!-- Top Brand Gradient Bar -->
    <tr>
      <td style="background: linear-gradient(90deg, #FB8F10 0%, #F3500F 50%, #FE0101 100%); height: 3px;"></td>
    </tr>

    <!-- Header (Clean HASSAN. Logo) -->
    <tr>
      <td style="padding: 36px 36px 16px 36px;">
        <table width="100%" border="0" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <div style="font-family: 'Poppins', sans-serif; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; color: #ffffff;">
                HASSAN<span style="color: #F3500F;">.</span>
              </div>
              <div style="font-family: 'Poppins', sans-serif; font-size: 13px; color: #8e8880; margin-top: 2px;">
                Designer &amp; Developer
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Heading & Main Message -->
    <tr>
      <td style="padding: 12px 36px 22px 36px;">
        <h1 style="font-family: 'Poppins', sans-serif; color: #ffffff; font-size: 22px; font-weight: 600; margin: 0 0 14px 0; letter-spacing: -0.4px;">
          Thanks for reaching out!
        </h1>
        <p style="font-family: 'Poppins', sans-serif; color: #d6d0c7; font-size: 14px; line-height: 1.7; margin: 0 0 14px 0;">
          I've received your project inquiry. I am currently reviewing the details and will get back to you shortly with next steps.
        </p>
        <p style="font-family: 'Poppins', sans-serif; color: #a39c93; font-size: 14px; line-height: 1.7; margin: 0;">
          Whether you're looking for brand identity, a high-converting website, or UI/UX design, I'm excited to help you bring your vision to life.
        </p>
      </td>
    </tr>

    <!-- Need a faster response box -->
    <tr>
      <td style="padding: 0 36px 26px 36px;">
        <table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color: #1a1917; border-radius: 16px; border: 1px solid #2a2723; padding: 22px 24px;">
          <tr>
            <td>
              <div style="font-family: 'Poppins', sans-serif; font-size: 15px; font-weight: 600; color: #ffffff; margin-bottom: 6px;">
                Need a faster response?
              </div>
              <div style="font-family: 'Poppins', sans-serif; font-size: 13px; color: #8e8880; line-height: 1.5; margin-bottom: 18px;">
                For urgent inquiries or quick discussions, message me directly on WhatsApp.
              </div>

              <!-- Pill Button styled exactly like portfolio buttons (Image 2) -->
              <table border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color: #ffffff; border-radius: 99px; padding: 4px 5px 4px 22px;">
                    <a href="https://wa.me/923190117360" target="_blank" rel="noopener noreferrer" style="text-decoration: none; display: block;">
                      <table border="0" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="font-family: 'Poppins', sans-serif; color: #111111; font-size: 14px; font-weight: 500; padding-right: 16px; white-space: nowrap;">
                            Chat on WhatsApp
                          </td>
                          <td style="width: 38px; height: 38px; background-color: #111111; border-radius: 50%; text-align: center; vertical-align: middle;">
                            <span style="color: #ffffff; font-size: 16px; line-height: 38px; display: inline-block;">&#8599;</span>
                          </td>
                        </tr>
                      </table>
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Your Inquiry Section -->
    <tr>
      <td style="padding: 0 36px 32px 36px;">
        <div style="font-family: 'Poppins', sans-serif; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: #8e8880; margin-bottom: 8px;">
          Your Inquiry:
        </div>
        <div style="background-color: #1a1917; border-radius: 12px; border: 1px solid #2a2723; padding: 16px 20px; color: #a39c93; font-family: 'Poppins', sans-serif; font-size: 13px; line-height: 1.6;">
          ${safeMessage}
        </div>
      </td>
    </tr>

    <!-- Clean Footer with Behance and LinkedIn Circular Icons -->
    <tr>
      <td style="background-color: #0e0d0c; padding: 26px 36px; border-top: 1px solid #221f1c; text-align: center;">
        <table align="center" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto 12px auto;">
          <tr>
            <!-- Behance Icon (Circular Button Style) -->
            <td style="padding: 0 6px;">
              <a href="https://www.behance.net/hassanrehman25" target="_blank" rel="noopener noreferrer" style="display: inline-block; width: 36px; height: 36px; line-height: 36px; background-color: #1f1d1a; border: 1px solid #332f2a; border-radius: 50%; color: #d6d0c7; text-decoration: none; font-family: 'Poppins', sans-serif; font-size: 13px; font-weight: 700; text-align: center;">
                Bē
              </a>
            </td>
            <!-- LinkedIn Icon (Circular Button Style) -->
            <td style="padding: 0 6px;">
              <a href="https://www.linkedin.com/in/hassan-rehman-graphicdesigner" target="_blank" rel="noopener noreferrer" style="display: inline-block; width: 36px; height: 36px; line-height: 36px; background-color: #1f1d1a; border: 1px solid #332f2a; border-radius: 50%; color: #d6d0c7; text-decoration: none; font-family: 'Poppins', sans-serif; font-size: 13px; font-weight: 700; text-align: center;">
                in
              </a>
            </td>
          </tr>
        </table>
        <div style="color: #6e6860; font-family: 'Poppins', sans-serif; font-size: 12px; margin-top: 8px;">
          &copy; 2026 Hassan Rehman. All rights reserved.
        </div>
      </td>
    </tr>
  </table>
</body>
</html>
          `,
        };

        console.log(`[Contact Form] Sending emails for ${userEmail}...`);
        await Promise.all([
          transporter.sendMail(mailToHassan),
          transporter.sendMail(mailToUser),
        ]);
        console.log(`[Contact Form] Both emails sent successfully!`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, message: "Message sent successfully!" }));
      } catch (err) {
        console.error("[Contact Form Error]:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Failed to send message. Please try again later or contact via WhatsApp.",
          })
        );
      }
    });
    return;
  }

  // Handle Static File Serving
  let decodedPathname = pathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch (e) {
    decodedPathname = pathname;
  }

  let filePath = path.join(
    __dirname,
    decodedPathname === "/" ? "index.html" : decodedPathname
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
