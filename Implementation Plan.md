# Implementation Plan: Minimal Agentic System in Vanilla JavaScript

## Overview

We'll create a minimal terminal-based AI agent system that can:
1. Process user requests
2. Execute simple tools based on AI instructions
3. Stream responses in real-time
4. Maintain a conversation history
5. Implement basic permission controls

The system will use the Claude API for intelligence but will be designed with minimal dependencies and vanilla JavaScript for accessibility.

## Architecture

### Core Components

1. **Terminal UI**: Simple command-line interface using Node.js
2. **Intelligence Layer**: Integration with Claude API
3. **Tool System**: A lightweight framework for defining and executing tools
4. **Reactive Command Loop**: Handles the flow of messages and tool executions

### System Flow

1. User inputs a request
2. Request is sent to Claude API with available tools
3. Claude responds with text and/or tool use requests
4. System executes tools when requested and sends results back to Claude
5. Process continues until response is complete
6. Results stream to the user in real-time

## Implementation Steps

### 1. Project Setup

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
│   └── config.js      # Configuration (API keys, etc.)
└── package.json
```

### 2. Core Functionality Implementation

#### 2.1. Intelligence Layer (services/claude.js)

- Create a function to send requests to the Claude API
- Implement streaming response handling using fetch's streaming capability
- Parse Claude's responses to extract tool use requests
- Create a basic error handling system for API issues

Example implementation approach:
```javascript
// We'll use the fetch API for streaming responses
async function* queryClaude(messages, tools, abortSignal) {
  // Set up request to Claude API with messages and tools
  // Use streaming fetch to get responses piece by piece
  // Parse and yield each chunk as it arrives
  // Detect tool use requests in the stream
}
```

#### 2.2. Tool System (tools.js)

Create a simple framework for defining tools with:
- Name and description
- Input schema (can be simple objects for validation)
- isReadOnly flag to determine if it can modify state
- Permission requirements
- Execution function

Example tool definition approach:
```javascript
// Define a base tool structure
const ViewFileTool = {
  name: "viewFile",
  description: "Reads the content of a file",
  isReadOnly: () => true,
  needsPermissions: (params) => true,  // Simple version always requires permission
  async call({ filePath }) {
    // Implementation to read a file
  }
};
```

Create a few basic tools:
- View: Read file contents
- List: Show directory contents
- Edit: Modify file contents
- Execute: Run shell commands

#### 2.3. Async Generator System (utils/generators.js)

Implement utility functions for handling async generators:
- A function to run generators in parallel for read-only tools
- A function to run generators sequentially for write operations
- A function to merge multiple generator outputs

This is a critical part of the architecture for performance:
```javascript
// Core utility to run multiple async generators in parallel
async function* runConcurrently(generators, maxConcurrency = 5) {
  // Track active generators
  // Use Promise.race to get results as they complete
  // Yield results with their generator index
  // Start new generators as others complete
}
```

#### 2.4. Query System (query.js)

Implement the core query function that:
- Takes user input
- Formats messages for Claude
- Calls the Claude API
- Handles tool executions
- Returns results

This should be an async generator function:
```javascript
async function* query(messages, tools, signal) {
  // Format messages for Claude API
  // Start streaming response from Claude
  // When tool use is detected, execute the tool
  // Feed tool results back to Claude
  // Continue the conversation
}
```

#### 2.5. Permission System (utils/permissions.js)

Implement a simple permission system:
- Functions to check if a tool has permission to run
- Functions to request permission from the user
- Storage for approved permissions

```javascript
function hasPermission(toolName, params) {
  // Check if tool has been approved before
  // Return true/false
}

function requestPermission(toolName, params) {
  // Ask user for permission via console
  // Return user's decision
}
```

#### 2.6. Message Handling (utils/messages.js)

Create utilities for:
- Formatting messages for display
- Normalizing messages for the API
- Managing conversation history

```javascript
function createUserMessage(content) {
  // Format a user message
}

function createAssistantMessage(content) {
  // Format an assistant message
}

function formatToolUse(toolUse) {
  // Format tool use for display
}
```

### 3. Main Application (index.js)

Create the main application that:
- Initializes the system
- Sets up the command prompt
- Processes user input
- Handles the query and response flow
- Manages conversation state

```javascript
async function main() {
  // Initialize system
  // Set up readline interface
  // Process user input
  // Handle query function
  // Display results to user
}
```

### 4. Tool Execution Logic

Create the core tool execution system:

```javascript
async function* executeTools(toolUses, context) {
  // Check if all tools are read-only
  const allReadOnly = toolUses.every(toolUse => {
    const tool = findToolByName(toolUse.name);
    return tool && tool.isReadOnly();
  });

  // Choose execution strategy based on tool types
  if (allReadOnly) {
    // Run read-only tools in parallel
    yield* runToolsConcurrently(toolUses, context);
  } else {
    // Run state-modifying tools sequentially
    yield* runToolsSequentially(toolUses, context);
  }
}
```

## Implementation Guide for Junior Developer

### 1. Start with Basic Structure

Begin by setting up the project structure and installing minimal dependencies:
- Node.js for running the application
- readline for terminal input
- node-fetch for API calls

### 2. Implement in This Order:

1. **Basic message formatting utilities** (messages.js)
   - Focus on simple functions to create and format messages

2. **Claude API integration** (claude.js)
   - Start with a non-streaming version to test connectivity
   - Then implement streaming response handling

3. **Simple tools** (tools.js)
   - Implement basic read-only tools first (View, List)
   - Test them independently before integration

4. **Permission system** (permissions.js)
   - Start with a console-based permission prompt
   - Implement simple storage for approved permissions

5. **Generator utilities** (generators.js)
   - Start with sequential execution
   - Then implement parallel execution for read-only tools

6. **Query function** (query.js)
   - Begin with a simple version that handles text responses
   - Add tool execution handling
   - Implement streaming responses

7. **Main application loop** (index.js)
   - Create the command-line interface
   - Implement the conversation flow

### 3. Testing Strategy

1. Test each component in isolation:
   - Test Claude API connection with simple prompts
   - Test tools by calling them directly
   - Test permission system with mock user inputs

2. Test integration points:
   - Test Claude with tool definitions
   - Test tools with permission system
   - Test query function with mocked Claude responses

3. End-to-end testing:
   - Test complete conversation flows
   - Test tool execution and results
   - Test error handling

### 4. Performance Considerations

1. Start with sequential execution for simplicity
2. Add parallel execution for read-only tools once basic functionality works
3. Implement proper stream handling for real-time responses
4. Add proper error handling and recovery

### 5. Simplifications for Minimal Version

1. Use console-based UI instead of rich terminal UI
2. Skip complex authentication, use API key directly
3. Use simple file-based storage for permissions and history
4. Implement a minimal set of tools (3-4 key tools)
5. Use basic validation instead of complex schemas
6. Focus on happy paths first, then add error handling

## Key Technical Challenges to Address

1. **Streaming Responses**: Handling incremental results from Claude API
2. **Async Generator Management**: Properly implementing and combining async generators
3. **Permission Management**: Creating a simple but effective permission system
4. **Tool Execution**: Safely handling tool executions with proper error handling
5. **State Management**: Maintaining conversation history and approved permissions

This implementation plan provides a structured approach to building a minimal agentic system with vanilla JavaScript. It focuses on the core architectural patterns described in the document while simplifying the implementation to make it accessible for a junior developer.