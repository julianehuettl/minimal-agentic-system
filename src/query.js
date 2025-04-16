const { queryClaude } = require('./services/claude.js');
const { findToolByName, getToolSchemas } = require('./tools.js');
const { requestPermission } = require('./utils/permissions.js');
const { executeTasksOptimally } = require('./utils/generators.js');
const {
    createToolResultMessage,
    formatToolUseForDisplay,
    formatToolResultForDisplay,
    createToolSignature
} = require('./utils/messages.js');

// Global tool execution tracker
const toolExecutionTracker = {
    executionCount: 0,
    recursionDepth: 0,
    toolIds: new Set(),
    toolSignatures: new Set(), // For content-similar tool calls
    timeWindowedSignatures: new Map(), // Store timestamps for signatures
    contentBlockIds: new Set(), // Store already processed content block IDs

    // Helper function to check if a tool has already been executed
    isDuplicate(toolUse) {
        if (!toolUse || !toolUse.id || !toolUse.name) return false;

        // Check for exact ID duplicates
        if (this.toolIds.has(toolUse.id)) {
            console.log(`[TRACKER] Tool with ID ${toolUse.id} already executed`);
            return true;
        }

        // Check for content duplicates (same name and parameters)
        const signature = createToolSignature(toolUse.name, toolUse.input);
        if (this.toolSignatures.has(signature)) {
            console.log(`[TRACKER] Tool with signature ${signature} already executed`);
            return true;
        }

        return false;
    },

    // Time window based duplicate detection
    isDuplicateWithTimeWindow(toolUse, windowMs = 60000) {
        if (!toolUse || !toolUse.name) return false;

        const now = Date.now();
        const signature = createToolSignature(toolUse.name, toolUse.input);

        if (this.timeWindowedSignatures.has(signature)) {
            const lastTime = this.timeWindowedSignatures.get(signature);
            if (now - lastTime < windowMs) {
                console.log(`[TRACKER] Tool with signature ${signature} was executed in the last ${windowMs/1000} seconds`);
                return true;
            }
        }

        // Update the timestamp
        this.timeWindowedSignatures.set(signature, now);
        return false;
    },

    // Helper function to register a new tool as executed
    trackExecution(toolUse) {
        if (!toolUse || !toolUse.id || !toolUse.name) return;

        this.executionCount++;
        this.toolIds.add(toolUse.id);

        const signature = createToolSignature(toolUse.name, toolUse.input);
        this.toolSignatures.add(signature);

        // Also update the timestamp
        this.timeWindowedSignatures.set(signature, Date.now());

        console.log(`[TRACKER] Tool ${toolUse.name} (ID: ${toolUse.id}) registered. Execution #${this.executionCount}`);
    },

    // Increase counter for recursion depth
    incrementRecursionDepth() {
        this.recursionDepth++;
        console.log(`[TRACKER] Recursion depth increased to ${this.recursionDepth}`);
        return this.recursionDepth;
    },

    // Reset counter for recursion depth (at the end of the call)
    decrementRecursionDepth() {
        if (this.recursionDepth > 0) this.recursionDepth--;
        console.log(`[TRACKER] Recursion depth decreased to ${this.recursionDepth}`);
        return this.recursionDepth;
    },

    // Log all executed tools
    logAllTrackedTools() {
        console.log(`[TRACKER] Tools tracked so far (${this.executionCount}):`);
        console.log(`[TRACKER] Tool IDs: ${Array.from(this.toolIds).join(', ')}`);
        console.log(`[TRACKER] Tool signatures: ${Array.from(this.toolSignatures).join(', ')}`);
    },

    // Helper function to check if a content block has already been processed
    isDuplicateContentBlock(contentBlockId) {
        if (!contentBlockId) return false;

        if (this.contentBlockIds.has(contentBlockId)) {
            console.log(`[TRACKER] Content block with ID ${contentBlockId} has already been processed`);
            return true;
        }

        this.contentBlockIds.add(contentBlockId);
        return false;
    },
     // Cleans tracker for a new top-level call
     resetForNewQuery() {
         this.executionCount = 0;
         this.recursionDepth = 0;
         this.toolIds.clear();
         this.toolSignatures.clear();
         // timeWindowedSignatures not necessarily cleared, can be useful across queries
         this.contentBlockIds.clear();
         console.log("[TRACKER] Tracker reset for new query.");
     }
};

