// ====================================================================
// RASP Complete Bypass + Native Shim - AI Protectt/Protectt.ai
// Target: com.iifl.iiflaaa (AAA.apk)
// ====================================================================
'use strict';

// Global variable for AOSP WebView native lib path
var AOSP_WEBVIEW_LIBPATH = null;
var WEBVIEW_SEARCHED = false;
var RASP_LIBS_LOADING = {};

// (Native-level JNI_OnLoad interception not needed - RASP libs are arm64,
// can't load on x86_64. We fake success at the Java level instead.)

function findWebViewLibrary() {
    if (WEBVIEW_SEARCHED) return AOSP_WEBVIEW_LIBPATH;
    WEBVIEW_SEARCHED = true;
    // Try Java file scan
    try {
        var javaFile = Java.use('java.io.File');
        var dataApp = javaFile.$new('/data/app/');
        var listing = dataApp.listFiles();
        if (listing) {
            for (var i = 0; i < listing.length; i++) {
                var name = listing[i].getName();
                if (name.indexOf('com.android.webview') >= 0) {
                    var basePath = listing[i].getAbsolutePath();
                    var libFile = javaFile.$new(basePath + '/lib/x86_64/libwebviewchromium.so');
                    if (libFile.exists()) {
                        AOSP_WEBVIEW_LIBPATH = libFile.getAbsolutePath();
                        console.log('[RASP] Found WebView lib: ' + AOSP_WEBVIEW_LIBPATH);
                        return AOSP_WEBVIEW_LIBPATH;
                    }
                    // Also try inside sub-paths
                    var libDir = javaFile.$new(basePath + '/lib');
                    if (libDir.exists()) {
                        var subDirs = libDir.listFiles();
                        if (subDirs) {
                            for (var j = 0; j < subDirs.length; j++) {
                                var testLib = javaFile.$new(subDirs[j].getAbsolutePath() + '/libwebviewchromium.so');
                                if (testLib.exists()) {
                                    AOSP_WEBVIEW_LIBPATH = testLib.getAbsolutePath();
                                    console.log('[RASP] Found WebView lib (scan): ' + AOSP_WEBVIEW_LIBPATH);
                                    return AOSP_WEBVIEW_LIBPATH;
                                }
                            }
                        }
                    }
                }
            }
        }
    } catch(e) {
        console.log('[RASP] File scan: ' + e.message);
    }
    return null;
}

// ============================================================
// 00. NATIVE: Pre-load WebView library using android_dlopen_ext
//     with the SYSTEM linker namespace (has all system libs)
// ============================================================
function preloadWebViewLib() {
    var libPath = AOSP_WEBVIEW_LIBPATH;
    if (!libPath) return false;
    
    console.log('[RASP] preload: starting for ' + libPath);
    
    // Find android_get_exported_namespace (in libc on Android 15)
    var getNsAddr = Module.findExportByName(null, 'android_get_exported_namespace');
    if (getNsAddr) {
        console.log('[RASP] preload: found android_get_exported_namespace');
        var getNs = new NativeFunction(getNsAddr, 'pointer', ['pointer']);
        
        // Try each known namespace
        var nsNames = ['default', 'system', 'platform'];
        var ns = NULL;
        for (var i = 0; i < nsNames.length; i++) {
            var namePtr = Memory.allocUtf8String(nsNames[i]);
            ns = getNs(namePtr);
            if (!ns.isNull()) {
                console.log('[RASP] preload: got namespace "' + nsNames[i] + '" @ ' + ns);
                break;
            }
        }
        
        if (!ns.isNull()) {
            // Build android_dlextinfo struct
            // flags(8) + reserved(3*8) + library_namespace(8) = 40 bytes min
            var dlextinfo = Memory.alloc(80);
            // ANDROID_DLEXT_USE_NAMESPACE = 0x200
            dlextinfo.writeU64(0x200);
            dlextinfo.add(8).writeS64(0);  // reserved0
            dlextinfo.add(16).writeS64(0); // reserved1
            dlextinfo.add(24).writePointer(ns);  // library_namespace @ offset 24
            dlextinfo.add(32).writeS64(0);  // reserved2
            dlextinfo.add(40).writeS64(0);  // etc...
            dlextinfo.add(48).writeS64(0);
            dlextinfo.add(56).writeS64(0);
            dlextinfo.add(64).writeS64(0);
            
            var dlopenExtAddr = Module.findExportByName(null, 'android_dlopen_ext');
            if (dlopenExtAddr) {
                console.log('[RASP] preload: calling android_dlopen_ext with namespace');
                var dlopenExtFn = new NativeFunction(dlopenExtAddr, 'pointer', ['pointer', 'int', 'pointer']);
                var pathPtr = Memory.allocUtf8String(libPath);
                var handle = dlopenExtFn(pathPtr, 258, dlextinfo); // RTLD_NOW | RTLD_GLOBAL
                
                if (!handle.isNull()) {
                    console.log('[RASP] WebView pre-loaded in system namespace!');
                    return true;
                }
                
                var dlerrorAddr = Module.findExportByName(null, 'dlerror');
                if (dlerrorAddr) {
                    var dlerrorFn = new NativeFunction(dlerrorAddr, 'pointer', []);
                    var err = dlerrorFn().readCString();
                    console.log('[RASP] preload ns dlopen error: ' + err);
                }
            }
        }
    } else {
        console.log('[RASP] preload: android_get_exported_namespace not found');
    }
    
    // Fallback: try plain dlopen
    console.log('[RASP] preload: trying plain dlopen fallback');
    try {
        var dlopenAddr = Module.findExportByName(null, 'dlopen');
        if (dlopenAddr) {
            var dlopenFn = new NativeFunction(dlopenAddr, 'pointer', ['pointer', 'int']);
            var pathPtr = Memory.allocUtf8String(libPath);
            var handle = dlopenFn(pathPtr, 258); // RTLD_NOW | RTLD_GLOBAL
            if (!handle.isNull()) {
                console.log('[RASP] WebView pre-loaded via plain dlopen');
                return true;
            }
        }
    } catch(e2) {
        console.log('[RASP] dlopen fallback error: ' + e2.message);
    }
    return false;
}

