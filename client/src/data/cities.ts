export interface City {
  name: string;
  country: string;
  countryCode: string;
  timezone: string;
}

export const CITIES: City[] = [
  // Zambian Cities (Priority)
  {
    name: "Lusaka",
    country: "Zambia",
    countryCode: "ZM",
    timezone: "Africa/Lusaka",
  },
  {
    name: "Kitwe",
    country: "Zambia",
    countryCode: "ZM",
    timezone: "Africa/Lusaka",
  },
  {
    name: "Ndola",
    country: "Zambia",
    countryCode: "ZM",
    timezone: "Africa/Lusaka",
  },
  {
    name: "Kabwe",
    country: "Zambia",
    countryCode: "ZM",
    timezone: "Africa/Lusaka",
  },
  {
    name: "Chingola",
    country: "Zambia",
    countryCode: "ZM",
    timezone: "Africa/Lusaka",
  },
  {
    name: "Mufulira",
    country: "Zambia",
    countryCode: "ZM",
    timezone: "Africa/Lusaka",
  },
  {
    name: "Livingstone",
    country: "Zambia",
    countryCode: "ZM",
    timezone: "Africa/Lusaka",
  },
  {
    name: "Luanshya",
    country: "Zambia",
    countryCode: "ZM",
    timezone: "Africa/Lusaka",
  },
  {
    name: "Kasama",
    country: "Zambia",
    countryCode: "ZM",
    timezone: "Africa/Lusaka",
  },
  {
    name: "Chipata",
    country: "Zambia",
    countryCode: "ZM",
    timezone: "Africa/Lusaka",
  },
  {
    name: "Solwezi",
    country: "Zambia",
    countryCode: "ZM",
    timezone: "Africa/Lusaka",
  },
  {
    name: "Mongu",
    country: "Zambia",
    countryCode: "ZM",
    timezone: "Africa/Lusaka",
  },

  // Southern Africa
  {
    name: "Johannesburg",
    country: "South Africa",
    countryCode: "ZA",
    timezone: "Africa/Johannesburg",
  },
  {
    name: "Cape Town",
    country: "South Africa",
    countryCode: "ZA",
    timezone: "Africa/Johannesburg",
  },
  {
    name: "Durban",
    country: "South Africa",
    countryCode: "ZA",
    timezone: "Africa/Johannesburg",
  },
  {
    name: "Pretoria",
    country: "South Africa",
    countryCode: "ZA",
    timezone: "Africa/Johannesburg",
  },
  {
    name: "Gaborone",
    country: "Botswana",
    countryCode: "BW",
    timezone: "Africa/Gaborone",
  },
  {
    name: "Harare",
    country: "Zimbabwe",
    countryCode: "ZW",
    timezone: "Africa/Harare",
  },
  {
    name: "Bulawayo",
    country: "Zimbabwe",
    countryCode: "ZW",
    timezone: "Africa/Harare",
  },
  {
    name: "Windhoek",
    country: "Namibia",
    countryCode: "NA",
    timezone: "Africa/Windhoek",
  },
  {
    name: "Maputo",
    country: "Mozambique",
    countryCode: "MZ",
    timezone: "Africa/Maputo",
  },
  {
    name: "Lilongwe",
    country: "Malawi",
    countryCode: "MW",
    timezone: "Africa/Blantyre",
  },
  {
    name: "Blantyre",
    country: "Malawi",
    countryCode: "MW",
    timezone: "Africa/Blantyre",
  },

  // East Africa
  {
    name: "Nairobi",
    country: "Kenya",
    countryCode: "KE",
    timezone: "Africa/Nairobi",
  },
  {
    name: "Mombasa",
    country: "Kenya",
    countryCode: "KE",
    timezone: "Africa/Nairobi",
  },
  {
    name: "Dar es Salaam",
    country: "Tanzania",
    countryCode: "TZ",
    timezone: "Africa/Dar_es_Salaam",
  },
  {
    name: "Kampala",
    country: "Uganda",
    countryCode: "UG",
    timezone: "Africa/Kampala",
  },
  {
    name: "Kigali",
    country: "Rwanda",
    countryCode: "RW",
    timezone: "Africa/Kigali",
  },
  {
    name: "Addis Ababa",
    country: "Ethiopia",
    countryCode: "ET",
    timezone: "Africa/Addis_Ababa",
  },

  // West Africa
  {
    name: "Lagos",
    country: "Nigeria",
    countryCode: "NG",
    timezone: "Africa/Lagos",
  },
  {
    name: "Abuja",
    country: "Nigeria",
    countryCode: "NG",
    timezone: "Africa/Lagos",
  },
  {
    name: "Accra",
    country: "Ghana",
    countryCode: "GH",
    timezone: "Africa/Accra",
  },
  {
    name: "Dakar",
    country: "Senegal",
    countryCode: "SN",
    timezone: "Africa/Dakar",
  },
  {
    name: "Abidjan",
    country: "Ivory Coast",
    countryCode: "CI",
    timezone: "Africa/Abidjan",
  },

  // North Africa
  {
    name: "Cairo",
    country: "Egypt",
    countryCode: "EG",
    timezone: "Africa/Cairo",
  },
  {
    name: "Casablanca",
    country: "Morocco",
    countryCode: "MA",
    timezone: "Africa/Casablanca",
  },
  {
    name: "Algiers",
    country: "Algeria",
    countryCode: "DZ",
    timezone: "Africa/Algiers",
  },
  {
    name: "Tunis",
    country: "Tunisia",
    countryCode: "TN",
    timezone: "Africa/Tunis",
  },

  // Europe
  {
    name: "London",
    country: "United Kingdom",
    countryCode: "GB",
    timezone: "Europe/London",
  },
  {
    name: "Paris",
    country: "France",
    countryCode: "FR",
    timezone: "Europe/Paris",
  },
  {
    name: "Berlin",
    country: "Germany",
    countryCode: "DE",
    timezone: "Europe/Berlin",
  },
  {
    name: "Madrid",
    country: "Spain",
    countryCode: "ES",
    timezone: "Europe/Madrid",
  },
  {
    name: "Rome",
    country: "Italy",
    countryCode: "IT",
    timezone: "Europe/Rome",
  },
  {
    name: "Amsterdam",
    country: "Netherlands",
    countryCode: "NL",
    timezone: "Europe/Amsterdam",
  },
  {
    name: "Brussels",
    country: "Belgium",
    countryCode: "BE",
    timezone: "Europe/Brussels",
  },
  {
    name: "Vienna",
    country: "Austria",
    countryCode: "AT",
    timezone: "Europe/Vienna",
  },
  {
    name: "Stockholm",
    country: "Sweden",
    countryCode: "SE",
    timezone: "Europe/Stockholm",
  },
  {
    name: "Oslo",
    country: "Norway",
    countryCode: "NO",
    timezone: "Europe/Oslo",
  },
  {
    name: "Copenhagen",
    country: "Denmark",
    countryCode: "DK",
    timezone: "Europe/Copenhagen",
  },
  {
    name: "Dublin",
    country: "Ireland",
    countryCode: "IE",
    timezone: "Europe/Dublin",
  },
  {
    name: "Lisbon",
    country: "Portugal",
    countryCode: "PT",
    timezone: "Europe/Lisbon",
  },
  {
    name: "Warsaw",
    country: "Poland",
    countryCode: "PL",
    timezone: "Europe/Warsaw",
  },
  {
    name: "Prague",
    country: "Czech Republic",
    countryCode: "CZ",
    timezone: "Europe/Prague",
  },
  {
    name: "Budapest",
    country: "Hungary",
    countryCode: "HU",
    timezone: "Europe/Budapest",
  },
  {
    name: "Athens",
    country: "Greece",
    countryCode: "GR",
    timezone: "Europe/Athens",
  },
  {
    name: "Moscow",
    country: "Russia",
    countryCode: "RU",
    timezone: "Europe/Moscow",
  },

  // North America
  {
    name: "New York",
    country: "United States",
    countryCode: "US",
    timezone: "America/New_York",
  },
  {
    name: "Los Angeles",
    country: "United States",
    countryCode: "US",
    timezone: "America/Los_Angeles",
  },
  {
    name: "Chicago",
    country: "United States",
    countryCode: "US",
    timezone: "America/Chicago",
  },
  {
    name: "Houston",
    country: "United States",
    countryCode: "US",
    timezone: "America/Chicago",
  },
  {
    name: "Phoenix",
    country: "United States",
    countryCode: "US",
    timezone: "America/Phoenix",
  },
  {
    name: "Philadelphia",
    country: "United States",
    countryCode: "US",
    timezone: "America/New_York",
  },
  {
    name: "San Antonio",
    country: "United States",
    countryCode: "US",
    timezone: "America/Chicago",
  },
  {
    name: "San Diego",
    country: "United States",
    countryCode: "US",
    timezone: "America/Los_Angeles",
  },
  {
    name: "Dallas",
    country: "United States",
    countryCode: "US",
    timezone: "America/Chicago",
  },
  {
    name: "San Francisco",
    country: "United States",
    countryCode: "US",
    timezone: "America/Los_Angeles",
  },
  {
    name: "Seattle",
    country: "United States",
    countryCode: "US",
    timezone: "America/Los_Angeles",
  },
  {
    name: "Boston",
    country: "United States",
    countryCode: "US",
    timezone: "America/New_York",
  },
  {
    name: "Miami",
    country: "United States",
    countryCode: "US",
    timezone: "America/New_York",
  },
  {
    name: "Toronto",
    country: "Canada",
    countryCode: "CA",
    timezone: "America/Toronto",
  },
  {
    name: "Vancouver",
    country: "Canada",
    countryCode: "CA",
    timezone: "America/Vancouver",
  },
  {
    name: "Montreal",
    country: "Canada",
    countryCode: "CA",
    timezone: "America/Toronto",
  },
  {
    name: "Mexico City",
    country: "Mexico",
    countryCode: "MX",
    timezone: "America/Mexico_City",
  },

  // South America
  {
    name: "São Paulo",
    country: "Brazil",
    countryCode: "BR",
    timezone: "America/Sao_Paulo",
  },
  {
    name: "Rio de Janeiro",
    country: "Brazil",
    countryCode: "BR",
    timezone: "America/Sao_Paulo",
  },
  {
    name: "Buenos Aires",
    country: "Argentina",
    countryCode: "AR",
    timezone: "America/Argentina/Buenos_Aires",
  },
  {
    name: "Lima",
    country: "Peru",
    countryCode: "PE",
    timezone: "America/Lima",
  },
  {
    name: "Bogotá",
    country: "Colombia",
    countryCode: "CO",
    timezone: "America/Bogota",
  },
  {
    name: "Santiago",
    country: "Chile",
    countryCode: "CL",
    timezone: "America/Santiago",
  },

  // Asia
  {
    name: "Tokyo",
    country: "Japan",
    countryCode: "JP",
    timezone: "Asia/Tokyo",
  },
  {
    name: "Beijing",
    country: "China",
    countryCode: "CN",
    timezone: "Asia/Shanghai",
  },
  {
    name: "Shanghai",
    country: "China",
    countryCode: "CN",
    timezone: "Asia/Shanghai",
  },
  {
    name: "Hong Kong",
    country: "Hong Kong",
    countryCode: "HK",
    timezone: "Asia/Hong_Kong",
  },
  {
    name: "Singapore",
    country: "Singapore",
    countryCode: "SG",
    timezone: "Asia/Singapore",
  },
  {
    name: "Seoul",
    country: "South Korea",
    countryCode: "KR",
    timezone: "Asia/Seoul",
  },
  {
    name: "Mumbai",
    country: "India",
    countryCode: "IN",
    timezone: "Asia/Kolkata",
  },
  {
    name: "Delhi",
    country: "India",
    countryCode: "IN",
    timezone: "Asia/Kolkata",
  },
  {
    name: "Bangalore",
    country: "India",
    countryCode: "IN",
    timezone: "Asia/Kolkata",
  },
  {
    name: "Dubai",
    country: "United Arab Emirates",
    countryCode: "AE",
    timezone: "Asia/Dubai",
  },
  {
    name: "Bangkok",
    country: "Thailand",
    countryCode: "TH",
    timezone: "Asia/Bangkok",
  },
  {
    name: "Kuala Lumpur",
    country: "Malaysia",
    countryCode: "MY",
    timezone: "Asia/Kuala_Lumpur",
  },
  {
    name: "Jakarta",
    country: "Indonesia",
    countryCode: "ID",
    timezone: "Asia/Jakarta",
  },
  {
    name: "Manila",
    country: "Philippines",
    countryCode: "PH",
    timezone: "Asia/Manila",
  },
  {
    name: "Karachi",
    country: "Pakistan",
    countryCode: "PK",
    timezone: "Asia/Karachi",
  },
  {
    name: "Istanbul",
    country: "Turkey",
    countryCode: "TR",
    timezone: "Europe/Istanbul",
  },

  // Oceania
  {
    name: "Sydney",
    country: "Australia",
    countryCode: "AU",
    timezone: "Australia/Sydney",
  },
  {
    name: "Melbourne",
    country: "Australia",
    countryCode: "AU",
    timezone: "Australia/Melbourne",
  },
  {
    name: "Brisbane",
    country: "Australia",
    countryCode: "AU",
    timezone: "Australia/Brisbane",
  },
  {
    name: "Perth",
    country: "Australia",
    countryCode: "AU",
    timezone: "Australia/Perth",
  },
  {
    name: "Auckland",
    country: "New Zealand",
    countryCode: "NZ",
    timezone: "Pacific/Auckland",
  },
];

// Search function with typo detection
export function searchCities(query: string): City[] {
  if (!query) return CITIES.slice(0, 20); // Return first 20 cities if no query

  const lowerQuery = query.toLowerCase();

  // Exact and partial matches
  const matches = CITIES.filter(
    (city) =>
      city.name.toLowerCase().includes(lowerQuery) ||
      city.country.toLowerCase().includes(lowerQuery)
  );

  // Prioritize Zambian cities
  return matches.sort((a, b) => {
    if (a.countryCode === "ZM" && b.countryCode !== "ZM") return -1;
    if (a.countryCode !== "ZM" && b.countryCode === "ZM") return 1;
    return 0;
  });
}

// Auto-capitalize city name
export function capitalizeCityName(name: string): string {
  return name
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
