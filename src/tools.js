const fs = require('fs').promises;
const path = require('path');

// --- Tool Definitionen ---

const viewFileTool = {
    name: "viewFile",
    description: "Liest den Inhalt einer Datei im Arbeitsbereich. Gibt den Dateiinhalt als String zurück.",
    input_schema: {
        type: "object",
        properties: {
            filePath: {
                type: "string",
                description: "Der relative Pfad zur Datei im Arbeitsbereich."
            }
        },
        required: ["filePath"]
    },
    isReadOnly: () => true, // Dieses Werkzeug ändert keinen Zustand
    needsPermission: (params) => true, // Auch Lesen erfordert jetzt Berechtigung
    async call({ filePath }, { requestPermission }) {
        // Sicherheitsüberprüfung: Stelle sicher, dass der Pfad relativ ist und nicht aus dem Arbeitsbereich hinausgeht
        const absolutePath = path.resolve(process.cwd(), filePath);
        if (!absolutePath.startsWith(process.cwd())) {
            throw new Error("Zugriff ausserhalb des Arbeitsbereichs ist nicht erlaubt.");
        }

        // Berechtigungsprüfung
        const hasPerm = await requestPermission(this.name, { filePath });
        if (!hasPerm) {
            return "Fehler: Keine Berechtigung zum Lesen der Datei.";
        }

        try {
            const content = await fs.readFile(absolutePath, 'utf-8');
            return content;
        } catch (error) {
            if (error.code === 'ENOENT') {
                 return `Fehler: Datei nicht gefunden unter ${filePath}`;
             }
             console.error(`Fehler beim Lesen der Datei ${filePath}:`, error);
             // Wir geben einen Fehlerstring zurück, anstatt den Fehler zu werfen, damit Claude ihn verarbeiten kann
             return `Fehler beim Lesen der Datei: ${error.message}`;
        }
    }
};

const listDirectoryTool = {
    name: "listDirectory",
    description: "Listet den Inhalt eines Verzeichnisses im Arbeitsbereich auf. Gibt eine Liste von Dateien und Unterverzeichnissen zurück.",
    input_schema: {
        type: "object",
        properties: {
            dirPath: {
                type: "string",
                description: "Der relative Pfad zum Verzeichnis im Arbeitsbereich. './' für das Stammverzeichnis."
            }
        },
        required: ["dirPath"]
    },
    isReadOnly: () => true,
    needsPermission: (params) => true, // Auch Verzeichnislisten erfordert jetzt Berechtigung
    async call({ dirPath }, { requestPermission }) {
        const absolutePath = path.resolve(process.cwd(), dirPath);
        if (!absolutePath.startsWith(process.cwd())) {
            throw new Error("Zugriff ausserhalb des Arbeitsbereichs ist nicht erlaubt.");
        }

        // Berechtigungsprüfung
        const hasPerm = await requestPermission(this.name, { dirPath });
        if (!hasPerm) {
            return "Fehler: Keine Berechtigung zum Auflisten des Verzeichnisses.";
        }

        try {
            const entries = await fs.readdir(absolutePath, { withFileTypes: true });
            const formattedEntries = entries.map(entry => {
                return entry.isDirectory() ? `${entry.name}/` : entry.name;
            });
            return formattedEntries;
        } catch (error) {
             if (error.code === 'ENOENT') {
                 return `Fehler: Verzeichnis nicht gefunden unter ${dirPath}`;
             }
             console.error(`Fehler beim Auflisten des Verzeichnisses ${dirPath}:`, error);
             return `Fehler beim Auflisten des Verzeichnisses: ${error.message}`;
        }
    }
};

const editFileTool = {
    name: "editFile",
    description: "Bearbeitet eine Datei im Arbeitsbereich. Ersetzt den Inhalt der Datei durch den angegebenen Inhalt oder erstellt die Datei, wenn sie nicht existiert.",
    input_schema: {
        type: "object",
        properties: {
            filePath: {
                type: "string",
                description: "Der relative Pfad zur Datei im Arbeitsbereich."
            },
            content: {
                type: "string",
                description: "Der neue Inhalt, der in die Datei geschrieben werden soll."
            }
        },
        required: ["filePath", "content"]
    },
    isReadOnly: () => false, // Dieses Werkzeug ändert den Zustand
    needsPermission: (params) => true, // Bearbeiten erfordert Berechtigung
    async call({ filePath, content }, { requestPermission }) {
        // Sicherheitsüberprüfung
        const absolutePath = path.resolve(process.cwd(), filePath);
        if (!absolutePath.startsWith(process.cwd())) {
            throw new Error("Zugriff ausserhalb des Arbeitsbereichs ist nicht erlaubt.");
        }

        // Berechtigungsprüfung (wird später implementiert)
        const hasPerm = await requestPermission(this.name, { filePath });
        if (!hasPerm) {
            return "Fehler: Keine Berechtigung zum Bearbeiten der Datei.";
        }

        try {
            // Stelle sicher, dass das Verzeichnis existiert
            await fs.mkdir(path.dirname(absolutePath), { recursive: true });
            await fs.writeFile(absolutePath, content, 'utf-8');
            return `Datei ${filePath} erfolgreich bearbeitet.`;
        } catch (error) {
            console.error(`Fehler beim Schreiben der Datei ${filePath}:`, error);
            return `Fehler beim Schreiben der Datei: ${error.message}`;
        }
    }
};

// --- Tool Management ---

const availableTools = [
    viewFileTool,
    listDirectoryTool,
    editFileTool,
    // Fügen Sie hier weitere Werkzeuge hinzu
];

/**
 * Findet ein Werkzeug anhand seines Namens.
 * @param {string} toolName - Der Name des Werkzeugs.
 * @returns {object|undefined} - Das Werkzeugobjekt oder undefined, wenn nicht gefunden.
 */
function findToolByName(toolName) {
    return availableTools.find(tool => tool.name === toolName);
}

/**
 * Generiert die Werkzeugdefinitionen im von der Claude API erwarteten Format.
 * @returns {Array<object>} - Eine Liste von Werkzeugdefinitionen für die API.
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
