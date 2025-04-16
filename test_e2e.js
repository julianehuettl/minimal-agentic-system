// Lade Umgebungsvariablen
require('dotenv').config();

const { queryClaude } = require('./src/services/claude.js');
const { findToolByName, getToolSchemas } = require('./src/tools.js');
const { requestPermission } = require('./src/utils/permissions.js');
const {
    createUserMessage,
    createToolResultMessage,
    formatToolUseForDisplay,
    formatToolResultForDisplay
} = require('./src/utils/messages.js');

/**
 * Führt ein Werkzeug basierend auf einem Werkzeug-Use-Objekt aus.
 * @param {object} toolUse - Das Werkzeugnutzungsobjekt von Claude.
 * @returns {Promise<object>} - Das Ergebnis der Werkzeugausführung.
 */
async function executeTool(toolUse) {
    const { id, name, input } = toolUse;
    console.log('\n' + formatToolUseForDisplay(toolUse));

    // Finde das Werkzeug
    const tool = findToolByName(name);
    if (!tool) {
        return { error: `Werkzeug "${name}" nicht gefunden.` };
    }

    try {
        // Führe das Werkzeug aus (mit Berechtigungskontext)
        const result = await tool.call(input, { requestPermission });
        console.log(formatToolResultForDisplay(name, result));
        return { result };
    } catch (error) {
        console.error(`Fehler bei der Ausführung von ${name}:`, error);
        return { error: error.message };
    }
}

/**
 * Führt einen einfachen Konversationsfluss mit Claude durch.
 */
