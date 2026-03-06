// =============================================================================
// HOF Array Builtin WASM Generation
// =============================================================================
// These builtins need call_indirect to invoke closure arguments, so they
// are generated as internal WASM functions rather than host imports.
//
// Array layout: [length:i32][elem0:i32][elem1:i32]...
// Closure pair: [table_index:i32][env_ptr:i32]
// Closure calling convention: call_indirect(table, idx, [env_ptr, ...args])

import binaryen from "binaryen";

/**
 * Generate array_map(arrPtr: i32, closurePtr: i32) → i32
 *
 * Allocates a new array, maps each element through the closure, returns result ptr.
 */
export function generateArrayMap(mod: binaryen.Module): void {
    // Params: arrPtr=0, closurePtr=1
    // Locals: length=2, tableIdx=3, envPtr=4, resultPtr=5, i=6
    const paramType = binaryen.createType([binaryen.i32, binaryen.i32]);
    const vars = [
        binaryen.i32, // length
        binaryen.i32, // tableIdx
        binaryen.i32, // envPtr
        binaryen.i32, // resultPtr
        binaryen.i32, // i
    ];

    const arrPtr = 0, closurePtr = 1, length = 2, tableIdx = 3, envPtr = 4, resultPtr = 5, idx = 6;

    // callbackType: (env:i32, elem:i32) → i32
    const callbackParamType = binaryen.createType([binaryen.i32, binaryen.i32]);

    const body = mod.block(null, [
        // length = i32.load(arrPtr, 0)
        mod.local.set(length, mod.i32.load(0, 0, mod.local.get(arrPtr, binaryen.i32))),
        // tableIdx = i32.load(closurePtr, 0)
        mod.local.set(tableIdx, mod.i32.load(0, 0, mod.local.get(closurePtr, binaryen.i32))),
        // envPtr = i32.load(closurePtr, 4)
        mod.local.set(envPtr, mod.i32.load(4, 0, mod.local.get(closurePtr, binaryen.i32))),
        // resultPtr = __heap_ptr
        mod.local.set(resultPtr, mod.global.get("__heap_ptr", binaryen.i32)),
        // __heap_ptr += 4 + length * 4
        mod.global.set("__heap_ptr", mod.i32.add(
            mod.global.get("__heap_ptr", binaryen.i32),
            mod.i32.add(mod.i32.const(4), mod.i32.mul(mod.local.get(length, binaryen.i32), mod.i32.const(4))),
        )),
        // i32.store(resultPtr, 0, length)
        mod.i32.store(0, 0, mod.local.get(resultPtr, binaryen.i32), mod.local.get(length, binaryen.i32)),
        // i = 0
        mod.local.set(idx, mod.i32.const(0)),
        // loop
        mod.if(
            mod.i32.gt_s(mod.local.get(length, binaryen.i32), mod.i32.const(0)),
            mod.loop("map_loop", mod.block(null, [
                // result[i] = call_indirect(tableIdx, [envPtr, arr[i]])
                mod.i32.store(
                    4, 0, // offset 4 + i*4 from resultPtr
                    mod.i32.add(mod.local.get(resultPtr, binaryen.i32), mod.i32.mul(mod.local.get(idx, binaryen.i32), mod.i32.const(4))),
                    mod.call_indirect(
                        "__fn_table",
                        mod.local.get(tableIdx, binaryen.i32),
                        [
                            mod.local.get(envPtr, binaryen.i32),
                            // arr[i] = i32.load(arrPtr + 4 + i*4)
                            mod.i32.load(4, 0, mod.i32.add(
                                mod.local.get(arrPtr, binaryen.i32),
                                mod.i32.mul(mod.local.get(idx, binaryen.i32), mod.i32.const(4)),
                            )),
                        ],
                        callbackParamType,
                        binaryen.i32,
                    ),
                ),
                // i++
                mod.local.set(idx, mod.i32.add(mod.local.get(idx, binaryen.i32), mod.i32.const(1))),
                // br_if map_loop (i < length)
                mod.br("map_loop", mod.i32.lt_s(mod.local.get(idx, binaryen.i32), mod.local.get(length, binaryen.i32))),
            ], binaryen.none)),
        ),
        // return resultPtr
        mod.local.get(resultPtr, binaryen.i32),
    ], binaryen.i32);

    mod.addFunction("array_map", paramType, binaryen.i32, vars, body);
}

