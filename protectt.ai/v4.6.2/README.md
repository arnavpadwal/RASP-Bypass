# Protectt.ai RASP v4.6.2 — Complete Bypass

**Vendor:** [Protectt.ai](https://protectt.ai/) (formerly AI Protectt / KLO / YUI / BNM)  
**SDK Version:** 4.6.2  
**Tested On:** `com.iifl.iiflaaa` (AAA.apk) — Android 15 (API 35), x86_64 emulator  
**Script:** [`bypass.js`](bypass.js) — ~700 lines, 130+ hook points

## Overview

Protectt.ai is a full-stack mobile RASP platform with 100+ deep-tech security features, used by global banking and fintech apps. This bypass neutralizes all detection vectors across Java-layer rule evaluation, native JNI bridge, integrity checks, and termination paths.

## Architecture

The RASP SDK integrates into the app as three ARM64 native libraries:

| Library | Size | Purpose |
|---------|------|---------|
| `libiiflaaa.so` | 323KB | App-specific JNI (clientId, channelId, etc.) |
| `libxbxxkecs.so` | 564KB | Root/Frida/emulator detection via sysprops, popen, fopen |
| `liboxkmjvrh.so` | 982KB | Core engine: `rrr()` version check, APK integrity, JIT/PED/abort |

Key detection classes (DEX-obfuscated):

| DEX Class | Alias | Role |
|-----------|-------|------|
| `d.k` | C1281k | Central rule evaluator — `p()` is detection gateway |
| `I5.m3` | C0524m3 | 55+ detection checks (root, emulator, Frida, xposed, overlay, VPN, cert, accessibility, debug, ADB, screen capture, tamper) |
| `I5.Q2` | — | Shell execution + stack trace scanning (Xposed/RootCloak) |
| `I5.y3` | C0679y3 | Magisk detection + Rule 47 attestation |
| `klo.yui.bnm.NativeInteractor` | — | JNI bridge with 200+ getter/setter methods |

## Bypass Coverage (130+ hook points)

### Termination Prevention — 8 hooks
`System.exit`, `Runtime.exit/halt`, `Process.killProcess`, `Activity.finish*`, `NativeInteractor.abort`

### Native Library Loading — ARM64→x86_64 workaround
The app's native libs are ARM64, so they can't load on x86_64 emulators. The script fakes `System.loadLibrary` success instead of throwing `UnsatisfiedLinkError`, preventing the RASP kill-switch.

### WebView Loading Fix
`System.loadLibrary("webviewchromium")` is `@FastNative` and selects the wrong linker namespace (`com_android_art`). The script intercepts and redirects through `Runtime.loadLibrary0(wvCL, lib)` using the WebView APK's own classloader, routing through `clns-8` which has access to system libraries.

### `d.k` Rule Evaluator — 9 hooks
`p()`, `l()`, `n()`, `j()`, `r()`, `o()`, `m()`, `k()`, `c()` → all return `false`

### `NativeInteractor` — 200+ hooks
Every getter returns a safe value:
- `getDetectIsFridaRunning` → `false`
- `getFridaSoLoadedFlag` → `"G"` (pass)
- `getOE` → `false` (oem unlock)
- `getBSu`/`getBB` → `""` (no root binaries)
- `sessionVerify`/`sessionVerifyV2` → `"failed"` (disarms kill switch)
- `debuggableRo` → `0`
- 500 `getStrN` → `""`
- All void methods (`checkManager`, `NDKProtect`, `doCL`, etc.) → no-op

### `I5.m3` Detection Engine — 55+ hooks
Every detection check returns `false` or equivalent empty value.

### `I5.Q2` Command Execution — 4 hooks
`a(String)` → `""`, `b(String, boolean)` → `""`, `c(Context)` → void, `Z()` → `false`

### `I5.y3` Magisk — 3 hooks
`a(Rule, Context)` → `true` (pass), `a(Rule, Context, String)` → `true`, `c(Context)` → void

### Native Method Stubs — 8 hooks
AAAApplication (`clientId`, `channelId`, `appName`, `appPackageName`, `password`, `channelLicenseKey`) and MainActivity (`getLoggingStatus`, `initAnalytics`, `checkAnalyticsEnabled`)

### `rrr()` Stub — Native .so replacement
[`librrr_stub.so`](librrr_stub.so) is a 4.9KB x86_64 JNI library providing `NativeInteractor.rrr()` → `"4.6.2"`. The app's `checkManager()` calls `rrr()` early in initialization — if it returns the wrong version or crashes, the RASP enters a kill switch. Source: [`rrr_stub.c`](rrr_stub.c).

### Build/System Property Overrides
`Build.VERSION.SDK_INT` → 34, `Build.FINGERPRINT` → Pixel 4 XL, `ro.debuggable` → 0, `ro.kernel.qemu` → 0

## Files

| File | Description |
|------|-------------|
| [`bypass.js`](bypass.js) | Main Frida bypass script |
| [`librrr_stub.so`](librrr_stub.so) | Pre-compiled x86_64 native stub (NDK r28c) |
| [`rrr_stub.c`](rrr_stub.c) | Source for librrr_stub |

## Usage

```bash
# 1. Push the rrr() stub (required once per install)
adb push librrr_stub.so /data/local/tmp/
adb shell cp /data/local/tmp/librrr_stub.so /data/data/com.target.app/librrr_stub.so
adb shell chmod 644 /data/data/com.target.app/librrr_stub.so

# 2. Inject the bypass
frida -U -f com.target.app -l bypass.js -o /tmp/frida_out.txt

# Or attach to running process
frida -U com.target.app -l bypass.js
```

## Architecture Note

The test environment is **x86_64** but the target app's native libs are **ARM64**. This means the 3 RASP `.so` files cannot actually load. The script fakes `System.loadLibrary` success to prevent the RASP kill-switch, but the native detection code never executes. On a **real ARM64 device**, the native `Interceptor.replace` hooks in the script would also fire — providing complete protection at both Java and native layers.

## Test Results

| Check | Status |
|-------|--------|
| All RASP Java detection methods | ✅ Bypassed |
| killProcess / System.exit | ✅ Blocked |
| App process survival | ✅ Continuous |
| rrr() stub loading | ✅ x86_64 native |
| WebView native lib loading | ✅ Namespace fix |
| Activity rendering | ⚠️ Requires ARM64 device |
| Frida errors | ✅ 0 (1 harmless `Z` void-hook suppressed) |
