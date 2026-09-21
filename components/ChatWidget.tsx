"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";

interface Message {
  id: string;
  sender: "bot" | "user";
  text: string;
  timestamp: string;
  quickReplies?: string[];
}

const QUICK_REPLIES = [
  "Logo Design",
  "Graphic Design",
  "Web Design",
  "WordPress",
  "Shopify",
  "AI Chatbot",
  "Other",
];

const WELCOME_TEXT = "Hi! I'm Hassan's assistant. Is there anything I can help you with today?";

export const ChatWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome-msg",
      sender: "bot",
      text: WELCOME_TEXT,
      timestamp: formatTime(new Date()),
      quickReplies: QUICK_REPLIES,
    },
  ]);
  const [inputVal, setInputVal] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [isSpeechSupported, setIsSpeechSupported] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const finalTranscriptRef = useRef<string>("");
  const isSpeakingRef = useRef<boolean>(false);
  const soundEnabledRef = useRef<boolean>(true);

  soundEnabledRef.current = soundEnabled;

  function formatTime(date: Date) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // 1. Initialize voices and speech recognition support safely on client
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Feature detection for Speech Recognition
    const SpeechRecClass =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    setIsSpeechSupported(Boolean(SpeechRecClass));

    // Feature detection for Speech Synthesis & load voices
    if ("speechSynthesis" in window) {
      const updateVoices = () => {
        const availableVoices = window.speechSynthesis.getVoices();
        if (availableVoices && availableVoices.length > 0) {
          setVoices(availableVoices);
        }
      };

      updateVoices();
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }

    // Cleanup on component unmount
    return () => {
      if (typeof window !== "undefined") {
        if ("speechSynthesis" in window) {
          window.speechSynthesis.cancel();
        }
        if (recognitionRef.current) {
          recognitionRef.current.abort();
        }
      }
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isLoading, isOpen]);

  // Clean text before text-to-speech
  const cleanTextForSpeech = (rawText: string): string => {
    return rawText
      // Remove URLs / markdown links
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "")
      // Remove markdown bold/italic/code/headers/lists
      .replace(/[*#`_~>]/g, "")
      .replace(/^[-*+]\s+/gm, "")
      // Remove emojis
      .replace(
        /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu,
        ""
      )
      // Normalize whitespace
      .replace(/\s+/g, " ")
      .trim();
  };

  // Select best voice (natural English or Urdu if Urdu text)
  const getBestVoice = useCallback(
    (textToSpeak: string): SpeechSynthesisVoice | null => {
      if (!voices || voices.length === 0) return null;

      const hasUrdu = /[\u0600-\u06FF]/.test(textToSpeak);

      if (hasUrdu) {
        const urduVoice = voices.find(
          (v) =>
            v.lang.toLowerCase().startsWith("ur") ||
            v.name.toLowerCase().includes("urdu")
        );
        if (urduVoice) return urduVoice;
      }

      // Filter English voices
      const enVoices = voices.filter((v) =>
        v.lang.toLowerCase().startsWith("en")
      );
      if (enVoices.length === 0) return voices[0] || null;

      // Prefer natural/neural/Google voices
      const preferred = enVoices.find((v) =>
        /(google|natural|neural|enhanced|premium)/i.test(v.name)
      );
      if (preferred) return preferred;

      // Prefer en-US / en-GB
      const regional = enVoices.find((v) =>
        /(en-US|en-GB|en_US|en_GB)/i.test(v.lang)
      );
      if (regional) return regional;

      return enVoices[0];
    },
    [voices]
  );

  // Speak text using SpeechSynthesis
  const speakText = useCallback(
    (text: string) => {
      if (!soundEnabledRef.current) return;
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

      const cleaned = cleanTextForSpeech(text);
      if (!cleaned) return;

      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(cleaned);
      utterance.rate = 0.95; // Slightly slower for clarity
      utterance.pitch = 1.0;

      const voice = getBestVoice(cleaned);
      if (voice) {
        utterance.voice = voice;
      }

      utterance.onstart = () => {
        isSpeakingRef.current = true;
      };

      utterance.onend = () => {
        isSpeakingRef.current = false;
      };

      utterance.onerror = () => {
        isSpeakingRef.current = false;
      };

      window.speechSynthesis.speak(utterance);
    },
    [getBestVoice]
  );

  // Cancel speech helper
  const cancelSpeech = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      isSpeakingRef.current = false;
    }
  };

  // Toggle Sound ON / OFF
  const handleToggleSound = () => {
    const nextState = !soundEnabled;
    setSoundEnabled(nextState);
    if (!nextState) {
      cancelSpeech();
    }
  };

  // Open / Close Panel
  const handleTogglePanel = () => {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);

    if (nextOpen) {
      // Speak welcome message on user-initiated open if sound enabled
      if (soundEnabled) {
        speakText(WELCOME_TEXT);
      }
    } else {
      // Cancel speech and listening on close
      cancelSpeech();
      if (isListening && recognitionRef.current) {
        recognitionRef.current.abort();
        setIsListening(false);
      }
    }
  };

  // Send Message Flow
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputVal).trim();
    if (!text || isLoading) return;

    // Cancel speech and active voice recognition when sending
    cancelSpeech();
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      sender: "user",
      text,
      timestamp: formatTime(new Date()),
    };

    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);

    // Always clear input field and reset transcript buffer immediately on send
    setInputVal("");
    finalTranscriptRef.current = "";

    setIsLoading(true);

    try {
      const payloadMessages = updatedMessages.map((m) => ({
        role: m.sender === "user" ? ("user" as const) : ("model" as const),
        text: m.text,
      }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: payloadMessages }),
      });

      const data = await response.json();

      let botReplyText = data.reply;
      if (!response.ok || !botReplyText) {
        botReplyText =
          data?.reply ||
          "Sorry, something went wrong. Please try again.";
      }

      const botMessage: Message = {
        id: `bot-${Date.now()}`,
        sender: "bot",
        text: botReplyText,
        timestamp: formatTime(new Date()),
      };

      setMessages((prev) => [...prev, botMessage]);

      // Speak bot reply if voice is enabled
      speakText(botReplyText);
    } catch (err) {
      console.error("[ChatWidget Error] Failed to send message:", err);
      const fallbackMessage: Message = {
        id: `bot-err-${Date.now()}`,
        sender: "bot",
        text: "Sorry, something went wrong. Please try again.",
        timestamp: formatTime(new Date()),
      };
      setMessages((prev) => [...prev, fallbackMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  // Speech to Text (Microphone Toggle)
  const handleToggleMic = () => {
    if (!isSpeechSupported || isLoading) return;

    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      return;
    }

    // Stop any ongoing bot speech when user activates microphone
    cancelSpeech();

    const SpeechRecClass =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecClass) return;

    try {
      const recognition = new SpeechRecClass();
      recognition.lang = "en-US";
      recognition.interimResults = true;
      recognition.continuous = false;
      recognitionRef.current = recognition;
      finalTranscriptRef.current = "";

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        let currentTranscript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const item = event.results[i];
          if (item.isFinal) {
            finalTranscriptRef.current = item[0].transcript;
          }
          currentTranscript += item[0].transcript;
        }
        setInputVal(currentTranscript);
      };

      recognition.onerror = (event: any) => {
        console.warn("[Speech Recognition Error]:", event.error);
        setIsListening(false);

        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          const errMsg: Message = {
            id: `mic-err-${Date.now()}`,
            sender: "bot",
            text: "Microphone access was denied. Please allow microphone permissions in your browser to use voice input.",
            timestamp: formatTime(new Date()),
          };
          setMessages((prev) => [...prev, errMsg]);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        const textToSubmit = finalTranscriptRef.current.trim();
        if (textToSubmit) {
          handleSendMessage(textToSubmit);
        }
      };

      recognition.start();
    } catch (err) {
      console.error("[Speech Recognition Start Error]:", err);
      setIsListening(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !isLoading) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div style={styles.container}>
      {/* Chat Window Panel */}
      {isOpen && (
        <div style={styles.panel} role="dialog" aria-label="Chat with Hassan's Assistant">
          {/* Header */}
          <div style={styles.header}>
            <div style={styles.headerLeft}>
              <div style={styles.avatarWrapper}>
                <div style={styles.avatarGradient}>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
                    <rect x="3" y="8" width="18" height="12" rx="4" />
                    <circle cx="9" cy="13" r="1.5" fill="#fff" />
                    <circle cx="15" cy="13" r="1.5" fill="#fff" />
                    <path d="M9 17h6" />
                  </svg>
                </div>
                <span style={styles.onlineStatus} />
              </div>
              <div>
                <h4 style={styles.headerTitle}>Hassan&apos;s Assistant</h4>
                <p style={styles.headerSubtitle}>
                  <span style={styles.onlineDot} /> Online • Instant replies
                </p>
              </div>
            </div>

            <div style={styles.headerActions}>
              {/* Sound Toggle */}
              <button
                type="button"
                onClick={handleToggleSound}
                style={{
                  ...styles.headerBtn,
                  opacity: soundEnabled ? 1 : 0.45,
                  borderColor: soundEnabled ? "#F3500F" : "rgba(255, 255, 255, 0.12)",
                }}
                title={soundEnabled ? "Mute voice replies" : "Enable voice replies"}
                aria-label="Toggle Sound"
              >
                {soundEnabled ? "🔊" : "🔇"}
              </button>

              {/* Close Button */}
              <button
                type="button"
                onClick={handleTogglePanel}
                style={styles.headerBtn}
                title="Close chat"
                aria-label="Close Chat"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Messages Body */}
          <div style={styles.messagesContainer}>
            {messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  ...styles.messageRow,
                  justifyContent:
                    msg.sender === "user" ? "flex-end" : "flex-start",
                }}
              >
                {msg.sender === "bot" && (
                  <div style={styles.botAvatarMini}>
                    <span>AI</span>
                  </div>
                )}
                <div
                  style={{
                    ...styles.messageBubble,
                    ...(msg.sender === "user"
                      ? styles.userBubble
                      : styles.botBubble),
                  }}
                >
                  <p style={styles.messageText}>{msg.text}</p>
                  <span
                    style={{
                      ...styles.timestamp,
                      textAlign: msg.sender === "user" ? "right" : "left",
                    }}
                  >
                    {msg.timestamp}
                  </span>

                  {/* Quick Replies Buttons */}
                  {msg.quickReplies && (
                    <div style={styles.quickRepliesContainer}>
                      {msg.quickReplies.map((reply) => (
                        <button
                          key={reply}
                          type="button"
                          disabled={isLoading}
                          onClick={() => handleSendMessage(reply)}
                          style={{
                            ...styles.quickReplyBtn,
                            opacity: isLoading ? 0.6 : 1,
                            cursor: isLoading ? "not-allowed" : "pointer",
                          }}
                          onMouseEnter={(e) => {
                            if (!isLoading) {
                              e.currentTarget.style.borderColor = "#F3500F";
                              e.currentTarget.style.color = "#F3500F";
                              e.currentTarget.style.backgroundColor =
                                "rgba(243, 80, 15, 0.12)";
                            }
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor =
                              "rgba(255, 255, 255, 0.18)";
                            e.currentTarget.style.color = "#ffffff";
                            e.currentTarget.style.backgroundColor =
                              "rgba(255, 255, 255, 0.05)";
                          }}
                        >
                          {reply}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Typing Indicator */}
            {isLoading && (
              <div style={{ ...styles.messageRow, justifyContent: "flex-start" }}>
                <div style={styles.botAvatarMini}>
                  <span>AI</span>
                </div>
                <div style={{ ...styles.messageBubble, ...styles.botBubble }}>
                  <div style={styles.typingDots}>
                    <span style={{ ...styles.dot, animationDelay: "0ms" }} />
                    <span style={{ ...styles.dot, animationDelay: "200ms" }} />
                    <span style={{ ...styles.dot, animationDelay: "400ms" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Footer Input */}
          <div style={styles.inputArea}>
            <div style={styles.inputWrap}>
              <input
                type="text"
                value={inputVal}
                disabled={isLoading}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  isListening
                    ? "Listening... speak now"
                    : isLoading
                    ? "Hassan's Assistant is typing..."
                    : "Type your message..."
                }
                style={{
                  ...styles.input,
                  opacity: isLoading ? 0.7 : 1,
                  cursor: isLoading ? "not-allowed" : "text",
                  borderColor: isListening ? "#F3500F" : "rgba(255, 255, 255, 0.12)",
                }}
              />
            </div>

            {/* Microphone Button */}
            <button
              type="button"
              onClick={handleToggleMic}
              disabled={isLoading || !isSpeechSupported}
              style={{
                ...styles.micBtn,
                opacity: !isSpeechSupported ? 0.3 : isListening ? 1 : 0.75,
                color: isListening ? "#F3500F" : "#ffffff",
                backgroundColor: isListening ? "rgba(243, 80, 15, 0.18)" : "transparent",
                borderColor: isListening ? "#F3500F" : "transparent",
                boxShadow: isListening ? "0 0 10px rgba(243, 80, 15, 0.5)" : "none",
                cursor: !isSpeechSupported || isLoading ? "not-allowed" : "pointer",
                transform: isListening ? "scale(1.1)" : "scale(1)",
              }}
              title={
                !isSpeechSupported
                  ? "Voice input not supported in this browser"
                  : isListening
                  ? "Stop listening"
                  : "Voice input (Speak to Hassan's Assistant)"
              }
              aria-label="Voice Input"
            >
              🎤
            </button>

            {/* Send Button */}
            <button
              type="button"
              disabled={isLoading || !inputVal.trim()}
              onClick={() => handleSendMessage()}
              style={{
                ...styles.sendBtn,
                opacity: isLoading || !inputVal.trim() ? 0.5 : 1,
                cursor: isLoading || !inputVal.trim() ? "not-allowed" : "pointer",
                transform: isLoading ? "scale(0.95)" : "scale(1)",
              }}
              title="Send message"
              aria-label="Send Message"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Floating Launcher Bubble Button */}
      <button
        type="button"
        onClick={handleTogglePanel}
        style={{
          ...styles.launcherBtn,
          transform: isOpen ? "rotate(90deg) scale(0.95)" : "scale(1)",
        }}
        aria-label="Open Hassan's Assistant Chat"
      >
        {isOpen ? (
          <span style={{ fontSize: "20px", fontWeight: "bold" }}>✕</span>
        ) : (
          <>
            <div style={styles.launcherIconWrapper}>
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#ffffff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <span style={styles.launcherPulseBadge} className="hassan-chat-pulse-badge" />
          </>
        )}
      </button>
    </div>
  );
};

// Component Native Styles (Design Matched)
const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "fixed",
    bottom: "28px",
    right: "28px",
    zIndex: 999999,
    fontFamily: '"Rajdhani", "Poppins", sans-serif',
  },
  launcherBtn: {
    width: "60px",
    height: "60px",
    borderRadius: "50%",
    background: "linear-gradient(136.55deg, #FB8F10 5.49%, #FE0101 100%)",
    color: "#ffffff",
    border: "2px solid rgba(255, 255, 255, 0.25)",
    boxShadow: "0 8px 30px rgba(243, 80, 15, 0.45), 0 4px 15px rgba(0, 0, 0, 0.7)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
    outline: "none",
    position: "relative",
    overflow: "visible",
  },
  launcherIconWrapper: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  launcherPulseBadge: {
    position: "absolute",
    top: "1px",
    right: "1px",
    width: "15px",
    height: "15px",
    borderRadius: "50%",
    backgroundColor: "#1EF482",
    border: "2.5px solid #141414",
    boxShadow: "0 0 8px rgba(30, 244, 130, 0.6)",
    pointerEvents: "none",
    zIndex: 10,
  },
  panel: {
    position: "absolute",
    bottom: "76px",
    right: "0",
    width: "380px",
    maxWidth: "calc(100vw - 32px)",
    height: "560px",
    maxHeight: "calc(100vh - 120px)",
    backgroundColor: "#121212",
    backgroundImage: "radial-gradient(circle at top right, rgba(251, 143, 16, 0.08), transparent 70%)",
    border: "1px solid rgba(255, 255, 255, 0.15)",
    borderRadius: "20px",
    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 30px rgba(243, 80, 15, 0.2)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  header: {
    padding: "16px 20px",
    background: "linear-gradient(180deg, #1f1f1f 0%, #161616 100%)",
    borderBottom: "1px solid rgba(255, 255, 255, 0.12)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  avatarWrapper: {
    position: "relative",
  },
  avatarGradient: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    background: "linear-gradient(135deg, #FB8F10 0%, #FE0101 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid rgba(255, 255, 255, 0.3)",
  },
  onlineStatus: {
    position: "absolute",
    bottom: "0px",
    right: "0px",
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    backgroundColor: "#1EF482",
    border: "2px solid #161616",
  },
  headerTitle: {
    margin: 0,
    fontSize: "18px",
    fontWeight: 600,
    color: "#ffffff",
    fontFamily: '"Rajdhani", sans-serif',
    letterSpacing: "0.5px",
    lineHeight: "1.2",
  },
  headerSubtitle: {
    margin: 0,
    fontSize: "12px",
    color: "rgba(255, 255, 255, 0.6)",
    fontFamily: '"Poppins", sans-serif',
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginTop: "2px",
  },
  onlineDot: {
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    backgroundColor: "#1EF482",
    display: "inline-block",
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  headerBtn: {
    background: "rgba(255, 255, 255, 0.08)",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    color: "#ffffff",
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "14px",
    transition: "all 0.2s ease",
  },
  messagesContainer: {
    flex: 1,
    padding: "18px 16px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    backgroundColor: "#0d0d0d",
  },
  messageRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
  },
  botAvatarMini: {
    width: "26px",
    height: "26px",
    borderRadius: "50%",
    background: "rgba(243, 80, 15, 0.2)",
    border: "1px solid #F3500F",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "10px",
    fontWeight: "bold",
    color: "#FB8F10",
    flexShrink: 0,
    marginTop: "4px",
  },
  messageBubble: {
    maxWidth: "82%",
    padding: "12px 16px",
    borderRadius: "16px",
    fontSize: "14px",
    lineHeight: "1.5",
    fontFamily: '"Poppins", sans-serif',
  },
  botBubble: {
    backgroundColor: "#1a1a1a",
    color: "#f1f1f1",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderTopLeftRadius: "4px",
  },
  userBubble: {
    background: "linear-gradient(136.55deg, #FB8F10 5.49%, #FE0101 100%)",
    color: "#ffffff",
    borderTopRightRadius: "4px",
    boxShadow: "0 4px 15px rgba(243, 80, 15, 0.3)",
  },
  messageText: {
    margin: 0,
    wordBreak: "break-word",
  },
  timestamp: {
    display: "block",
    fontSize: "10px",
    opacity: 0.6,
    marginTop: "5px",
  },
  quickRepliesContainer: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "12px",
  },
  quickReplyBtn: {
    padding: "6px 14px",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    border: "1px solid rgba(255, 255, 255, 0.18)",
    borderRadius: "99px",
    color: "#ffffff",
    fontSize: "12px",
    fontFamily: '"Rajdhani", sans-serif',
    fontWeight: 600,
    letterSpacing: "0.3px",
    cursor: "pointer",
    transition: "all 0.25s ease",
  },
  typingDots: {
    display: "flex",
    gap: "5px",
    padding: "4px 2px",
  },
  dot: {
    width: "7px",
    height: "7px",
    backgroundColor: "#F3500F",
    borderRadius: "50%",
    display: "inline-block",
  },
  inputArea: {
    padding: "12px 14px",
    backgroundColor: "#161616",
    borderTop: "1px solid rgba(255, 255, 255, 0.1)",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  inputWrap: {
    flex: 1,
  },
  input: {
    width: "100%",
    background: "rgba(255, 255, 255, 0.06)",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    borderRadius: "99px",
    padding: "10px 16px",
    color: "#ffffff",
    fontSize: "14px",
    fontFamily: '"Poppins", sans-serif',
    outline: "none",
    boxSizing: "border-box",
    transition: "all 0.25s ease",
  },
  micBtn: {
    background: "transparent",
    border: "1px solid transparent",
    borderRadius: "50%",
    fontSize: "18px",
    cursor: "pointer",
    padding: "6px",
    width: "36px",
    height: "36px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.25s ease",
    outline: "none",
    flexShrink: 0,
  },
  sendBtn: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    background: "linear-gradient(136.55deg, #FB8F10 5.49%, #FE0101 100%)",
    border: "none",
    color: "#ffffff",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 4px 12px rgba(243, 80, 15, 0.35)",
    transition: "transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease",
    flexShrink: 0,
  },
};

export default ChatWidget;
