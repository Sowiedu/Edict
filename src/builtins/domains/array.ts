// =============================================================================
// Array domain — host-imported array ops + WASM-native HOF builtins
// =============================================================================

import type { BuiltinDef } from "../builtin-types.js";
import { INT_TYPE, BOOL_TYPE, T_TYPE, U_TYPE, ARRAY_T_TYPE, OPTION_T_TYPE } from "../../ast/type-constants.js";
import { getMemoryBuffer, writeArrayResult, type HostContext } from "../host-helpers.js";
import { generateArrayMap, generateArrayFilter, generateArrayReduce, generateArrayFind, generateArraySort } from "../../codegen/hof-generators.js";

// ── Host-imported array builtins ────────────────────────────────────────────

const HOST_ARRAY_BUILTINS: BuiltinDef[] = [
    {
        name: "array_length",
        type: { kind: "fn_type", params: [ARRAY_T_TYPE], effects: ["pure"], returnType: INT_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (arrPtr: number): number => {
                return new DataView(getMemoryBuffer(ctx.state)).getInt32(arrPtr, true);
            },
        },
    },
    {
        name: "array_get",
        type: { kind: "fn_type", params: [ARRAY_T_TYPE, INT_TYPE], effects: ["pure"], returnType: T_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (arrPtr: number, index: number): number => {
                const view = new DataView(getMemoryBuffer(ctx.state));
                const length = view.getInt32(arrPtr, true);
                if (index < 0 || index >= length) return 0;
                return view.getInt32(arrPtr + 4 + index * 4, true);
            },
        },
    },
    {
        name: "array_set",
        type: { kind: "fn_type", params: [ARRAY_T_TYPE, INT_TYPE, T_TYPE], effects: ["pure"], returnType: ARRAY_T_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (arrPtr: number, index: number, value: number): number => {
                const view = new DataView(getMemoryBuffer(ctx.state));
                const length = view.getInt32(arrPtr, true);
                const elems: number[] = [];
                for (let i = 0; i < length; i++) {
                    elems.push(i === index ? value : view.getInt32(arrPtr + 4 + i * 4, true));
                }
                return writeArrayResult(ctx.state, elems);
            },
        },
    },
    {
        name: "array_push",
        type: { kind: "fn_type", params: [ARRAY_T_TYPE, T_TYPE], effects: ["pure"], returnType: ARRAY_T_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (arrPtr: number, value: number): number => {
                const view = new DataView(getMemoryBuffer(ctx.state));
                const length = view.getInt32(arrPtr, true);
                const elems: number[] = [];
                for (let i = 0; i < length; i++) {
                    elems.push(view.getInt32(arrPtr + 4 + i * 4, true));
                }
                elems.push(value);
                return writeArrayResult(ctx.state, elems);
            },
        },
    },
    {
        name: "array_pop",
        type: { kind: "fn_type", params: [ARRAY_T_TYPE], effects: ["pure"], returnType: ARRAY_T_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (arrPtr: number): number => {
                const view = new DataView(getMemoryBuffer(ctx.state));
                const length = view.getInt32(arrPtr, true);
                if (length === 0) return writeArrayResult(ctx.state, []);
                const elems: number[] = [];
                for (let i = 0; i < length - 1; i++) {
                    elems.push(view.getInt32(arrPtr + 4 + i * 4, true));
                }
                return writeArrayResult(ctx.state, elems);
            },
        },
    },
    {
        name: "array_concat",
        type: { kind: "fn_type", params: [ARRAY_T_TYPE, ARRAY_T_TYPE], effects: ["pure"], returnType: ARRAY_T_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (aPtr: number, bPtr: number): number => {
                const view = new DataView(getMemoryBuffer(ctx.state));
                const aLen = view.getInt32(aPtr, true);
                const bLen = view.getInt32(bPtr, true);
                const elems: number[] = [];
                for (let i = 0; i < aLen; i++) {
                    elems.push(view.getInt32(aPtr + 4 + i * 4, true));
                }
                for (let i = 0; i < bLen; i++) {
                    elems.push(view.getInt32(bPtr + 4 + i * 4, true));
                }
                return writeArrayResult(ctx.state, elems);
            },
        },
    },
    {
        name: "array_slice",
        type: { kind: "fn_type", params: [ARRAY_T_TYPE, INT_TYPE, INT_TYPE], effects: ["pure"], returnType: ARRAY_T_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (arrPtr: number, start: number, end: number): number => {
                const view = new DataView(getMemoryBuffer(ctx.state));
                const length = view.getInt32(arrPtr, true);
                const s = Math.max(0, Math.min(start, length));
                const e = Math.max(s, Math.min(end, length));
                const elems: number[] = [];
                for (let i = s; i < e; i++) {
                    elems.push(view.getInt32(arrPtr + 4 + i * 4, true));
                }
                return writeArrayResult(ctx.state, elems);
            },
        },
    },
    {
        name: "array_isEmpty",
        type: { kind: "fn_type", params: [ARRAY_T_TYPE], effects: ["pure"], returnType: BOOL_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (arrPtr: number): number => {
                return new DataView(getMemoryBuffer(ctx.state)).getInt32(arrPtr, true) === 0 ? 1 : 0;
            },
        },
    },
    {
        name: "array_contains",
        type: { kind: "fn_type", params: [ARRAY_T_TYPE, T_TYPE], effects: ["pure"], returnType: BOOL_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (arrPtr: number, value: number): number => {
                const view = new DataView(getMemoryBuffer(ctx.state));
                const length = view.getInt32(arrPtr, true);
                for (let i = 0; i < length; i++) {
                    if (view.getInt32(arrPtr + 4 + i * 4, true) === value) return 1;
                }
                return 0;
            },
        },
    },
    {
        name: "array_reverse",
        type: { kind: "fn_type", params: [ARRAY_T_TYPE], effects: ["pure"], returnType: ARRAY_T_TYPE },
        impl: {
            kind: "host",
            factory: (ctx: HostContext) => (arrPtr: number): number => {
                const view = new DataView(getMemoryBuffer(ctx.state));
                const length = view.getInt32(arrPtr, true);
                const elems: number[] = [];
                for (let i = length - 1; i >= 0; i--) {
                    elems.push(view.getInt32(arrPtr + 4 + i * 4, true));
                }
                return writeArrayResult(ctx.state, elems);
            },
        },
    },
];

