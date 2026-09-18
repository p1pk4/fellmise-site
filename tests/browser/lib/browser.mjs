/* Shared browser settings: one place, so smoke and visual see the same thing. */

/* WebGL in headless Chromium comes from SwiftShader (software). The flag is
   needed since Chrome 13x made SwiftShader-for-WebGL opt-in. */
export const LAUNCH = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };

/* The pages pull fonts from Google. Tests must not depend on the network, so
   every non-local request is answered locally with an empty body and counted.
   Fonts then fall back — identically for base and head. */
export async function stubExternal(page) {
  const seen = [];
  await page.route((url) => !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url.href), (route) => {
    const url = route.request().url();
    seen.push(url);
    const css = /\.css|fonts\.googleapis/.test(url);
    return route.fulfill({ status: 200, contentType: css ? 'text/css' : 'application/octet-stream', body: '' });
  });
  return seen;
}
