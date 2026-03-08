// =============================================================================
// DateTime domain — now, formatDate, parseDate, diffMs
// =============================================================================

import type { BuiltinDef } from "../builtin-types.js";
import { INT64_TYPE, STRING_TYPE } from "../../ast/type-constants.js";
import { readString, writeStringResult, formatDateString, type HostContext } from "../host-helpers.js";

export const DATETIME_BUILTINS: BuiltinDef[] = [
    {
        name: "now",
        type: { kind: "fn_type", params: [], effects: ["reads"], returnType: INT64_TYPE },
        impl: { kind: "host", factory: () => (): bigint => BigInt(Date.now()) },
    },
    {
        name: "formatDate",
        type: { kind: "fn_type", params: [INT64_TYPE, STRING_TYPE], effects: ["pure"], returnType: STRING_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (timestamp: bigint, fmtPtr: number): number => {
                const fmt = readString(ctx.state, fmtPtr, ctx.decoder);
                const date = new Date(Number(timestamp));
                return writeStringResult(ctx.state, formatDateString(date, fmt), ctx.encoder);
            },
        },
    },
    {
        name: "parseDate",
        type: { kind: "fn_type", params: [STRING_TYPE, STRING_TYPE], effects: ["fails"], returnType: INT64_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (strPtr: number, _fmtPtr: number): bigint => {
                const str = readString(ctx.state, strPtr, ctx.decoder);
                const ms = Date.parse(str);
                if (isNaN(ms)) {
                    throw new Error(`parseDate: invalid date string "${str}"`);
                }
                return BigInt(ms);
            },
        },
    },
    {
        name: "diffMs",
        type: { kind: "fn_type", params: [INT64_TYPE, INT64_TYPE], effects: ["pure"], returnType: INT64_TYPE },
        impl: { kind: "host", factory: () => (a: bigint, b: bigint): bigint => a - b },
    },
];
