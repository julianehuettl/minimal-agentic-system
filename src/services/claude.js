const {
    CLAUDE_API_KEY,
    CLAUDE_API_URL,
    CLAUDE_API_VERSION,
    MAX_TOKENS,
    CLAUDE_MODEL
} = require('../config');

/**
 * Sends a request to the Claude API and returns the response as an Async-Generator.
 * @param {Array<object>} messages - The conversation history.
 * @param {Array<object>|null} tools - The available tools.
 * @param {string|null} systemPrompt - The system prompt.
 * @param {AbortSignal|null} abortSignal - A signal to abort the request.
 * @yields {object} - Chunks of the API response (SSE events).
 */
async function* queryClaude(messages, tools = null, systemPrompt = null, abortSignal = null) {
    if (!CLAUDE_API_KEY || CLAUDE_API_KEY === 'YOUR_API_KEY') {
        throw new Error("Claude API key not configured. Please set it in src/config.js or as environment variable CLAUDE_API_KEY.");
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
            throw new Error(`Claude API error: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        // Process the stream of Server-Sent Events (SSE)
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }

            buffer += decoder.decode(value, { stream: true });

            // Process complete SSE messages in the buffer
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
                            console.error('Error parsing SSE data:', data, e);
                            // Ignore faulty JSON data and continue
                        }
                    }
                }
                boundary = buffer.indexOf('\n\n');
            }
        }

        // Process remaining data in the buffer (should not occur with correct SSEs)
        if (buffer.trim()) {
             console.warn('Remaining data in SSE buffer:', buffer);
             // Optional: Try to parse the remaining data if expected
        }

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Claude API request aborted.');
            // Silently terminate the generator
            return;
        } else {
            console.error("Error in Claude API request:", error);
            // Throw the error further or handle it specifically
            throw error;
        }
    }
}

module.exports = { queryClaude };
