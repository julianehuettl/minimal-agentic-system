const fs = require('fs').promises;
const path = require('path');

// --- Tool Definitions ---

const viewFileTool = {
    name: "viewFile",
    description: "Reads the content of a file in the workspace. Returns the file content as a string.",
    input_schema: {
        type: "object",
        properties: {
            filePath: {
                type: "string",
                description: "The relative path to the file in the workspace."
            }
        },
        required: ["filePath"]
    },
    isReadOnly: () => true, // This tool doesn't change any state
    needsPermission: (params) => true, // Reading now also requires permission
    async call({ filePath }, { requestPermission }) {
        // Security check: Ensure the path is relative and doesn't go outside the workspace
        const absolutePath = path.resolve(process.cwd(), filePath);
        if (!absolutePath.startsWith(process.cwd())) {
            throw new Error("Access outside the workspace is not allowed.");
        }

        // Permission check
        const hasPerm = await requestPermission(this.name, { filePath });
        if (!hasPerm) {
            return "Error: No permission to read the file.";
        }

        try {
            const content = await fs.readFile(absolutePath, 'utf-8');
            return content;
        } catch (error) {
            if (error.code === 'ENOENT') {
                 return `Error: File not found at ${filePath}`;
             }
             console.error(`Error reading file ${filePath}:`, error);
             // We return an error string instead of throwing the error so Claude can process it
             return `Error reading file: ${error.message}`;
        }
    }
};

const listDirectoryTool = {
    name: "listDirectory",
    description: "Lists the contents of a directory in the workspace. Returns a list of files and subdirectories.",
    input_schema: {
        type: "object",
        properties: {
            dirPath: {
                type: "string",
                description: "The relative path to the directory in the workspace. './' for the root directory."
            }
        },
        required: ["dirPath"]
    },
    isReadOnly: () => true,
    needsPermission: (params) => true, // Directory listing now also requires permission
    async call({ dirPath }, { requestPermission }) {
        const absolutePath = path.resolve(process.cwd(), dirPath);
        if (!absolutePath.startsWith(process.cwd())) {
            throw new Error("Access outside the workspace is not allowed.");
        }

        // Permission check
        const hasPerm = await requestPermission(this.name, { dirPath });
        if (!hasPerm) {
            return "Error: No permission to list the directory.";
        }

        try {
            const entries = await fs.readdir(absolutePath, { withFileTypes: true });
            const formattedEntries = entries.map(entry => {
                return entry.isDirectory() ? `${entry.name}/` : entry.name;
            });
            return formattedEntries;
        } catch (error) {
             if (error.code === 'ENOENT') {
                 return `Error: Directory not found at ${dirPath}`;
             }
             console.error(`Error listing directory ${dirPath}:`, error);
             return `Error listing directory: ${error.message}`;
        }
    }
};

const editFileTool = {
    name: "editFile",
    description: "Edits a file in the workspace. Replaces the content of the file with the specified content or creates the file if it doesn't exist.",
    input_schema: {
        type: "object",
        properties: {
            filePath: {
                type: "string",
                description: "The relative path to the file in the workspace."
            },
            content: {
                type: "string",
                description: "The new content to be written to the file."
            }
        },
        required: ["filePath", "content"]
    },
    isReadOnly: () => false, // This tool changes state
    needsPermission: (params) => true, // Editing requires permission
    async call({ filePath, content }, { requestPermission }) {
        // Security check
        const absolutePath = path.resolve(process.cwd(), filePath);
        if (!absolutePath.startsWith(process.cwd())) {
            throw new Error("Access outside the workspace is not allowed.");
        }

        // Permission check (will be implemented later)
        const hasPerm = await requestPermission(this.name, { filePath });
        if (!hasPerm) {
            return "Error: No permission to edit the file.";
        }

        try {
            // Ensure the directory exists
            await fs.mkdir(path.dirname(absolutePath), { recursive: true });
            await fs.writeFile(absolutePath, content, 'utf-8');
            return `File ${filePath} successfully edited.`;
        } catch (error) {
            console.error(`Error writing to file ${filePath}:`, error);
            return `Error writing to file: ${error.message}`;
        }
    }
};

// --- Tool Management ---

const availableTools = [
    viewFileTool,
    listDirectoryTool,
    editFileTool,
    // Add more tools here
];

/**
 * Finds a tool by its name.
 * @param {string} toolName - The name of the tool.
 * @returns {object|undefined} - The tool object or undefined if not found.
 */
function findToolByName(toolName) {
    return availableTools.find(tool => tool.name === toolName);
}

/**
 * Generates the tool definitions in the format expected by the Claude API.
 * @returns {Array<object>} - A list of tool definitions for the API.
 */
function getToolSchemas() {
    return availableTools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema,
    }));
}

module.exports = {
    availableTools,
    findToolByName,
    getToolSchemas,
};
