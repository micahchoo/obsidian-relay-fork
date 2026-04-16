# Reactivity Audit Report

## Summary

| Metric | Count |
|--------|-------|
| `notifyListeners()` calls | 42 |
| Debounced notifications | 2 |
| Transaction-wrapped batch ops | 3 |
| Immediate notifications | 0 |

## Problematic Patterns

### 1. Debounced Notifications (CRITICAL)

**SharedFolder.ts:109** - Files collection
```typescript
notifyListeners = debounce(super.notifyListeners, 100);
```
**Impact**: UI doesn't update until 100ms after last file change. Causes stale file lists.

**SharedFolder.ts:1731** - Settings update
```typescript
update = debounce(this.notifyListeners, 100);
```
**Impact**: Settings changes don't reflect in UI immediately.

### 2. Missing Transaction Wrappers

Most `ObservableMap.set()` and `ObservableMap.delete()` calls notify immediately, causing multiple UI renders:

| Location | Issue |
|----------|-------|
| `RelayManager.ts:649` | `relays.set()` - no transaction |
| `RelayManager.ts:697` | `relayRoles.set()` - no transaction |
| `RelayManager.ts:792` | `relayInvitations.set()` - no transaction |
| `RelayManager.ts:826` | `users.set()` - no transaction |
| `RelayManager.ts:870` | `subscriptions.set()` - no transaction |

### 3. PostOffice Async Queue (20ms default)

When `notifyListeners()` is called:
1. `PostOffice.send()` queues the message
2. `scheduleDelivery()` waits up to 20ms
3. UI updates in batch

**Impact**: Brief visual staleness, especially on fast interactions.

## Recommended Fixes

### Fix 1: Remove Debounce from Files Collection

**File**: `Relay/src/SharedFolder.ts:109`

```typescript
// BEFORE (problematic)
notifyListeners = debounce(super.notifyListeners, 100);

// AFTER
notifyListeners = super.notifyListeners;
```

### Fix 2: Wrap Batch Mutations in Transactions

**File**: `Relay/src/RelayManager.ts`

```typescript
// Example: ingest() method
ingest(update: RelayDAO): Relay {
    const existingRelay = this.relays.get(update.id);
    const postie = PostOffice.getInstance();
    
    postie.beginTransaction();  // ADD THIS
    if (existingRelay) {
        existingRelay.update(update);
        this.relays.notifyListeners();
    } else {
        const relay = new RelayAuto(...);
        this.relays.set(relay.id, relay);
    }
    postie.commitTransaction();  // ADD THIS
    return existingRelay || relay;
}
```

### Fix 3: Add Transaction Helper Method

```typescript
// In RelayManager
private batchNotify(callback: () => void) {
    const postie = PostOffice.getInstance();
    postie.beginTransaction();
    try {
        callback();
    } finally {
        postie.commitTransaction();
    }
}
```

### Fix 4: Consider Immediate Notification Option

Extend `notifyListeners()` to support immediate mode:

```typescript
// In Observable class
notifyListeners(immediate: boolean = false): void {
    for (const recipient of this._listeners) {
        PostOffice.getInstance().send(
            this as unknown as T & IObservable<T>,
            recipient,
            immediate  // Pass immediate flag
        );
    }
}
```

Then use for critical UI updates:
```typescript
this.relays.notifyListeners(true);  // Immediate
```

## Priority Order

1. **P0**: Remove debounce from Files collection (SharedFolder.ts:109)
2. **P1**: Add transactions to batch ingest operations
3. **P2**: Add immediate notification option
4. **P3**: Document transaction patterns for future code

## Verification

After fixes, test:
- Creating a relay → appears immediately in list
- Deleting a relay → disappears immediately from list
- Adding files → file list updates instantly
- Settings changes → UI reflects immediately
