export interface TimezoneOption {
  value: string; // IANA identifier
  label: string; // Display format
  offset: number; // Minutes from UTC
  cities: string[];
}

export const TIMEZONES: TimezoneOption[] = [
  // UTC-12 to UTC-11
  {
    value: "Pacific/Midway",
    label: "UTC-11:00 Midway Island",
    offset: -660,
    cities: ["Midway"],
  },
  {
    value: "Pacific/Honolulu",
    label: "UTC-10:00 Honolulu, Hawaii",
    offset: -600,
    cities: ["Honolulu"],
  },

  // UTC-9 to UTC-8
  {
    value: "America/Anchorage",
    label: "UTC-09:00 Anchorage, Alaska",
    offset: -540,
    cities: ["Anchorage"],
  },
  {
    value: "America/Los_Angeles",
    label: "UTC-08:00 Los Angeles, San Francisco, Seattle",
    offset: -480,
    cities: ["Los Angeles", "San Francisco", "Seattle"],
  },

  // UTC-7 to UTC-6
  {
    value: "America/Denver",
    label: "UTC-07:00 Denver, Phoenix",
    offset: -420,
    cities: ["Denver", "Phoenix"],
  },
  {
    value: "America/Chicago",
    label: "UTC-06:00 Chicago, Dallas, Houston",
    offset: -360,
    cities: ["Chicago", "Dallas", "Houston"],
  },
  {
    value: "America/Mexico_City",
    label: "UTC-06:00 Mexico City",
    offset: -360,
    cities: ["Mexico City"],
  },

  // UTC-5 to UTC-4
  {
    value: "America/New_York",
    label: "UTC-05:00 New York, Miami, Boston",
    offset: -300,
    cities: ["New York", "Miami", "Boston"],
  },
  {
    value: "America/Toronto",
    label: "UTC-05:00 Toronto",
    offset: -300,
    cities: ["Toronto"],
  },
  {
    value: "America/Bogota",
    label: "UTC-05:00 Bogotá, Lima",
    offset: -300,
    cities: ["Bogotá", "Lima"],
  },
  {
    value: "America/Santiago",
    label: "UTC-04:00 Santiago",
    offset: -240,
    cities: ["Santiago"],
  },

  // UTC-3
  {
    value: "America/Sao_Paulo",
    label: "UTC-03:00 São Paulo, Rio de Janeiro",
    offset: -180,
    cities: ["São Paulo", "Rio de Janeiro"],
  },
  {
    value: "America/Argentina/Buenos_Aires",
    label: "UTC-03:00 Buenos Aires",
    offset: -180,
    cities: ["Buenos Aires"],
  },

  // UTC+0 to UTC+1
  {
    value: "UTC",
    label: "UTC+00:00 Coordinated Universal Time",
    offset: 0,
    cities: [],
  },
  {
    value: "Europe/London",
    label: "UTC+00:00 London, Dublin",
    offset: 0,
    cities: ["London", "Dublin"],
  },
  {
    value: "Europe/Paris",
    label: "UTC+01:00 Paris, Berlin, Rome",
    offset: 60,
    cities: ["Paris", "Berlin", "Rome"],
  },
  {
    value: "Europe/Madrid",
    label: "UTC+01:00 Madrid",
    offset: 60,
    cities: ["Madrid"],
  },
  {
    value: "Africa/Lagos",
    label: "UTC+01:00 Lagos",
    offset: 60,
    cities: ["Lagos"],
  },
  {
    value: "Africa/Casablanca",
    label: "UTC+01:00 Casablanca",
    offset: 60,
    cities: ["Casablanca"],
  },

  // UTC+2 (Zambia and Southern Africa)
  {
    value: "Africa/Lusaka",
    label: "UTC+02:00 Lusaka, Zambia",
    offset: 120,
    cities: ["Lusaka", "Kitwe", "Ndola"],
  },
  {
    value: "Africa/Johannesburg",
    label: "UTC+02:00 Johannesburg, Cape Town, Pretoria",
    offset: 120,
    cities: ["Johannesburg", "Cape Town", "Pretoria"],
  },
  {
    value: "Africa/Harare",
    label: "UTC+02:00 Harare, Zimbabwe",
    offset: 120,
    cities: ["Harare"],
  },
  {
    value: "Africa/Gaborone",
    label: "UTC+02:00 Gaborone, Botswana",
    offset: 120,
    cities: ["Gaborone"],
  },
  {
    value: "Africa/Maputo",
    label: "UTC+02:00 Maputo, Mozambique",
    offset: 120,
    cities: ["Maputo"],
  },
  {
    value: "Africa/Cairo",
    label: "UTC+02:00 Cairo",
    offset: 120,
    cities: ["Cairo"],
  },
  {
    value: "Europe/Athens",
    label: "UTC+02:00 Athens",
    offset: 120,
    cities: ["Athens"],
  },

  // UTC+3
  {
    value: "Africa/Nairobi",
    label: "UTC+03:00 Nairobi, Kampala, Dar es Salaam",
    offset: 180,
    cities: ["Nairobi", "Kampala", "Dar es Salaam"],
  },
  {
    value: "Africa/Addis_Ababa",
    label: "UTC+03:00 Addis Ababa",
    offset: 180,
    cities: ["Addis Ababa"],
  },
  {
    value: "Europe/Moscow",
    label: "UTC+03:00 Moscow",
    offset: 180,
    cities: ["Moscow"],
  },
  {
    value: "Asia/Dubai",
    label: "UTC+04:00 Dubai",
    offset: 240,
    cities: ["Dubai"],
  },

  // UTC+5 to UTC+6
  {
    value: "Asia/Karachi",
    label: "UTC+05:00 Karachi",
    offset: 300,
    cities: ["Karachi"],
  },
  {
    value: "Asia/Kolkata",
    label: "UTC+05:30 Mumbai, Delhi, Bangalore",
    offset: 330,
    cities: ["Mumbai", "Delhi", "Bangalore"],
  },
  {
    value: "Asia/Dhaka",
    label: "UTC+06:00 Dhaka",
    offset: 360,
    cities: ["Dhaka"],
  },

  // UTC+7 to UTC+8
  {
    value: "Asia/Bangkok",
    label: "UTC+07:00 Bangkok, Jakarta",
    offset: 420,
    cities: ["Bangkok", "Jakarta"],
  },
  {
    value: "Asia/Shanghai",
    label: "UTC+08:00 Beijing, Shanghai, Hong Kong",
    offset: 480,
    cities: ["Beijing", "Shanghai", "Hong Kong"],
  },
  {
    value: "Asia/Singapore",
    label: "UTC+08:00 Singapore, Kuala Lumpur",
    offset: 480,
    cities: ["Singapore", "Kuala Lumpur"],
  },
  {
    value: "Australia/Perth",
    label: "UTC+08:00 Perth",
    offset: 480,
    cities: ["Perth"],
  },

  // UTC+9 to UTC+10
  {
    value: "Asia/Tokyo",
    label: "UTC+09:00 Tokyo",
    offset: 540,
    cities: ["Tokyo"],
  },
  {
    value: "Asia/Seoul",
    label: "UTC+09:00 Seoul",
    offset: 540,
    cities: ["Seoul"],
  },
  {
    value: "Australia/Sydney",
    label: "UTC+10:00 Sydney, Melbourne",
    offset: 600,
    cities: ["Sydney", "Melbourne"],
  },
  {
    value: "Australia/Brisbane",
    label: "UTC+10:00 Brisbane",
    offset: 600,
    cities: ["Brisbane"],
  },

  // UTC+12 to UTC+13
  {
    value: "Pacific/Auckland",
    label: "UTC+12:00 Auckland, New Zealand",
    offset: 720,
    cities: ["Auckland"],
  },
  {
    value: "Pacific/Fiji",
    label: "UTC+12:00 Fiji",
    offset: 720,
    cities: ["Fiji"],
  },
];

// Get current time in a timezone
export function getCurrentTimeInTimezone(timezone: string): string {
  try {
    return new Date().toLocaleTimeString("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "";
  }
}

// Auto-detect browser timezone
export function detectBrowserTimezone(): string {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Check if detected timezone exists in our list
    const exists = TIMEZONES.find((tz) => tz.value === detected);
    return exists ? detected : "Africa/Lusaka"; // Default to Lusaka
  } catch {
    return "Africa/Lusaka";
  }
}

// Search timezones
export function searchTimezones(query: string): TimezoneOption[] {
  if (!query) return TIMEZONES;

  const lowerQuery = query.toLowerCase();
  return TIMEZONES.filter(
    (tz) =>
      tz.label.toLowerCase().includes(lowerQuery) ||
      tz.value.toLowerCase().includes(lowerQuery) ||
      tz.cities.some((city) => city.toLowerCase().includes(lowerQuery))
  );
}
