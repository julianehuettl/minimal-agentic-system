#!/usr/bin/env node

// Lade Umgebungsvariablen
require('dotenv').config();

const readline = require('readline');
const { query } = require('./src/query.js');
const { createUserMessage, createAssistantMessage } = require('./src/utils/messages.js');

/**
 * Zeigt den Willkommensbildschirm an.
 */
function showWelcomeScreen() {
    console.log('\n=======================================================');
    console.log('          🤖 Minimales Agentic System 🤖');
    console.log('=======================================================\n');
    console.log('Willkommen! Dieses System ermöglicht es Claude, Dateien');
    console.log('zu lesen, Verzeichnisse zu durchsuchen und mehr.\n');
    console.log('Geben Sie Ihre Fragen ein oder "exit" zum Beenden.\n');
    console.log('=======================================================\n');
}

/**
 * Erstellt eine readline-Schnittstelle für die Konsoleneingabe.
 * @returns {readline.Interface} - Die readline-Schnittstelle.
 */
function createReadlineInterface() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: '> ',
        terminal: true,
    });
}

/**
 * Startet die Hauptprogrammschleife.
 */
async function main() {
    showWelcomeScreen();

    // Erstelle eine readline-Schnittstelle
    const rl = createReadlineInterface();

    // Verwalte den Konversationsverlauf
    const messages = [];

    // Systemanweisung für Claude
    const systemPrompt = `Du bist ein hilfreicher Assistent mit Zugriff auf Werkzeuge.
Wenn du eine Anfrage erhältst, die den Zugriff auf Dateien oder Verzeichnisse erfordert,
nutze die dir zur Verfügung stehenden Werkzeuge, anstatt zu sagen, dass du keinen Zugriff hast.
Verwende stets die passenden Werkzeuge für die jeweilige Aufgabe und erkläre deine Aktionen.`;

    // Abbruchsignal für langwierige Anfragen
    let controller = new AbortController();
    let signal = controller.signal;
    let isAwaitingUserInput = true;

    // Hauptprogrammschleife
    rl.prompt();
    rl.on('line', async (line) => {
        if (!isAwaitingUserInput) {
            console.log("\n[INFO] Bitte warten Sie, bis die aktuelle Anfrage abgeschlossen ist.");
            return;
        }

        const userInput = line.trim();

        if (userInput.toLowerCase() === 'exit') {
            console.log('Auf Wiedersehen! 👋');
            rl.close();
            process.exit(0);
            return;
        }

        if (userInput.toLowerCase() === 'stop') {
            console.log('Breche die aktuelle Anfrage ab...');
            controller.abort();
            controller = new AbortController();
            signal = controller.signal;
            isAwaitingUserInput = true;
            rl.resume();
            rl.prompt();
            return;
        }

        try {
            // Füge die Benutzernachricht zum Verlauf hinzu
            const userMessage = createUserMessage(userInput);
            messages.push(userMessage);

            // Antwort generieren
            let assistantMessageContent = '';
            let lastEventType = '';
            let currentError = null;
            let finalContentProcessed = false;
            isAwaitingUserInput = false;

            // Führe die Anfrage aus
            for await (const event of query(messages, systemPrompt, signal)) {
                switch (event.type) {
                    case 'status':
                        // Zeige Status-Updates an
                        console.log(`\n[${event.message}]`);
                        
                        // Wenn der Status "Ignoriere weitere Werkzeuganforderungen" beinhaltet, 
                        // setze eine Formatierung, damit es auffälliger ist
                        if (event.message.includes('Weitere Werkzeuganforderungen erkannt')) {
                            console.log('\n----------------------------------------');
                            console.log('⚠️  HINWEIS: Claude versucht erneut Werkzeuge zu verwenden.');
                            console.log('    Diese Werkzeugaufrufe werden verarbeitet, um die Anfrage vollständig zu beantworten.');
                            console.log('----------------------------------------\n');
                        }
                        break;

                    case 'content_block_delta':
                        // Gib die Textantwort in Echtzeit aus
                        if (event.data?.delta?.type === 'text_delta') {
                            const text = event.data.delta.text;
                            assistantMessageContent += text;
                            process.stdout.write(text);
                            lastEventType = 'text';
                        }
                        break;

                    case 'tool_executing':
                        if (lastEventType === 'text') {
                            console.log('\n'); // Füge eine Leerzeile ein, wenn wir von Text zu Tool wechseln
                        }
                        console.log(`\n[Werkzeug wird verwendet] ${event.displayText}`);
                        lastEventType = 'tool';
                        break;

                    case 'tool_result':
                        console.log(`\n[Werkzeugergebnis] ${event.displayText}`);
                        lastEventType = 'tool_result';
                        break;

                    case 'error':
                        console.error(`\n❌ Fehler: ${event.error.message || event.error}`);
                        break;
                        
                    case 'final_assistant_response':
                        // Dieser spezielle Event-Typ enthält die finale Textantwort von Claude nach Werkzeugausführung
                        // Wir speichern sie direkt, damit sie nicht durch einen neuen Werkzeugaufruf überschrieben wird
                        if (event.content) {
                            assistantMessageContent = event.content;
                            process.stdout.write('\n' + event.content); // Gib die Antwort direkt aus
                            lastEventType = 'text';
                        }
                        break;

                    case 'awaiting_permissions':
                        console.log("[DEBUG] Pausing readline due to awaiting_permissions.");
                        rl.pause();
                        break;
                    case 'permissions_resolved':
                        console.log("[DEBUG] Resuming readline due to permissions_resolved.");
                        rl.resume();
                        break;
                    case 'turn_complete':
                        console.log("[DEBUG] Resuming readline and enabling input due to turn_complete.");
                        rl.resume();
                        if (!currentError && assistantMessageContent.trim() && !finalContentProcessed) {
                            co