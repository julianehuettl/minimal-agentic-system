/**
 * Creates a user message object for the API.
 * @param {string} content - The text content of the user's message.
 * @returns {object} - The user message object.
 */
function createUserMessage(content) {
  return { role: 'user', content: content };
}

/**
 * Creates an assistant message object for the API.
 * @param {string} content - The text content of the assistant's message.
 * @returns {object} - The assistant message object.
 */
function createAssistantMessage(content) {
  return { role: 'assistant', content: content };
}

/**
 * Creates an assistant message object representing a tool use request.
 * @param {string} toolUseId - The ID of the tool use request.
 * @param {string} toolName - The name of the tool being requested.
 * @param {object} toolInput - The input parameters for the tool.
 * @returns {object} - The assistant message object for tool use.
 */
function createToolUseMessage(toolUseId, toolName, toolInput) {
    return {
        role: 'assistant',
        content: [
            {
                type: 'tool_use',
                id: toolUseId,
                name: toolName,
                input: toolInput,
            }
        ]
    };
}

/**
 * Creates a user message object representing the result of a tool execution.
 * @param {string} toolUseId - The ID of the corresponding tool use request.
 * @param {string} toolName - The name of the tool that was executed.
 * @param {any} toolResult - The result returned by the tool execution.
 * @param {boolean} isError - Optional flag indicating if the result is an error.
 * @returns {object} - The user message object for the tool result.
 */
function createToolResultMessage(toolUseId, toolName, toolResult, isError = false) {
    return {
        role: 'user',
        content: [
            {
                type: 'tool_result',
                tool_use_id: toolUseId,
                content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
                is_error: isError, // Optional: Include if the tool execution resulted in an error
            }
        ]
    };
}

/**
 * Creates a fingerprint for tool calls to detect duplicates.
 * @param {string} toolName - The name of the tool.
 * @param {object} toolInput - The input parameters for the tool.
 * @returns {string} - A signature that uniquely identifies the tool and its parameters.
 */
function createToolSignature(toolName, toolInput) {
    if (!toolName) return "unknown:tool";
    
    try {
        // If input is null or undefined
        if (toolInput === null || toolInput === undefined) {
            return `${toolName}:empty-input`;
        }
        
        // For empty objects
        if (typeof toolInput === 'object' && Object.keys(toolInput).length === 0) {
            return `${toolName}:empty-object`;
        }
        
        // Normalize the parameters by sorting them
        let normalizedInput;
        
        if (typeof toolInput === 'object') {
            try {
                // Sort the keys to get consistent signatures
                const sortedKeys = Object.keys(toolInput).sort();
                normalizedInput = {};
                
                for (const key of sortedKeys) {
                    normalizedInput[key] = toolInput[key];
                }
                
                return `${toolName}:${JSON.stringify(normalizedInput)}`;
            } catch (innerError) {
                console.warn(`Warning: Error normalizing tool parameters:`, innerError);
                return `${toolName}:object-normalization-failed`;
            }
        } else if (typeof toolInput === 'string') {
            // For string inputs
            return `${toolName}:${toolInput}`;
        } else {
            // For other primitive types
            return `${toolName}:${String(toolInput)}`;
        }
    } catch (e) {
        console.warn(`Warning: Cannot create signature for tool ${toolName}:`, e);
        return `${toolName}:signature-error-${typeof toolInput}`;
    }
}

/**
 * Formats a tool use request for display to the user.
 * @param {object} toolUse - The tool use object from the API response.
 * @returns {string} - A formatted string representation for display.
 */
function formatToolUseForDisplay(toolUse) {
  // Basic formatting, can be enhanced later
  return `Tool request: ${toolUse.name}(${JSON.stringify(toolUse.input)})`;
}

/**
 * Formats a tool result for display to the user.
 * @param {string} toolName - The name of the tool.
 * @param {any} result - The result from the tool.
 * @returns {string} - A formatted string representation for display.
 */
 function formatToolResultForDisplay(toolName, result) {
    // Basic formatting, can be enhanced later
    return `Tool result [${toolName}]:\n${typeof result === 'string' ? result : JSON.stringify(result, null, 2)}`;
  }


module.exports = {
  createUserMessage,
  createAssistantMessage,
  createToolUseMessage,
  createToolResultMessage,
  formatToolUseForDisplay,
  formatToolResultForDisplay,
  createToolSignature,
};
