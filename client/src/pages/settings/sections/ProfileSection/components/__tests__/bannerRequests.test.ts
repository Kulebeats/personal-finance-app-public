/**
 * BannerUpload request helpers — unit tests
 *
 * Guards two past defects:
 *  1. Banner mutations used raw fetch with no x-csrf-token (403 in a real
 *     browser session) — they must go through apiCall.
 *  2. The component read `data.bannerUrl` off the raw V7 envelope
 *     ({ success, data: { bannerUrl } }), which is undefined —
 *     uploadBannerRequest must unwrap the envelope.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  uploadBannerRequest,
  deleteBannerRequest,
} from "../BannerUpload";
import { clearCsrfToken } from "@/lib/api";

const CSRF_TOKEN = "test-csrf-token";
const BANNER_URL = "/uploads/banners/hh-1/abc.png";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("banner request helpers", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearCsrfToken();
    fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("/api/csrf-token")) {
        return jsonResponse({ csrfToken: CSRF_TOKEN });
      }
      return jsonResponse({
        success: true,
        data: { bannerUrl: BANNER_URL },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearCsrfToken();
  });

  function bannerCall(): { url: string; init: RequestInit } {
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/api/settings/profile/banner"),
    );
    expect(call).toBeDefined();
    return { url: String(call![0]), init: call![1] as RequestInit };
  }

  it("uploadBannerRequest POSTs FormData with x-csrf-token and unwraps the envelope", async () => {
    const file = new File(["png-bytes"], "cover.png", { type: "image/png" });

    const result = await uploadBannerRequest(file);

    // Envelope unwrapped: the component's `data.bannerUrl` gets the URL.
    expect(result).toEqual({ bannerUrl: BANNER_URL });

    const { init } = bannerCall();
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers["x-csrf-token"]).toBe(CSRF_TOKEN);
    // FormData bodies must not get a JSON content-type (browser sets the
    // multipart boundary itself).
    expect(headers["Content-Type"]).toBeUndefined();

    expect(init.body).toBeInstanceOf(FormData);
    const sent = (init.body as FormData).get("banner");
    expect(sent).toBeInstanceOf(File);
    expect((sent as File).name).toBe("cover.png");
  });

  it("deleteBannerRequest sends DELETE with x-csrf-token", async () => {
    await deleteBannerRequest();

    const { init } = bannerCall();
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>)["x-csrf-token"]).toBe(
      CSRF_TOKEN,
    );
  });

  it("uploadBannerRequest surfaces the server error message on failure", async () => {
    fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
      if (String(url).includes("/api/csrf-token")) {
        return jsonResponse({ csrfToken: CSRF_TOKEN });
      }
      return jsonResponse(
        {
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Invalid file type" },
        },
        400,
      );
    });

    const file = new File(["nope"], "cover.txt", { type: "text/plain" });
    await expect(uploadBannerRequest(file)).rejects.toThrow(
      "Invalid file type",
    );
  });
});
