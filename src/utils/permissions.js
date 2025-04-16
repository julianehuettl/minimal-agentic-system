const readline = require('readline');
const stream = require('stream'); // Importiere das gesamte Modul

// Einfacher In-Memory-Speicher für genehmigte Berechtigungen (nur für die aktuelle Sitzung)
const approvedPermissions = new Set();

/**
 * Erstellt einen eindeutigen Schlüssel für eine Berechtigungsanfrage.
 * @param {string} toolName - Der Name des Werkzeugs.
 * @param {object} params - Die Parameter des Werkzeugaufrufs.
 * @returns {string} - Ein eindeutiger Schlüssel.
 */
function getPermissionKey(toolName, params) {
    // Für 'editFile' verwenden wir den Dateipfad als Teil des Schlüssels
    if (toolName === 'editFile' && params.filePath) {
        return `${toolName}:${params.filePath}`;
    }
    // TODO: Fügen Sie Logik für andere zustandsändernde Werkzeuge hinzu (z.B. executeCommand)
    return toolName; // Allgemeiner Schlüssel für andere Werkzeuge
}

/**
 * Prüft, ob eine bestimmte Werkzeugausführung bereits genehmigt wurde.
 * @param {string} toolName - Der Name des Werkzeugs.
 * @param {object} params - Die Parameter des Werkzeugaufrufs.
 * @returns {boolean} - True, wenn die Berechtigung erteilt wurde, sonst false.
 */
function hasPermission(toolName, params) {
    const key = getPermissionKey(toolName, params);
    return approvedPermissions.has(key);
}

/**
 * Fragt den Benutzer über die Konsole nach der Berechtigung für eine Werkzeugausführung.
 * Verwendet eine eigene, temporäre readline-Instanz ohne eigenes Echo.
 * @param {string} toolName - Der Name des Werkzeugs.
 * @param {object} params - Die Parameter des Werkzeugaufrufs.
 * @returns {Promise<boolean>} - True, wenn der Benutzer zustimmt, sonst false.
 */
async function requestPermission(toolName, params) {
    const key = getPermissionKey(toolName, params);

    // Wenn bereits genehmigt, nicht erneut fragen
    if (approvedPermissions.has(key)) {
        return true;
    }

    // Erstelle eine aussagekräftige Frage
    let paramsInfo = '';
    if (toolName === 'viewFile' && params.filePath) {
        paramsInfo = `für die Datei "${params.filePath}"`;
    } else if (toolName === 'listDirectory' && params.dirPath) {
        paramsInfo = `für das Verzeichnis "${params.dirPath}"`;
    } else if (toolName === 'editFile' && params.filePath) {
        paramsInfo = `für die Datei "${params.filePath}"`;
    }
    // TODO: Fügen Sie spezifischere Fragen für andere Werkzeuge hinzu

    // Zeige eine klare, formatierte Nachricht an
    console.log('\n┌─────────────────────────────────────────────┐');
    console.log(`│ BERECHTIGUNG ERFORDERLICH                    │`);
    console.log('├─────────────────────────────────────────────┤');
    console.log(`│ Werkzeug: ${toolName.padEnd(36)} │`);
    if (paramsInfo) {
        const chunks = [];
        let remaining = paramsInfo;
        while (remaining.length > 0) {
            const chunk = remaining.slice(0, 35);
            chunks.push(chunk);
            remaining = remaining.slice(35);
        }
        chunks.forEach((chunk, i) => {
            const prefix = i === 0 ? '│ Für: ' : '│      ';
            console.log(`${prefix}${chunk.padEnd(36)} │`);
        });
    }
    console.log('├─────────────────────────────────────────────┤');
    console.log(`│ Bitte geben Sie 'ja' oder 'nein' ein:       │`);
    console.log('└─────────────────────────────────────────────┘');

    // Erstelle einen Output-Stream, der alle Daten verwirft
    const discardStream = new stream.Writable({
        write(chunk, encoding, callback) {
            callback();
        }
    });

    // Erstelle eine temporäre readline-Instanz, die diesen stillen Stream nutzt
    const tempInterface = readline.createInterface({
        input: process.stdin,
        output: discardStream,
        terminal: true
    });

    // Führe die Abfrage durch
    return new Promise((resolve) => {
        // Schreibe den Prompt manuell auf den *echten* stdout
        process.stdout.write('> ');
        
        // Nutze tempInterface.question, aber ohne Prompt-Argument, da wir es manuell geschrieben haben
        // Und ohne Echo, da der Output-Stream still ist
        tempInterface.question('', (answer) => { 
            const input = answer.trim().toLowerCase();
            const approved = input === 'ja' || input === 'j';

            // Füge einen manuellen Zeilenumbruch zum echten stdout hinzu, nachdem der User Enter gedrückt hat
            process.stdout.write('\n');

            // Gib Feedback über Genehmigung/Ablehnung auf stdout aus
            if (approved) {
                approvedPermissions.add(key);
                console.log(`✅ Berechtigung für "${toolName}" erteilt.\n`);
            } else {
                console.log(`❌ Berechtigung für "${toolName}" verweigert.\n`);
            }
            
            // Schließe die temporäre readline-Instanz
            tempInterface.close();
            
            // Löse das Promise auf
            resolve(approved);
        });
    });
}

module.exports = {
    hasPermission,
    requestPermission,
};
