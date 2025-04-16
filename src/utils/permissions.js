const readline = require('readline');
const stream = require('stream'); // Import the entire module

// Simple in-memory storage for approved permissions (only for the current session)
const approvedPermissions = new Set();

/**
 * Creates a unique key for a permission request.
 * @param {string} toolName - The name of the tool.
 * @param {object} params - The parameters of the tool call.
 * @returns {string} - A unique key.
 */
function getPermissionKey(toolName, params) {
    // For 'editFile' we use the file path as part of the key
    if (toolName === 'editFile' && params.filePath) {
        return `${toolName}:${params.filePath}`;
    }
    // TODO: Add logic for other state-changing tools (e.g. executeCommand)
    return toolName; // General key for other tools
}

/**
 * Checks if a specific tool execution has already been approved.
 * @param {string} toolName - The name of the tool.
 * @param {object} params - The parameters of the tool call.
 * @returns {boolean} - True if permission has been granted, otherwise false.
 */
function hasPermission(toolName, params) {
    const key = getPermissionKey(toolName, params);
    return approvedPermissions.has(key);
}

/**
 * Asks the user for permission to execute a tool via the console.
 * Uses its own temporary readline instance without echo.
 * @param {string} toolName - The name of the tool.
 * @param {object} params - The parameters of the tool call.
 * @returns {Promise<boolean>} - True if the user agrees, otherwise false.
 */
async function requestPermission(toolName, params) {
    const key = getPermissionKey(toolName, params);

    // If already approved, don't ask again
    if (approvedPermissions.has(key)) {
        return true;
    }

    // Create a meaningful question
    let paramsInfo = '';
    if (toolName === 'viewFile' && params.filePath) {
        paramsInfo = `for the file "${params.filePath}"`;
    } else if (toolName === 'listDirectory' && params.dirPath) {
        paramsInfo = `for the directory "${params.dirPath}"`;
    } else if (toolName === 'editFile' && params.filePath) {
        paramsInfo = `for the file "${params.filePath}"`;
    }
    // TODO: Add more specific questions for other tools

    // Display a clear, formatted message
    console.log('\n┌─────────────────────────────────────────────┐');
    console.log(`│ PERMISSION REQUIRED                          │`);
    console.log('├─────────────────────────────────────────────┤');
    console.log(`│ Tool: ${toolName.padEnd(36)} │`);
    if (paramsInfo) {
        const chunks = [];
        let remaining = paramsInfo;
        while (remaining.length > 0) {
            const chunk = remaining.slice(0, 35);
            chunks.push(chunk);
            remaining = remaining.slice(35);
        }
        chunks.forEach((chunk, i) => {
            const prefix = i === 0 ? '│ For: ' : '│      ';
            console.log(`${prefix}${chunk.padEnd(36)} │`);
        });
    }
    console.log('├─────────────────────────────────────────────┤');
    console.log(`│ Please enter 'yes' or 'no':                 │`);
    console.log('└─────────────────────────────────────────────┘');

    // Create an output stream that discards all data
    const discardStream = new stream.Writable({
        write(chunk, encoding, callback) {
            callback();
        }
    });

    // Create a temporary readline instance that uses this silent stream
    const tempInterface = readline.createInterface({
        input: process.stdin,
        output: discardStream,
        terminal: true
    });

    // Perform the query
    return new Promise((resolve) => {
        process.stdout.write('> ');
        
        tempInterface.question('', (answer) => { 
            const input = answer.trim().toLowerCase();
            const approved = input === 'yes' || input === 'y';

            process.stdout.write('\n');

            // Provide feedback about approval/rejection to stdout
            if (approved) {
                approvedPermissions.add(key);
                console.log(`✅ Permission for "${toolName}" granted.\n`);
            } else {
                console.log(`❌ Permission for "${toolName}" denied.\n`);
            }
            
            // Close the temporary readline instance
            tempInterface.close();
            
            // Resolve the promise
            resolve(approved);
        });
    });
}

module.exports = {
    hasPermission,
    requestPermission,
};
