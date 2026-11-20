import { describe, expect, test } from "vitest";
import { cannotDownloadHere } from "./savePdf";

const ua = {
  chromeDesktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 14; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36",
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  androidWebView: "Mozilla/5.0 (Linux; Android 14; SM-A145F; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0 Mobile Safari/537.36",
  facebook: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36 [FBAN/EMA;FBLC/en_US;FBAV/400.0]",
  instagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0"
};

describe("where a page cannot save its own PDF", () => {
  test("laptops and Android Chrome download normally", () => {
    expect(cannotDownloadHere(ua.chromeDesktop, false)).toBe(false);
    expect(cannotDownloadHere(ua.chromeAndroid, false)).toBe(false);
  });

  test("iPhones, in-app browsers and home-screen apps use the share sheet or a link", () => {
    expect(cannotDownloadHere(ua.iphoneSafari, false)).toBe(true);
    expect(cannotDownloadHere(ua.androidWebView, false)).toBe(true);
    expect(cannotDownloadHere(ua.facebook, false)).toBe(true);
    expect(cannotDownloadHere(ua.instagram, false)).toBe(true);
    expect(cannotDownloadHere(ua.chromeDesktop, true)).toBe(true);
  });
});
