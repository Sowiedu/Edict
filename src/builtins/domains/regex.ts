// =============================================================================
// Regex domain — regexTest, regexMatch, regexReplace
// =============================================================================

import type { BuiltinDef } from "../builtin-types.js";
import { STRING_TYPE, BOOL_TYPE } from "../../ast/type-constants.js";
import { readString, writeStringResult, type HostContext } from "../host-helpers.js";

export const REGEX_BUILTINS: BuiltinDef[] = [
    {
        name: "regexTest",
        type: { kind: "fn_type", params: [STRING_TYPE, STRING_TYPE], effects: ["pure"], returnType: BOOL_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (patPtr: number, inputPtr: number): number => {
                const pattern = readString(ctx.state, patPtr, ctx.decoder);
                const input = readString(ctx.state, inputPtr, ctx.decoder);
                try {
                    return new RegExp(pattern).test(input) ? 1 : 0;
                } catch {
                    return 0; // invalid regex → false
                }
            },
        },
    },
    {
        name: "regexMatch",
        type: { kind: "fn_type", params: [STRING_TYPE, STRING_TYPE], effects: ["pure"], returnType: STRING_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (patPtr: number, inputPtr: number): number => {
                const pattern = readString(ctx.state, patPtr, ctx.decoder);
                const input = readString(ctx.state, inputPtr, ctx.decoder);
                try {
                    const m = input.match(new RegExp(pattern));
                    return writeStringResult(ctx.state, m ? m[0]! : "", ctx.encoder);
                } catch {
                    return writeStringResult(ctx.state, "", ctx.encoder); // invalid regex → empty string
                }
            },
        },
    },
    {
        name: "regexReplace",
        type: {
            kind: "fn_type",
            params: [STRING_TYPE, STRING_TYPE, STRING_TYPE],
            effects: ["pure"],
            returnType: STRING_TYPE,
        },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (
                inputPtr: number,
                patPtr: number,
                replPtr: number,
            ): number => {
                const input = readString(ctx.state, inputPtr, ctx.decoder);
                const pattern = readString(ctx.state, patPtr, ctx.decoder);
                const replacement = readString(ctx.state, replPtr, ctx.decoder);
                try {
                    return writeStringResult(ctx.state, input.replace(new RegExp(pattern, "g"), replacement), ctx.encoder);
                } catch {
                    return writeStringResult(ctx.state, input, ctx.encoder); // invalid regex → unchanged
                }
            },
        },
    },
];
