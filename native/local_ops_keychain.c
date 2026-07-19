#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_SECRET_BYTES (16 * 1024)

static const char *service_name = "com.arvin.localops.ssh-passphrase";

static void print_status(const char *prefix, OSStatus status) {
  CFStringRef message = SecCopyErrorMessageString(status, NULL);
  char buffer[512] = {0};
  if (message && CFStringGetCString(message, buffer, sizeof(buffer), kCFStringEncodingUTF8)) {
    fprintf(stderr, "%s: %s\n", prefix, buffer);
  } else {
    fprintf(stderr, "%s: OSStatus %d\n", prefix, (int)status);
  }
  if (message) CFRelease(message);
}

static int valid_reference(const char *value) {
  if (!value || strlen(value) != 36) return 0;
  for (size_t index = 0; index < 36; index += 1) {
    if (index == 8 || index == 13 || index == 18 || index == 23) {
      if (value[index] != '-') return 0;
    } else if (!isxdigit((unsigned char)value[index]) || isupper((unsigned char)value[index])) {
      return 0;
    }
  }
  return value[14] >= '1' && value[14] <= '5'
    && (value[19] == '8' || value[19] == '9' || value[19] == 'a' || value[19] == 'b');
}

static CFMutableDictionaryRef create_query(const char *account) {
  CFMutableDictionaryRef query = CFDictionaryCreateMutable(
    kCFAllocatorDefault, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks
  );
  CFStringRef service = CFStringCreateWithCString(kCFAllocatorDefault, service_name, kCFStringEncodingUTF8);
  CFStringRef account_string = CFStringCreateWithCString(kCFAllocatorDefault, account, kCFStringEncodingUTF8);
  if (!query || !service || !account_string) {
    if (query) CFRelease(query);
    if (service) CFRelease(service);
    if (account_string) CFRelease(account_string);
    return NULL;
  }
  CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);
  CFDictionarySetValue(query, kSecAttrService, service);
  CFDictionarySetValue(query, kSecAttrAccount, account_string);
  CFRelease(service);
  CFRelease(account_string);
  return query;
}

static int store_secret(const char *account) {
  unsigned char *secret = malloc(MAX_SECRET_BYTES + 1);
  if (!secret) return 1;
  size_t length = fread(secret, 1, MAX_SECRET_BYTES + 1, stdin);
  if (length == 0 || length > MAX_SECRET_BYTES) {
    fprintf(stderr, "the secret must contain between 1 and %d bytes\n", MAX_SECRET_BYTES);
    memset(secret, 0, MAX_SECRET_BYTES + 1);
    free(secret);
    return 1;
  }

  CFDataRef data = CFDataCreate(kCFAllocatorDefault, secret, (CFIndex)length);
  memset(secret, 0, MAX_SECRET_BYTES + 1);
  free(secret);
  CFMutableDictionaryRef query = create_query(account);
  if (!data || !query) {
    if (data) CFRelease(data);
    if (query) CFRelease(query);
    return 1;
  }

  const void *update_keys[] = { kSecValueData };
  const void *update_values[] = { data };
  CFDictionaryRef update = CFDictionaryCreate(
    kCFAllocatorDefault, update_keys, update_values, 1,
    &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks
  );
  OSStatus status = SecItemUpdate(query, update);
  CFRelease(update);
  if (status == errSecItemNotFound) {
    CFStringRef label = CFSTR("Local Ops SSH private key passphrase");
    CFStringRef description = CFSTR("Used only to unlock a configured SSH private key");
    CFDictionarySetValue(query, kSecValueData, data);
    CFDictionarySetValue(query, kSecAttrLabel, label);
    CFDictionarySetValue(query, kSecAttrDescription, description);
    status = SecItemAdd(query, NULL);
  }
  CFRelease(data);
  CFRelease(query);
  if (status != errSecSuccess) {
    print_status("Keychain operation failed", status);
    return 1;
  }
  return 0;
}

static int get_secret(const char *account) {
  CFMutableDictionaryRef query = create_query(account);
  if (!query) return 1;
  CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);
  CFDictionarySetValue(query, kSecMatchLimit, kSecMatchLimitOne);
  CFTypeRef result = NULL;
  OSStatus status = SecItemCopyMatching(query, &result);
  CFRelease(query);
  if (status != errSecSuccess) {
    print_status("Keychain operation failed", status);
    return 1;
  }
  if (!result || CFGetTypeID(result) != CFDataGetTypeID()) {
    if (result) CFRelease(result);
    fprintf(stderr, "Keychain operation failed: invalid secret data\n");
    return 1;
  }
  CFDataRef data = (CFDataRef)result;
  fwrite(CFDataGetBytePtr(data), 1, (size_t)CFDataGetLength(data), stdout);
  CFRelease(result);
  return ferror(stdout) ? 1 : 0;
}

static int secret_exists(const char *account) {
  CFMutableDictionaryRef query = create_query(account);
  if (!query) return 1;
  CFDictionarySetValue(query, kSecMatchLimit, kSecMatchLimitOne);
  OSStatus status = SecItemCopyMatching(query, NULL);
  CFRelease(query);
  if (status != errSecSuccess) {
    print_status("Keychain operation failed", status);
    return 1;
  }
  return 0;
}

static int delete_secret(const char *account) {
  CFMutableDictionaryRef query = create_query(account);
  if (!query) return 1;
  OSStatus status = SecItemDelete(query);
  CFRelease(query);
  if (status != errSecSuccess && status != errSecItemNotFound) {
    print_status("Keychain operation failed", status);
    return 1;
  }
  return 0;
}

int main(int argc, char **argv) {
  if (argc != 3 || !valid_reference(argv[2])) {
    fprintf(stderr, "usage: local-ops-keychain <store|get|exists|delete> <account>\n");
    return 1;
  }
  if (strcmp(argv[1], "store") == 0) return store_secret(argv[2]);
  if (strcmp(argv[1], "get") == 0) return get_secret(argv[2]);
  if (strcmp(argv[1], "exists") == 0) return secret_exists(argv[2]);
  if (strcmp(argv[1], "delete") == 0) return delete_secret(argv[2]);
  fprintf(stderr, "usage: local-ops-keychain <store|get|exists|delete> <account>\n");
  return 1;
}
