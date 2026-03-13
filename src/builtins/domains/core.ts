// =============================================================================
// Core domain — print, string_replace
// =============================================================================

import type { BuiltinDef } from "../builtin-types.js";
import { STRING_TYPE } from "../../ast/type-constants.js";
import { readString, writeStringResult, type HostContext } from "../host-helpers.js";

export const CORE_BUILTINS: BuiltinDef[] = [
    {
        name: "print",
        type: {
            kind: "fn_type",
            params: [STRING_TYPE],
            effects: ["io"],
            returnType: STRING_TYPE,
        },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (ptr: number): number => {
                const text = readString(ctx.state, ptr, ctx.decoder);
                ctx.state.outputParts.push(text);
                return ptr;
            },
        },
    },
    {
        name: "println",
        type: {
            kind: "fn_type",
            params: [STRING_TYPE],
            effects: ["io"],
            returnType: STRING_TYPE,
        },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (ptr: number): number => {
                const text = readString(ctx.state, ptr, ctx.decoder);
                ctx.state.outputParts.push(text + "\n");
                return ptr;
            },
        },
    },
    {
        name: "string_replace",
        type: {
            kind: "fn_type",
            params: [STRING_TYPE, STRING_TYPE, STRING_TYPE],
            effects: ["pure"],
            returnType: STRING_TYPE,
        },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (
                hayPtr: number,
                needlePtr: number,
                replPtr: number,
            ): number => {
                const haystack = readString(ctx.state, hayPtr, ctx.decoder);
                const needle = readString(ctx.state, needlePtr, ctx.decoder);
                const replacement = readString(ctx.state, replPtr, ctx.decoder);
                return writeStringResult(ctx.state, haystack.replaceAll(needle, replacement), ctx.encoder);
            },
        },
    },
    {
        name: "toString",
        type: {
            kind: "fn_type",
            params: [STRING_TYPE],
            effects: ["pure"],
            returnType: STRING_TYPE,
        },
        impl: {
            kind: "host",
            factory: (_ctx: HostContext) => (ptr: number): number => ptr,
        },
    },
];