Java.perform(function () {
    console.log('[RASP] ==================== FINAL BYPASS ====================');

    // ============================================================
    // 00. Pre-find WebView library path before any hooks run
    //     This sets AOSP_WEBVIEW_LIBPATH so the dlopen hook can redirect
    // ============================================================
    findWebViewLibrary();

    // ============================================================
    // 0. CRITICAL: Load our rrr() stub .so BEFORE any RASP classes initialize
    //    This provides the native rrr() function that checkManager() calls.
    //    rrr() must return "4.6.2" so checkManager returns early (avoids crash switch)
    // ============================================================
    try {
        Module.load('/data/data/com.iifl.iiflaaa/librrr_stub.so');
        console.log('[RASP] rrr() stub loaded');
    } catch (e) {
        console.log('[RASP] WARN: Could not load rrr stub: ' + e.message);
        try {
            Java.use('java.lang.System').load('/data/data/com.iifl.iiflaaa/librrr_stub.so');
            console.log('[RASP] rrr() stub loaded (via System.load)');
        } catch (e2) {
            console.log('[RASP] WARN: Could not load via System.load either: ' + e2.message);
        }
    }

    // ============================================================
    // 0b. Hook System.loadLibrary AND Runtime.loadLibrary0
    //     System.loadLibrary is @FastNative (hooks work for most cases)
    //     Runtime.loadLibrary0 catches calls from non-FastNative paths
    // ============================================================
    function ensureWebViewPath() {
        if (AOSP_WEBVIEW_LIBPATH) return AOSP_WEBVIEW_LIBPATH;
        // Try PackageManager first (most reliable)
        try {
            var ActivityThread = Java.use('android.app.ActivityThread');
            var ctx = ActivityThread.currentApplication();
            if (ctx) {
                var pm = ctx.getPackageManager();
                var ai = pm.getApplicationInfo('com.android.webview', 0);
                var nd = ai.nativeLibraryDir.value || ai.nativeLibraryDir;
                if (nd) {
                    AOSP_WEBVIEW_LIBPATH = nd + '/libwebviewchromium.so';
                    console.log('[RASP] Found WebView via PackageManager: ' + AOSP_WEBVIEW_LIBPATH);
                    return AOSP_WEBVIEW_LIBPATH;
                }
            }
        } catch(e) {}
        // Fallback to filesystem scan
        return findWebViewLibrary();
    }
    
    function fakeLoadRasps(lib) {
        return lib.indexOf('xbxxkecs') >= 0 || lib.indexOf('oxkmjvrh') >= 0 || lib.indexOf('iiflaaa') >= 0;
    }
    
        // Eagerly try to find WebView path during hook setup
    ensureWebViewPath();
    
    // Pre-load WebView lib in anonymous namespace (has access to all system libs)
    // This ensures libandroid.so and other DT_NEEDED deps are resolved
    if (AOSP_WEBVIEW_LIBPATH) {
        preloadWebViewLib();
    }
    
    // Hook System.loadLibrary
    // CRITICAL: For "webviewchromium", System.loadLibrary is @FastNative and uses the wrong namespace
    // (com_android_art instead of the WebView's clns-8). We intercept and call Runtime.loadLibrary0
    // with the WebView classloader so nativeloader selects the correct namespace (clns-8).
    // For all other libs (RASP libs included), let them load normally.
    try {
        var loadLibraryOrig = Java.use('java.lang.System').loadLibrary;
        Java.use('java.lang.System').loadLibrary.implementation = function (lib) {
            ensureWebViewPath();
            if (lib.indexOf('webviewchromium') >= 0) {
                try {
                    var VMStack = Java.use('dalvik.system.VMStack');
                    var wvCL = VMStack.getCallingClassLoader();
                    var clName = wvCL ? wvCL.getClass().getName() : 'null';
                    console.log('[RASP] WV classloader: ' + clName);
                    if (wvCL) {
                        var Rt = Java.use('java.lang.Runtime');
                        Rt.getRuntime().loadLibrary0(wvCL, lib);
                        console.log('[RASP] WV loaded via Runtime.loadLibrary0 OK');
                        return;
                    }
                } catch(e) {
                    console.log('[RASP] WV Runtime.loadLibrary0 error: ' + e.message);
                }
                var libPath = AOSP_WEBVIEW_LIBPATH || ensureWebViewPath();
                if (libPath) {
                    console.log('[RASP] WV fallback System.load: ' + libPath);
                    Java.use('java.lang.System').load(libPath);
                    return;
                }
            }
            console.log('[RASP] Sys.loadLibrary: ' + lib);
            try {
                var ret = loadLibraryOrig.call(this, lib);
                console.log('[RASP] Sys.loadLibrary OK: ' + lib);
                return ret;
            } catch(e) {
                if (lib.indexOf('iiflaaa') >= 0 || lib.indexOf('xbxxkecs') >= 0 || lib.indexOf('oxkmjvrh') >= 0) {
                    console.log('[RASP] RASP lib ' + lib + ' cannot load (arm64 on x86_64) - faking success');
                    return; // Fake success - all native methods are stubbed in Java
                }
                console.log('[RASP] Sys.loadLibrary FAILED: ' + lib + ' - ' + e.message);
                throw e;
            }
        };
        console.log('[RASP] System.loadLibrary hooked');
    } catch (e) { console.log('[RASP] loadLibrary hook failed: ' + e.message); }
    // Hook Runtime.loadLibrary0 as fallback
    try {
        Java.use('java.lang.Runtime').loadLibrary0.overload('java.lang.ClassLoader', 'java.lang.String').implementation = function (cl, lib) {
            ensureWebViewPath();
            if (lib.indexOf('webviewchromium') >= 0) {
                try {
                    var VMStack = Java.use('dalvik.system.VMStack');
                    var wvCL = VMStack.getCallingClassLoader();
                    var clName = wvCL ? wvCL.getClass().getName() : 'null';
                    console.log('[RASP] WV(load0) classloader: ' + clName);
                    // Use the ORIGINAL loadLibrary0 with the WebView classloader
                    // This routes through nativeloader to the correct clns-8 namespace
                    this.loadLibrary0(cl, lib);
                    console.log('[RASP] WV(load0) OK');
                    return;
                } catch(e) {
                    console.log('[RASP] WV(load0) error: ' + e.message);
                }
                var libPath = AOSP_WEBVIEW_LIBPATH || ensureWebViewPath();
                if (libPath) {
                    Java.use('java.lang.System').load(libPath);
                    return;
                }
            }
            console.log('[RASP] load0: ' + lib);
            this.loadLibrary0(cl, lib);
        };
        console.log('[RASP] Runtime.loadLibrary0 hooked');
    } catch (e) { console.log('[RASP] loadLibrary0 hook failed: ' + e.message); }

    // ============================================================
    // 0c. Try to find WebView library path early
    //     Falls back to findWebViewLibrary() on demand
    // ============================================================
    try {
        var ctx = Java.use('android.app.ActivityThread').currentApplication();
        if (ctx) {
            var pm = ctx.getPackageManager();
            var ai = pm.getPackageInfo('com.android.webview', 0).applicationInfo;
            var nd = ai.nativeLibraryDir.value || ai.nativeLibraryDir;
            if (nd) {
                AOSP_WEBVIEW_LIBPATH = nd + '/libwebviewchromium.so';
                console.log('[RASP] AOSP WebView lib: ' + AOSP_WEBVIEW_LIBPATH);
            } else {
                console.log('[RASP] WebView native dir is null, will scan');
            }
        } else {
            console.log('[RASP] WebView path deferred (app not ready)');
        }
    } catch (e) {
        console.log('[RASP] WebView path deferred: ' + e.message);
    }

    // ============================================================
    // 0b. Provide stub native method implementations for libiiflaaa.so
    //     Prevents UnsatisfiedLinkError when these are called after fake load
    // ============================================================
    try {
        var app = Java.use('com.iifl.iiflaaa.AAAApplication');
        try { app.clientId.implementation = function () { return '12345678'; }; } catch (e) {}
        try { app.channelId.implementation = function () { return '87654321'; }; } catch (e) {}
        try { app.appName.implementation = function () { return 'AAA'; }; } catch (e) {}
        try { app.appPackageName.implementation = function () { return 'com.iifl.iiflaaa'; }; } catch (e) {}
        try { app.password.implementation = function () { return 'password123'; }; } catch (e) {}
        try { app.channelLicenseKey.implementation = function () { return 'LICENSE-KEY-123'; }; } catch (e) {}
        console.log('[RASP] AAAApplication native stubs applied');
    } catch (e) {
        console.log('[RASP] AAAApplication stubs: ' + e.message);
    }

    try {
        var main = Java.use('com.iifl.iiflaaa.MainActivity');
        try { main.getLoggingStatus.implementation = function () {}; } catch (e) {}
        try { main.initAnalytics.implementation = function () {}; } catch (e) {}
        try { main.checkAnalyticsEnabled.implementation = function () { return true; }; } catch (e) {}
        console.log('[RASP] MainActivity native stubs applied');
    } catch (e) {
        console.log('[RASP] MainActivity stubs: ' + e.message);
    }

    // ============================================================
    // 1. BLOCK ALL TERMINATION PATHS
    // ============================================================
    try { Java.use('java.lang.System').exit.implementation = function (c) { console.log('[RASP] X: System.exit(' + c + ')'); }; } catch (e) {}
    try { var Rt = Java.use('java.lang.Runtime'); Rt.exit.implementation = function (c) { console.log('[RASP] X: Runtime.exit(' + c + ')'); }; Rt.halt.implementation = function (c) { console.log('[RASP] X: Runtime.halt(' + c + ')'); }; } catch (e) {}
    try { Java.use('android.os.Process').killProcess.implementation = function (p) { console.log('[RASP] X: killProcess(' + p + ')'); }; } catch (e) {}
    try { var A = Java.use('android.app.Activity'); try { A.finish.overload().implementation = function () { console.log('[RASP] X: finish()'); }; } catch (e1) {} try { A.finishAffinity.implementation = function () { console.log('[RASP] X: finishAffinity()'); }; } catch (e1) {} try { A.finishAndRemoveTask.implementation = function () { console.log('[RASP] X: finishAndRemoveTask()'); }; } catch (e1) {} } catch (e) {}
    try { Java.use('android.app.ActivityManager$AppTask').finishAndRemoveTask.implementation = function () { console.log('[RASP] X: AppTask.finishAndRemoveTask()'); }; } catch (e) {}

    // ============================================================
    // 2. HOOK d.k (C1281k) - CENTRAL RULE EVALUATOR
    // ============================================================
    try {
        var k = Java.use('d.k');
        try { k.p.overload('java.lang.String', 'android.content.Context').implementation = function (i, c) { return false; }; } catch (e) {}
        // Hook I5.m3-style methods on d.k
        try { k.l.implementation = function () { return false; }; } catch (e) {}
        try { k.n.implementation = function () { return false; }; } catch (e) {}
        try { k.j.implementation = function () { return false; }; } catch (e) {}
        try { k.r.implementation = function () { return false; }; } catch (e) {}
        try { k.o.implementation = function () { return false; }; } catch (e) {}
        try { k.m.implementation = function () { return false; }; } catch (e) {}
        try { k.k.implementation = function () { return false; }; } catch (e) {}
        // c has one boolean version and one void version; only hook boolean
        try { k.c.overload().implementation = function () { return false; }; } catch (e) {}
        try { k.c.overload('boolean').implementation = function (v) { return false; }; } catch (e) {}
    } catch (e) { console.log('[RASP] d.k: ' + e.message); }

    // ============================================================
    // 3. HOOK d.a (C1271a) & d.f (C1276f)
    // ============================================================
    try { var a = Java.use('d.a'); try { a.j.overload().implementation = function () { return false; }; } catch (e) {} try { a.a.overload('android.content.Context').implementation = function (c) { return false; }; } catch (e) {} } catch (e) {}
    try { var f = Java.use('d.f'); try { f.n.overload().implementation = function () { return false; }; } catch (e) {} try { f.o.overload().implementation = function () { return false; }; } catch (e) {} try { f.i.overload().implementation = function () { return false; }; } catch (e) {} try { f.a.overload().implementation = function () {}; } catch (e) {} } catch (e) {}

    // ============================================================
    // 4. HOOK NativeInteractor - ALL NATIVE DETECTION
    // ============================================================
    try {
        var n = Java.use('klo.yui.bnm.NativeInteractor');
        function r(name, val) { try { n[name].implementation = function () { return val; }; } catch (e) {} }
        function v(name) { try { n[name].implementation = function () {}; } catch (e) {} }

        r('getDetectIsFridaRunning', false);
        r('getFridaSoLoadedFlag', 'G');
        r('getcheckFopenFlag', 'G');
        r('str1000', ''); r('str1001', ''); r('str1003', 'G'); r('strF1', '');
        r('getStrF1', '');

        r('getOE', false); r('getSP', ''); r('getBSu', ''); r('getBB', '');
        r('binarySu', ''); r('binaryBusyBox', ''); r('binaryNativeCheck', '');
        r('suPaths', []); r('nativeBin', ''); r('isMagiskMountPathIdentify', false);

        r('getEmuUsb', false); r('getPath', '');

        r('debuggableRo', 0); r('persistDebuggable', 0);
        r('getPED', 0); r('getAFTD', 0); r('PED', 0); r('NAFTD', 0); r('RDG', 0);

        r('prop1', '1'); r('prop2', '1'); r('prop3', '1');
        r('str1005', ''); r('str1006', ''); r('str1007', ''); r('getSyNtv', '');

        r('sessionVerify', 'failed'); r('sessionVerifyV2', 'failed');
        r('appInteg007', ''); r('checkApkIntegrity', '');
        r('getDalivikDexRes', ''); r('getJitCount', 0); r('jitCC', 0);
        r('str1004', ''); r('str1004v2', ''); r('getAI007', '');
        r('isSIPrt', false); r('isSApp', false);
        r('printServerLog', ''); r('serverLog', ''); r('logs', '');
        r('str497', ''); r('str1002', '');

        r('getDOAES', ''); r('AESKey', ''); r('getAesTransForm', '');
        r('getRSAPr', ''); r('getRSAPu', ''); r('getRSATransForm', '');
        r('getGKey', []); r('tightIv', ''); r('tightKy', '');
        r('fK', ''); r('fIV', ''); r('keCe', ''); r('KeVer', '');
        r('fopn', ''); r('fileEnd', ''); r('spath1', '');
        r('spathEnd', ''); r('libAppPro', ''); r('libGeneral', '');
        r('hashOne', ''); r('hashTwo', ''); r('hashThree', '');
        r('doStr497', ''); r('getKeCee', ''); r('getFileGCMKey', ''); r('getFileGCMIV', '');
        r('getKeVersion', ''); r('getAesTransForm', '');
        r('dotTextFileHash', ''); r('getDalivikDexRes', '');
        r('getDetectIsFridaRunning', false); r('getFridaSoLoadedFlag', 'G');
        r('getcheckFopenFlag', 'G'); r('checkApkIntegrity', []);
        r('knownUnsecuredAppsPackages', []); r('crtArr', []);
        r('debuggableRo', 0); r('getPD', 0); r('persistDebuggable', 0);
        r('getAnalyticsState', 0); r('isSIPrt', false); r('isSApp', false);
        r('getSpath1', ''); r('getSpathend', ''); r('getStrF1', '');
        r('str388', ''); r('str389', ''); r('nR', ''); r('b', '');
        r('getM1Str', ''); r('getM2Str', ''); r('getM3Str', '');
        r('getnoxPub', ''); r('getAspRAPub', ''); r('getAspECPu', '');
        r('getGRPu', ''); r('getSSL', ''); r('getUAL', '');
        r('urlVerification', ''); r('navigationPlayStoreUrl', '');
        r('statusUrl', ''); r('getSharedJWT', ''); r('getSessionToken', '');
        r('gwhitelistSOverlayActivity1', ''); r('gwhitelistSOverlayActivity2', '');
        r('pocketPname', ''); r('gpocketPname', ''); r('nameAL', '');
        r('getNameAL', ''); r('mnName', '');

        v('checkManager');
        v('t23'); v('thrdContl');
        v('NDKProtect'); v('closeAppUsingNDKWithToast'); v('abort');
        v('doCL'); v('doCToast'); v('warn'); v('block'); v('doInitV');

        for (var i = 1; i <= 500; i++) { r('getStr' + i, ''); }
        console.log('[RASP] NI fully hooked');
    } catch (e) { console.log('[RASP] NI: ' + e.message); }

    // ============================================================
    // 5. HOOK I5.m3 (C0524m3) - MAIN DETECTION ENGINE
    // ============================================================
    try {
        var m3 = Java.use('I5.m3');
        function m(meth, ret) { try { m3[meth].implementation = function () { return ret; }; } catch (e) {} }
        function mv(meth) { try { m3[meth].implementation = function () { return false; }; } catch (e) {} }

        m('B', []); m('f', ''); m('Z0', ''); m('G', false); m('K0', '');
        m('W0', ''); m('y0', ''); m('t', false); m('C', '');
        m('c1', false); m('l1', false); m('v', false); m('d0', false);
        try { m3.Z0.implementation = function () { return ''; }; } catch(e) {}
        m('n0', ''); m('o1', false); m('z', false); m('x0', false); m('r', '');
        m('w0', ''); m('I0', ''); m('L', false); m('T', ''); m('y', '');
        m('V0', ''); m('X0', ''); m('l', ''); m('s', false);
// Z - hook no-arg overload returning false (skip void overloads)
try { m3.Z.overload().implementation = function() { return false; }; } catch(e) {
    try { m3.Z.implementation = function() { return false; }; } catch(e2) {}
}
        try { m3.X.overload().implementation = function () { return false; }; } catch(e) { try { mv('X'); } catch(e2) {} }
        m('O0', false); m('u', ''); m('S', ''); m('s0', '');
        m('k0', false); m('m1', false); m('H0', false); m('L0', '');
        m('C0', false); m('N0', false); m('B0', false); m('e', false);
        m('j1', false); m('f0', ''); m('R', ''); m('Q', ''); m('U', null);

        mv('A'); mv('A0'); mv('D0'); mv('E'); mv('E0'); mv('F'); mv('I');
        mv('J'); mv('J0'); mv('M'); mv('M0'); mv('N0'); mv('R0');
        mv('U0'); mv('V0'); mv('W'); mv('Y');
        console.log('[RASP] I5.m3 hooked');
    } catch (e) { console.log('[RASP] I5.m3: ' + e.message); }

    // ============================================================
    // 6. HOOK I5.t, I5.Q2, I5.y3, I5.E1
    // ============================================================
    try {
        var t = Java.use('I5.t');
        try { t.d.overload().implementation = function () { return ''; }; } catch (e) {}
        try { t.q.overload().implementation = function () { return null; }; } catch (e) {}
        try { t.L.overload().implementation = function () { return false; }; } catch (e) {}
        try { t.m0.overload().implementation = function () { return false; }; } catch (e) {}
        try { t.e0.overload().implementation = function () { return false; }; } catch (e) {}
        try { t.d0.overload().implementation = function () { return ''; }; } catch (e) {}
        try { t.B.overload('I5.Rule').implementation = function (r) { console.log('[RASP] X: overlay blocked'); }; } catch (e) {}
        try { t.s0.overload().implementation = function () { return []; }; } catch (e) {}
        try { t.W.overload().implementation = function () {}; } catch (e) {}
        try { t.o0.overload().implementation = function () { return false; }; } catch (e) {}
        try { t.V.overload().implementation = function () { return true; }; } catch (e) {}
        try { t.M.overload().implementation = function () { return false; }; } catch (e) {}
        try { t.S.overload().implementation = function () { return false; }; } catch (e) {}
        console.log('[RASP] I5.t hooked');
    } catch (e) { console.log('[RASP] I5.t: ' + e.message); }

    try {
        var q2 = Java.use('I5.Q2');
        try { q2.a.overload('java.lang.String').implementation = function (cmd) { console.log('[RASP] X: Q2 exec: ' + cmd); return ''; }; } catch (e) {}
        try { q2.b.overload('java.lang.String', 'boolean').implementation = function (cmd, b) { console.log('[RASP] X: Q2 exec2: ' + cmd); return ''; }; } catch (e) {}
        try { q2.c.overload('android.content.Context').implementation = function (c) { console.log('[RASP] X: Q2.c'); }; } catch (e) {}
        // Z method - hook if exists
        try { q2.Z.implementation = function() { return false; }; } catch(e) {}
    } catch (e) {}

    try {
        var y3 = Java.use('I5.y3');
        try { y3.a.overload('I5.Rule', 'android.content.Context').implementation = function (r, c) { return true; }; } catch (e) {}
        try { y3.a.overload('I5.Rule', 'android.content.Context', 'java.lang.String').implementation = function (r, c, s) { return true; }; } catch (e) {}
        try { y3.c.overload('android.content.Context').implementation = function (c) {}; } catch (e) {}
    } catch (e) {}

    try {
        var e1 = Java.use('I5.E1');
        try { e1.b.overload().implementation = function () { return false; }; } catch (e) {}
        try { e1.a.overload().implementation = function () { return false; }; } catch (e) {}
    } catch (e) {}

    // ============================================================
    // 7. HOOK PairIP License
    // ============================================================
    try {
        var lc = Java.use('com.pairip.licensecheck.LicenseClient');
        try { lc.initializeLicenseCheck.overload().implementation = function () { console.log('[RASP] X: PairIP blocked'); }; } catch (e) {}
        try { lc.handleError.overload('java.lang.String').implementation = function (s) {}; } catch (e) {}
        try { lc.exitAction.overload().implementation = function () {}; } catch (e) {}
        try { lc.performLocalInstallerCheck.overload().implementation = function () { return true; }; } catch (e) {}
        try { lc.checkLicenseInternal.overload().implementation = function () {}; } catch (e) {}
    } catch (e) {}
    try { Java.use('com.pairip.licensecheck.LicenseContentProvider').onCreate.overload().implementation = function () { return true; }; } catch (e) {}

    // ============================================================
    // 8. BUILD + SYSTEM PROPERTIES
    // ============================================================
    try {
        var b = Java.use('android.os.Build');
        b.FINGERPRINT.value = 'google/coral/coral:14/RQ3A.211001.001/12345678:user/release-keys';
        b.PRODUCT.value = 'coral'; b.MODEL.value = 'Pixel 4 XL'; b.MANUFACTURER.value = 'Google';
        b.BRAND.value = 'google'; b.DEVICE.value = 'coral'; b.TAGS.value = 'release-keys';
        b.TYPE.value = 'user'; b.HARDWARE.value = 'coral'; b.BOOTLOADER.value = 'unknown';
        b.RADIO.value = 'unknown'; b.SERIAL.value = 'unknown';
        b.DISPLAY.value = 'RQ3A.211001.001 release-keys'; b.ID.value = 'RQ3A.211001.001';
        if (b.VERSION) { b.VERSION.SDK_INT.value = 34; b.VERSION.RELEASE.value = '14'; b.VERSION.SECURITY_PATCH.value = '2024-05-05'; }
    } catch (e) {}

    try {
        var sp = Java.use('android.os.SystemProperties');
        var ov = {
            'ro.debuggable': '0', 'ro.secure': '1',
            'ro.build.tags': 'release-keys', 'ro.build.type': 'user',
            'ro.boot.verifiedbootstate': 'green', 'ro.boot.flash.locked': '1',
            'ro.boot.vbmeta.device_state': 'locked',
            'sys.oem_unlock_allowed': '0', 'ro.kernel.qemu': '0',
            'ro.build.fingerprint': 'google/coral/coral:14/RQ3A.211001.001/12345678:user/release-keys',
            'ro.product.cpu.abi': 'arm64-v8a',
            'ro.build.version.sdk': '34', 'ro.build.version.release': '14',
            'ro.build.version.security_patch': '2024-05-05',
            'ro.build.display.id': 'RQ3A.211001.001',
            'ro.build.description': 'coral-user 14 RQ3A.211001.001 12345678 release-keys',
            'persist.sys.root_access': '0', 'init.svc.adbd': 'stopped',
            'service.adb.root': '0', 'ro.adb.secure': '1',
        };
        sp.get.overload('java.lang.String').implementation = function (k) {
            if (ov[k] !== undefined) return ov[k];
            return this.get(k);
        };
    } catch (e) {}

    // ============================================================
    // 9. HOOK Debug + Settings + Connectivity + exec
    // ============================================================
    try { var D = Java.use('android.os.Debug'); D.isDebuggerConnected.implementation = function () { return false; }; D.waitingForDebugger.implementation = function () { return false; }; } catch (e) {}

    try {
        var SS = Java.use('android.provider.Settings$Secure');
        try { SS.getInt.overload('android.content.ContentResolver', 'java.lang.String', 'int').implementation = function (cr, name, def) { var o = {'development_settings_enabled':0,'adb_enabled':0,'adb_wifi_enabled':0,'mock_location':0,'accessibility_enabled':0}; return o[name] !== undefined ? o[name] : this.getInt(cr, name, def); }; } catch (e) {}
        try { SS.getString.overload('android.content.ContentResolver', 'java.lang.String').implementation = function (cr, name) { return name === 'android_id' ? 'deadbeefcafebabe' : this.getString(cr, name); }; } catch (e) {}
    } catch (e) {}
    try { var SG = Java.use('android.provider.Settings$Global'); try { SG.getInt.overload('android.content.ContentResolver', 'java.lang.String', 'int').implementation = function (cr, name, def) { var o = {'development_settings_enabled':0,'adb_enabled':0,'adb_wifi_enabled':0}; return o[name] !== undefined ? o[name] : this.getInt(cr, name, def); }; } catch (e) {} } catch (e) {}

    try {
        Java.use('android.net.ConnectivityManager').getNetworkCapabilities.implementation = function (net) {
            try { var nc = this.getNetworkCapabilities(net); if (nc) { nc.hasTransport.implementation = function (t) { if (t === 4) return false; return this.hasTransport(t); }; } return nc; } catch (e) { return null; }
        };
    } catch (e) {}

    try {
        var RE = Java.use('java.lang.Runtime');
        RE.exec.overload('[Ljava.lang.String;').implementation = function (cmds) { console.log('[RASP] X: exec blocked'); return Java.use('java.lang.Process').$new(); };
        RE.exec.overload('java.lang.String').implementation = function (cmd) { console.log('[RASP] X: exec blocked'); return Java.use('java.lang.Process').$new(); };
    } catch (e) {}

    try {
        Java.use('android.content.pm.PackageManager').getInstallerPackageName.overload('java.lang.String').implementation = function (pkg) {
            return pkg.indexOf('iifl') >= 0 ? 'com.android.vending' : this.getInstallerPackageName(pkg);
        };
    } catch (e) {}

    // ============================================================
    // WV. Hook WebViewFactory - prevent re-throw, let native hook handle
    // ============================================================
    try {
        var wvf = Java.use('android.webkit.WebViewFactory');
        try {
            wvf.getProvider.overload().implementation = function () {
                try {
                    return this.getProvider();
                } catch (e) {
                    console.log('[RASP] WebViewFactory.getProvider() caught: ' + e.message);
                    throw e;
                }
            };
        } catch (e) {}
    } catch (e) {}

    // ============================================================
    // WV. Hook Capacitor bridge - handle null WebView gracefully
    // ============================================================
    try {
        var capBridge = Java.use('com.getcapacitor.i');
        try {
            capBridge.I.implementation = function () {
                try {
                    var wv = this.I();
                    if (wv !== null) return wv;
                } catch(e) {}
                console.log('[RASP] Capacitor bridge WebView is null!');
                // Return the original result (null) - let app handle it
                // The app will crash but we need WebView lib working first
                return null;
            };
        } catch (e) {}
    } catch (e) {}

    console.log('[RASP] ==================== ALL HOOKS APPLIED ====================');
});

