/* Regression: the GDK permits deleting/reusing XAsyncBlock in completion.
 * No Xbox identity, game files, network, or save data is used. */
#define COBJMACROS
#define INITGUID
#include <windows.h>
#include <stdio.h>
#include "xtaskqueue.h"
#include "xasyncprovider.h"

static IXThreadingImpl *threads;
static XTaskQueueHandle queue;
static LONG callbacks, cleanups, checks, failures;
static HRESULT outcome;
static SIZE_T payload;
static BOOL consume, reuse;
#define CHECK(x) do { InterlockedIncrement(&checks); if (!(x)) { InterlockedIncrement(&failures); printf("FAIL %d\n", __LINE__); } } while (0)

static HRESULT WINAPI provider(XAsyncOp op, const XAsyncProviderData *data)
{
    if (op == XAsyncOp_GetResult && data->buffer) *(DWORD *)data->buffer = 0x12345678;
    if (op == XAsyncOp_Cleanup) InterlockedIncrement(&cleanups);
    return S_OK;
}

static void WINAPI completed(XAsyncBlock *block)
{
    DWORD result = 0;
    CHECK(IXThreadingImpl_XAsyncGetStatus(threads, block, FALSE) == outcome);
    if (consume) {
        CHECK(IXThreadingImpl_XAsyncGetResult(threads, block, NULL, sizeof(result), &result, NULL) == S_OK);
        CHECK(result == 0x12345678);
    }
    InterlockedIncrement(&callbacks);
    if (reuse) {
        /* A new state must not make the old completion clean it by mistake. */
        /* Native XAsync snapshots callback at Begin. Set it for the next
         * operation before Begin, not after it has already been captured. */
        block->callback = NULL;
        CHECK(IXThreadingImpl_XAsyncBegin(threads, block, NULL, NULL, "reused", provider) == S_OK);
    } else {
        CHECK(VirtualFree(block, 0, MEM_RELEASE));
    }
}

/* Provider-owned payloads must survive result consumption until completion
 * returns, including when GetResult runs before a manually queued callback. */
struct payload_operation
{
    XAsyncBlock block;
    DWORD payload, *result, *pending_result;
    unsigned cleanup, callbacks, get_results, cancels;
    BOOL early_result, skip_result, race_result;
};

static void check_consumed_result(struct payload_operation *test)
{
    DWORD sentinel = 0x87654321;
    DWORD *result = &sentinel;
    SIZE_T used = 123;
    CHECK(IXThreadingImpl_XAsyncGetResult(threads, &test->block, test,
        sizeof(result), &result, &used) == E_ILLEGAL_METHOD_CALL);
    CHECK(result == &sentinel && used == 123);
    CHECK(test->get_results == 1);
    IXThreadingImpl_XAsyncCancel(threads, &test->block);
    CHECK(test->cancels == 0);
}

static void retrieve_payload(struct payload_operation *test)
{
    SIZE_T used = 123;
    CHECK(IXThreadingImpl_XAsyncGetResult(threads, &test->block, NULL,
        sizeof(test->result), &test->result, &used) == E_INVALIDARG);
    CHECK(IXThreadingImpl_XAsyncGetResult(threads, &test->block, test,
        sizeof(test->result), NULL, &used) == E_INVALIDARG);
    CHECK(IXThreadingImpl_XAsyncGetResult(threads, &test->block, test,
        sizeof(test->result) - 1, &test->result, &used) == HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER));
    CHECK(test->get_results == 0 && used == 123 && !test->result);
    CHECK(IXThreadingImpl_XAsyncGetResult(threads, &test->block, test,
        sizeof(test->result), &test->result, &used) == S_OK);
    CHECK(used == sizeof(test->result) && test->result == &test->payload);
    CHECK(test->get_results == 1 && !test->pending_result);
    check_consumed_result(test);
}

