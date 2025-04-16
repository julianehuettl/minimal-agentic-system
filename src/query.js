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

// Globaler Tool-Execution-Tracker
const toolExecutionTracker = {
    executionCount: 0,
    recursionDepth: 0,
    toolIds: new Set(),
    toolSignatures: new Set(), // Für inhaltlich ähnliche Werkzeugaufrufe
    timeWindowedSignatures: new Map(), // Speichere Zeitstempel für Signaturen
    contentBlockIds: new Set(), // Speichere bereits verarbeitete Content-Block-IDs

    // Hilfsfunktion, um zu prüfen, ob ein Werkzeug bereits ausgeführt wurde
    isDuplicate(toolUse) {
        if (!toolUse || !toolUse.id || !toolUse.name) return false;

        // Prüfe auf exakte ID-Duplikate
        if (this.toolIds.has(toolUse.id)) {
            console.log(`[TRACKER] Werkzeug mit ID ${toolUse.id} bereits ausgeführt`);
            return true;
        }

        // Prüfe auf inhaltliche Duplikate (gleicher Name und gleiche Parameter)
        const signature = createToolSignature(toolUse.name, toolUse.input);
        if (this.toolSignatures.has(signature)) {
            console.log(`[TRACKER] Werkzeug mit Signatur ${signature} bereits ausgeführt`);
            return true;
        }

        return false;
    },

    // Zeitfenster-basierte Duplikaterkennung
    isDuplicateWithTimeWindow(toolUse, windowMs = 60000) {
        if (!toolUse || !toolUse.name) return false;

        const now = Date.now();
        const signature = createToolSignature(toolUse.name, toolUse.input);

        if (this.timeWindowedSignatures.has(signature)) {
            const lastTime = this.timeWindowedSignatures.get(signature);
            if (now - lastTime < windowMs) {
                console.log(`[TRACKER] Werkzeug mit Signatur ${signature} wurde in den letzten ${windowMs/1000} Sekunden ausgeführt`);
                return true;
            }
        }

        // Aktualisiere den Zeitstempel
        this.timeWindowedSignatures.set(signature, now);
        return false;
    },

    // Hilfsfunktion, um ein neues Werkzeug als ausgeführt zu registrieren
    trackExecution(toolUse) {
        if (!toolUse || !toolUse.id || !toolUse.name) return;

        this.executionCount++;
        this.toolIds.add(toolUse.id);

        const signature = createToolSignature(toolUse.name, toolUse.input);
        this.toolSignatures.add(signature);

        // Aktualisiere auch den Zeitstempel
        this.timeWindowedSignatures.set(signature, Date.now());

        console.log(`[TRACKER] Werkzeug ${toolUse.name} (ID: ${toolUse.id}) registriert. Ausführung #${this.executionCount}`);
    },

    // Zähler für Rekursionstiefe erhöhen
    incrementRecursionDepth() {
        this.recursionDepth++;
        console.log(`[TRACKER] Rekursionstiefe erhöht auf ${this.recursionDepth}`);
        return this.recursionDepth;
    },

    // Zähler für Rekursionstiefe zurücksetzen (am Ende des Aufrufs)
    decrementRecursionDepth() {
        if (this.recursionDepth > 0) this.recursionDepth--;
        console.log(`[TRACKER] Rekursionstiefe verringert auf ${this.recursionDepth}`);
        return this.recursionDepth;
    },

    // Alle ausgeführten Tools protokollieren
    logAllTrackedTools() {
        console.log(`[TRACKER] Bisher verfolgte Tools (${this.executionCount}):`);
        console.log(`[TRACKER] Tool-IDs: ${Array.from(this.toolIds).join(', ')}`);
        console.log(`[TRACKER] Tool-Signaturen: ${Array.from(this.toolSignatures).join(', ')}`);
    },

    // Hilfsfunktion, um zu prüfen, ob ein Content-Block bereits verarbeitet wurde
    isDuplicateContentBlock(contentBlockId) {
        if (!contentBlockId) return false;

        if (this.contentBlockIds.has(contentBlockId)) {
            console.log(`[TRACKER] Content-Block mit ID ${contentBlockId} wurde bereits verarbeitet`);
            return true;
        }

        this.contentBlockIds.add(contentBlockId);
        return false;
    },
     // Bereinigt Tracker für einen neuen Top-Level-Aufruf
     resetForNewQuery() {
         this.executionCount = 0;
         this.recursionDepth = 0;
         this.toolIds.clear();
         this.toolSignatures.clear();
         // timeWindowedSignatures nicht unbedingt löschen, kann über Anfragen hinweg nützlich sein
         this.contentBlockIds.clear();
         console.log("[TRACKER] Tracker für neue Anfrage zurückgesetzt.");
     }
};