/**
 * Generate array_filter(arrPtr: i32, closurePtr: i32) → i32
 *
 * Single-pass overalloc: allocates max-length result, filters in one pass,
 * then writes actual count. Tail waste is acceptable (arena allocator).
 */
export function generateArrayFilter(mod: binaryen.Module): void {
    // Params: arrPtr=0, closurePtr=1
    // Locals: length=2, tableIdx=3, envPtr=4, resultPtr=5, i=6, count=7, elem=8
    const paramType = binaryen.createType([binaryen.i32, binaryen.i32]);
    const vars = [
        binaryen.i32, // length
        binaryen.i32, // tableIdx
        binaryen.i32, // envPtr
        binaryen.i32, // resultPtr
        binaryen.i32, // i
        binaryen.i32, // count
        binaryen.i32, // elem
    ];

    const arrPtr = 0, closurePtr = 1, length = 2, tableIdx = 3, envPtr = 4, resultPtr = 5, idx = 6, count = 7, elem = 8;

    // callbackType: (env:i32, elem:i32) → i32 (bool)
    const callbackParamType = binaryen.createType([binaryen.i32, binaryen.i32]);

    const body = mod.block(null, [
        // length = i32.load(arrPtr, 0)
        mod.local.set(length, mod.i32.load(0, 0, mod.local.get(arrPtr, binaryen.i32))),
        // tableIdx = i32.load(closurePtr, 0)
        mod.local.set(tableIdx, mod.i32.load(0, 0, mod.local.get(closurePtr, binaryen.i32))),
        // envPtr = i32.load(closurePtr, 4)
        mod.local.set(envPtr, mod.i32.load(4, 0, mod.local.get(closurePtr, binaryen.i32))),
        // resultPtr = __heap_ptr (overalloc: 4 + length*4)
        mod.local.set(resultPtr, mod.global.get("__heap_ptr", binaryen.i32)),
        mod.global.set("__heap_ptr", mod.i32.add(
            mod.global.get("__heap_ptr", binaryen.i32),
            mod.i32.add(mod.i32.const(4), mod.i32.mul(mod.local.get(length, binaryen.i32), mod.i32.const(4))),
        )),
        // count = 0, i = 0
        mod.local.set(count, mod.i32.const(0)),
        mod.local.set(idx, mod.i32.const(0)),
        // loop
        mod.if(
            mod.i32.gt_s(mod.local.get(length, binaryen.i32), mod.i32.const(0)),
            mod.loop("filter_loop", mod.block(null, [
                // elem = arr[i]
                mod.local.set(elem, mod.i32.load(4, 0, mod.i32.add(
                    mod.local.get(arrPtr, binaryen.i32),
                    mod.i32.mul(mod.local.get(idx, binaryen.i32), mod.i32.const(4)),
                ))),
                // if call_indirect(tableIdx, [envPtr, elem]) != 0
                mod.if(
                    mod.call_indirect(
                        "__fn_table",
                        mod.local.get(tableIdx, binaryen.i32),
                        [
                            mod.local.get(envPtr, binaryen.i32),
                            mod.local.get(elem, binaryen.i32),
                        ],
                        callbackParamType,
                        binaryen.i32,
                    ),
                    mod.block(null, [
                        // result[count] = elem
                        mod.i32.store(
                            4, 0,
                            mod.i32.add(mod.local.get(resultPtr, binaryen.i32), mod.i32.mul(mod.local.get(count, binaryen.i32), mod.i32.const(4))),
                            mod.local.get(elem, binaryen.i32),
                        ),
                        // count++
                        mod.local.set(count, mod.i32.add(mod.local.get(count, binaryen.i32), mod.i32.const(1))),
                    ], binaryen.none),
                ),
                // i++
                mod.local.set(idx, mod.i32.add(mod.local.get(idx, binaryen.i32), mod.i32.const(1))),
                // br_if filter_loop (i < length)
                mod.br("filter_loop", mod.i32.lt_s(mod.local.get(idx, binaryen.i32), mod.local.get(length, binaryen.i32))),
            ], binaryen.none)),
        ),
        // Write actual count as result length
        mod.i32.store(0, 0, mod.local.get(resultPtr, binaryen.i32), mod.local.get(count, binaryen.i32)),
        // return resultPtr
        mod.local.get(resultPtr, binaryen.i32),
    ], binaryen.i32);

    mod.addFunction("array_filter", paramType, binaryen.i32, vars, body);
}

