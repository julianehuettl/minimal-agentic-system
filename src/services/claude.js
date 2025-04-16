const {
    CLAUDE_API_KEY,
    CLAUDE_API_URL,
    CLAUDE_API_VERSION,
    MAX_TOKENS,
    CLAUDE_MODEL
} = require('../config');

/**
 * Sendet eine Anfrage an die Claude API und gibt die Antwort als Async-Generator zurück.
 * @param {Array<object>} messages - Der Konversationsverlauf.
 * @param {Array<object>|null} tools - Die verfügbaren Werkzeuge.
 * @param {string|null} systemPrompt - Der Systemprompt.
 * @param {AbortSignal|null} abortSignal - Ein Signal zum Abbrechen der Anfrage.
 * @yields {object} - Chunks der API-Antwort (SSE-Events).
 */
async function* queryClaude(messages, tools = null, systemPrompt = null, abortSignal = null) {
    if (!CLAUDE_API_KEY || CLAUDE_API_KEY === 'YOUR_API_KEY') {
        throw new Error("Claude API Schlüssel nicht konfiguriert. Bitte setzen Sie ihn in src/config.js oder als Umgebungsvariable CLAUDE_API_KEY.");
    }

    const requestBody = {
        model: CLAUDE_MODEL,
        messages: messages,
        max_tokens: MAX_TOKENS,
        stream: true,
    };

    if (tools && tools.length > 0) {
        requestBody.tools = tools.map(tool => ({
            type: "custom",
            name: tool.name,
            description: tool.description,
            input_schema: tool.input_schema,
        }));
    }
    if (systemPrompt) {
        requestBody.system = systemPrompt;
    }

    try {
        const response = await globalThis.fetch(CLAUDE_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': CLAUDE_API_KEY,
                'anthropic-version': CLAUDE_API_VERSION,
            },
            body: JSON.stringify(requestBody),
            signal: abortSignal,
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Claude API Fehler: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        // Verarbeite den Stream von Server-Sent Events (SSE)
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }

            buffer += decoder.decode(value, { stream: true });

            // Verarbeite vollständige SSE-Nachrichten im Puffer
            let boundary = buffer.indexOf('\n\n');
            while (boundary !== -1) {
                const message = buffer.substring(0, boundary);
                buffer = buffer.substring(boundary + 2);

                if (message.startsWith('event:')) {
                    const lines = message.split('\n');
                    const eventType = lines[0].substring('event: '.length).trim();
                    const dataLine = lines.find(line => line.startsWith('data:'));

                    if (dataLine) {
                        const data = dataLine.substring('data: '.length).trim();
                        try {
                            const parsedData = JSON.parse(data);
                            yield { type: eventType, data: parsedData };
                        } catch (e) {
                            console.error('Fehler beim Parsen der SSE-Daten:', data, e);
                            // Ignoriere fehlerhafte JSON-Daten und fahre fort
                        }
                    }
                }
                boundary = buffer.indexOf('\n\n');
            }
        }

        // Verarbeite verbleibende Daten im Puffer (sollte bei korrekten SSEs nicht vorkommen)
        if (buffer.trim()) {
             console.warn('Verbleibende Daten im SSE-Puffer:', buffer);
             // Optional: Versuche, die verbleibenden Daten zu parsen, wenn erwartet
        }

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Claude API Anfrage abgebrochen.');
            // Beende den Generator leise
            return;
        } else {
            console.error("Fehler bei der Claude API Anfrage:", error);
            // Werfe den Fehler weiter oder handle ihn spezifisch
            throw error;
        }
    }
}

module.exports = { queryClaude };