/**
 * Der Haupt-Query-Generator, der eine Konversation mit Claude verarbeitet,
 * Werkzeuge ausführt und die Ergebnisse zurücksendet.
 *
 * @param {Array} messages - Der Konversationsverlauf als Array von Nachrichtenobjekten.
 * @param {string} systemPrompt - Ein optionaler Systemprompt für Claude.
 * @param {AbortSignal} abortSignal - Ein Signal, um die Anfrage zu abzubrechen.
 * @param {readline.Interface} mainRl - Die Haupt-readline-Instanz aus index.js.
 * @yields {object} - Generiert verschiedene Ereignisobjekte während der Verarbeitung.
 */
async function* query(messages, systemPrompt = null, abortSignal = null, mainRl = null) {
    // Tracker nur zurücksetzen, wenn es der erste Aufruf ist (Rekursionstiefe 0)
     if (toolExecutionTracker.recursionDepth === 0) {
         toolExecutionTracker.resetForNewQuery();
     }

    const currentRecursionDepth = toolExecutionTracker.incrementRecursionDepth();
    // Abbruchbedingung für Rekursionstiefe
     const MAX_RECURSION_DEPTH = 5; // Maximal erlaubte Rekursionstiefe
     if (currentRecursionDepth > MAX_RECURSION_DEPTH) {
         console.error(`❌ Maximale Rekursionstiefe (${MAX_RECURSION_DEPTH}) erreicht. Breche ab.`);
         yield { type: 'error', error: new Error(`Maximale Rekursionstiefe (${MAX_RECURSION_DEPTH}) erreicht.`) };
         toolExecutionTracker.decrementRecursionDepth();
         return; // Beende den Generator hier
     }

    try {
        // Hole Werkzeugdefinitionen
        const toolDefinitions = getToolSchemas();

        // Debugging-Information
        console.log(`[DEBUG] query aufgerufen mit ${messages.length} Nachrichten, Rekursionstiefe: ${currentRecursionDepth}`);
        // toolExecutionTracker.logAllTrackedTools();

        // Sende Anfrage an Claude
        yield { type: 'status', message: 'Sende Anfrage an Claude...' };
        const claudeStream = queryClaude(messages, toolDefinitions, systemPrompt, abortSignal);

        // Verarbeite die Antwort von Claude
        let toolUseRequests = []; // Sammelt gültige Tool-Anfragen
        let assistantResponseText = ''; // Sammelt Text-Antworten
        let currentToolInputJson = ''; // Sammelt JSON-Input für das aktuelle Tool
        let currentToolUseId = null; // ID des aktuellen Tool-Blocks
        let finalAssistantMessageStructure = null; // Speichert die Struktur der finalen Nachricht

        let skippingDuplicateTool = false; // Flag, um Duplikat-Verarbeitung zu steuern

        for await (const event of claudeStream) {
             // Globale Fehlerbehandlung zuerst
             if (event.type === 'error') {
                 console.error(`[STREAM ERROR] ${event.error?.message || 'Unbekannter Stream-Fehler'}`);
                 yield event; // Fehler weitergeben
                 continue; // Nächstes Event
             }

            // Verhindere doppelte Verarbeitung desselben Content-Blocks
            if (event.type === 'content_block_start' && event.data.content_block?.id) {
                const blockId = event.data.content_block.id;
                if (toolExecutionTracker.contentBlockIds.has(blockId)) {
                    console.log(`[DEBUG] Überspringe bereits verarbeiteten Content-Block: ${blockId}`);
                    continue;
                }
                toolExecutionTracker.contentBlockIds.add(blockId);
            }

            switch (event.type) {
                case 'message_start':
                     assistantResponseText = ''; // Zurücksetzen für neue Nachricht
                     toolUseRequests = []; // Zurücksetzen für neue Nachricht
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

                         // Prüfe auf Duplikat (ID oder Signatur im Zeitfenster)
                         if (toolExecutionTracker.isDuplicate(toolUse) || toolExecutionTracker.isDuplicateWithTimeWindow(toolUse)) {
                             console.warn(`⚠️ Überspringe doppelte Werkzeuganforderung: ${toolUse.name} mit ID ${toolUse.id}`);
                             skippingDuplicateTool = true;
                             yield { type: 'skipped_duplicate_tool', toolUseId: toolUse.id, toolName: toolUse.name };
                         } else {
                             // Gültige Anfrage - initial hinzufügen
                             toolUseRequests.push(toolUse);
                         }
                    }
                    break;

                case 'content_block_delta':
                    if (event.data.delta.type === 'text_delta') {
                        // Text immer sammeln, egal ob Tool übersprungen wird oder nicht
                        assistantResponseText += event.data.delta.text;
                    } else if (event.data.delta.type === 'input_json_delta' && currentToolUseId && !skippingDuplicateTool) {
                         // JSON nur sammeln, wenn es KEIN Duplikat ist
                         currentToolInputJson += event.data.delta.partial_json;
                         // Versuch, Input im toolUseRequests Array zu aktualisieren
                         try {
                              if (currentToolInputJson.trim().startsWith('{') && currentToolInputJson.trim().endsWith('}')) {
                                 const parsedInput = JSON.parse(currentToolInputJson);
                                 const requestToUpdate = toolUseRequests.find(req => req.id === currentToolUseId);
                                 if (requestToUpdate) {
                                     requestToUpdate.input = parsedInput; // Aktualisiere Input
                                 }
                              }
                         } catch (e) { /* JSON noch unvollständig */ }
                     }
                    break;

                case 'content_block_stop':
                    // Wenn ein Block endet, relevante Zustände zurücksetzen
                    currentToolUseId = null;
                    currentToolInputJson = '';
                    skippingDuplicateTool = false; // Zurücksetzen für den nächsten Block
                    break;

                 case 'message_stop':
                    // Die gesamte Antwort von Claude ist fertig
                    // Speichere die finale Struktur (Text und gültige Tools)
                    finalAssistantMessageStructure = {
                        role: 'assistant',
                        content: [{ type: 'text', text: assistantResponseText }], // Immer als Content-Block-Struktur
                        tool_uses: toolUseRequests // Nur die gültigen Tool-Anfragen
                    };
                    yield { type: 'final_assistant_message_structure', structure: finalAssistantMessageStructure };
                    break;
            }
        } // Ende for await claudeStream

        // --- Werkzeugausführung (nur wenn gültige Anfragen vorhanden) ---
        if (toolUseRequests.length > 0) {
             yield { type: 'status', message: `Führe ${toolUseRequests.length} Werkzeuge aus...` };
             console.log(`[DEBUG] Vor Werkzeugausführung - Konversationshistorie: ${messages.length} Nachrichten`);

            // Nachrichtenstruktur für den rekursiven Aufruf HIER vorbereiten
            const updatedMessages = [...messages];

            // Tracke die Ausführung erst jetzt
            toolUseRequests.forEach(req => toolExecutionTracker.trackExecution(req));

            // Signal senden, dass wir möglicherweise auf Berechtigungen warten
            yield { type: 'awaiting_permissions' };

            const tasks = toolUseRequests.map(toolUse => {
                const tool = findToolByName(toolUse.name);
                return {
                    // Stelle sicher, dass fn eine normale async function ist
                    fn: async (params, context) => { // KEIN Sternchen (*)
                        // Kein yield hier drin!
                        try {
                            if (!tool) {
                                throw new Error(`Werkzeug "${toolUse.name}" nicht gefunden.`);
                            }
                            // Übergebe die *originale* requestPermission Funktion
                            const result = await tool.call(params, { requestPermission }); // <- Originale Funktion
                            return { toolUse, result, error: null };
                        } catch (error) {
                            console.error(`Fehler bei der Ausführung von ${toolUse.name} (ID: ${toolUse.id}):`, error);
                            return { toolUse, result: null, error: error.message || 'Unbekannter Fehler bei Werkzeugausführung' };
                        }
                    },
                    isReadOnly: tool ? (tool.isReadOnly ? tool.isReadOnly() : true) : true,
                    params: toolUse.input,
                    toolUse: toolUse
                };
            });

            // Gib die 'tool_executing' Events HIER aus, VOR dem Start der Tasks
            for (const toolUse of toolUseRequests) {
                 let executionDisplayText = formatToolUseForDisplay(toolUse);
                 yield { type: 'tool_executing', toolUseId: toolUse.id, toolName: toolUse.name, displayText: executionDisplayText };
            }

            // --- WICHTIG: Korrekte Nachrichtenstruktur für Rekursion --- 

            // 1. Füge EINE Assistenten-Nachricht mit ALLEN tool_use Blöcken hinzu
            //    (Ignoriere den Text der vorherigen Antwort für diesen Schritt)
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
                console.log(`[DEBUG] Assistenten-Nachricht NUR mit ${toolUseContentBlocks.length} Tool-Use-Blöcken für Rekursion hinzugefügt.`);
            }
             
            // (Der Code, der finalAssistantMessageStructure prüft und Text/Tool kombiniert, wird entfernt,
            // da er nur für die finale Ausgabe, nicht für die Rekursion relevant war und Probleme verursachte)
            /*  ENTFERNT:
             if (finalAssistantMessageStructure) {
                 const assistantContent = [];
                 if (finalAssistantMessageStructure.content && finalAssistantMessageStructure.content[0]?.text) {
                     assistantContent.push({ type: 'text', text: finalAssistantMessageStructure.content[0].text });
                 }
                 finalAssistantMessageStructure.tool_uses.forEach(tu => { ... });
                 if (assistantContent.length > 0) {
                    updatedMessages.push({ role: 'assistant', content: assistantContent });
                 }
             }
            */

            // 2. Führe Tasks aus und füge für jedes Ergebnis eine User-Nachricht hinzu
            const toolResultsData = [];
            for await (const result of executeTasksOptimally(tasks, {}, 5)) { 
                toolResultsData.push(result);

                 // Formatieren und Ergebnis-Event ausgeben
                 let resultValue;
                 let isError = !!result.error;
                 if (isError) {
                     resultValue = `Fehler: ${result.error}`;
                 } else if (typeof result.result === 'string') {
                     resultValue = result.result;
                 } else if (Array.isArray(result.result)) {
                     resultValue = result.result.join('\n');
                 } else if (result.result === undefined || result.result === null) {
                     resultValue = "[Kein Ergebnis]";
                 } else {
                     try {
                        resultValue = JSON.stringify(result.result, null, 2);
                     } catch (stringifyError) {
                         resultValue = `[Fehler bei JSON.stringify: ${stringifyError.message}]`;
                         isError = true;
                     }
                 }

                 const displayText = formatToolResultForDisplay(result.toolUse, resultValue, isError);
                 yield { type: 'tool_result', toolUseId: result.toolUse.id, toolName: result.toolUse.name, isError, result: resultValue, displayText };

                 // Füge die User-Nachricht mit dem Tool-Ergebnis hinzu
                 updatedMessages.push(createToolResultMessage(
                     result.toolUse.id,
                     result.toolUse.name,
                     resultValue,
                     isError
                 ));
                 console.log(`[DEBUG] Sende Werkzeugergebnis an Claude für ${result.toolUse.name}: ${isError ? 'ERROR' : 'SUCCESS'} (${resultValue.length} Zeichen)`);
            }

            // Signal senden, dass die Berechtigungsphase (und Tool-Ausführung) vorbei ist
            yield { type: 'permissions_resolved' };

            yield { type: 'status', message: 'Sende Werkzeugergebnisse an Claude...' };
            // Rekursiver Aufruf mit der korrigierten Nachrichtenstruktur
            yield* query(updatedMessages, systemPrompt, abortSignal, mainRl);

        } else {
            // Keine gültigen Tools angefordert
             if (finalAssistantMessageStructure && finalAssistantMessageStructure.content && finalAssistantMessageStructure.content[0]?.text) {
                 // Gib die finale Textantwort aus, wenn vorhanden
                 yield { type: 'final_assistant_response', content: finalAssistantMessageStructure.content[0].text };
             } else if (assistantResponseText.trim()) {
                 // Fallback auf gesammelten Text, falls message_stop fehlte
                  yield { type: 'final_assistant_response', content: assistantResponseText };
             } else {
                  yield { type: 'status', message: '[Keine Textantwort von Claude erhalten]' };
             }
             yield { type: 'status', message: 'Anfrage abgeschlossen.' };
        }

    } catch (error) {
        if (error.name === 'AbortError') {
            yield { type: 'status', message: 'Anfrage vom Benutzer abgebrochen.' };
        } else {
             console.error(`❌ Fehler im query-Generator (Rekursion ${currentRecursionDepth}):`, error);
             yield { type: 'error', error };
        }
    } finally {
        toolExecutionTracker.decrementRecursionDepth();
        // Prüfen, ob dies der Top-Level-Aufruf war
        if (toolExecutionTracker.recursionDepth === 0) {
            console.log("[DEBUG] Top-Level query-Aufruf beendet. Sende turn_complete.");
            yield { type: 'turn_complete' };
        }
    }
}

module.exports = { query };
