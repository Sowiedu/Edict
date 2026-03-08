// =============================================================================
// HTTP domain — httpGet, httpPost, httpPut, httpDelete (adapter-delegated)
// =============================================================================

import type { BuiltinDef } from "../builtin-types.js";
import { STRING_TYPE, RESULT_STRING_TYPE } from "../../ast/type-constants.js";
import { readString, writeStringResult, writeResultValue, type HostContext } from "../host-helpers.js";

function makeResult(ctx: HostContext, fetchResult: { ok: boolean; data: string }): number {
    const strPtr = writeStringResult(ctx.state, fetchResult.data, ctx.encoder);
    return writeResultValue(ctx.state, fetchResult.ok ? 0 : 1, strPtr);
}

export const HTTP_BUILTINS: BuiltinDef[] = [
    {
        name: "httpGet",
        type: { kind: "fn_type", params: [STRING_TYPE], effects: ["io"], returnType: RESULT_STRING_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (urlPtr: number): number => {
                return makeResult(ctx, ctx.adapter.fetch(readString(ctx.state, urlPtr, ctx.decoder), "GET"));
            },
        },
    },
    {
        name: "httpPost",
        type: { kind: "fn_type", params: [STRING_TYPE, STRING_TYPE], effects: ["io"], returnType: RESULT_STRING_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (urlPtr: number, bodyPtr: number): number => {
                return makeResult(ctx, ctx.adapter.fetch(
                    readString(ctx.state, urlPtr, ctx.decoder),
                    "POST",
                    readString(ctx.state, bodyPtr, ctx.decoder),
                ));
            },
        },
    },
    {
        name: "httpPut",
        type: { kind: "fn_type", params: [STRING_TYPE, STRING_TYPE], effects: ["io"], returnType: RESULT_STRING_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (urlPtr: number, bodyPtr: number): number => {
                return makeResult(ctx, ctx.adapter.fetch(
                    readString(ctx.state, urlPtr, ctx.decoder),
                    "PUT",
                    readString(ctx.state, bodyPtr, ctx.decoder),
                ));
            },
        },
    },
    {
        name: "httpDelete",
        type: { kind: "fn_type", params: [STRING_TYPE], effects: ["io"], returnType: RESULT_STRING_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (urlPtr: number): number => {
                return makeResult(ctx, ctx.adapter.fetch(readString(ctx.state, urlPtr, ctx.decoder), "DELETE"));
            },
        },
    },
];