/**
 * Generate array_reduce(arrPtr: i32, init: i32, closurePtr: i32) → i32
 *
 * Folds array elements into an accumulator via the closure.
 */
export function generateArrayReduce(mod: binaryen.Module): void {
    // Params: arrPtr=0, init=1, closurePtr=2
    // Locals: length=3, tableIdx=4, envPtr=5, acc=6, i=7
    const paramType = binaryen.createType([binaryen.i32, binaryen.i32, binaryen.i32]);
    const vars = [
        binaryen.i32, // length
        binaryen.i32, // tableIdx
        binaryen.i32, // envPtr
        binaryen.i32, // acc
        binaryen.i32, // i
    ];

    const arrPtr = 0, init = 1, closurePtr = 2, length = 3, tableIdx = 4, envPtr = 5, acc = 6, idx = 7;

    // callbackType: (env:i32, acc:i32, elem:i32) → i32
    const callbackParamType = binaryen.createType([binaryen.i32, binaryen.i32, binaryen.i32]);

    const body = mod.block(null, [
        // length = i32.load(arrPtr, 0)
        mod.local.set(length, mod.i32.load(0, 0, mod.local.get(arrPtr, binaryen.i32))),
        // tableIdx = i32.load(closurePtr, 0)
        mod.local.set(tableIdx, mod.i32.load(0, 0, mod.local.get(closurePtr, binaryen.i32))),
        // envPtr = i32.load(closurePtr, 4)
        mod.local.set(envPtr, mod.i32.load(4, 0, mod.local.get(closurePtr, binaryen.i32))),
        // acc = init
        mod.local.set(acc, mod.local.get(init, binaryen.i32)),
        // i = 0
        mod.local.set(idx, mod.i32.const(0)),
        // loop
        mod.if(
            mod.i32.gt_s(mod.local.get(length, binaryen.i32), mod.i32.const(0)),
            mod.loop("reduce_loop", mod.block(null, [
                // acc = call_indirect(tableIdx, [envPtr, acc, arr[i]])
                mod.local.set(acc, mod.call_indirect(
                    "__fn_table",
                    mod.local.get(tableIdx, binaryen.i32),
                    [
                        mod.local.get(envPtr, binaryen.i32),
                        mod.local.get(acc, binaryen.i32),
                        mod.i32.load(4, 0, mod.i32.add(
                            mod.local.get(arrPtr, binaryen.i32),
                            mod.i32.mul(mod.local.get(idx, binaryen.i32), mod.i32.const(4)),
                        )),
                    ],
                    callbackParamType,
                    binaryen.i32,
                )),
                // i++
                mod.local.set(idx, mod.i32.add(mod.local.get(idx, binaryen.i32), mod.i32.const(1))),
                // br_if reduce_loop (i < length)
                mod.br("reduce_loop", mod.i32.lt_s(mod.local.get(idx, binaryen.i32), mod.local.get(length, binaryen.i32))),
            ], binaryen.none)),
        ),
        // return acc
        mod.local.get(acc, binaryen.i32),
    ], binaryen.i32);

    mod.addFunction("array_reduce", paramType, binaryen.i32, vars, body);
}