static HRESULT WINAPI payload_provider(XAsyncOp op, const XAsyncProviderData *data)
{
    struct payload_operation *test = data->context;
    if (op == XAsyncOp_GetResult) {
        CHECK(data->buffer && data->bufferSize >= sizeof(test->result));
        if (!data->buffer || data->bufferSize < sizeof(test->result)) return E_INVALIDARG;
        ++test->get_results;
        /* Model GameSave's destructive handle transfer. A second call would
         * otherwise return success with the now-cleared provider handle. */
        *(DWORD **)data->buffer = test->pending_result;
        test->pending_result = NULL;
        /* Also exercise a nested retrieval before the first provider returns. */
        if (test->get_results == 1) check_consumed_result(test);
    }
    if (op == XAsyncOp_Cancel) {
        ++test->cancels;
        /* A late cancellation must not invalidate the callback's payload. */
        test->payload = 0;
    }
    if (op == XAsyncOp_Cleanup) {
        ++test->cleanup;
        test->payload = 0;
    }
    return S_OK;
}

struct result_racer
{
    struct payload_operation *test;
    HANDLE start;
    DWORD sentinel, *buffer[8];
    SIZE_T capacity, used;
    HRESULT hr;
};

static DWORD WINAPI race_result(void *context)
{
    struct result_racer *racer = context;
    if (WaitForSingleObject(racer->start, 10000) != WAIT_OBJECT_0) return 1;
    racer->hr = IXThreadingImpl_XAsyncGetResult(threads, &racer->test->block, racer->test,
        racer->capacity, racer->buffer, &racer->used);
    return 0;
}

static void retrieve_racing_payload(struct payload_operation *test)
{
    struct result_racer racers[4];
    HANDLE workers[4], start = CreateEventW(NULL, TRUE, FALSE, NULL);
    DWORD waited;
    unsigned i, j, successes = 0;
    CHECK(start != NULL);
    if (!start) ExitProcess(2);
    ZeroMemory(racers, sizeof(racers));
    for (i = 0; i < 4; ++i) {
        racers[i].test = test;
        racers[i].start = start;
        racers[i].sentinel = 0x87654321;
        for (j = 0; j < 8; ++j) racers[i].buffer[j] = &racers[i].sentinel;
        /* Different capacities exercise consumption while the provider's
         * shared bufferSize temporarily holds more than its minimum size. */
        racers[i].capacity = i % 2 ? sizeof(racers[i].buffer) : sizeof(test->result);
        racers[i].used = 123;
        racers[i].hr = E_PENDING;
        workers[i] = CreateThread(NULL, 0, race_result, &racers[i], 0, NULL);
        CHECK(workers[i] != NULL);
        if (!workers[i]) ExitProcess(2);
    }
    CHECK(SetEvent(start));
    waited = WaitForMultipleObjects(4, workers, TRUE, 10000);
    CHECK(waited == WAIT_OBJECT_0);
    if (waited != WAIT_OBJECT_0) ExitProcess(2);
    for (i = 0; i < 4; ++i) {
        if (racers[i].hr == S_OK) {
            ++successes;
            test->result = racers[i].buffer[0];
            CHECK(test->result == &test->payload && racers[i].used == sizeof(test->result));
        } else {
            CHECK(racers[i].hr == E_ILLEGAL_METHOD_CALL);
            CHECK(racers[i].buffer[0] == &racers[i].sentinel && racers[i].used == 123);
        }
        for (j = 1; j < 8; ++j) CHECK(racers[i].buffer[j] == &racers[i].sentinel);
        CHECK(CloseHandle(workers[i]));
    }
    CHECK(successes == 1 && test->get_results == 1);
    CHECK(CloseHandle(start));
    check_consumed_result(test);
}

static void WINAPI payload_completed(XAsyncBlock *block)
{
    struct payload_operation *test = block->context;
    ++test->callbacks;
    if (test->race_result) retrieve_racing_payload(test);
    else if (!test->early_result && !test->skip_result) retrieve_payload(test);
    if (test->early_result) check_consumed_result(test);
    CHECK(test->cleanup == 0);
    CHECK(test->payload == 0x12345678);
    if (test->result) CHECK(*test->result == 0x12345678);
}

