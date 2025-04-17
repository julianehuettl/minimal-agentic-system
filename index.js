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
        terminal: true,  // Enable terminal mode for proper input handling
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
Always use the appropriate tools for each task and explain your actions.
After successfully executing a tool, especially one that modifies files like 'editFile',
provide a brief confirmation message and wait for the next user prompt.
Avoid further actions or explanations unless specifically asked.`;

    // Abort signal for lengthy requests
    let controller = new AbortController();
    let signal = controller.signal;
    let isAwaitingUserInput = true;

    // Main program loop
    rl.prompt();
    
    // Handle user input
    const handleUserInput = async (line) => {
        // console.log('[DEBUG] handleUserInput entered'); // Removed Debug
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
            // console.log('[DEBUG] isAwaitingUserInput set to false'); // Removed Debug

            // Execute the request
            for await (const event of query(messages, systemPrompt, signal)) {
                switch (event.type) {
                    case 'status':
                        // Show status updates, but filter out the generic "Sending request..."
                        if (event.message !== 'Sending request to Claude...') {
                            console.log(`\n[${event.message}]`);
                        }
                        
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
                        // Output text response in real-time ONLY
                        if (event.data?.delta?.type === 'text_delta') {
                            const text = event.data.delta.text;
                            // Only write to stdout, do not accumulate here
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
                        // Store the error to check in turn_complete
                        currentError = event.error; 
                        break;
                        
                    case 'final_assistant_response':
                        // This event contains the complete final text response.
                        // Output it, store it, and mark it as processed.
                        if (event.content) {
                            assistantMessageContent = event.content; // Store the final content
                            process.stdout.write('\n' + event.content); // Output the final content
                            finalContentProcessed = true; // Mark as processed
                            lastEventType = 'text';
                        }
                        break;

                    case 'awaiting_permissions':
                        rl.pause();
                        break;
                    case 'permissions_resolved':
                        rl.resume();
                        break;
                    case 'turn_complete':
                        // Resume readline (might be paused due to permissions)
                        rl.resume(); 
                        
                        // Add message to history ONLY if it wasn't processed via final_assistant_response
                        if (!currentError && assistantMessageContent.trim() && !finalContentProcessed) {
                            // This case handles responses that didn't trigger 'final_assistant_response'
                            // or if 'final_assistant_response' somehow didn't have content (unlikely).
                            // We still need to create the message object.
                            const assistantMessage = createAssistantMessage(assistantMessageContent);
                            messages.push(assistantMessage);
                            // No need to set finalContentProcessed=true here, as it's already false
                        }
                        
                        // Reset state for next turn
                        assistantMessageContent = ''; // Reset for next round
                        currentError = null;
                        finalContentProcessed = false; // Reset for next round
                        isAwaitingUserInput = true;
                        rl.prompt();
                        break;
                }
            }

            if (currentError && !controller.signal.aborted) {
                console.log("\n[Round ended due to stream error]");
                rl.resume();
                isAwaitingUserInput = true;
                rl.prompt();
            }
            
            // Ensure we prompt again even if something unexpected happens
            if (!isAwaitingUserInput) {

                isAwaitingUserInput = true;
                rl.resume();
                rl.prompt();
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('\n[Request aborted by user]');
            } else {
                console.error(`\n❌ External error: ${error.message}`);
                console.error(error.stack);
            }
            
            rl.resume();
            isAwaitingUserInput = true;
            rl.prompt();
        }
    };

    // Register the line handler without letting it terminate the main function
    rl.on('line', handleUserInput);

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
    
    // Keep the main function alive indefinitely with a never-resolving Promise
    await new Promise(() => { /* This Promise never resolves */ });
}

// Start the program
main().catch(err => {
    console.error(`\n❌ Unhandled error: ${err.message}`);
    process.exit(1);
});