// ── WASM-native HOF builtins ────────────────────────────────────────────────

const WASM_ARRAY_BUILTINS: BuiltinDef[] = [
    {
        name: "array_map",
        type: {
            kind: "fn_type",
            params: [
                ARRAY_T_TYPE,
                { kind: "fn_type", params: [T_TYPE], effects: [], returnType: U_TYPE },
            ],
            effects: ["pure"],
            returnType: { kind: "array", element: U_TYPE },
        },
        impl: { kind: "wasm", generator: generateArrayMap },
    },
    {
        name: "array_filter",
        type: {
            kind: "fn_type",
            params: [
                ARRAY_T_TYPE,
                { kind: "fn_type", params: [T_TYPE], effects: [], returnType: BOOL_TYPE },
            ],
            effects: ["pure"],
            returnType: ARRAY_T_TYPE,
        },
        impl: { kind: "wasm", generator: generateArrayFilter },
    },
    {
        name: "array_reduce",
        type: {
            kind: "fn_type",
            params: [
                ARRAY_T_TYPE,
                U_TYPE,
                { kind: "fn_type", params: [U_TYPE, T_TYPE], effects: [], returnType: U_TYPE },
            ],
            effects: ["pure"],
            returnType: U_TYPE,
        },
        impl: { kind: "wasm", generator: generateArrayReduce },
    },
    {
        name: "array_find",
        type: {
            kind: "fn_type",
            params: [
                ARRAY_T_TYPE,
                { kind: "fn_type", params: [T_TYPE], effects: [], returnType: BOOL_TYPE },
            ],
            effects: ["pure"],
            returnType: OPTION_T_TYPE,
        },
        impl: { kind: "wasm", generator: generateArrayFind },
    },
    {
        name: "array_sort",
        type: {
            kind: "fn_type",
            params: [
                ARRAY_T_TYPE,
                { kind: "fn_type", params: [T_TYPE, T_TYPE], effects: [], returnType: INT_TYPE },
            ],
            effects: ["pure"],
            returnType: ARRAY_T_TYPE,
        },
        impl: { kind: "wasm", generator: generateArraySort },
    },
];

// ── Combined export ─────────────────────────────────────────────────────────

export const ARRAY_BUILTINS: BuiltinDef[] = [...HOST_ARRAY_BUILTINS, ...WASM_ARRAY_BUILTINS];