static void check_payload_lifetime(void)
{
    XTaskQueueHandle payload_queue;
    struct payload_operation test;
    unsigned mode;
    for (mode = 0; mode < 6; ++mode) {
        ZeroMemory(&test, sizeof(test));
        test.payload = 0x12345678;
        test.pending_result = &test.payload;
        test.early_result = mode == 1;
        test.skip_result = mode == 3;
        test.race_result = mode == 5;
        CHECK(IXThreadingImpl_XTaskQueueCreate(threads, XTaskQueueDispatchMode_Manual,
            mode == 2 ? XTaskQueueDispatchMode_Immediate : XTaskQueueDispatchMode_Manual,
            &payload_queue) == S_OK);
        test.block.queue = payload_queue;
        test.block.context = &test;
        test.block.callback = mode == 4 ? NULL : payload_completed;
        CHECK(IXThreadingImpl_XAsyncBegin(threads, &test.block, &test, &test,
            "completion-lifetime", payload_provider) == S_OK);
        IXThreadingImpl_XAsyncComplete(threads, &test.block, S_OK, sizeof(test.result));
        if (test.early_result) {
            retrieve_payload(&test);
            CHECK(test.cleanup == 0);
        }
        if (mode != 2 && mode != 4)
            CHECK(IXThreadingImpl_XTaskQueueDispatch(threads, payload_queue, XTaskQueuePort_Completion, 0));
        if (mode == 3 || mode == 4) {
            CHECK(test.cleanup == 0);
            retrieve_payload(&test);
        }
        check_consumed_result(&test);
        CHECK(test.cleanup == 1);
        CHECK(test.callbacks == (mode == 4 ? 0 : 1));
        IXThreadingImpl_XTaskQueueCloseHandle(threads, payload_queue);
    }
}

int main(int argc, char **argv)
{
    HRESULT (WINAPI *query)(const GUID *, REFIID, void **);
    HMODULE dll = LoadLibraryA(argc > 1 ? argv[1] : "xgameruntime.dll");
    int i;
    if (!dll) { printf("DLL load failed %lu\n", GetLastError()); return 1; }
    query = (void *)GetProcAddress(dll, "QueryApiImpl");
    CHECK(query != NULL);
    if (!query) return 1;
    CHECK(query(&CLSID_XThreadingImpl, &IID_IXThreadingImpl, (void **)&threads) == S_OK);
    CHECK(IXThreadingImpl_XTaskQueueCreate(threads, XTaskQueueDispatchMode_Manual, XTaskQueueDispatchMode_Manual, &queue) == S_OK);
    for (i = 0; i < 400; i++) {
        LONG before = cleanups;
        XAsyncBlock *block = VirtualAlloc(NULL, 4096, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
        CHECK(block != NULL);
        if (!block) return 1;
        outcome = i % 4 == 0 ? E_FAIL : S_OK;
        payload = i % 4 == 2 ? sizeof(DWORD) : 0;
        consume = payload != 0;
        reuse = i % 4 == 3;
        block->queue = queue;
        block->callback = completed;
        CHECK(IXThreadingImpl_XAsyncBegin(threads, block, NULL, NULL, "lifetime", provider) == S_OK);
        IXThreadingImpl_XAsyncComplete(threads, block, outcome, payload);
        CHECK(IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 0));
        CHECK(cleanups == before + 1);
        if (reuse) {
            block->callback = NULL;
            IXThreadingImpl_XAsyncComplete(threads, block, S_OK, 0);
            CHECK(cleanups == before + 2);
            CHECK(VirtualFree(block, 0, MEM_RELEASE));
        }
    }
    CHECK(callbacks == 400);
    CHECK(cleanups == 500);
    check_payload_lifetime();
    {
        XAsyncBlock block = {0};
        SIZE_T used;
        block.queue = queue;
        CHECK(IXThreadingImpl_XAsyncBegin(threads, &block, NULL, NULL, "no-payload", provider) == S_OK);
        IXThreadingImpl_XAsyncComplete(threads, &block, S_OK, 0);
        for (i = 0; i < 2; ++i) {
            used = 123;
            CHECK(IXThreadingImpl_XAsyncGetResult(threads, &block, NULL, 0, NULL, &used) == S_OK);
            CHECK(used == 0);
        }
    }
    IXThreadingImpl_XTaskQueueCloseHandle(threads, queue);
    IXThreadingImpl_Release(threads);
    printf("ASYNC CHECKS %ld FAILURES %ld CALLBACKS %ld CLEANUPS %ld\n", checks, failures, callbacks, cleanups);
    return failures ? 1 : 0;
}
