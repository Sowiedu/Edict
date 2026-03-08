// =============================================================================
// Crypto domain — sha256, md5, hmac (adapter-delegated)
// =============================================================================

import type { BuiltinDef } from "../builtin-types.js";
import { STRING_TYPE } from "../../ast/type-constants.js";
import { readString, writeStringResult, type HostContext } from "../host-helpers.js";

export const CRYPTO_BUILTINS: BuiltinDef[] = [
    {
        name: "sha256",
        type: { kind: "fn_type", params: [STRING_TYPE], effects: ["pure"], returnType: STRING_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (ptr: number): number => {
                const str = readString(ctx.state, ptr, ctx.decoder);
                return writeStringResult(ctx.state, ctx.adapter.sha256(str), ctx.encoder);
            },
        },
    },
    {
        name: "md5",
        type: { kind: "fn_type", params: [STRING_TYPE], effects: ["pure"], returnType: STRING_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (ptr: number): number => {
                const str = readString(ctx.state, ptr, ctx.decoder);
                return writeStringResult(ctx.state, ctx.adapter.md5(str), ctx.encoder);
            },
        },
    },
    {
        name: "hmac",
        type: {
            kind: "fn_type",
            params: [STRING_TYPE, STRING_TYPE, STRING_TYPE],
            effects: ["pure"],
            returnType: STRING_TYPE,
        },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (
                algoPtr: number,
                keyPtr: number,
                dataPtr: number,
            ): number => {
                const algo = readString(ctx.state, algoPtr, ctx.decoder);
                const key = readString(ctx.state, keyPtr, ctx.decoder);
                const data = readString(ctx.state, dataPtr, ctx.decoder);
                return writeStringResult(ctx.state, ctx.adapter.hmac(algo, key, data), ctx.encoder);
            },
        },
    },
];
