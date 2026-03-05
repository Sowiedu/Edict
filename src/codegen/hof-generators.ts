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
