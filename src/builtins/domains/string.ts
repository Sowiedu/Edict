// =============================================================================
// String domain — string_length, substring, string_concat, etc.
// =============================================================================

import type { BuiltinDef } from "../builtin-types.js";
import { INT_TYPE, STRING_TYPE, BOOL_TYPE } from "../../ast/type-constants.js";
import { readString, writeStringResult, type HostContext } from "../host-helpers.js";

export const STRING_BUILTINS: BuiltinDef[] = [
    {
        name: "string_length",
        type: { kind: "fn_type", params: [STRING_TYPE], effects: ["pure"], returnType: INT_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (ptr: number): number => {
                const str = readString(ctx.state, ptr, ctx.decoder);
                return str.length;
            },
        },
    },
    {
        name: "substring",
        type: { kind: "fn_type", params: [STRING_TYPE, INT_TYPE, INT_TYPE], effects: ["pure"], returnType: STRING_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (ptr: number, start: number, end: number): number => {
                const str = readString(ctx.state, ptr, ctx.decoder);
                return writeStringResult(ctx.state, str.substring(start, end), ctx.encoder);
            },
        },
    },
    {
        name: "string_concat",
        type: { kind: "fn_type", params: [STRING_TYPE, STRING_TYPE], effects: ["pure"], returnType: STRING_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (aPtr: number, bPtr: number): number => {
                const a = readString(ctx.state, aPtr, ctx.decoder);
                const b = readString(ctx.state, bPtr, ctx.decoder);
                return writeStringResult(ctx.state, a + b, ctx.encoder);
            },
        },
    },
    {
        name: "string_indexOf",
        type: { kind: "fn_type", params: [STRING_TYPE, STRING_TYPE], effects: ["pure"], returnType: INT_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (hayPtr: number, needlePtr: number): number => {
                const haystack = readString(ctx.state, hayPtr, ctx.decoder);
                const needle = readString(ctx.state, needlePtr, ctx.decoder);
                return haystack.indexOf(needle);
            },
        },
    },
    {
        name: "toUpperCase",
        type: { kind: "fn_type", params: [STRING_TYPE], effects: ["pure"], returnType: STRING_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (ptr: number): number => {
                const str = readString(ctx.state, ptr, ctx.decoder);
                return writeStringResult(ctx.state, str.toUpperCase(), ctx.encoder);
            },
        },
    },
    {
        name: "toLowerCase",
        type: { kind: "fn_type", params: [STRING_TYPE], effects: ["pure"], returnType: STRING_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (ptr: number): number => {
                const str = readString(ctx.state, ptr, ctx.decoder);
                return writeStringResult(ctx.state, str.toLowerCase(), ctx.encoder);
            },
        },
    },
    {
        name: "string_trim",
        type: { kind: "fn_type", params: [STRING_TYPE], effects: ["pure"], returnType: STRING_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (ptr: number): number => {
                const str = readString(ctx.state, ptr, ctx.decoder);
                return writeStringResult(ctx.state, str.trim(), ctx.encoder);
            },
        },
    },
    {
        name: "string_startsWith",
        type: { kind: "fn_type", params: [STRING_TYPE, STRING_TYPE], effects: ["pure"], returnType: BOOL_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (strPtr: number, prefixPtr: number): number => {
                const str = readString(ctx.state, strPtr, ctx.decoder);
                const prefix = readString(ctx.state, prefixPtr, ctx.decoder);
                return str.startsWith(prefix) ? 1 : 0;
            },
        },
    },
    {
        name: "string_endsWith",
        type: { kind: "fn_type", params: [STRING_TYPE, STRING_TYPE], effects: ["pure"], returnType: BOOL_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (strPtr: number, suffixPtr: number): number => {
                const str = readString(ctx.state, strPtr, ctx.decoder);
                const suffix = readString(ctx.state, suffixPtr, ctx.decoder);
                return str.endsWith(suffix) ? 1 : 0;
            },
        },
    },
    {
        name: "string_contains",
        type: { kind: "fn_type", params: [STRING_TYPE, STRING_TYPE], effects: ["pure"], returnType: BOOL_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (hayPtr: number, needlePtr: number): number => {
                const haystack = readString(ctx.state, hayPtr, ctx.decoder);
                const needle = readString(ctx.state, needlePtr, ctx.decoder);
                return haystack.includes(needle) ? 1 : 0;
            },
        },
    },
    {
        name: "string_repeat",
        type: { kind: "fn_type", params: [STRING_TYPE, INT_TYPE], effects: ["pure"], returnType: STRING_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (ptr: number, count: number): number => {
                const str = readString(ctx.state, ptr, ctx.decoder);
                return writeStringResult(ctx.state, str.repeat(count), ctx.encoder);
            },
        },
    },
];
