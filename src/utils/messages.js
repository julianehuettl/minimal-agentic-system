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
 * Erstellt einen Fingerabdruck für Werkzeugaufrufe zur Duplilkaterkennung.
 * @param {string} toolName - Der Name des Werkzeugs.
 * @param {object} toolInput - Die Eingabeparameter für das Werkzeug.
 * @returns {string} - Eine Signatur, die das Werkzeug und seine Parameter eindeutig identifiziert.
 */
function createToolSignature(toolName, toolInput) {
    if (!toolName) return "unknown:tool";
    
    try {
        // Wenn input null oder undefined ist
        if (toolInput === null || toolInput === undefined) {
            return `${toolName}:empty-input`;
        }
        
        // Für leere Objekte
        if (typeof toolInput === 'object' && Object.keys(toolInput).length === 0) {
            return `${toolName}:empty-object`;
        }
        
        // Normalisiere die Parameter, indem wir sie sortieren
        let normalizedInput;
        
        if (typeof toolInput === 'object') {
            try {
                // Sortiere die Schlüssel, um konsistente Signaturen zu erhalten
                const sortedKeys = Object.keys(toolInput).sort();
                normalizedInput = {};
                
                for (const key of sortedKeys) {
                    normalizedInput[key] = toolInput[key];
                }
                
                return `${toolName}:${JSON.stringify(normalizedInput)}`;
            } catch (innerError) {
                console.warn(`Warnung: Fehler bei der Normalisierung der Tool-Parameter:`, innerError);
                return `${toolName}:object-normalization-failed`;
            }
        } else if (typeof toolInput === 'string') {
            // Für String-Inputs
            return `${toolName}:${toolInput}`;
        } else {
            // Für andere primitive Typen
            return `${toolName}:${String(toolInput)}`;
        }
    } catch (e) {
        console.warn(`Warnung: Kann keine Signatur für Werkzeug ${toolName} erstellen:`, e);
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
  return `Werkzeuganforderung: ${toolUse.name}(${JSON.stringify(toolUse.input)})`;
}

/**
 * Formats a tool result for display to the user.
 * @param {string} toolName - The name of the tool.
 * @param {any} result - The result from the tool.
 * @returns {string} - A formatted string representation for display.
 */
 function formatToolResultForDisplay(toolName, result) {
    // Basic formatting, can be enhanced later
    return `Werkzeugergebnis [${toolName}]:\n${typeof result === 'string' ? result : JSON.stringify(result, null, 2)}`;
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
