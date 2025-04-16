# Häufige Fehler bei der Implementierung des Agentic Systems

In diesem Dokument werden häufige Fehler und Probleme bei der Implementierung unseres Agentic Systems mit der Claude API beschrieben, sowie ihre Lösungen.

## 1. Fehlende tool_use Nachrichten für tool_result

### Problem
Bei der Rückgabe von Werkzeugergebnissen an Claude erhielten wir folgende Fehlermeldung:

```
unexpected `tool_use_id` found in `tool_result` blocks: toolu_XXXXX. Each `tool_result` block must have a corresponding `tool_use` block in the previous message.
```

Die Claude API erwartet, dass für jedes `tool_result` ein entsprechender `tool_use` Block in der vorherigen Nachricht existiert. In unserer Implementierung hatten wir die Werkzeugergebnisse (`tool_result`) zur Konversation hinzugefügt, ohne vorher die Werkzeuganfragen (`tool_use`) als eigene Nachricht zu speichern.

### Lösung
Wir haben die Konversationsstruktur korrigiert, indem wir folgende Schritte implementiert haben:

1. Zuerst kopieren wir die ursprünglichen Nachrichten:
   ```javascript
   const updatedMessages = [...messages];
   ```

2. Dann fügen wir eine Assistenten-Nachricht mit allen tool_use Blöcken hinzu:
   ```javascript
   if (toolUseRequests.length > 0) {
       // Wir erstellen alle tool_use-Blöcke als Content-Array
       const toolUseContentBlocks = toolUseRequests.map(toolUse => ({
           type: 'tool_use',
           id: toolUse.id,
           name: toolUse.name,
           input: toolUse.input
       }));
       
       // Füge eine Assistenten-Nachricht mit allen tool_use-Blöcken hinzu
       updatedMessages.push({
           role: 'assistant',
           content: toolUseContentBlocks
       });
   }
   ```

3. Erst danach fügen wir die Werkzeugergebnisse als user Nachrichten hinzu:
   ```javascript
   updatedMessages.push(createToolResultMessage(
       result.toolUse.id,
       result.toolUse.name,
       resultValue,
       isError
   ));
   ```

Diese Struktur entspricht der Erwartung der Claude API, dass jedes Werkzeugergebnis einen entsprechenden Werkzeugaufruf in der vorherigen Nachricht haben muss.

## 2. Probleme bei der JSON-Serialisierung von Werkzeugergebnissen

### Problem
Bei komplexen Objekten oder zirkulären Referenzen kann die JSON-Serialisierung von Werkzeugergebnissen fehlschlagen.

### Lösung
Wir haben eine robuste Fehlerbehandlung implementiert, die verschiedene Datentypen berücksichtigt:

```javascript
if (typeof result.result === 'string') {
    resultValue = result.result;
} else if (Array.isArray(result.result)) {
    // Für Array-Ergebnisse (z.B. Verzeichnislisten) formatieren wir das Array als Text
    resultValue = result.result.join('\n');
} else if (typeof result.result === 'object') {
    try {
        resultValue = JSON.stringify(result.result, null, 2);
    } catch (e) {
        resultValue = `[Objekt kann nicht serialisiert werden: ${e.message}]`;
    }
} else {
    resultValue = String(result.result);
}
```

## 3. Schwierigkeiten bei der Zuordnung von Werkzeugergebnissen zu Werkzeuganfragen

### Problem
In der Implementierung können Werkzeugergebnisse manchmal nicht eindeutig den ursprünglichen Werkzeuganfragen zugeordnet werden, was zu fehlenden IDs oder Fehlern führt.

### Lösung
Wir haben einen mehrstufigen Ansatz implementiert, um die Zuordnung robust zu gestalten:

