// =============================================================================
// Invoke Handler — invoke deployed WASM services via HTTP
// =============================================================================

// =============================================================================
// Result type
// =============================================================================

export interface InvokeResult {
    ok: boolean;
    output?: string;
    status?: number;
    durationMs?: number;
    error?: string;
    errorCode?: "unreachable" | "timeout" | "invalid_response" | "http_error";
}

// =============================================================================
// Handler
// =============================================================================

export async function handleInvoke(
    url: string,
    input?: string,
    options?: { timeoutMs?: number; method?: string; headers?: Record<string, string> },
): Promise<InvokeResult> {
    const method = options?.method?.toUpperCase() ?? "POST";
    const timeoutMs = options?.timeoutMs ?? 10_000;
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...options?.headers,
    };

    const start = Date.now();
    try {
        const fetchOptions: RequestInit = {
            method,
            headers,
            signal: AbortSignal.timeout(timeoutMs),
        };
        // Only set body for non-GET/HEAD methods when input is provided
        if (input !== undefined && method !== "GET" && method !== "HEAD") {
            fetchOptions.body = input;
        }

        const response = await fetch(url, fetchOptions);
        const body = await response.text();
        const durationMs = Date.now() - start;

        if (response.ok) {
            return { ok: true, output: body, status: response.status, durationMs };
        }
        return {
            ok: false,
            output: body,
            status: response.status,
            durationMs,
            error: `HTTP ${response.status}: ${response.statusText}`,
            errorCode: "http_error",
        };
    } catch (err: unknown) {
        const durationMs = Date.now() - start;
        const message = err instanceof Error ? err.message : String(err);

        // Timeout detection: AbortSignal.timeout throws a TimeoutError (DOMException with name "TimeoutError")
        if (err instanceof DOMException && err.name === "TimeoutError") {
            return { ok: false, durationMs, error: `Request timed out after ${timeoutMs}ms`, errorCode: "timeout" };
        }
        // Also catch AbortError (in case of manual abort)
        if (err instanceof DOMException && err.name === "AbortError") {
            return { ok: false, durationMs, error: `Request aborted: ${message}`, errorCode: "timeout" };
        }

        // Network/DNS errors
        if (err instanceof TypeError || message.includes("fetch failed") || message.includes("ECONNREFUSED") || message.includes("ENOTFOUND")) {
            return { ok: false, durationMs, error: `Service unreachable: ${message}`, errorCode: "unreachable" };
        }

        return { ok: false, durationMs, error: `Unexpected error: ${message}`, errorCode: "invalid_response" };
    }
}