async function runTest() {
    try {
        // Initialer Benutzer-Prompt
        console.log('\n--- Anfrage an Claude senden... ---');
        const initialPrompt = 'Du verfügst über Werkzeuge, die du verwenden kannst, um Dateien anzuzeigen und Verzeichnisse zu durchsuchen. NUTZE DIESE WERKZEUGE, um folgende Aufgaben zu erledigen: 1) Zeige mir den Inhalt der Datei "package.json" und 2) Liste alle Dateien im src/ Verzeichnis auf. Du musst für diese Aufgaben die bereitgestellten Werkzeuge verwenden.';
        const messages = [createUserMessage(initialPrompt)];

        // Erstelle die Werkzeugdefinitionen für Claude
        const toolDefinitions = getToolSchemas();
        console.log('\nWerkzeugdefinitionen, die an Claude gesendet werden:');
        console.log(JSON.stringify(toolDefinitions, null, 2));

        // System-Prompt für Claude
        const systemPrompt = "Du bist ein hilfreicher Assistent mit Zugriff auf Werkzeuge. Wenn du eine Anfrage erhältst, die den Zugriff auf Dateien oder Verzeichnisse erfordert, nutze die dir zur Verfügung stehenden Werkzeuge, anstatt zu sagen, dass du keinen Zugriff hast. Verwende stets die passenden Werkzeuge für die jeweilige Aufgabe und erkläre deine Aktionen.";

        // Sende Anfrage an Claude und verarbeite die Antwort
        const claudeStream = queryClaude(messages, toolDefinitions, systemPrompt);

        // Verfolge Nachrichten und Tool-Use-ID, um Tools zu verwalten
        let currentToolUseId = null;
        let toolUseRequests = [];
        let assistantResponse = '';
        let currentToolInputJson = '';

        // Verarbeite den Claude-Stream
        for await (const event of claudeStream) {
            // Debug-Ausgabe für alle Events
            console.log('\nEVENT:', event.type);
            console.log(JSON.stringify(event.data, null, 2));
            
            // Verarbeite verschiedene Event-Typen
            switch (event.type) {
                case 'message_start':
                    console.log('\n--- Claude beginnt zu antworten ---');
                    break;
                
                case 'content_block_start':
                    // Nur Text-Blöcke (nicht Werkzeugnutzungen) verarbeiten
                    if (event.data.content_block?.type === 'text') {
                        assistantResponse = ''; // Beginne einen neuen Textblock
                        console.log('\n--- Claude erzeugt Text ---');
                    } else if (event.data.content_block?.type === 'tool_use') {
                        console.log('\n--- Claude möchte ein Werkzeug verwenden ---');
                        currentToolUseId = event.data.content_block.id;
                        // Speichere vorerst ein leeres Werkzeug, dessen Input später vervollständigt wird
                        toolUseRequests.push({
                            id: event.data.content_block.id,
                            name: event.data.content_block.name,
                            input: event.data.content_block.input || {} // Falls input bereits vorhanden ist
                        });
                        currentToolInputJson = '';
                    }
                    break;
                
                case 'content_block_delta':
                    // Fügt Änderungen an einen Textblock an
                    if (event.data.delta.type === 'text_delta') {
                        const text = event.data.delta.text;
                        assistantResponse += text;
                        process.stdout.write(text); // Gib Text in Echtzeit aus
                    } else if (event.data.delta.type === 'input_json_delta') {
                        // Sammle JSON-Deltas für Werkzeug-Input
                        currentToolInputJson += event.data.delta.partial_json;
                        console.log('JSON Delta erhalten:', event.data.delta.partial_json);
                        
                        try {
                            if (currentToolInputJson.trim() && 
                                currentToolInputJson.trim().startsWith('{') && 
                                currentToolInputJson.trim().endsWith('}')) {
                                
                                const inputObj = JSON.parse(currentToolInputJson);
                                console.log('Vollständiges JSON geparst:', inputObj);
                                
                                // Aktualisiere den Input im entsprechenden Tool-Use-Request
                                const toolRequest = toolUseRequests.find(req => req.id === currentToolUseId);
                                if (toolRequest) {
                                    toolRequest.input = inputObj;
                                }
                            }
                        } catch (e) {
                            // JSON noch nicht vollständig - normal, da es schrittweise aufgebaut wird
                            console.log('JSON noch nicht vollständig:', currentToolInputJson);
                        }
                    }
                    break;
                
                case 'content_block_stop':
                    // Wenn ein Werkzeug-Block endet, versuche ein letztes Mal, das JSON zu parsen
                    if (currentToolInputJson && currentToolUseId) {
                        try {
                            const inputObj = JSON.parse(currentToolInputJson);
                            console.log('\nFinales JSON beim Block-Ende geparst:', inputObj);
                            
                            // Aktualisiere den Input im entsprechenden Tool-Use-Request
                            const toolRequest = toolUseRequests.find(req => req.id === currentToolUseId);
                            if (toolRequest) {
                                toolRequest.input = inputObj;
                            }
                            
                            // Setze den JSON-Sammler zurück
                            currentToolInputJson = '';
                        } catch (e) {
                            console.error('\nFehler beim finalen JSON-Parsing:', e.message);
                        }
                    }
                    break;
                
                case 'tool_use':
                    // Claude möchte ein Werkzeug verwenden (altes Format oder alternativer Event-Typ)
                    console.log('\n--- Claude möchte ein Werkzeug verwenden (tool_use event) ---');
                    currentToolUseId = event.data.id;
                    toolUseRequests.push({
                        id: event.data.id,
                        name: event.data.name,
                        input: event.data.input
                    });
                    break;
                
                case 'message_stop':
                    console.log('\n\n--- Claude hat geantwortet ---');
                    break;
            }
        }

        // Verarbeite alle Werkzeuganfragen sequentiell
        console.log(`\n--- Verarbeite ${toolUseRequests.length} Werkzeuganfragen ---`);
        
        for (const toolUse of toolUseRequests) {
            // Führe das Werkzeug aus
            const { result, error } = await executeTool(toolUse);
            
            // Füge das Ergebnis zur Konversation hinzu
            messages.push(
                createToolResultMessage(
                    toolUse.id,
                    toolUse.name,
                    error || result,
                    !!error
                )
            );
        }

        if (toolUseRequests.length > 0) {
            // Sende die Werkzeugergebnisse zurück an Claude
            console.log('\n--- Sende Werkzeugergebnisse an Claude... ---');
            const followUpStream = queryClaude(messages, toolDefinitions, systemPrompt);
            
            // Verarbeite die Antwort auf die Werkzeugergebnisse
            assistantResponse = '';
            
            for await (const event of followUpStream) {
                // Verarbeite nur Text-Deltas für die Einfachheit
                if (event.type === 'content_block_delta' && event.data.delta.type === 'text_delta') {
                    const text = event.data.delta.text;
                    assistantResponse += text;
                    process.stdout.write(text); // Gib Text in Echtzeit aus
                }
            }
            
            console.log('\n\n--- Claude hat die Werkzeugergebnisse verarbeitet ---');
        }

    } catch (error) {
        console.error('Fehler im E2E-Test:', error);
    }
}

// Führe den Test aus
console.log('=== Starte End-to-End-Test ===');
runTest().then(() => {
    console.log('=== End-to-End-Test abgeschlossen ===');
}).catch(err => {
    console.error('Fehler beim Ausführen des Tests:', err);
}); 