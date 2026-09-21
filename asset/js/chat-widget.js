/**
 * Hassan's Assistant - Floating Chatbot Widget
 * Connected to Gemini AI API (/api/chat) + Web Speech API (TTS & STT)
 */

(function () {
    const QUICK_REPLIES = [
        "Logo Design",
        "Graphic Design",
        "Web Design",
        "WordPress",
        "Shopify",
        "AI Chatbot",
        "Other"
    ];

    const WELCOME_TEXT = "Hi! I'm Hassan's assistant. Is there anything I can help you with today?";

    const FALLBACK_RESPONSES = {
        "Logo Design": "Hassan specializes in custom, memorable logo designs that capture your brand's essence. Could you share your business name and industry to begin?",
        "Graphic Design": "From brand identity and business cards to social media posts and banners, Hassan offers complete graphic design solutions. What type of design project are you planning?",
        "Web Design": "I specialize in crafting modern, responsive, and high-converting web designs with interactive animations. Would you like to review some design case studies or discuss a project?",
        "WordPress": "I build custom, high-speed WordPress themes and WooCommerce stores tailored to your brand identity and business goals. Let's build something exceptional!",
        "Shopify": "I create bespoke, high-performance Shopify e-commerce stores designed to optimize checkout conversion and elevate customer experience.",
        "AI Chatbot": "I develop and integrate custom AI assistants, conversational chatbots, and automated workflows to engage your website visitors 24/7.",
        "Other": "Thanks for reaching out! Feel free to describe your project or drop an email via the contact section below, and Hassan will get back to you promptly."
    };

    function formatCurrentTime() {
        const now = new Date();
        return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // Clean text before speech synthesis
    function cleanTextForSpeech(rawText) {
        return rawText
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
            .replace(/https?:\/\/\S+/g, "")
            .replace(/[*#`_~>]/g, "")
            .replace(/^[-*+]\s+/gm, "")
            .replace(
                /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu,
                ""
            )
            .replace(/\s+/g, " ")
            .trim();
    }

    function initChatWidget() {
        const conversationHistory = [
            {
                role: "model",
                text: WELCOME_TEXT
            }
        ];

        let isLoading = false;
        let isSoundEnabled = true;
        let isListening = false;
        let availableVoices = [];
        let recognitionInstance = null;
        let finalTranscript = "";

        // Feature detection
        const SpeechRecClass = window.SpeechRecognition || window.webkitSpeechRecognition;
        const isSpeechRecSupported = Boolean(SpeechRecClass);
        const isSpeechSynthSupported = "speechSynthesis" in window;

        // Load voices
        if (isSpeechSynthSupported) {
            const updateVoices = () => {
                availableVoices = window.speechSynthesis.getVoices() || [];
            };
            updateVoices();
            window.speechSynthesis.onvoiceschanged = updateVoices;
        }

        // Voice picker
        function getBestVoice(textToSpeak) {
            if (!availableVoices || availableVoices.length === 0) return null;

            const hasUrdu = /[\u0600-\u06FF]/.test(textToSpeak);
            if (hasUrdu) {
                const urVoice = availableVoices.find(v => v.lang.toLowerCase().startsWith("ur") || v.name.toLowerCase().includes("urdu"));
                if (urVoice) return urVoice;
            }

            const enVoices = availableVoices.filter(v => v.lang.toLowerCase().startsWith("en"));
            if (enVoices.length === 0) return availableVoices[0] || null;

            const preferred = enVoices.find(v => /(google|natural|neural|enhanced|premium)/i.test(v.name));
            if (preferred) return preferred;

            const regional = enVoices.find(v => /(en-US|en-GB|en_US|en_GB)/i.test(v.lang));
            if (regional) return regional;

            return enVoices[0];
        }

        function cancelSpeech() {
            if (isSpeechSynthSupported) {
                window.speechSynthesis.cancel();
            }
        }

        function speakText(text) {
            if (!isSoundEnabled || !isSpeechSynthSupported) return;

            const cleaned = cleanTextForSpeech(text);
            if (!cleaned) return;

            cancelSpeech();

            const utterance = new SpeechSynthesisUtterance(cleaned);
            utterance.rate = 0.95;
            utterance.pitch = 1.0;

            const voice = getBestVoice(cleaned);
            if (voice) {
                utterance.voice = voice;
            }

            window.speechSynthesis.speak(utterance);
        }

        // Create widget container HTML
        const container = document.createElement("div");
        container.className = "hassan-chat-widget-container";
        container.id = "hassanChatWidget";

        container.innerHTML = `
            <!-- Chat Panel -->
            <div class="hassan-chat-panel" id="hassanChatPanel" role="dialog" aria-label="Hassan's Assistant Chat">
                <!-- Header -->
                <div class="hassan-chat-header">
                    <div class="hassan-chat-header-left">
                        <div class="hassan-chat-avatar-wrap">
                            <div class="hassan-chat-avatar">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/>
                                    <rect x="3" y="8" width="18" height="12" rx="4"/>
                                    <circle cx="9" cy="13" r="1.5" fill="#fff"/>
                                    <circle cx="15" cy="13" r="1.5" fill="#fff"/>
                                    <path d="M9 17h6"/>
                                </svg>
                            </div>
                            <span class="hassan-chat-status-dot"></span>
                        </div>
                        <div class="hassan-chat-title-info">
                            <h4>Hassan's Assistant</h4>
                            <p><span class="dot"></span> Online • Ready to help</p>
                        </div>
                    </div>
                    <div class="hassan-chat-header-actions">
                        <button type="button" class="hassan-chat-header-btn" id="hassanSoundToggle" title="Mute voice replies" aria-label="Sound Toggle">
                            🔊
                        </button>
                        <button type="button" class="hassan-chat-header-btn" id="hassanCloseChatBtn" title="Close Chat" aria-label="Close Chat">
                            ✕
                        </button>
                    </div>
                </div>

                <!-- Messages Area -->
                <div class="hassan-chat-messages" id="hassanChatMessages">
                    <!-- Welcome Bot Message -->
                    <div class="hassan-msg-row bot">
                        <div class="hassan-msg-bot-avatar">AI</div>
                        <div class="hassan-msg-bubble">
                            <p>${WELCOME_TEXT}</p>
                            <span class="hassan-msg-timestamp">${formatCurrentTime()}</span>
                            
                            <!-- Quick Reply Buttons -->
                            <div class="hassan-quick-replies" id="hassanQuickReplies">
                                ${QUICK_REPLIES.map(qr => `<button type="button" class="hassan-quick-reply-btn" data-reply="${qr}">${qr}</button>`).join('')}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Input Area -->
                <div class="hassan-chat-input-area">
                    <div class="hassan-chat-input-wrap">
                        <input type="text" class="hassan-chat-input" id="hassanChatInput" placeholder="Type your message..." autocomplete="off" />
                    </div>
                    <button type="button" class="hassan-chat-mic-btn" id="hassanMicBtn" title="Voice Input (Speak to Hassan's Assistant)" aria-label="Voice Input">
                        🎤
                    </button>
                    <button type="button" class="hassan-chat-send-btn" id="hassanSendBtn" title="Send Message" aria-label="Send Message">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="22" y1="2" x2="11" y2="13"></line>
                            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                        </svg>
                    </button>
                </div>
            </div>

            <!-- Launcher Button -->
            <button type="button" class="hassan-chat-launcher" id="hassanChatLauncher" aria-label="Open Chat">
                <span class="icon-chat">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                </span>
                <span class="icon-close">✕</span>
                <span class="hassan-chat-pulse-badge"></span>
            </button>
        `;

        document.body.appendChild(container);

        // Elements
        const launcher = document.getElementById("hassanChatLauncher");
        const panel = document.getElementById("hassanChatPanel");
        const closeBtn = document.getElementById("hassanCloseChatBtn");
        const soundBtn = document.getElementById("hassanSoundToggle");
        const micBtn = document.getElementById("hassanMicBtn");
        const sendBtn = document.getElementById("hassanSendBtn");
        const input = document.getElementById("hassanChatInput");
        const messagesBox = document.getElementById("hassanChatMessages");

        if (!isSpeechRecSupported) {
            micBtn.style.opacity = "0.3";
            micBtn.style.cursor = "not-allowed";
            micBtn.title = "Voice input is not supported in this browser";
        }

        function scrollToBottom() {
            messagesBox.scrollTop = messagesBox.scrollHeight;
        }

        function toggleChat() {
            const isActive = container.classList.toggle("active");
            if (isActive) {
                setTimeout(() => {
                    if (!isLoading) input.focus();
                    scrollToBottom();
                }, 300);

                // Speak welcome message on user click opening panel
                if (isSoundEnabled) {
                    speakText(WELCOME_TEXT);
                }
            } else {
                cancelSpeech();
                if (isListening && recognitionInstance) {
                    recognitionInstance.abort();
                    setIsListeningState(false);
                }
            }
        }

        launcher.addEventListener("click", toggleChat);
        closeBtn.addEventListener("click", toggleChat);

        soundBtn.addEventListener("click", () => {
            isSoundEnabled = !isSoundEnabled;
            soundBtn.textContent = isSoundEnabled ? "🔊" : "🔇";
            soundBtn.title = isSoundEnabled ? "Mute voice replies" : "Enable voice replies";
            soundBtn.classList.toggle("muted", !isSoundEnabled);
            if (!isSoundEnabled) {
                cancelSpeech();
            }
        });

        function setIsListeningState(listening) {
            isListening = listening;
            if (listening) {
                micBtn.style.color = "#F3500F";
                micBtn.style.backgroundColor = "rgba(243, 80, 15, 0.18)";
                micBtn.style.borderRadius = "50%";
                micBtn.style.boxShadow = "0 0 12px rgba(243, 80, 15, 0.5)";
                input.placeholder = "Listening... speak now";
                input.style.borderColor = "#F3500F";
            } else {
                micBtn.style.color = "#ffffff";
                micBtn.style.backgroundColor = "transparent";
                micBtn.style.boxShadow = "none";
                input.placeholder = "Type your message...";
                input.style.borderColor = "rgba(255, 255, 255, 0.14)";
            }
        }

        micBtn.addEventListener("click", () => {
            if (!isSpeechRecSupported || isLoading) return;

            if (isListening) {
                if (recognitionInstance) {
                    recognitionInstance.stop();
                }
                setIsListeningState(false);
                return;
            }

            cancelSpeech();

            try {
                recognitionInstance = new SpeechRecClass();
                recognitionInstance.lang = "en-US";
                recognitionInstance.interimResults = true;
                recognitionInstance.continuous = false;
                finalTranscript = "";

                recognitionInstance.onstart = () => {
                    setIsListeningState(true);
                };

                recognitionInstance.onresult = (event) => {
                    let text = "";
                    for (let i = event.resultIndex; i < event.results.length; i++) {
                        const item = event.results[i];
                        if (item.isFinal) {
                            finalTranscript = item[0].transcript;
                        }
                        text += item[0].transcript;
                    }
                    input.value = text;
                };

                recognitionInstance.onerror = (event) => {
                    console.warn("[Speech Recognition Error]:", event.error);
                    setIsListeningState(false);

                    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
                        appendMessage("bot", "Microphone access was denied. Please allow microphone permissions in your browser to use voice input.");
                    }
                };

                recognitionInstance.onend = () => {
                    setIsListeningState(false);
                    const textToSend = finalTranscript.trim();
                    if (textToSend) {
                        handleSend(textToSend);
                    }
                };

                recognitionInstance.start();
            } catch (err) {
                console.error("[Speech Recognition Start Error]:", err);
                setIsListeningState(false);
            }
        });

        function appendMessage(sender, text) {
            const row = document.createElement("div");
            row.className = `hassan-msg-row ${sender}`;

            if (sender === "bot") {
                row.innerHTML = `
                    <div class="hassan-msg-bot-avatar">AI</div>
                    <div class="hassan-msg-bubble">
                        <p>${escapeHTML(text)}</p>
                        <span class="hassan-msg-timestamp">${formatCurrentTime()}</span>
                    </div>
                `;
            } else {
                row.innerHTML = `
                    <div class="hassan-msg-bubble">
                        <p>${escapeHTML(text)}</p>
                        <span class="hassan-msg-timestamp">${formatCurrentTime()}</span>
                    </div>
                `;
            }

            messagesBox.appendChild(row);
            scrollToBottom();
        }

        function showTypingIndicator() {
            const typingRow = document.createElement("div");
            typingRow.className = "hassan-msg-row bot";
            typingRow.id = "hassanTypingIndicator";
            typingRow.innerHTML = `
                <div class="hassan-msg-bot-avatar">AI</div>
                <div class="hassan-msg-bubble">
                    <div class="hassan-typing-indicator">
                        <span class="hassan-typing-dot"></span>
                        <span class="hassan-typing-dot"></span>
                        <span class="hassan-typing-dot"></span>
                    </div>
                </div>
            `;
            messagesBox.appendChild(typingRow);
            scrollToBottom();
            return typingRow;
        }

        function removeTypingIndicator() {
            const typingRow = document.getElementById("hassanTypingIndicator");
            if (typingRow) {
                typingRow.remove();
            }
        }

        async function handleSend(userText) {
            const text = (userText || input.value).trim();
            if (!text || isLoading) return;

            cancelSpeech();
            if (isListening && recognitionInstance) {
                recognitionInstance.stop();
                setIsListeningState(false);
            }

            appendMessage("user", text);
            conversationHistory.push({ role: "user", text });

            // Always clear input field and reset final transcript immediately
            input.value = "";
            finalTranscript = "";

            isLoading = true;
            input.disabled = true;
            sendBtn.disabled = true;
            input.placeholder = "Hassan's Assistant is typing...";

            showTypingIndicator();

            try {
                const response = await fetch("/api/chat", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        messages: conversationHistory
                    })
                });

                const data = await response.json();
                removeTypingIndicator();

                let botReply = data?.reply;
                if (!response.ok || !botReply) {
                    botReply = FALLBACK_RESPONSES[text] || data?.reply || "Sorry, something went wrong. Please try again.";
                }

                appendMessage("bot", botReply);
                conversationHistory.push({ role: "model", text: botReply });

                // Speak bot reply
                speakText(botReply);
            } catch (error) {
                console.error("[ChatWidget] Error calling /api/chat:", error);
                removeTypingIndicator();
                const fallback = FALLBACK_RESPONSES[text] || "Sorry, something went wrong. Please try again.";
                appendMessage("bot", fallback);
                conversationHistory.push({ role: "model", text: fallback });
                speakText(fallback);
            } finally {
                isLoading = false;
                input.disabled = false;
                sendBtn.disabled = false;
                input.placeholder = "Type your message...";
                input.focus();
            }
        }

        // Quick replies event delegation
        messagesBox.addEventListener("click", (e) => {
            const qrBtn = e.target.closest(".hassan-quick-reply-btn");
            if (qrBtn && !isLoading) {
                const text = qrBtn.getAttribute("data-reply");
                handleSend(text);
            }
        });

        sendBtn.addEventListener("click", () => handleSend());

        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !isLoading) {
                e.preventDefault();
                handleSend();
            }
        });

        function escapeHTML(str) {
            const div = document.createElement("div");
            div.textContent = str;
            return div.innerHTML;
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initChatWidget);
    } else {
        initChatWidget();
    }
})();