/**
 * The main query generator that processes a conversation with Claude,
 * executes tools and returns the results.
 *
 * @param {Array} messages - The conversation history as an array of message objects.
 * @param {string} systemPrompt - An optional system prompt for Claude.
 * @param {AbortSignal} abortSignal - A signal to abort the request.
 * @param {readline.Interface} mainRl - The main readline instance from index.js.
 * @yields {object} - Generates various event objects during processing.
 */
async function* query(messages, systemPrompt = null, abortSignal = null, mainRl = null) {
    // Only reset tracker if it's the first call (recursion depth 0)
     if (toolExecutionTracker.recursionDepth === 0) {
         toolExecutionTracker.resetForNewQuery();
     }

    const currentRecursionDepth = toolExecutionTracker.incrementRecursionDepth();
    // Termination condition for recursion depth
     const MAX_RECURSION_DEPTH = 5; // Maximum allowed recursion depth
     if (currentRecursionDepth > MAX_RECURSION_DEPTH) {
         console.error(`❌ Maximum recursion depth (${MAX_RECURSION_DEPTH}) reached. Aborting.`);
         yield { type: 'error', error: new Error(`Maximum recursion depth (${MAX_RECURSION_DEPTH}) reached.`) };
         toolExecutionTracker.decrementRecursionDepth();
         return; // End the generator here
     }

    try {
        // Get tool definitions
        const toolDefinitions = getToolSchemas();

        // Debugging information
        console.log(`[DEBUG] query called with ${messages.length} messages, recursion depth: ${currentRecursionDepth}`);
        // toolExecutionTracker.logAllTrackedTools();

        // Send request to Claude
        yield { type: 'status', message: 'Sending request to Claude...' };
        const claudeStream = queryClaude(messages, toolDefinitions, systemPrompt, abortSignal);

        // Process Claude's response
        let toolUseRequests = []; // Collects valid tool requests
        let assistantResponseText = ''; // Collects text responses
        let currentToolInputJson = ''; // Collects JSON input for the current tool
        let currentToolUseId = null; // ID of current tool block
        let finalAssistantMessageStructure = null; // Stores the structure of the final message

        let skippingDuplicateTool = false; // Flag to control duplicate processing

        for await (const event of claudeStream) {
             // Global error handling first
             if (event.type === 'error') {
                 console.error(`[STREAM ERROR] ${event.error?.message || 'Unknown stream error'}`);
                 yield event; // Pass error along
                 continue; // Next event
             }

            // Prevent double processing of the same content block
            if (event.type === 'content_block_start' && event.data.content_block?.id) {
                const blockId = event.data.content_block.id;
                if (toolExecutionTracker.contentBlockIds.has(blockId)) {
                    console.log(`[DEBUG] Skipping already processed content block: ${blockId}`);
                    continue;
                }
                toolExecutionTracker.contentBlockIds.add(blockId);
            }

            switch (event.type) {
                case 'message_start':
                     assistantResponseText = ''; // Reset for new message
                     toolUseRequests = []; // Reset for new message
                     finalAssistantMessageStructure = null;
                     break;

                case 'content_block_start':
                    if (event.data.content_block?.type === 'tool_use') {
                        const toolUse = {
                            id: event.data.content_block.id,
                            name: event.data.content_block.name,
                            input: event.data.content_block.input || {}
                        };
                        currentToolUseId = toolUse.id;
                        currentToolInputJson = ''; // Reset JSON buffer
                        skippingDuplicateTool = false; // Reset flag

                         // Check for duplicate (ID or signature in time window)
                         if (toolExecutionTracker.isDuplicate(toolUse) || toolExecutionTracker.isDuplicateWithTimeWindow(toolUse)) {
                             console.warn(`⚠️ Skipping duplicate tool request: ${toolUse.name} with ID ${toolUse.id}`);
                             skippingDuplicateTool = true;
                             yield { type: 'skipped_duplicate_tool', toolUseId: toolUse.id, toolName: toolUse.name };
                         } else {
                             // Valid request - add initially
                             toolUseRequests.push(toolUse);
                         }
                    }
                    break;

                case 'content_block_delta':
                    if (event.data.delta.type === 'text_delta') {
                        // Always collect text, whether tool is skipped or not
                        assistantResponseText += event.data.delta.text;
                    } else if (event.data.delta.type === 'input_json_delta' && currentToolUseId && !skippingDuplicateTool) {
                         // Only collect JSON if it's NOT a duplicate
                         currentToolInputJson += event.data.delta.partial_json;
                         // Try to update input in toolUseRequests array
                         try {
                              if (currentToolInputJson.trim().startsWith('{') && currentToolInputJson.trim().endsWith('}')) {
                                 const parsedInput = JSON.parse(currentToolInputJson);
                                 const requestToUpdate = toolUseRequests.find(req => req.id === currentToolUseId);
                                 if (requestToUpdate) {
                                     requestToUpdate.input = parsedInput; // Update input
                                 }
                              }
                         } catch (e) { /* JSON still incomplete */ }
                     }
                    break;

                case 'content_block_stop':
                    // When a block ends, reset relevant states
                    currentToolUseId = null;
                    currentToolInputJson = '';
                    skippingDuplicateTool = false; // Reset for next block
                    break;

                 case 'message_stop':
                    // Claude's entire response is complete
                    // Save the final structure (text and valid tools)
                    finalAssistantMessageStructure = {
                        role: 'assistant',
                        content: [{ type: 'text', text: assistantResponseText }], // Always as content block structure
                        tool_uses: toolUseRequests // Only valid tool requests
                    };
                    yield { type: 'final_assistant_message_structure', structure: finalAssistantMessageStructure };
                    break;
            }
        } // End for await claudeStream

        // --- Tool execution (only if valid requests exist) ---
        if (toolUseRequests.length > 0) {
             yield { type: 'status', message: `Executing ${toolUseRequests.length} tools...` };
             console.log(`[DEBUG] Before tool execution - Conversation history: ${messages.length} messages`);

            // Prepare message structure for recursive call HERE
            const updatedMessages = [...messages];

            // Track execution only now
            toolUseRequests.forEach(req => toolExecutionTracker.trackExecution(req));

            // Signal that we may be waiting for permissions
            yield { type: 'awaiting_permissions' };

            const tasks = toolUseRequests.map(toolUse => {
                const tool = findToolByName(toolUse.name);
                return {
                    fn: async (params, context) => { 
                        try {
                            if (!tool) {
                                throw new Error(`Tool "${toolUse.name}" not found.`);
                            }
                            // Pass the *original* requestPermission function
                            const result = await tool.call(params, { requestPermission }); // <- Original function
                            return { toolUse, result, error: null };
                        } catch (error) {
                            console.error(`Error executing ${toolUse.name} (ID: ${toolUse.id}):`, error);
                            return { toolUse, result: null, error: error.message || 'Unknown error during tool execution' };
                        }
                    },
                    isReadOnly: tool ? (tool.isReadOnly ? tool.isReadOnly() : true) : true,
                    params: toolUse.input,
                    toolUse: toolUse
                };
            });

            // Output 'tool_executing' events HERE, BEFORE starting tasks
            for (const toolUse of toolUseRequests) {
                 let executionDisplayText = formatToolUseForDisplay(toolUse);
                 yield { type: 'tool_executing', toolUseId: toolUse.id, toolName: toolUse.name, displayText: executionDisplayText };
            }

            // --- IMPORTANT: Correct message structure for recursion --- 

            // 1. Add ONE assistant message with ALL tool_use blocks
            //    (Ignore the text of the previous response for this step)
            if (toolUseRequests.length > 0) {
                const toolUseContentBlocks = toolUseRequests.map(toolUse => ({
                    type: 'tool_use',
                    id: toolUse.id,
                    name: toolUse.name,
                    input: toolUse.input
                }));
                updatedMessages.push({
                    role: 'assistant',
                    content: toolUseContentBlocks
                });
                console.log(`[DEBUG] Assistant message with ONLY ${toolUseContentBlocks.length} tool-use blocks added for recursion.`);
            }

            // 2. Execute tasks and add a user message for each result
            const toolResultsData = [];
            for await (const result of executeTasksOptimally(tasks, {}, 5)) { 
                toolResultsData.push(result);

                 // Format and output result event
                 let resultValue;
                 let isError = !!result.error;
                 if (isError) {
                     resultValue = `Error: ${result.error}`;
                 } else if (typeof result.result === 'string') {
                     resultValue = result.result;
                 } else if (Array.isArray(result.result)) {
                     resultValue = result.result.join('\n');
                 } else if (result.result === undefined || result.result === null) {
                     resultValue = "[No result]";
                 } else {
                     try {
                        resultValue = JSON.stringify(result.result, null, 2);
                     } catch (stringifyError) {
                         resultValue = `[Error in JSON.stringify: ${stringifyError.message}]`;
                         isError = true;
                     }
                 }

                 const displayText = formatToolResultForDisplay(result.toolUse, resultValue, isError);
                 yield { type: 'tool_result', toolUseId: result.toolUse.id, toolName: result.toolUse.name, isError, result: resultValue, displayText };

                 // Add the user message with the tool result
                 updatedMessages.push(createToolResultMessage(
                     result.toolUse.id,
                     result.toolUse.name,
                     resultValue,
                     isError
                 ));
                 console.log(`[DEBUG] Sending tool result to Claude for ${result.toolUse.name}: ${isError ? 'ERROR' : 'SUCCESS'} (${resultValue.length} characters)`);
            }

            // Signal that the permission phase (and tool execution) is over
            yield { type: 'permissions_resolved' };

            yield { type: 'status', message: 'Sending tool results to Claude...' };
            yield* query(updatedMessages, systemPrompt, abortSignal, mainRl);

        } else {
            // No valid tools requested
             if (finalAssistantMessageStructure && finalAssistantMessageStructure.content && finalAssistantMessageStructure.content[0]?.text) {
                 // Output the final text response, if available
                 yield { type: 'final_assistant_response', content: finalAssistantMessageStructure.content[0].text };
             } else if (assistantResponseText.trim()) {
                 // Fallback to collected text if message_stop was missing
                  yield { type: 'final_assistant_response', content: assistantResponseText };
             } else {
                  yield { type: 'status', message: '[No text response received from Claude]' };
             }
             yield { type: 'status', message: 'Request completed.' };
        }

    } catch (error) {
        if (error.name === 'AbortError') {
            yield { type: 'status', message: 'Request aborted by user.' };
        } else {
             console.error(`❌ Error in query generator (recursion ${currentRecursionDepth}):`, error);
             yield { type: 'error', error };
        }
    } finally {
        toolExecutionTracker.decrementRecursionDepth();
        // Check if this was the top-level call
        if (toolExecutionTracker.recursionDepth === 0) {
            console.log("[DEBUG] Top-level query call completed. Sending turn_complete.");
            yield { type: 'turn_complete' };
        }
    }
}

module.exports = { query };
