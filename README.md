# My First Agent - Minimal Agentic System

A terminal-based AI agent system built with Node.js that enables Claude to interact with your local filesystem.

## Overview

This minimal agentic system allows Claude to:
- Read files from your local workspace
- List directory contents
- Edit and create files
- Respond to your questions with context from your files

The system uses the Claude API for intelligence and provides a simple command-line interface for interaction.

## Features

- **Terminal-based interface**: Simple and lightweight command-line experience
- **Real-time streaming**: See Claude's responses as they are generated
- **File system interaction**: Let Claude read and write files in your workspace
- **Conversation history**: Maintains context throughout your session
- **Permission system**: Asks for your consent before reading or modifying files

## Requirements

- Node.js (v14 or higher)
- Claude API key (Claude 3.5 Sonnet model recommended)

## Available Tools

- `viewFile` - Reads the content of a file in the workspace
    - `filePath` (string, required): The relative path to the file in the workspace
    
- `listDirectory` - Lists the contents of a directory in the workspace
    - `dirPath` (string, required): The relative path to the directory in the workspace. './' for the root directory
    
- `editFile` - Edits a file in the workspace or creates a new one
    - `filePath` (string, required): The relative path to the file in the workspace
    - `content` (string, required): The new content to be written to the file

## Installation

1. Clone this repository or download the files
2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file in the root directory with your Claude API key:
```
CLAUDE_API_KEY=your_api_key_here
```

## Configuration

### API Key Setup

1. Obtain a Claude API key from Anthropic
2. Add your key to the `.env` file:
   ```
   CLAUDE_API_KEY=your_api_key_here
   ```

3. Alternatively, you can modify the `src/config.js` file directly (not recommended)

### Advanced Configuration

You can modify additional settings in `src/config.js`:
- Change the Claude model
- Adjust token limits
- Configure other API parameters

## Usage

Start the agent:
```bash
npm start
```

Ask questions or give instructions in natural language. For example:
- "List all files in the current directory"
- "Read the content of index.js and explain what it does"
- "Create a new file called hello.txt with 'Hello World' as content"

Type `exit` to quit the application.
Type `stop` to cancel the current request.

## Project Structure

```
project/
├── index.js          # Main entry point
├── src/
│   ├── query.js      # Core query logic
│   ├── tools.js      # Tool definitions
│   ├── services/
│   │   └── claude.js  # API integration
│   ├── utils/
│   │   ├── messages.js   # Message handling
│   │   ├── permissions.js # Permission controls
│   │   └── generators.js  # Async generator utilities
│   └── config.js      # Configuration
└── package.json
```

## Limitations

- The agent can only access files within the project directory
- API usage is subject to Claude's rate limits and token quotas
- The agent requires explicit permission for file operations

## License

My First Agent is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Author

Juliane Hüttl
- GitHub: [julianehuettl](https://github.com/julianehuettl)
- Website: [juliane-huettl.de](https://juliane-huettl.de)

## Acknowledgments

This minimal agentic system is designed for educational purposes to demonstrate how to build a simple AI agent with local filesystem access capabilities. 