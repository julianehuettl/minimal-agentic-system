/**
 * Führt asynchrone Generatoren sequentiell aus.
 * @param {Array<function>} generatorFunctions - Ein Array von async Generator-Funktionen.
 * @param {object} context - Ein Kontext-Objekt, das an jede Generator-Funktion übergeben wird.
 * @yields {any} - Die Werte, die von jedem Generator ausgegeben werden.
 */
async function* runSequentially(generatorFunctions, context = {}) {
    for (const genFn of generatorFunctions) {
        const generator = genFn(context);
        for await (const value of generator) {
            yield value;
        }
    }
}

/**
 * Führt asynchrone Generatoren parallel aus (mit Begrenzung der Parallelität).
 * @param {Array<function>} generatorFunctions - Ein Array von async Generator-Funktionen.
 * @param {object} context - Ein Kontext-Objekt, das an jede Generator-Funktion übergeben wird.
 * @param {number} maxConcurrency - Die maximale Anzahl von parallel laufenden Generatoren.
 * @yields {object} - { index, value }, wobei index der Index der generatorFunctions ist und value der ausgegebene Wert ist.
 */
async function* runConcurrently(generatorFunctions, context = {}, maxConcurrency = 5) {
    if (!generatorFunctions.length) return;

    // Halte aktive Generatoren und ihre Indizes
    const activeGenerators = new Map();
    // Halte die nächste Generator-Funktion, die gestartet werden soll
    let nextIndex = 0;

    // Initialisiere die ersten Generatoren bis zur maximalen Parallelität
    for (let i = 0; i < Math.min(maxConcurrency, generatorFunctions.length); i++) {
        const generator = generatorFunctions[i](context);
        activeGenerators.set(i, generator);
    }
    nextIndex = Math.min(maxConcurrency, generatorFunctions.length);

    // Solange aktive Generatoren vorhanden sind, verarbeite sie
    while (activeGenerators.size > 0) {
        // Erstelle ein Array von Promises für den nächsten Wert jedes aktiven Generators
        const nextValuePromises = Array.from(activeGenerators.entries()).map(
            async ([index, generator]) => {
                try {
                    const result = await generator.next();
                    return { index, result };
                } catch (error) {
                    console.error(`Fehler im Generator ${index}:`, error);
                    return { index, error };
                }
            }
        );

        // Warte auf den ersten Generator, der einen Wert ausgibt oder beendet wird
        const { index, result, error } = await Promise.race(nextValuePromises);

        if (error) {
            // Entferne den Generator, der einen Fehler ausgelöst hat
            activeGenerators.delete(index);
            // Starte den nächsten Generator, falls vorhanden
            if (nextIndex < generatorFunctions.length) {
                const generator = generatorFunctions[nextIndex](context);
                activeGenerators.set(nextIndex, generator);
                nextIndex++;
            }
            continue;
        }

        if (result.done) {
            // Entferne den abgeschlossenen Generator
            activeGenerators.delete(index);
            // Starte den nächsten Generator, falls vorhanden
            if (nextIndex < generatorFunctions.length) {
                const generator = generatorFunctions[nextIndex](context);
                activeGenerators.set(nextIndex, generator);
                nextIndex++;
            }
        } else {
            // Gib den Wert aus mit Index für die Identifikation
            yield { index, value: result.value };
        }
    }
}

/**
 * Führt asynchrone Generatoren aus, abhängig davon, ob sie nur lesend sind oder nicht.
 * Schreibende Generatoren werden sequentiell ausgeführt, lesende parallel.
 * @param {Array<object>} tasks - Array von Aufgabenobjekten { fn, isReadOnly, params }.
 * @param {object} context - Ein Kontext-Objekt für Generatoren.
 * @param {number} maxConcurrency - Die maximale Anzahl paralleler lesender Aufgaben.
 * @yields {any} - Die Werte, die von den Generatoren ausgegeben werden.
 */
async function* executeTasksOptimally(tasks, context = {}, maxConcurrency = 5) {
    if (!tasks.length) return;

    // Trenne lesende und schreibende Aufgaben
    const readOnlyTasks = tasks.filter(task => task.isReadOnly);
    const writeTasks = tasks.filter(task => !task.isReadOnly);

    // Erzeuge Generator-Funktionen für lesende Aufgaben
    const readOnlyGenerators = readOnlyTasks.map(task => async function* (ctx) {
        try {
            const result = await task.fn(task.params, ctx);
            yield result;
        } catch (error) {
            console.error(`Fehler bei lesender Aufgabe:`, error);
            yield { error, events: [] };
        }
    });

    // Erzeuge Generator-Funktionen für schreibende Aufgaben
    const writeGenerators = writeTasks.map(task => async function* (ctx) {
        try {
            const result = await task.fn(task.params, ctx);
            yield result;
        } catch (error) {
            console.error(`Fehler bei schreibender Aufgabe:`, error);
            yield { error, events: [] };
        }
    });

    // Führe lesende Aufgaben parallel aus
    if (readOnlyGenerators.length > 0) {
        console.log(`Führe ${readOnlyGenerators.length} lesende Aufgaben parallel aus...`);
        for await (const { index, value } of runConcurrently(readOnlyGenerators, context, maxConcurrency)) {
            yield value;
        }
    }

    // Führe schreibende Aufgaben sequentiell aus
    if (writeGenerators.length > 0) {
        console.log(`Führe ${writeGenerators.length} schreibende Aufgaben sequentiell aus...`);
        for await (const value of runSequentially(writeGenerators, context)) {
            yield value;
        }
    }
}

module.exports = {
    runSequentially,
    runConcurrently,
    executeTasksOptimally,
};
