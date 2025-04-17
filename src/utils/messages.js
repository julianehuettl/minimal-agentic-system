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
 * @param {object} toolUse - The tool use object with id, name, and input.
 * @param {any} toolResult - The result returned by the tool execution.
 * @param {boolean} isError - Optional flag indicating if the result is an error.
 * @returns {object} - The user message object for the tool result.
 */
function createToolResultMessage(toolUse, toolResult, isError = false) {
    // Ensure we have a valid toolUse object
    if (!toolUse || !toolUse.id || !toolUse.name) {
        console.error("Invalid tool use object provided to createToolResultMessage");
        return {
            role: 'user',
            content: `Error: Unable to process tool result due to invalid tool use information`
        };
    }
    
    // Format tool result for Claude API (following the original format)
    return {
        role: 'user',
        content: [
            {
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
                is_error: isError
            }
        ]
    };
}

/**
 * Creates a unique signature for a tool execution including parameters
 * @param {string} toolName - Name of the tool
 * @param {object} params - Tool parameters
 * @returns {string} Unique signature for this tool execution
 */
function createToolSignature(toolName, params = {}) {
    if (!toolName) return "unknown:tool";
    
    try {
        // Handle null or undefined params
        if (params === null || params === undefined) {
            return `${toolName}:no-params`;
        }
        
        // Ensure params is an object
        const paramObj = typeof params === 'string' ? JSON.parse(params) : params;
        
        // Create a stable string representation of parameters
        const paramString = Object.entries(paramObj)
            .filter(([_, value]) => value !== undefined && value !== null) // Filter out undefined and null values
            .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
            .map(([key, value]) => {
                const valueStr = typeof value === 'object' ? 
                    JSON.stringify(value) : 
                    String(value);
                return `${key}:${valueStr}`;
            })
            .join('|');
        
        // Log the parameter processing
        console.log(`[DEBUG] Creating signature for ${toolName}:
            Input params: ${JSON.stringify(params)}
            Processed params: ${paramString}`);
        
        return `${toolName}:${paramString || 'empty-params'}`;
    } catch (error) {
        console.warn(`Warning: Error creating signature for tool ${toolName}:`, error);
        return `${toolName}:signature-error`;
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
