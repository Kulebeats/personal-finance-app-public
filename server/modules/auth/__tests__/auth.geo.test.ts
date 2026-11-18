import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  lookupGeoLocation,
  checkGeoAnomaly,
  GEO_ANOMALY_CONFIG,
  formatLocation,
} from "../strategies/geo-anomaly";
import geoip from "fast-geoip";
import { db } from "../../../db";

// Mock dependencies
vi.mock("fast-geoip", () => ({
  default: {
    lookup: vi.fn(),
  },
}));

// Mock DB chain
const { mockSelect, mockFrom, mockWhere, mockOrderBy, mockLimit } = vi.hoisted(
  () => {
    const mockLimit = vi.fn();
    const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
    return { mockSelect, mockFrom, mockWhere, mockOrderBy, mockLimit };
  },
);

vi.mock("../../../db", () => ({
  db: {
    select: mockSelect,
  },
}));

describe("Geo Anomaly Detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    GEO_ANOMALY_CONFIG.enabled = true;
    GEO_ANOMALY_CONFIG.suspiciousCountries = ["NK"];

    // Reset DB mock chain
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockOrderBy.mockReturnValue({ limit: mockLimit });
  });

  describe("lookupGeoLocation", () => {
    it("should return localhost for local IPs", async () => {
      const result = await lookupGeoLocation("127.0.0.1");
      expect(result.countryCode).toBe("LO");
      expect(result.country).toBe("Localhost");
    });

    it("should return nulls if lookup fails", async () => {
      (geoip.lookup as any).mockResolvedValue(null);
      const result = await lookupGeoLocation("1.2.3.4");
      expect(result.countryCode).toBeNull();
    });

    it("should return geo data from library", async () => {
      (geoip.lookup as any).mockResolvedValue({
        country: "US",
        region: "CA",
        city: "Mountain View",
        ll: [37, -122],
        timezone: "America/Los_Angeles",
      });

      const result = await lookupGeoLocation("8.8.8.8");
      expect(result.countryCode).toBe("US");
      expect(result.city).toBe("Mountain View");
    });
  });

  describe("checkGeoAnomaly", () => {
    // Helper to mock current location
    const mockCurrentLocation = (country: string) => {
      (geoip.lookup as any).mockResolvedValue({
        country: country,
        region: "NY",
        city: "New York",
        ll: [40, -74],
      });
    };

    it("should return low risk if disabled", async () => {
      GEO_ANOMALY_CONFIG.enabled = false;
      const result = await checkGeoAnomaly("user1", "8.8.8.8");
      expect(result.isAnomaly).toBe(false);
      expect(result.riskLevel).toBe("low");
    });

    it("should return low risk if location unknown", async () => {
      (geoip.lookup as any).mockResolvedValue(null);
      const result = await checkGeoAnomaly("user1", "1.1.1.1");
      expect(result.isAnomaly).toBe(false);
      expect(result.location?.countryCode).toBeNull();
    });

    it("should return low risk if no login history", async () => {
      mockCurrentLocation("US");
      mockLimit.mockResolvedValue([]); // No history

      const result = await checkGeoAnomaly("user1", "8.8.8.8");

      expect(result.isAnomaly).toBe(false);
      expect(result.riskLevel).toBe("low");
    });

    it("should return low risk if country matches history", async () => {
      mockCurrentLocation("US");
      mockLimit.mockResolvedValue([
        { location: "New York, NY, US" },
        { location: "London, UK" }, // Mixed history
      ]);

      const result = await checkGeoAnomaly("user1", "8.8.8.8");

      expect(result.isAnomaly).toBe(false);
      expect(result.riskLevel).toBe("low");
    });

    it("should return medium risk (anomaly) if new country", async () => {
      mockCurrentLocation("FR"); // France (new)
      mockLimit.mockResolvedValue([
        { location: "New York, NY, US" },
        { location: "San Francisco, CA, US" },
      ]);

      const result = await checkGeoAnomaly("user1", "8.8.8.8");

      expect(result.isAnomaly).toBe(true);
      expect(result.riskLevel).toBe("medium");
      expect(result.reason).toContain("new country");
    });

    it("should return high risk if suspicious country", async () => {
      mockCurrentLocation("NK"); // Suspicious
      mockLimit.mockResolvedValue([{ location: "New York, NY, US" }]);

      const result = await checkGeoAnomaly("user1", "8.8.8.8");

      expect(result.isAnomaly).toBe(true);
      expect(result.riskLevel).toBe("high");
      expect(result.reason).toContain("flagged country");
    });
  });

  describe("formatLocation", () => {
    it("formats geolocation data as plain text for React-rendered login history", () => {
      expect(
        formatLocation({
          country: "US",
          countryCode: "US",
          region: "CA",
          city: "<San Francisco>",
          latitude: null,
          longitude: null,
          timezone: null,
        }),
      ).toBe("<San Francisco>, CA, US");
    });
  });
});