```javascript
// Referenz auf das ursprüngliche Werkzeug finden
let matchingTask = null;
// Wenn das Ergebnis bereits eine Werkzeugreferenz hat
if (result.toolUse) {
    matchingTask = tasks.find(t => t.toolUse && t.toolUse.id === result.toolUse.id);
} 
// Oder versuche, die Werkzeugreferenz aus den Ereignissen zu extrahieren
else if (result.events && result.events.length > 0) {
    const toolEvent = result.events.find(e => e.toolUse);
    if (toolEvent && toolEvent.toolUse) {
        matchingTask = tasks.find(t => t.toolUse && t.toolUse.id === toolEvent.toolUse.id);
    }
}

// Erstelle ein vollständiges Ergebnisobjekt mit allen erforderlichen Eigenschaften
const completeResult = {
    ...result,
    toolUse: (matchingTask && matchingTask.toolUse) ? matchingTask.toolUse : 
             (result.toolUse ? result.toolUse : null)
};
```

## 4. Unvollständige JSON-Parsen bei Werkzeug-Input

### Problem
Die JSON-Deltas für Werkzeug-Inputs kommen in Teilen an und können während der Übertragung unvollständig sein, was zu Parsing-Fehlern führt.

### Lösung
Wir sammeln die JSON-Teile und versuchen erst dann zu parsen, wenn wir ein vollständiges JSON-Objekt haben:

```javascript
currentToolInputJson += event.data.delta.partial_json;

try {
    if (currentToolInputJson.trim() && 
        currentToolInputJson.trim().startsWith('{') && 
        currentToolInputJson.trim().endsWith('}')) {
        
        const inputObj = JSON.parse(currentToolInputJson);
        
        // Aktualisiere den Input im entsprechenden Tool-Use-Request
        const toolRequest = toolUseRequests.find(req => req.id === currentToolUseId);
        if (toolRequest) {
            toolRequest.input = inputObj;
        }
    }
} catch (e) {
    // JSON noch nicht vollständig - normal
}
```

## 5. Fehlende Fehlerbehandlung bei Werkzeugausführung

### Problem
Wenn Werkzeuge Fehler werfen, können diese die gesamte Anwendung zum Absturz bringen, wenn sie nicht ordnungsgemäß behandelt werden.

### Lösung
Wir haben robuste Try-Catch-Blöcke um die Werkzeugausführung implementiert und geben Fehler als spezielle Ergebnisobjekte zurück:

```javascript
try {
    // Führe das Werkzeug aus
    const result = await tool.call(params, { requestPermission });
    
    // ... Erfolgsfall ...
    
} catch (error) {
    console.error(`Fehler bei der Ausführung von ${toolUse.name}:`, error);
    return { 
        events: [], 
        error: error.message 
    };
}
```

## 6. Asynchrone Ausgabekonflikte & Timing-Probleme (Vorzeitiger/Fehlender Prompt)

### Problem
Nach Werkzeugausführung oder bei komplexeren Abläufen erschien der Eingabe-Prompt (`>`) zu früh (bevor die gesamte Antwort ausgegeben wurde), gar nicht mehr, oder es kam zu "verstümmelten" Textausgaben ("Garbled Text").

### Ursache
Die Hauptursache war eine unzureichende Synchronisation zwischen der asynchronen Natur der Stream-Verarbeitung in `query.js` und der Konsolenausgabe sowie der Steuerung der `readline`-Instanz in `index.js`. `index.js` wusste nicht zuverlässig, wann eine komplette Anfrage-Antwort-Runde (inklusive Rekursionen und Berechtigungsabfragen) abgeschlossen war und zeigte den Prompt daher zum falschen Zeitpunkt an oder wurde durch parallele Ereignisse blockiert.

