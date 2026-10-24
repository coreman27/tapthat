// CloudFront Function (cloudfront-js-2.0, viewer-request) for the retired web version of
// DON'T TAP THAT (donttapthat.com and www). Every old address forwards to the company pages, so the
// privacy URL printed in older App Store listings and any shared challenge link keeps working.
// Fragments (#c=...) are kept by the browser across a redirect.
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // Home-screen installs of the old web game check /sw.js for updates; let the kill-switch through.
  if (uri === '/sw.js') return request;

  var base = 'https://hallsoftwaresolutions.com/dont-tap-that/';
  var target = base;
  if (uri === '/privacy.html' || uri === '/privacy' || uri === '/privacy/') target = base + 'privacy/';
  else if (uri === '/support' || uri === '/support/') target = base + 'support/';

  return {
    statusCode: 301,
    statusDescription: 'Moved Permanently',
    headers: {
      location: { value: target },
      'cache-control': { value: 'public, max-age=3600' }
    }
  };
}
