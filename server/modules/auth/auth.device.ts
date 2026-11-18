/**
 * Auth Module Device Utilities
 *
 * Device detection and identification helpers.
 * Extracted from auth.service.ts to maintain LOC limits.
 *
 * @module modules/auth/auth.device
 */

import { DeviceInfo, SessionDeviceInfo } from "./auth.types";

/**
 * Parse device info from user agent string
 *
 * Extracts browser, OS, and device type from a user agent string.
 * Used for device tracking and new device notifications.
 */
export function parseDeviceInfo(userAgent: string): DeviceInfo {
  let browser = "Unknown Browser";
  let os = "Unknown OS";
  let deviceType: "desktop" | "mobile" | "tablet" = "desktop";

  // Detect browser
  if (userAgent.includes("Firefox")) {
    browser = "Firefox";
  } else if (userAgent.includes("Edg")) {
    browser = "Edge";
  } else if (userAgent.includes("Chrome")) {
    browser = "Chrome";
  } else if (userAgent.includes("Safari")) {
    browser = "Safari";
  } else if (userAgent.includes("Opera") || userAgent.includes("OPR")) {
    browser = "Opera";
  }

  // Detect OS (order matters: check mobile OS before generic "Linux")
  if (userAgent.includes("Android")) {
    os = "Android";
    deviceType = "mobile";
  } else if (userAgent.includes("iPhone")) {
    os = "iOS";
    deviceType = "mobile";
  } else if (userAgent.includes("iPad")) {
    os = "iPadOS";
    deviceType = "tablet";
  } else if (userAgent.includes("Windows")) {
    os = "Windows";
  } else if (userAgent.includes("Mac OS")) {
    os = "macOS";
  } else if (userAgent.includes("Linux")) {
    os = "Linux";
  }

  // Check for tablets
  if (userAgent.includes("Tablet") || userAgent.includes("iPad")) {
    deviceType = "tablet";
  } else if (
    userAgent.includes("Mobile") ||
    userAgent.includes("Android") ||
    userAgent.includes("iPhone")
  ) {
    deviceType = "mobile";
  }

  return {
    deviceName: `${browser} on ${os}`,
    deviceType,
    browser,
    os,
  };
}

/**
 * Check if device session is already known
 *
 * Compares current device info against existing sessions
 * to determine if this is a new device login.
 */
export function isKnownDeviceSession(
  sessions: SessionDeviceInfo[],
  deviceInfo: DeviceInfo
): boolean {
  const normalized = (value?: string | null) =>
    (value ?? "").trim().toLowerCase();

  const browser = normalized(deviceInfo.browser);
  const os = normalized(deviceInfo.os);
  const deviceType = normalized(deviceInfo.deviceType);
  const deviceName = normalized(deviceInfo.deviceName);

  return sessions.some((session) => {
    const sessionBrowser = normalized(session.browser);
    const sessionOs = normalized(session.os);
    const sessionType = normalized(session.deviceType);
    const sessionName = normalized(session.deviceName);

    if (sessionBrowser || sessionOs || sessionType) {
      return (
        sessionBrowser === browser &&
        sessionOs === os &&
        sessionType === deviceType
      );
    }

    if (sessionName === "" || deviceName === "") {
      return false;
    }

    if (sessionName === deviceName) {
      return true;
    }

    return sessionName.includes(browser) && sessionName.includes("browser");
  });
}

/**
 * Format device description for display
 *
 * Creates a human-readable description of a device
 * for use in notification emails and UI display.
 */
export function formatDeviceDescription(device: DeviceInfo): string {
  const typeLabels = {
    desktop: "Desktop",
    mobile: "Mobile",
    tablet: "Tablet",
  };
  return `${device.browser} on ${device.os} (${typeLabels[device.deviceType]})`;
}
