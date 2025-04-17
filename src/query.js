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
    toolSignatures: new Set(),
    timeWindowedSignatures: new Map(),
    contentBlockIds: new Set(),
    
    // New: Sequence tracking
    currentSequenceId: null,
    sequenceToolCounts: new Map(),
    
    // Configuration
    TIME_WINDOW_MS: 60000, // 60 seconds
    
    /**
     * Checks if a tool execution would be a duplicate
     * Now considers sequence context and parameter variations
     */
    isDuplicate(toolUse) {
        if (!toolUse || !toolUse.id || !toolUse.name) return false;
        
        // Check for exact ID duplicates
        if (this.toolIds.has(toolUse.id)) {
            // console.log(`[TRACKER] Tool with ID ${toolUse.id} already executed`);
            return true;
        }
        
        return false;
    },
    
    /**
     * Enhanced duplicate detection with time window and sequence awareness
     */
    isDuplicateWithTimeWindow(toolUse, windowMs = this.TIME_WINDOW_MS) {
        if (!toolUse || !toolUse.name) return false;
        
        const now = Date.now();
        const signature = createToolSignature(toolUse.name, toolUse.input || {});
        
        // console.log(`[TRACKER] Checking tool signature: ${signature}`);
        
        if (this.timeWindowedSignatures.has(signature)) {
            const lastExecution = this.timeWindowedSignatures.get(signature);
            const timeDiff = now - lastExecution.timestamp;
            
            // Check if the tool was executed recently in the same sequence
            if (timeDiff < windowMs && lastExecution.sequenceId === this.currentSequenceId) {
                const params = JSON.stringify(toolUse.input || {});
                /* console.log(`[TRACKER] Found recent execution:
                    - Tool: ${toolUse.name}
                    - Parameters: ${params}
                    - Time since last execution: ${timeDiff}ms
                    - Current sequence: ${this.currentSequenceId}
                    - Last sequence: ${lastExecution.sequenceId}`); */
                return true;
            }
        }
        
        // Update execution record
        this.timeWindowedSignatures.set(signature, {
            timestamp: now,
            sequenceId: this.currentSequenceId,
            params: toolUse.input || {}
        });
        
        return false;
    },
    
    /**
     * Tracks tool execution with enhanced context
     */
    trackExecution(toolUse) {
        if (!toolUse || !toolUse.id || !toolUse.name) return;
        
        this.executionCount++;
        this.toolIds.add(toolUse.id);
        
        const signature = createToolSignature(toolUse.name, toolUse.input);
        this.toolSignatures.add(signature);
        
        // Track tool count in current sequence
        if (this.currentSequenceId) {
            const currentCount = this.sequenceToolCounts.get(this.currentSequenceId) || 0;
            this.sequenceToolCounts.set(this.currentSequenceId, currentCount + 1);
        }
        
        // console.log(`[TRACKER] Tool ${toolUse.name} (ID: ${toolUse.id}) registered. Execution #${this.executionCount}`);
    },

    // Increase counter for recursion depth
    incrementRecursionDepth() {
        this.recursionDepth++;
        // console.log(`[TRACKER] Recursion depth increased to ${this.recursionDepth}`);
        return this.recursionDepth;
    },

    // Reset counter for recursion depth (at the end of the call)
    decrementRecursionDepth() {
        if (this.recursionDepth > 0) this.recursionDepth--;
        // console.log(`[TRACKER] Recursion depth decreased to ${this.recursionDepth}`);
        return this.recursionDepth;
    },

    // Log all executed tools
    logAllTrackedTools() {
        /* console.log(`[TRACKER] Tools tracked so far (${this.executionCount}):`);
        console.log(`[TRACKER] Tool IDs: ${Array.from(this.toolIds).join(', ')}`);
        console.log(`[TRACKER] Tool signatures: ${Array.from(this.toolSignatures).join(', ')}`); */
    },

    // Helper function to check if a content block has already been processed
    isDuplicateContentBlock(contentBlockId) {
        if (!contentBlockId) return false;

        if (this.contentBlockIds.has(contentBlockId)) {
            // console.log(`[TRACKER] Content block with ID ${contentBlockId} has already been processed`);
            return true;
        }

        this.contentBlockIds.add(contentBlockId);
        return false;
    },
    
    /**
     * Enhanced reset for new query with sequence management
     */
    resetForNewQuery() {
        this.executionCount = 0;
        this.recursionDepth = 0;
        this.toolIds.clear();
        this.toolSignatures.clear();
        this.contentBlockIds.clear();
        
        // Create new sequence ID
        this.currentSequenceId = Date.now().toString(36);
        this.sequenceToolCounts.clear();
        
        // console.log("[TRACKER] Tracker reset for new query with sequence ID:", this.currentSequenceId);
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
    // Reset tracker for new query
    toolExecutionTracker.resetForNewQuery();
    
    try {
        // Get tool definitions
        const toolDefinitions = getToolSchemas();
        
        // Flag to track if this query is complete
        let isQueryComplete = false;
        
        while (!isQueryComplete) {  // Continue until query is explicitly marked as complete
            // Send request to Claude
            // yield { type: 'status', message: 'Sending request to Claude...' }; // Removed this yield in favor of index.js filtering
            const claudeStream = queryClaude(messages, toolDefinitions, systemPrompt, abortSignal);

            // Process Claude's response
            let toolUseRequests = []; // Collects valid tool requests
            let assistantResponseText = ''; // Collects text responses
            let currentToolInputJson = ''; // Collects JSON input for the current tool
            let currentToolUseId = null; // ID of current tool block
            let finalAssistantMessageStructure = null; // Stores the structure of the final message

            // Process Claude's stream
            for await (const event of claudeStream) {
                // Global error handling first
                if (event.type === 'error') {
                    console.error(`[STREAM ERROR] ${event.error?.message || 'Unknown stream error'}`);
                    yield event;
                    isQueryComplete = true;
                    break;
                }

                switch (event.type) {
                    case 'message_start':
                        assistantResponseText = '';
                        toolUseRequests = [];
                        finalAssistantMessageStructure = null;
                        break;

                    case 'content_block_start':
                        if (event.data.content_block?.type === 'tool_use') {
                            const toolUse = {
                                id: event.data.content_block.id,
                                name: event.data.content_block.name,
                                input: {}
                            };
                            currentToolUseId = toolUse.id;
                            currentToolInputJson = '';
                            toolUseRequests.push(toolUse);
                        }
                        break;

                    case 'content_block_delta':
                        if (event.data.delta.type === 'text_delta') {
                            assistantResponseText += event.data.delta.text;
                        } else if (event.data.delta.type === 'input_json_delta' && currentToolUseId) {
                            currentToolInputJson += event.data.delta.partial_json;
                            try {
                                if (currentToolInputJson.trim().startsWith('{') && currentToolInputJson.trim().endsWith('}')) {
                                    const parsedInput = JSON.parse(currentToolInputJson);
                                    const currentToolUse = toolUseRequests.find(req => req.id === currentToolUseId);
                                    if (currentToolUse) {
                                        currentToolUse.input = parsedInput;
                                    }
                                }
                            } catch (e) { /* JSON still incomplete */ }
                        }
                        break;

                    case 'message_stop':
                        finalAssistantMessageStructure = {
                            role: 'assistant',
                            content: [{ type: 'text', text: assistantResponseText }],
                            tool_uses: toolUseRequests
                        };
                        break;
                }
            }

            // First, output Claude's text response if any
            if (assistantResponseText.trim()) {
                yield { type: 'final_assistant_response', content: assistantResponseText };
            }

            // Add Claude's response to conversation history properly
            if (finalAssistantMessageStructure) {
                // Add assistant's text response first (without tools)
                if (assistantResponseText.trim()) {
                    messages.push({
                        role: 'assistant',
                        content: assistantResponseText
                    });
                }
                
                // If we have tool requests, add them separately (not in the same message)
                if (toolUseRequests.length > 0) {
                    // Format must match Claude's expected format for tool use
                    const toolUseMessage = {
                        role: 'assistant',
                        content: toolUseRequests.map(toolUse => ({
                            type: 'tool_use',
                            id: toolUse.id,
                            name: toolUse.name,
                            input: toolUse.input
                        }))
                    };
                    
                    messages.push(toolUseMessage);
                }
            }

            // If no tools to execute, we're done with this query
            if (toolUseRequests.length === 0) {
                yield { type: 'turn_complete' };
                isQueryComplete = true;
                break;
            }

            // Process tool requests
            for (const toolUse of toolUseRequests) {
                const tool = findToolByName(toolUse.name);
                if (!tool) {
                    console.error(`❌ Tool ${toolUse.name} not found`);
                    continue;
                }

                let needsPerm = false;
                try {
                    // Check if permission is needed before calling the tool
                    needsPerm = tool.needsPermission ? tool.needsPermission(toolUse.input) : false;
                    
                    if (needsPerm) {
                        yield { type: 'awaiting_permissions' };
                    }
                    
                    // Execute the tool
                    const result = await tool.call(toolUse.input, { requestPermission });
                    
                    if (needsPerm) {
                        yield { type: 'permissions_resolved' };
                    }
                    
                    // Create tool result message
                    const toolResultMessage = createToolResultMessage(toolUse, result);
                    
                    // Add result to conversation history
                    messages.push(toolResultMessage);
                    
                    // Yield tool completion event
                    yield { type: 'tool_complete', result };
                } catch (error) {
                    console.error(`❌ Error executing tool ${toolUse.name}:`, error);
                    // Ensure permissions_resolved is sent even if the tool call fails after permission was requested
                    if (needsPerm) {
                        yield { type: 'permissions_resolved' };
                    }
                    yield { type: 'error', error };
                    isQueryComplete = true;
                    break;
                }
            }
        }
        
        // Final turn_complete to signal the end of processing
        yield { type: 'turn_complete' };
        
    } catch (error) {
        console.error('❌ Error in query:', error);
        yield { type: 'error', error };
    }
}

module.exports = { query };
