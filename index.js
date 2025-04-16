#!/usr/bin/env node

// Load environment variables
require('dotenv').config();

const readline = require('readline');
const { query } = require('./src/query.js');
const { createUserMessage, createAssistantMessage } = require('./src/utils/messages.js');

/**
 * Displays the welcome screen.
 */
function showWelcomeScreen() {
    console.log('\n=======================================================');
    console.log('          🤖 Minimal Agentic System 🤖');
    console.log('=======================================================\n');
    console.log('Welcome! This system enables Claude to read files,');
    console.log('search directories and more.\n');
    console.log('Enter your questions or "exit" to quit.\n');
    console.log('=======================================================\n');
}

/**
 * Creates a readline interface for console input.
 * @returns {readline.Interface} - The readline interface.
 */
function createReadlineInterface() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: '> ',
        terminal: true,
    });
}

/**
 * Starts the main program loop.
 */
async function main() {
    showWelcomeScreen();

    // Create a readline interface
    const rl = createReadlineInterface();

    // Manage conversation history
    const messages = [];

    // System instruction for Claude
    const systemPrompt = `You are a helpful assistant with access to tools.
When you receive a request that requires access to files or directories,
use the tools available to you instead of saying you don't have access.
Always use the appropriate tools for each task and explain your actions.`;

    // Abort signal for lengthy requests
    let controller = new AbortController();
    let signal = controller.signal;
    let isAwaitingUserInput = true;

    // Main program loop
    rl.prompt();
    rl.on('line', async (line) => {
        if (!isAwaitingUserInput) {
            console.log("\n[INFO] Please wait until the current request is completed.");
            return;
        }

        const userInput = line.trim();

        if (userInput.toLowerCase() === 'exit') {
            console.log('Goodbye! 👋');
            rl.close();
            process.exit(0);
            return;
        }

        if (userInput.toLowerCase() === 'stop') {
            console.log('Aborting current request...');
            controller.abort();
            controller = new AbortController();
            signal = controller.signal;
            isAwaitingUserInput = true;
            rl.resume();
            rl.prompt();
            return;
        }

        try {
            // Add user message to history
            const userMessage = createUserMessage(userInput);
            messages.push(userMessage);

            // Generate response
            let assistantMessageContent = '';
            let lastEventType = '';
            let currentError = null;
            let finalContentProcessed = false;
            isAwaitingUserInput = false;

            // Execute the request
            for await (const event of query(messages, systemPrompt, signal)) {
                switch (event.type) {
                    case 'status':
                        // Show status updates
                        console.log(`\n[${event.message}]`);
                        
                        // If the status includes "Ignore further tool requests", 
                        // set formatting to make it more noticeable
                        if (event.message.includes('Further tool requests detected')) {
                            console.log('\n----------------------------------------');
                            console.log('⚠️  NOTE: Claude is attempting to use tools again.');
                            console.log('    These tool calls will be processed to complete the request.');
                            console.log('----------------------------------------\n');
                        }
                        break;

                    case 'content_block_delta':
                        // Output text response in real-time
                        if (event.data?.delta?.type === 'text_delta') {
                            const text = event.data.delta.text;
                            assistantMessageContent += text;
                            process.stdout.write(text);
                            lastEventType = 'text';
                        }
                        break;

                    case 'tool_executing':
                        if (lastEventType === 'text') {
                            console.log('\n'); // Add a blank line when switching from text to tool
                        }
                        console.log(`\n[Tool being used] ${event.displayText}`);
                        lastEventType = 'tool';
                        break;

                    case 'tool_result':
                        console.log(`\n[Tool result] ${event.displayText}`);
                        lastEventType = 'tool_result';
                        break;

                    case 'error':
                        console.error(`\n❌ Error: ${event.error.message || event.error}`);
                        break;
                        
                    case 'final_assistant_response':
                        // This special event type contains Claude's final text response after tool execution
                        // We save it directly so it's not overwritten by a new tool call
                        if (event.content) {
                            assistantMessageContent = event.content;
                            process.stdout.write('\n' + event.content); // Output the response directly
                            lastEventType = 'text';
                        }
                        break;

                    case 'awaiting_permissions':
                        console.log("[DEBUG] Pausing readline due to awaiting_permissions.");
                        rl.pause();
                        break;
                    case 'permissions_resolved':
                        console.log("[DEBUG] Resuming readline due to permissions_resolved.");
                        rl.resume();
                        break;
                    case 'turn_complete':
                        console.log("[DEBUG] Resuming readline and enabling input due to turn_complete.");
                        rl.resume();
                        if (!currentError && assistantMessageContent.trim() && !finalContentProcessed) {
                            const assistantMessage = createAssistantMessage(assistantMessageContent);
                            messages.push(assistantMessage);
                            finalContentProcessed = true;
                            console.log("[DEBUG] Assistant message added to history (turn_complete fallback).");
                        }
                        isAwaitingUserInput = true;
                        rl.prompt();
                        break;
                }
            }

            if (currentError && !controller.signal.aborted) {
                console.log("\n[Round ended due to stream error]");
                rl.resume();
                rl.prompt();
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('\n[Request aborted by user]');
            } else {
                console.error(`\n❌ External error: ${error.message}`);
                console.error(error.stack);
                rl.resume();
                isAwaitingUserInput = true;
                rl.prompt();
            }
        }
    });

    // Handle SIGINT (Ctrl+C)
    rl.on('SIGINT', () => {
        console.log('\nGoodbye! 👋');
        rl.close();
        process.exit(0);
    });

    // Handle errors
    rl.on('error', (err) => {
        console.error(`\n❌ Fatal error: ${err.message}`);
        rl.close();
        process.exit(1);
    });
}

// Start the program
main().catch(err => {
    console.error(`\n❌ Unhandled error: ${err.message}`);
    process.exit(1);
});
