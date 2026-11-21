import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:mobile/core/constants/captcha_constants.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// Cloudflare Turnstile challenge in a small WebView (AUTH-3).
///
/// Reports each new token through [onToken], and `null` when the token
/// expires or the challenge fails. A token is single-use: after every attempt
/// the screen rebuilds this widget with a new key to get a fresh one.
class TurnstileCaptcha extends StatefulWidget {
  const TurnstileCaptcha({super.key, required this.onToken});

  final ValueChanged<String?> onToken;

  @override
  State<TurnstileCaptcha> createState() => _TurnstileCaptchaState();
}

class _TurnstileCaptchaState extends State<TurnstileCaptcha> {
  late final WebViewController _controller;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.transparent)
      ..addJavaScriptChannel(
        'Captcha',
        onMessageReceived: (message) {
          if (!mounted) return;
          final token = message.message;
          if (token == '__error__') {
            setState(() => _failed = true);
            widget.onToken(null);
            return;
          }
          widget.onToken(token.isEmpty ? null : token);
        },
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          // Only the challenge itself may load; any link opens nothing.
          onNavigationRequest: (request) {
            final uri = Uri.parse(request.url);
            final allowed =
                request.url.startsWith(CaptchaConstants.pageUrl) ||
                uri.host == 'challenges.cloudflare.com' ||
                request.url == 'about:blank';
            return allowed
                ? NavigationDecision.navigate
                : NavigationDecision.prevent;
          },
        ),
      )
      ..loadHtmlString(_html(), baseUrl: CaptchaConstants.pageUrl);
  }

  void _retry() {
    setState(() => _failed = false);
    _controller.loadHtmlString(_html(), baseUrl: CaptchaConstants.pageUrl);
  }

  String _html() {
    final siteKey = jsonEncode(CaptchaConstants.siteKey);
    return '''
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;padding:0;background:transparent;}</style>
<script>
  function onloadTurnstile() {
    turnstile.render('#widget', {
      sitekey: $siteKey,
      size: 'flexible',
      theme: 'auto',
      callback: function (token) { Captcha.postMessage(token); },
      'expired-callback': function () { Captcha.postMessage(''); },
      'error-callback': function () { Captcha.postMessage('__error__'); }
    });
  }
</script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onloadTurnstile" async defer></script>
</head>
<body><div id="widget"></div></body>
</html>
''';
  }

  @override
  Widget build(BuildContext context) {
    if (_failed) {
      return Column(
        children: [
          Text(
            'The security check could not load. Check your connection, then try again.',
            style: TextStyle(color: Theme.of(context).colorScheme.error),
            textAlign: TextAlign.center,
          ),
          TextButton(onPressed: _retry, child: const Text('Try again')),
        ],
      );
    }
    return SizedBox(height: 72, child: WebViewWidget(controller: _controller));
  }
}
