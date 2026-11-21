import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';

/// Cloudflare Turnstile settings for the sign-in and sign-up screens (AUTH-3).
///
/// The backend refuses sign-in and sign-up without a valid token once
/// `CAPTCHA_SECRET_KEY` is set, for every client, so the app solves the same
/// challenge as the web. Like [ApiConstants], configuration arrives via
/// `--dart-define`, never a bundled asset:
///
/// ```bash
/// flutter build apk --release \
///   --dart-define=TURNSTILE_SITE_KEY=0x4AAAA... \
///   --dart-define=TURNSTILE_PAGE_URL=https://qsps.example.gov.ph
/// ```
class CaptchaConstants {
  CaptchaConstants._();

  /// Request header that carries the token. Must match `CAPTCHA_HEADER` in
  /// `@repo/auth`.
  static const String header = 'x-captcha-response';

  static const String _siteKey = String.fromEnvironment('TURNSTILE_SITE_KEY');
  static const String _pageUrl = String.fromEnvironment('TURNSTILE_PAGE_URL');

  /// Cloudflare's always-pass test key. Pairs with the test secret in
  /// `apps/backend/.env.example`.
  static const String _testSiteKey = '1x00000000000000000000AA';

  /// Public site key. Debug builds fall back to the test key; a release
  /// without one fails loudly, since the server would refuse every sign-in.
  static String get siteKey {
    if (_siteKey.isNotEmpty) return _siteKey;
    if (kReleaseMode) {
      throw StateError(
        'TURNSTILE_SITE_KEY was not provided at build time. Rebuild with '
        '--dart-define=TURNSTILE_SITE_KEY=<site key>',
      );
    }
    return _testSiteKey;
  }

  /// Address the challenge page is loaded as. Turnstile checks the page's
  /// hostname against the widget's allowed hostnames in the Cloudflare
  /// dashboard, so a release must use a host listed there.
  static String get pageUrl {
    if (_pageUrl.isNotEmpty) {
      if (kReleaseMode && !_pageUrl.startsWith('https://')) {
        throw StateError(
          'TURNSTILE_PAGE_URL must be https:// in release builds.',
        );
      }
      return _pageUrl;
    }
    if (kReleaseMode) {
      throw StateError(
        'TURNSTILE_PAGE_URL was not provided at build time. Rebuild with '
        '--dart-define=TURNSTILE_PAGE_URL=https://<allowed host>',
      );
    }
    return 'http://localhost';
  }

  /// Off under `flutter test`, where no WebView exists. Everywhere else the
  /// screens show the challenge and wait for its token.
  static bool get isEnabled => !_isFlutterTest;

  static bool get _isFlutterTest {
    if (kIsWeb) return false;
    return Platform.environment.containsKey('FLUTTER_TEST');
  }
}