/**
 * Generate array_find(arrPtr: i32, closurePtr: i32) → i32
 *
 * Scans array, calls predicate on each element. Returns Option<Int>:
 *   - Some(elem): heap-allocated [tag=1][pad(4)][value][pad(4)]
 *   - None:       heap-allocated [tag=0][pad(4)]
 *
 * Option layout matches the built-in enum: None=tag0/8 bytes, Some=tag1/16 bytes.
 */
export function generateArrayFind(mod: binaryen.Module): void {
    // Params: arrPtr=0, closurePtr=1
    // Locals: length=2, tableIdx=3, envPtr=4, i=5, elem=6, resultPtr=7
    const paramType = binaryen.createType([binaryen.i32, binaryen.i32]);
    const vars = [
        binaryen.i32, // length
        binaryen.i32, // tableIdx
        binaryen.i32, // envPtr
        binaryen.i32, // i
        binaryen.i32, // elem
        binaryen.i32, // resultPtr
    ];

    const arrPtr = 0, closurePtr = 1, length = 2, tableIdx = 3, envPtr = 4, idx = 5, elem = 6, resultPtr = 7;

    // callbackType: (env:i32, elem:i32) → i32 (bool)
    const callbackParamType = binaryen.createType([binaryen.i32, binaryen.i32]);

    // Inner loop block label — we use "find_block" so we can br out on match
    const body = mod.block(null, [
        // length = i32.load(arrPtr, 0)
        mod.local.set(length, mod.i32.load(0, 0, mod.local.get(arrPtr, binaryen.i32))),
        // tableIdx = i32.load(closurePtr, 0)
        mod.local.set(tableIdx, mod.i32.load(0, 0, mod.local.get(closurePtr, binaryen.i32))),
        // envPtr = i32.load(closurePtr, 4)
        mod.local.set(envPtr, mod.i32.load(4, 0, mod.local.get(closurePtr, binaryen.i32))),
        // i = 0
        mod.local.set(idx, mod.i32.const(0)),
        // Search loop — break out when found
        mod.if(
            mod.i32.gt_s(mod.local.get(length, binaryen.i32), mod.i32.const(0)),
            mod.block("find_block", [
                mod.loop("find_loop", mod.block(null, [
                    // elem = arr[i]
                    mod.local.set(elem, mod.i32.load(4, 0, mod.i32.add(
                        mod.local.get(arrPtr, binaryen.i32),
                        mod.i32.mul(mod.local.get(idx, binaryen.i32), mod.i32.const(4)),
                    ))),
                    // if predicate(elem) → return Some(elem)
                    mod.if(
                        mod.call_indirect(
                            "__fn_table",
                            mod.local.get(tableIdx, binaryen.i32),
                            [
                                mod.local.get(envPtr, binaryen.i32),
                                mod.local.get(elem, binaryen.i32),
                            ],
                            callbackParamType,
                            binaryen.i32,
                        ),
                        mod.block(null, [
                            // Allocate Some(elem): [tag=1][pad][value][pad] = 16 bytes
                            mod.local.set(resultPtr, mod.global.get("__heap_ptr", binaryen.i32)),
                            mod.global.set("__heap_ptr", mod.i32.add(
                                mod.global.get("__heap_ptr", binaryen.i32),
                                mod.i32.const(16),
                            )),
                            // Write tag = 1 (Some)
                            mod.i32.store(0, 0, mod.local.get(resultPtr, binaryen.i32), mod.i32.const(1)),
                            // Write value at offset 8
                            mod.i32.store(8, 0, mod.local.get(resultPtr, binaryen.i32), mod.local.get(elem, binaryen.i32)),
                            // Break out of search block
                            mod.br("find_block"),
                        ], binaryen.none),
                    ),
                    // i++
                    mod.local.set(idx, mod.i32.add(mod.local.get(idx, binaryen.i32), mod.i32.const(1))),
                    // br_if find_loop (i < length)
                    mod.br("find_loop", mod.i32.lt_s(mod.local.get(idx, binaryen.i32), mod.local.get(length, binaryen.i32))),
                ], binaryen.none)),
                // If we reach here, no match found → allocate None
                mod.local.set(resultPtr, mod.global.get("__heap_ptr", binaryen.i32)),
                mod.global.set("__heap_ptr", mod.i32.add(
                    mod.global.get("__heap_ptr", binaryen.i32),
                    mod.i32.const(8),
                )),
                // Write tag = 0 (None)
                mod.i32.store(0, 0, mod.local.get(resultPtr, binaryen.i32), mod.i32.const(0)),
            ], binaryen.none),
            // Empty array → allocate None
            mod.block(null, [
                mod.local.set(resultPtr, mod.global.get("__heap_ptr", binaryen.i32)),
                mod.global.set("__heap_ptr", mod.i32.add(
                    mod.global.get("__heap_ptr", binaryen.i32),
                    mod.i32.const(8),
                )),
                mod.i32.store(0, 0, mod.local.get(resultPtr, binaryen.i32), mod.i32.const(0)),
            ], binaryen.none),
        ),
        // return resultPtr
        mod.local.get(resultPtr, binaryen.i32),
    ], binaryen.i32);

    mod.addFunction("array_find", paramType, binaryen.i32, vars, body);
}

