// =============================================================================
// IO domain — readFile, writeFile, env, args, exit (adapter-delegated)
// =============================================================================

import type { BuiltinDef } from "../builtin-types.js";
import { INT_TYPE, STRING_TYPE, RESULT_STRING_TYPE } from "../../ast/type-constants.js";
import { readString, writeStringResult, writeResultValue, type HostContext } from "../host-helpers.js";

export const IO_BUILTINS: BuiltinDef[] = [
    {
        name: "readFile",
        type: { kind: "fn_type", params: [STRING_TYPE], effects: ["io"], returnType: RESULT_STRING_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (pathPtr: number): number => {
                const result = ctx.adapter.readFile(readString(ctx.state, pathPtr, ctx.decoder));
                if (result.ok) {
                    const strPtr = writeStringResult(ctx.state, result.data, ctx.encoder);
                    return writeResultValue(ctx.state, 0, strPtr);
                } else {
                    const errPtr = writeStringResult(ctx.state, result.error, ctx.encoder);
                    return writeResultValue(ctx.state, 1, errPtr);
                }
            },
        },
    },
    {
        name: "writeFile",
        type: { kind: "fn_type", params: [STRING_TYPE, STRING_TYPE], effects: ["io"], returnType: RESULT_STRING_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (pathPtr: number, contentPtr: number): number => {
                const result = ctx.adapter.writeFile(
                    readString(ctx.state, pathPtr, ctx.decoder),
                    readString(ctx.state, contentPtr, ctx.decoder),
                );
                if (result.ok) {
                    const okPtr = writeStringResult(ctx.state, "ok", ctx.encoder);
                    return writeResultValue(ctx.state, 0, okPtr);
                } else {
                    const errPtr = writeStringResult(ctx.state, result.error, ctx.encoder);
                    return writeResultValue(ctx.state, 1, errPtr);
                }
            },
        },
    },
    {
        name: "env",
        type: { kind: "fn_type", params: [STRING_TYPE], effects: ["reads"], returnType: STRING_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (namePtr: number): number => {
                const name = readString(ctx.state, namePtr, ctx.decoder);
                return writeStringResult(ctx.state, ctx.adapter.env(name), ctx.encoder);
            },
        },
    },
    {
        name: "args",
        type: { kind: "fn_type", params: [], effects: ["reads"], returnType: STRING_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (): number => {
                const argsJson = JSON.stringify(ctx.adapter.args());
                return writeStringResult(ctx.state, argsJson, ctx.encoder);
            },
        },
    },
    {
        name: "exit",
        type: { kind: "fn_type", params: [INT_TYPE], effects: ["io"], returnType: INT_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (code: number): number => {
                ctx.adapter.exit(code);
            },
        },
    },
];
