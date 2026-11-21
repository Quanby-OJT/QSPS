import 'dart:developer' as developer;

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:mobile/core/constants/api_constants.dart';
import 'package:mobile/core/constants/captcha_constants.dart';
import 'package:mobile/features/auth/data/models/session_model.dart';
import 'package:mobile/services/api/api_client.dart';
import 'package:mobile/services/storage/secure_storage_service.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

part 'auth_repository.g.dart';

/// Repository that communicates with the Better Auth backend endpoints.
///
/// Better Auth uses cookie-based sessions. The Dio cookie interceptor
/// (in api_client.dart) automatically persists `set-cookie` headers.
/// We also store the session token in secure storage as a fallback.
class AuthRepository {
  AuthRepository(this._dio, this._storage, this._cookieJar);

  final Dio _dio;
  final SecureStorageService _storage;
  final PersistCookieJar _cookieJar;

  /// Logs an auth diagnostic, debug builds only.
  ///
  /// Two problems are closed here. `dart:developer`'s `log()` is not stripped
  /// from release builds, so anything passed to it ships to end-user devices
  /// and can be read with `adb logcat`. And the calls used to interpolate
  /// `response.data`, which for every auth endpoint contains the session token.
  ///
  /// Callers pass status and shape only â€” never a response body. The
  /// `kDebugMode` guard is a compile-time constant, so the whole call is tree
  /// shaken out of release builds.
  void _logDebug(String message) {
    if (kDebugMode) {
      developer.log(message, name: 'AuthRepository');
    }
  }

  /// Safely extracts a JSON map from a Dio response.
  /// Returns null if the data cannot be parsed as `Map<String, dynamic>`.
  Map<String, dynamic>? _parseJsonBody(Response<dynamic> response) {
    final data = response.data;
    if (data is Map<String, dynamic>) return data;
    if (data is String && data.isNotEmpty) {
      // Dio didn't auto-decode â€” shouldn't happen with default settings
      // but guard against it. The body is a token carrier, so only its size
      // is reported; that is enough to tell "empty" from "unexpected shape".
      _logDebug('Auth response was an undecoded String (${data.length} chars)');
    }
    return null;
  }

  /// AUTH-3: the CAPTCHA token rides in a header, so the JSON body stays
  /// exactly what Better Auth expects.
  Options? _captchaOptions(String? captchaToken) {
    if (captchaToken == null || captchaToken.isEmpty) return null;
    return Options(headers: {CaptchaConstants.header: captchaToken});
  }

  /// Signs in with email and password.
  ///
  /// Better Auth `/sign-in/email` returns:
  /// ```json
  /// { "session": { "id": "...", "token": "...", ... }, "user": { ... } }
  /// ```
  Future<SessionModel?> signIn({
    required String email,
    required String password,
    String? captchaToken,
  }) async {
    final response = await _dio.post(
      ApiConstants.signIn,
      data: {'email': email, 'password': password},
      options: _captchaOptions(captchaToken),
    );

    _logDebug(
      'signIn status=${response.statusCode} '
      'type=${response.data.runtimeType}',
    );

    final body = _parseJsonBody(response);
    if (response.statusCode == 200 && body != null) {
      final session = SessionModel.fromAuthResponse(body);
      await _storage.setSessionToken(session.session.token);
      return session;
    }
    return null;
  }

  /// Signs up with email, password, and name.
  ///
  /// Better Auth `/sign-up/email` returns the same shape as sign-in.
  Future<SessionModel?> signUp({
    required String email,
    required String password,
    required String name,
    String? captchaToken,
  }) async {
    final response = await _dio.post(
      ApiConstants.signUp,
      data: {'email': email, 'password': password, 'name': name},
      options: _captchaOptions(captchaToken),
    );

    _logDebug(
      'signUp status=${response.statusCode} '
      'type=${response.data.runtimeType}',
    );

    final body = _parseJsonBody(response);
    if (response.statusCode == 200 && body != null) {
      final session = SessionModel.fromAuthResponse(body);
      await _storage.setSessionToken(session.session.token);
      return session;
    }
    return null;
  }

  /// Signs out and clears every stored credential on the device.
  ///
  /// The cookie jar was unreachable
  /// from here, so sign-out cleared secure storage while the session cookie
  /// stayed on disk in the jar's persistence directory â€” the next launch
  /// resumed the session. The jar is purged too, and the purge runs in
  /// `finally` so a failed network sign-out still clears the device.
  Future<void> signOut() async {
    try {
      await _dio.post(ApiConstants.signOut);
    } finally {
      await _cookieJar.deleteAll();
      await _storage.deleteSessionToken();
      await _storage.deleteCookie();
    }
  }

  /// Fetches the current session from the backend.
  ///
  /// Better Auth `/get-session` returns the same shape as sign-in
  /// if the session cookie is valid.
  Future<SessionModel?> getSession() async {
    try {
      final response = await _dio.get(ApiConstants.getSession);

      _logDebug(
        'getSession status=${response.statusCode} '
        'type=${response.data.runtimeType}',
      );

      final body = _parseJsonBody(response);
      if (response.statusCode == 200 && body != null) {
        return SessionModel.fromAuthResponse(body);
      }
      return null;
    } on DioException {
      return null;
    }
  }
}

@Riverpod(keepAlive: true)
AuthRepository authRepository(Ref ref) {
  final dio = ref.watch(dioProvider);
  final storage = ref.watch(secureStorageProvider);
  final cookieJar = ref.watch(cookieJarProvider);
  return AuthRepository(dio, storage, cookieJar);
}
