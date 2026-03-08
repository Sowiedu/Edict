// =============================================================================
// JSON domain — jsonParse, jsonStringify
// =============================================================================

import type { BuiltinDef } from "../builtin-types.js";
import { STRING_TYPE, RESULT_STRING_TYPE } from "../../ast/type-constants.js";
import { readString, writeStringResult, writeResultValue, type HostContext } from "../host-helpers.js";

export const JSON_BUILTINS: BuiltinDef[] = [
    {
        name: "jsonParse",
        type: { kind: "fn_type", params: [STRING_TYPE], effects: ["pure"], returnType: RESULT_STRING_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (ptr: number): number => {
                const str = readString(ctx.state, ptr, ctx.decoder);
                try {
                    JSON.parse(str);
                    // Valid JSON — return Ok(strPtr) with original string
                    const strPtr = writeStringResult(ctx.state, str, ctx.encoder);
                    return writeResultValue(ctx.state, 0, strPtr); // Ok
                } catch (e) {
                    const msg = e instanceof Error ? e.message : "Invalid JSON";
                    const errPtr = writeStringResult(ctx.state, msg, ctx.encoder);
                    return writeResultValue(ctx.state, 1, errPtr); // Err
                }
            },
        },
    },
    {
        name: "jsonStringify",
        type: { kind: "fn_type", params: [STRING_TYPE], effects: ["pure"], returnType: STRING_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (ptr: number): number => {
                const str = readString(ctx.state, ptr, ctx.decoder);
                try {
                    const parsed = JSON.parse(str);
                    return writeStringResult(ctx.state, JSON.stringify(parsed), ctx.encoder);
                } catch {
                    // If input is not valid JSON, return it unchanged
                    return writeStringResult(ctx.state, str, ctx.encoder);
                }
            },
        },
    },
];
