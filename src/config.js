// TODO: Fügen Sie hier Ihren Claude-API-Schlüssel ein
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || 'YOUR_API_KEY';

// TODO: Passen Sie die Claude-API-URL bei Bedarf an
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

const CLAUDE_API_VERSION = '2023-06-01';

// Maximale Anzahl von Tokens, die in der Antwort generiert werden sollen
const MAX_TOKENS = 4096;

// Das zu verwendende Claude-Modell
const CLAUDE_MODEL = 'claude-3-5-sonnet-20240620'; // Oder ein anderes verfügbares Modell

module.exports = {
    CLAUDE_API_KEY,
    CLAUDE_API_URL,
    CLAUDE_API_VERSION,
    MAX_TOKENS,
    CLAUDE_MODEL,
};
