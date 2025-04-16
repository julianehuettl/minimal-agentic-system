// TODO: Enter your Claude API key here
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || 'YOUR_API_KEY';

// TODO: Adjust the Claude API URL if needed
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

const CLAUDE_API_VERSION = '2023-06-01';

// Maximum number of tokens to be generated in the response
const MAX_TOKENS = 4096;

// The Claude model to use
const CLAUDE_MODEL = 'claude-3-5-sonnet-20240620'; // Or another available model

module.exports = {
    CLAUDE_API_KEY,
    CLAUDE_API_URL,
    CLAUDE_API_VERSION,
    MAX_TOKENS,
    CLAUDE_MODEL,
};
