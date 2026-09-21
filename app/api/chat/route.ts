import { NextRequest, NextResponse } from "next/server";

interface MessageItem {
  role: "user" | "model";
  text: string;
}

const SYSTEM_PROMPT =
  "You are Hassan's Assistant, the chatbot on Hassan's portfolio website. Hassan is a graphic designer and web developer. His services: logo design, brand identity, business cards, social media post design, banners, flyers, and other graphic design work; and also web design and development (WordPress, Shopify, Webflow, Next.js) and AI chatbot integration. Graphic design and logo design are his main services, so when a visitor asks about logos, branding, or any design work, answer as a graphic designer and never redirect them to web design. Greet visitors warmly and find out what they need. Ask only one question at a time (for logos: business name, industry, preferred style/colors, timeline). Keep replies short, maximum 3 sentences. Reply in the same language the visitor uses (English, Urdu, or Roman Urdu). Never invent prices, deadlines, or promises. If asked about pricing or anything you are unsure about, say Hassan will discuss it directly and ask for the visitor's name and email or WhatsApp. Do not answer topics unrelated to Hassan's services.";

const MODELS_TO_TRY = [
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-2.5-flash-lite",
];

function sanitizeAndFormatContents(rawMessages: MessageItem[]) {
  const cleaned = rawMessages
    .filter((m) => m && typeof m.text === "string" && m.text.trim().length > 0)
    .filter(
      (m) =>
        !m.text.includes("Sorry, something went wrong") &&
        !m.text.includes("unable to answer that right now") &&
        !m.text.includes("receiving a lot of messages")
    );

  const recent = cleaned.slice(-10);

  const normalized = recent.map((m) => ({
    role: m.role === "user" ? ("user" as const) : ("model" as const),
    text: m.text.trim(),
  }));

  const merged: { role: "user" | "model"; text: string }[] = [];
  for (const item of normalized) {
    if (merged.length > 0 && merged[merged.length - 1].role === item.role) {
      merged[merged.length - 1].text += `\n${item.text}`;
    } else {
      merged.push({ ...item });
    }
  }

  while (merged.length > 0 && merged[0].role === "model") {
    merged.shift();
  }

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

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("[API Error] GEMINI_API_KEY is not configured.");
      return NextResponse.json(
        {
          error: "API key not configured.",
          reply: "Sorry, the AI service is currently unavailable. Please configure GEMINI_API_KEY.",
        },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json(
        {
          error: "Invalid request payload.",
          reply: "Invalid message format.",
        },
        { status: 400 }
      );
    }

    const rawMessages: MessageItem[] = body.messages;
    const formattedContents = sanitizeAndFormatContents(rawMessages);

    const preferredModel = process.env.GEMINI_MODEL;
    const modelQueue = [
      ...(preferredModel && !preferredModel.includes("1.5") ? [preferredModel] : []),
      ...MODELS_TO_TRY,
    ];
    const uniqueModels = Array.from(new Set(modelQueue));

    let botReply: string | null = null;
    let lastError: string | null = null;

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

        console.log(`[Next.js /api/chat] Model ${model} -> Status: ${response.status} ${response.statusText}`);

        if (response.status === 429) {
          lastError = "429_RATE_LIMIT";
          continue;
        }

        if (!response.ok) {
          const errText = await response.text();
          console.error(`[Next.js /api/chat] Error with ${model}:`, errText);
          lastError = errText;
          continue;
        }

        const data = await response.json();
        const candidates = data?.candidates;

        if (candidates && candidates.length > 0) {
          const text = candidates[0]?.content?.parts?.[0]?.text?.trim();
          if (text) {
            botReply = text;
            break;
          }
        }
      } catch (err: any) {
        console.error(`[Next.js /api/chat] Exception with model ${model}:`, err);
        lastError = err?.message || String(err);
      }
    }

    if (botReply) {
      return NextResponse.json({ reply: botReply }, { status: 200 });
    }

    if (lastError === "429_RATE_LIMIT") {
      return NextResponse.json(
        {
          reply: "I'm receiving a lot of messages right now. Please wait a moment and send your message again!",
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        reply: "Hi! I'm Hassan's assistant. How can I help you with your graphic design or web development project today?",
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[Next.js /api/chat] Top-level Exception:", error);
    return NextResponse.json(
      {
        reply: "Hi! How can I assist you with your project today?",
      },
      { status: 200 }
    );
  }
}
