#include <jni.h>
#include <string.h>

jstring Java_klo_yui_bnm_NativeInteractor_rrr(JNIEnv* env, jobject thiz) {
    return (*env)->NewStringUTF(env, "4.6.2");
}

jint JNI_OnLoad(JavaVM* vm, void* reserved) {
    return JNI_VERSION_1_6;
}