// Native hooks for ARM64 (Frida 17 compat)
setTimeout(function () {
    try {
        var raspModule = Process.findModuleByName('libxbxxkecs.so');
        if (raspModule) {
            console.log('[RASP] libxbxxkecs.so @ ' + raspModule.base);
            var exports = raspModule.enumerateExports();
            exports.forEach(function (exp) {
                if (exp.name.indexOf('Java') >= 0 && exp.name.indexOf('NativeInteractor') >= 0) {
                    console.log('[RASP] Native: ' + exp.name + ' @ ' + exp.address);
                    Interceptor.attach(exp.address, {
                        onLeave: function (retval) {
                            if (exp.name.indexOf('getOE') >= 0 || exp.name.indexOf('getBSu') >= 0 ||
                                exp.name.indexOf('getBB') >= 0 || exp.name.indexOf('getEmuUsb') >= 0 ||
                                exp.name.indexOf('getSP') >= 0 || exp.name.indexOf('str1000') >= 0 ||
                                exp.name.indexOf('str1001') >= 0 || exp.name.indexOf('str1003') >= 0 ||
                                exp.name.indexOf('strF1') >= 0 || exp.name.indexOf('getDetectIsFridaRunning') >= 0) {
                                retval.replace(ptr(0));
                            }
                        }
                    });
                }
            });
        }
    } catch (e) {}
}, 2000);