/**
 * Generate array_sort(arrPtr: i32, closurePtr: i32) → i32
 *
 * Copies the input array to a new heap allocation, then sorts in-place
 * using insertion sort. The comparator closure returns:
 *   negative if a < b, 0 if a == b, positive if a > b (C qsort convention).
 */
export function generateArraySort(mod: binaryen.Module): void {
    // Params: arrPtr=0, closurePtr=1
    // Locals: length=2, tableIdx=3, envPtr=4, resultPtr=5,
    //         i=6, j=7, key=8, cmpResult=9
    const paramType = binaryen.createType([binaryen.i32, binaryen.i32]);
    const vars = [
        binaryen.i32, // length
        binaryen.i32, // tableIdx
        binaryen.i32, // envPtr
        binaryen.i32, // resultPtr
        binaryen.i32, // i (outer loop)
        binaryen.i32, // j (inner loop)
        binaryen.i32, // key
        binaryen.i32, // cmpResult
    ];

    const arrPtr = 0, closurePtr = 1, length = 2, tableIdx = 3, envPtr = 4,
        resultPtr = 5, i = 6, j = 7, key = 8;

    // callbackType: (env:i32, a:i32, b:i32) → i32
    const callbackParamType = binaryen.createType([binaryen.i32, binaryen.i32, binaryen.i32]);

    // Helper: result[idx] = i32.load(resultPtr + 4 + idx*4)
    const loadResult = (idxLocal: number) =>
        mod.i32.load(4, 0, mod.i32.add(
            mod.local.get(resultPtr, binaryen.i32),
            mod.i32.mul(mod.local.get(idxLocal, binaryen.i32), mod.i32.const(4)),
        ));

    const storeResult = (idxLocal: number, value: binaryen.ExpressionRef) =>
        mod.i32.store(4, 0,
            mod.i32.add(
                mod.local.get(resultPtr, binaryen.i32),
                mod.i32.mul(mod.local.get(idxLocal, binaryen.i32), mod.i32.const(4)),
            ),
            value,
        );

    const body = mod.block(null, [
        // length = i32.load(arrPtr, 0)
        mod.local.set(length, mod.i32.load(0, 0, mod.local.get(arrPtr, binaryen.i32))),
        // tableIdx = i32.load(closurePtr, 0)
        mod.local.set(tableIdx, mod.i32.load(0, 0, mod.local.get(closurePtr, binaryen.i32))),
        // envPtr = i32.load(closurePtr, 4)
        mod.local.set(envPtr, mod.i32.load(4, 0, mod.local.get(closurePtr, binaryen.i32))),

        // Allocate result array: [length][elem0]...[elemN-1]
        mod.local.set(resultPtr, mod.global.get("__heap_ptr", binaryen.i32)),
        mod.global.set("__heap_ptr", mod.i32.add(
            mod.global.get("__heap_ptr", binaryen.i32),
            mod.i32.add(mod.i32.const(4), mod.i32.mul(mod.local.get(length, binaryen.i32), mod.i32.const(4))),
        )),
        // Write length header
        mod.i32.store(0, 0, mod.local.get(resultPtr, binaryen.i32), mod.local.get(length, binaryen.i32)),

        // Copy elements from input to result
        mod.local.set(i, mod.i32.const(0)),
        mod.if(
            mod.i32.gt_s(mod.local.get(length, binaryen.i32), mod.i32.const(0)),
            mod.loop("copy_loop", mod.block(null, [
                storeResult(i, mod.i32.load(4, 0, mod.i32.add(
                    mod.local.get(arrPtr, binaryen.i32),
                    mod.i32.mul(mod.local.get(i, binaryen.i32), mod.i32.const(4)),
                ))),
                mod.local.set(i, mod.i32.add(mod.local.get(i, binaryen.i32), mod.i32.const(1))),
                mod.br("copy_loop", mod.i32.lt_s(mod.local.get(i, binaryen.i32), mod.local.get(length, binaryen.i32))),
            ], binaryen.none)),
        ),

        // Insertion sort: for i = 1 to length-1
        mod.if(
            mod.i32.gt_s(mod.local.get(length, binaryen.i32), mod.i32.const(1)),
            mod.block(null, [
                mod.local.set(i, mod.i32.const(1)),
                mod.loop("sort_outer", mod.block(null, [
                    // key = result[i]
                    mod.local.set(key, loadResult(i)),
                    // j = i - 1
                    mod.local.set(j, mod.i32.sub(mod.local.get(i, binaryen.i32), mod.i32.const(1))),

                    // Inner loop: while j >= 0 && compare(result[j], key) > 0
                    mod.block("shift_break", [
                        mod.loop("shift_loop", mod.block(null, [
                            // if j < 0, break
                            mod.br("shift_break", mod.i32.lt_s(mod.local.get(j, binaryen.i32), mod.i32.const(0))),
                            // cmp = compare(result[j], key)
                            // if cmp <= 0, break
                            mod.br("shift_break", mod.i32.le_s(
                                mod.call_indirect(
                                    "__fn_table",
                                    mod.local.get(tableIdx, binaryen.i32),
                                    [
                                        mod.local.get(envPtr, binaryen.i32),
                                        loadResult(j),
                                        mod.local.get(key, binaryen.i32),
                                    ],
                                    callbackParamType,
                                    binaryen.i32,
                                ),
                                mod.i32.const(0),
                            )),
                            // result[j+1] = result[j]
                            mod.i32.store(4, 0,
                                mod.i32.add(
                                    mod.local.get(resultPtr, binaryen.i32),
                                    mod.i32.mul(
                                        mod.i32.add(mod.local.get(j, binaryen.i32), mod.i32.const(1)),
                                        mod.i32.const(4),
                                    ),
                                ),
                                loadResult(j),
                            ),
                            // j--
                            mod.local.set(j, mod.i32.sub(mod.local.get(j, binaryen.i32), mod.i32.const(1))),
                            mod.br("shift_loop"),
                        ], binaryen.none)),
                    ], binaryen.none),

                    // result[j+1] = key
                    mod.i32.store(4, 0,
                        mod.i32.add(
                            mod.local.get(resultPtr, binaryen.i32),
                            mod.i32.mul(
                                mod.i32.add(mod.local.get(j, binaryen.i32), mod.i32.const(1)),
                                mod.i32.const(4),
                            ),
                        ),
                        mod.local.get(key, binaryen.i32),
                    ),

                    // i++
                    mod.local.set(i, mod.i32.add(mod.local.get(i, binaryen.i32), mod.i32.const(1))),
                    // br_if sort_outer (i < length)
                    mod.br("sort_outer", mod.i32.lt_s(mod.local.get(i, binaryen.i32), mod.local.get(length, binaryen.i32))),
                ], binaryen.none)),
            ], binaryen.none),
        ),

        // return resultPtr
        mod.local.get(resultPtr, binaryen.i32),
    ], binaryen.i32);

    mod.addFunction("array_sort", paramType, binaryen.i32, vars, body);
}