### Lösung
Eine mehrstufige Lösung war erforderlich:
1.  **Explizites Endsignal:** `query.js` sendet ein eindeutiges `{ type: 'turn_complete' }`-Event, *nur* wenn der oberste Aufruf der Funktion abgeschlossen ist.
2.  **Zentrale Zustandssteuerung:** `index.js` verwaltet den Zustand `isAwaitingUserInput`.
3.  **Event-gesteuerte `readline`-Kontrolle:** `index.js` pausiert (`rl.pause()`) und setzt (`rl.resume()`) die Haupt-`readline`-Instanz basierend auf Signalen aus `query.js` (`awaiting_permissions`, `permissions_resolved`, `turn_complete`).
4.  **Prompt nur bei Abschluss:** Der Prompt (`rl.prompt()`) wird in `index.js` *nur* noch aufgerufen, wenn das `turn_complete`-Signal empfangen wird (oder bei Fehlern/Abbruch).
5.  **Bereinigung:** Entfernung redundanter Logik (z.B. `console.log('\n')` nach der Hauptschleife), die das Timing störte.

## 7. Eingabekonflikte bei parallelen Abfragen (z.B. Berechtigungen)

### Problem
Bei der Eingabe für die Berechtigungsabfrage erschienen Buchstaben doppelt ("jjaa"). Obwohl die Berechtigung funktionierte, erschien der finale Prompt am Ende nicht mehr.

### Ursache
Die Eingabe für die Berechtigung löste sowohl den Handler der temporären `readline`-Instanz als auch den (`line`-Event) der Haupt-`readline`-Instanz aus. Da die Hauptinstanz nicht korrekt pausiert wurde, geriet ihr Zustand durcheinander und sie konnte den finalen Prompt nicht mehr anzeigen. Das doppelte Echo entstand durch das Standard-Echo des Terminals und das zusätzliche Echo der (ursprünglich falsch konfigurierten) temporären `readline`-Instanz.

### Lösung
1.  **Haupt-Readline Pausieren/Fortsetzen:** Die Haupt-`readline`-Instanz (`rl`) wird von `index.js` über Events aus `query.js` gesteuert (`rl.pause()` vor der Berechtigungsphase, `rl.resume()` danach).
2.  **Dedizierte Temporäre Readline:** Die `requestPermission`-Funktion verwendet eine eigene, temporäre `readline.createInterface`.
3.  **Echo Unterdrücken:** Diese temporäre Instanz wird mit einem Dummy-"Writable Stream" als `output` konfiguriert, der alle Daten verwirft. Der Prompt (`> `) und der finale Zeilenumbruch werden manuell auf `process.stdout` geschrieben.

## 8. Fehlende/Falsche Nachrichtenstruktur bei Rekursion

### Problem
Die Claude API meldete einen Fehler: `unexpected 'tool_use_id' found in 'tool_result' blocks...` nach einer erfolgreichen Werkzeugausführung, wenn das Ergebnis zurück an Claude gesendet wurde.

### Ursache
Die für den rekursiven Aufruf von `query` zusammengestellte Nachrichtenliste (`updatedMessages`) entsprach nicht der von der API erwarteten Struktur. Es wurde fälschlicherweise versucht, Textinhalte der vorherigen Assistentenantwort mit den `tool_use`-Blöcken zu kombinieren.

### Lösung
Die Nachrichtenstruktur für den rekursiven Aufruf muss *exakt* dem API-Schema folgen:
1.  Die ursprüngliche Nachrichtenliste (`...messages`).
2.  Eine einzelne `assistant`-Nachricht, die *nur* die `tool_use`-Blöcke als Array im `content`-Feld enthält.
3.  Die darauf folgenden `user`-Nachrichten (erzeugt durch `createToolResultMessage`), die jeweils einen `tool_result`-Block enthalten.

