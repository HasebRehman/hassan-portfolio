import { NextRequest, NextResponse } from "next/server";

interface MessageItem {
  role: "user" | "model";
  text: string;
}

// In-memory sliding window rate limiting: IP -> timestamps[]
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 15;

const SYSTEM_PROMPT =
  "You are Hassan's Assistant, the chatbot on Hassan's portfolio website. Hassan is a graphic designer and web developer. His services: logo design, brand identity, business cards, social media post design, banners, flyers, and other graphic design work; and also web design and development (WordPress, Shopify, Webflow, Next.js) and AI chatbot integration. Graphic design and logo design are his main services, so when a visitor asks about logos, branding, or any design work, answer as a graphic designer and never redirect them to web design. Greet visitors warmly and find out what they need. Ask only one question at a time (for logos: business name, industry, preferred style/colors, timeline). Keep replies short, maximum 3 sentences. Reply in the same language the visitor uses (English, Urdu, or Roman Urdu). Never invent prices, deadlines, or promises. If asked about pricing or anything you are unsure about, say Hassan will discuss it directly and ask for the visitor's name and email or WhatsApp. Do not answer topics unrelated to Hassan's services.";

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(ip) || [];

  const validTimestamps = timestamps.filter(
    (ts) => now - ts < RATE_LIMIT_WINDOW_MS
  );

  if (validTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    rateLimitMap.set(ip, validTimestamps);
    return false;
  }

  validTimestamps.push(now);
  rateLimitMap.set(ip, validTimestamps);
  return true;
}

export async function POST(req: NextRequest) {
  try {
    // 1. Diagnostic Environment Logging (true/false only - never log secret values)
    const isApiKeyDefined = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
    const isModelDefined = Boolean(process.env.GEMINI_MODEL && process.env.GEMINI_MODEL.trim().length > 0);

    console.log("[Chat Debug] Environment Check:", {
      GEMINI_API_KEY_DEFINED: isApiKeyDefined,
      GEMINI_MODEL_DEFINED: isModelDefined,
    });

    // 2. IP Rate Limiting
    const forwardedFor = req.headers.get("x-forwarded-for");
    const realIp = req.headers.get("x-real-ip");
    const clientIp =
      forwardedFor?.split(",")[0]?.trim() || realIp || "127.0.0.1";

    if (!checkRateLimit(clientIp)) {
      console.warn(`[Chat Rate Limit] Exceeded by IP: ${clientIp}`);
      return NextResponse.json(
        {
          error: "Rate limit exceeded.",
          reply:
            "You are sending messages too quickly. Please wait a moment before trying again.",
        },
        { status: 429 }
      );
    }

    // 3. API Key Validation
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("[Chat Server Error] GEMINI_API_KEY is not defined in environment.");
      return NextResponse.json(
        {
          error: "Server configuration error.",
          reply: "Sorry, something went wrong. Please try again.",
        },
        { status: 500 }
      );
    }

    // 4. Parse & Validate Request Body
    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
      console.warn("[Chat Request Error] Missing or invalid 'messages' array in request body.");
      return NextResponse.json(
        {
          error: "Invalid request payload.",
          reply: "Invalid message format.",
        },
        { status: 400 }
      );
    }

    const rawMessages: MessageItem[] = body.messages;

    // Reject message exceeding 500 characters
    for (const msg of rawMessages) {
      if (!msg || typeof msg.text !== "string") {
        return NextResponse.json(
          {
            error: "Each message must have string text.",
            reply: "Invalid message content.",
          },
          { status: 400 }
        );
      }
      if (msg.text.length > 500) {
        console.warn(`[Chat Validation Error] Message exceeded 500 chars (${msg.text.length} chars).`);
        return NextResponse.json(
          {
            error: "Message too long.",
            reply: "Your message is too long (maximum 500 characters). Please send a shorter message.",
          },
          { status: 400 }
        );
      }
    }

    // Keep only last 10 messages for conversation context
    const recentMessages = rawMessages.slice(-10);

    let formattedContents = recentMessages.map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.text.trim() }],
    }));

    // Ensure first turn in Gemini history starts with 'user'
    while (formattedContents.length > 0 && formattedContents[0].role === "model") {
      formattedContents.shift();
    }

    if (formattedContents.length === 0) {
      formattedContents = [{ role: "user", parts: [{ text: "Hello" }] }];
    }

    // 5. Call Gemini REST API
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const payload = {
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
      body: JSON.stringify(payload),
    });

    // Log HTTP status code from Gemini response
    console.log(`[Gemini Response] HTTP Status: ${response.status} ${response.statusText}`);

    // If HTTP status is not 200, log full response body
    if (!response.ok) {
      const errorBody = await response.text();
      console.error("[Gemini API Error] Full Response Body:", errorBody);
      return NextResponse.json(
        {
          error: "Gemini API error",
          reply: "Sorry, something went wrong. Please try again.",
        },
        { status: 502 }
      );
    }

    const data = await response.json();

    // 6. Handle case where Gemini response has no candidates or is blocked/empty
    const candidates = data?.candidates;
    if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
      console.warn("[Gemini Response Warning] No candidates returned in response:", JSON.stringify(data));
      const promptFeedback = data?.promptFeedback;
      if (promptFeedback?.blockReason) {
        console.warn(`[Gemini Block Reason] Prompt blocked due to: ${promptFeedback.blockReason}`);
      }
      return NextResponse.json(
        {
          error: "No candidate response generated.",
          reply: "I am unable to answer that right now. Please ask about Hassan's design or development services!",
        },
        { status: 200 }
      );
    }

    const firstCandidate = candidates[0];
    const finishReason = firstCandidate?.finishReason || "UNKNOWN";
    console.log(`[Gemini Response] finishReason: ${finishReason}`);

    const botReply = firstCandidate?.content?.parts?.[0]?.text?.trim();

    if (!botReply) {
      console.warn("[Gemini Response Warning] Empty text part in first candidate:", JSON.stringify(firstCandidate));
      return NextResponse.json(
        {
          reply: "Hi! How can I assist you with your design or web project today?",
        },
        { status: 200 }
      );
    }

    return NextResponse.json({ reply: botReply }, { status: 200 });
  } catch (error: any) {
    console.error("[Chat Server Exception] Unhandled error:", error);
    return NextResponse.json(
      {
        error: "Internal server error.",
        reply: "Sorry, something went wrong. Please try again.",
      },
      { status: 500 }
    );
  }
}
