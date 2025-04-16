/**
 * Executes asynchronous generators sequentially.
 * @param {Array<function>} generatorFunctions - An array of async generator functions.
 * @param {object} context - A context object that is passed to each generator function.
 * @yields {any} - The values output by each generator.
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
 * Executes asynchronous generators in parallel (with limited concurrency).
 * @param {Array<function>} generatorFunctions - An array of async generator functions.
 * @param {object} context - A context object that is passed to each generator function.
 * @param {number} maxConcurrency - The maximum number of concurrently running generators.
 * @yields {object} - { index, value }, where index is the index of generatorFunctions and value is the output value.
 */
async function* runConcurrently(generatorFunctions, context = {}, maxConcurrency = 5) {
    if (!generatorFunctions.length) return;

    // Keep track of active generators and their indices
    const activeGenerators = new Map();
    // Keep track of the next generator function to be started
    let nextIndex = 0;

    // Initialize the first generators up to maximum concurrency
    for (let i = 0; i < Math.min(maxConcurrency, generatorFunctions.length); i++) {
        const generator = generatorFunctions[i](context);
        activeGenerators.set(i, generator);
    }
    nextIndex = Math.min(maxConcurrency, generatorFunctions.length);

    // As long as there are active generators, process them
    while (activeGenerators.size > 0) {
        // Create an array of promises for the next value of each active generator
        const nextValuePromises = Array.from(activeGenerators.entries()).map(
            async ([index, generator]) => {
                try {
                    const result = await generator.next();
                    return { index, result };
                } catch (error) {
                    console.error(`Error in generator ${index}:`, error);
                    return { index, error };
                }
            }
        );

        // Wait for the first generator to output a value or complete
        const { index, result, error } = await Promise.race(nextValuePromises);

        if (error) {
            // Remove the generator that caused an error
            activeGenerators.delete(index);
            // Start the next generator, if available
            if (nextIndex < generatorFunctions.length) {
                const generator = generatorFunctions[nextIndex](context);
                activeGenerators.set(nextIndex, generator);
                nextIndex++;
            }
            continue;
        }

        if (result.done) {
            // Remove the completed generator
            activeGenerators.delete(index);
            // Start the next generator, if available
            if (nextIndex < generatorFunctions.length) {
                const generator = generatorFunctions[nextIndex](context);
                activeGenerators.set(nextIndex, generator);
                nextIndex++;
            }
        } else {
            // Output the value with index for identification
            yield { index, value: result.value };
        }
    }
}

/**
 * Executes asynchronous generators based on whether they are read-only or not.
 * Write generators are executed sequentially, read generators in parallel.
 * @param {Array<object>} tasks - Array of task objects { fn, isReadOnly, params }.
 * @param {object} context - A context object for generators.
 * @param {number} maxConcurrency - The maximum number of parallel read tasks.
 * @yields {any} - The values output by the generators.
 */
async function* executeTasksOptimally(tasks, context = {}, maxConcurrency = 5) {
    if (!tasks.length) return;

    // Separate read and write tasks
    const readOnlyTasks = tasks.filter(task => task.isReadOnly);
    const writeTasks = tasks.filter(task => !task.isReadOnly);

    // Create generator functions for read tasks
    const readOnlyGenerators = readOnlyTasks.map(task => async function* (ctx) {
        try {
            const result = await task.fn(task.params, ctx);
            yield result;
        } catch (error) {
            console.error(`Error in read task:`, error);
            yield { error, events: [] };
        }
    });

    // Create generator functions for write tasks
    const writeGenerators = writeTasks.map(task => async function* (ctx) {
        try {
            const result = await task.fn(task.params, ctx);
            yield result;
        } catch (error) {
            console.error(`Error in write task:`, error);
            yield { error, events: [] };
        }
    });

    // Execute read tasks in parallel
    if (readOnlyGenerators.length > 0) {
        console.log(`Executing ${readOnlyGenerators.length} read tasks in parallel...`);
        for await (const { index, value } of runConcurrently(readOnlyGenerators, context, maxConcurrency)) {
            yield value;
        }
    }

    // Execute write tasks sequentially
    if (writeGenerators.length > 0) {
        console.log(`Executing ${writeGenerators.length} write tasks sequentially...`);
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