```javascript
// In query.js, vor dem rekursiven Aufruf:
const updatedMessages = [...messages];

// 1. Assistant-Nachricht mit tool_use hinzufügen
if (toolUseRequests.length > 0) {
    const toolUseContentBlocks = toolUseRequests.map(toolUse => ({ /* ... tool_use block ... */ }));
    updatedMessages.push({
        role: 'assistant',
        content: toolUseContentBlocks
    });
}

// 2. Tool-Ergebnisse verarbeiten und User-Nachrichten hinzufügen
for await (const result of executeTasksOptimally(tasks, {}, 5)) {
    // ... resultValue formatieren ...
    updatedMessages.push(createToolResultMessage(
        result.toolUse.id, 
        result.toolUse.name,
        resultValue,
        isError
    ));
}

// 3. Rekursiver Aufruf
yield* query(updatedMessages, ...);
```

## 9. Fehler bei der Verarbeitung von Generator-Ergebnissen

### Problem
Ein `TypeError: Cannot read properties of undefined (reading 'id')` trat auf beim Versuch, das Ergebnis eines Werkzeugs nach dem Aufruf von `executeTasksOptimally` zu verarbeiten (`result.toolUse.id`).

### Ursache
Die Funktion (`fn`), die das eigentliche Werkzeug aufruft und an `executeTasksOptimally` übergeben wurde, war fälschlicherweise als asynchroner Generator (`async function*`) deklariert. Generatoren geben ihre finalen Werte mit `return` zurück, aber `executeTasksOptimally` war darauf ausgelegt, mit normalen `async function`-Promises zu arbeiten, die ihren Wert ebenfalls mit `return` zurückgeben. Die Hilfsfunktion konnte den `return`-Wert des Generators nicht korrekt extrahieren.

### Lösung
Die Werkzeugaufruf-Funktion (`fn` in `tasks.map` in `query.js`) muss eine normale `async function` sein. Statusmeldungen, die *während* der Ausführung gesendet werden sollen (wie `tool_executing`), dürfen nicht mit `yield` innerhalb dieser `fn` erfolgen. Stattdessen müssen solche Status-Events *vor* dem Aufruf der Funktion, die die Werkzeuge ausführt (z.B. `executeTasksOptimally`), in einer separaten Schleife über die anstehenden Aufgaben gesendet werden.

```javascript
// In query.js:

// 1. Tasks definieren mit normaler async function
const tasks = toolUseRequests.map(toolUse => {
    return {
        fn: async (params, context) => { // Normale async function
            // KEIN yield hier!
            try {
                const result = await tool.call(params, { requestPermission });
                return { toolUse, result, error: null }; // Ergebnis mit return
            } catch (error) {
                return { toolUse, result: null, error: error.message };
            }
        },
        // ... restliche Task-Properties ...
    };
});

// 2. Status-Events VOR der Ausführung senden
for (const toolUse of toolUseRequests) {
     let executionDisplayText = formatToolUseForDisplay(toolUse);
     yield { type: 'tool_executing', toolUseId: toolUse.id, /* ... */ };
}

// 3. Tasks ausführen
for await (const result of executeTasksOptimally(tasks, {}, 5)) {
    // Hier ist result jetzt das korrekte Objekt mit result.toolUse
    yield { type: 'tool_result', toolUseId: result.toolUse.id, /* ... */ }; 
    // ... Ergebnis verarbeiten ...
}
```

## Fazit

Die meisten Probleme bei der Implementierung des Agentic Systems entstehen durch:

1. **Falsche Nachrichtenstruktur**: Die Claude API erwartet eine bestimmte Struktur für Werkzeuganfragen und -ergebnisse.
2. **Komplexe Datentypen**: Probleme bei der Serialisierung komplexer Objekte oder großer Datensätze.
3. **Asynchrone Verarbeitung**: Die asynchrone Natur von Werkzeugaufrufen und Ereignisverarbeitung erfordert sorgfältige Koordination.
4. **Fehlerbehandlung**: Robuste Fehlerbehandlung auf allen Ebenen ist entscheidend für ein stabiles System.

Durch das Verständnis dieser häufigen Probleme und die Implementierung der entsprechenden Lösungen haben wir ein zuverlässigeres und robusteres Agentic System geschaffen. 