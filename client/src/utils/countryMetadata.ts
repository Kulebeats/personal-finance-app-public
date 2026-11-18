export interface CountryMetadata {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  stateLabel: string; // "State", "Province", "Region", "County", etc.
  postalCodeLabel: string; // "ZIP Code", "Postcode", "PIN Code", etc.
  postalCodePattern?: RegExp;
  postalCodeRequired: boolean;
  states?: string[]; // List of major states/provinces/regions
}

export const COUNTRY_METADATA: Record<string, CountryMetadata> = {
  // United States
  US: {
    code: "US",
    name: "United States",
    stateLabel: "State",
    postalCodeLabel: "ZIP Code",
    postalCodePattern: /^\d{5}(-\d{4})?$/,
    postalCodeRequired: true,
    states: [
      "Alabama",
      "Alaska",
      "Arizona",
      "Arkansas",
      "California",
      "Colorado",
      "Connecticut",
      "Delaware",
      "Florida",
      "Georgia",
      "Hawaii",
      "Idaho",
      "Illinois",
      "Indiana",
      "Iowa",
      "Kansas",
      "Kentucky",
      "Louisiana",
      "Maine",
      "Maryland",
      "Massachusetts",
      "Michigan",
      "Minnesota",
      "Mississippi",
      "Missouri",
      "Montana",
      "Nebraska",
      "Nevada",
      "New Hampshire",
      "New Jersey",
      "New Mexico",
      "New York",
      "North Carolina",
      "North Dakota",
      "Ohio",
      "Oklahoma",
      "Oregon",
      "Pennsylvania",
      "Rhode Island",
      "South Carolina",
      "South Dakota",
      "Tennessee",
      "Texas",
      "Utah",
      "Vermont",
      "Virginia",
      "Washington",
      "West Virginia",
      "Wisconsin",
      "Wyoming",
    ],
  },

  // United Kingdom
  GB: {
    code: "GB",
    name: "United Kingdom",
    stateLabel: "County",
    postalCodeLabel: "Postcode",
    postalCodePattern: /^[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}$/i,
    postalCodeRequired: true,
    states: [
      "Greater London",
      "Greater Manchester",
      "West Midlands",
      "West Yorkshire",
      "Merseyside",
      "South Yorkshire",
      "Tyne and Wear",
      "Kent",
      "Essex",
      "Hampshire",
      "Surrey",
      "Lancashire",
      "Hertfordshire",
      "Berkshire",
      "Cheshire",
      "Staffordshire",
      "Devon",
      "Nottinghamshire",
      "Leicestershire",
    ],
  },

  // Canada
  CA: {
    code: "CA",
    name: "Canada",
    stateLabel: "Province",
    postalCodeLabel: "Postal Code",
    postalCodePattern: /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i,
    postalCodeRequired: true,
    states: [
      "Alberta",
      "British Columbia",
      "Manitoba",
      "New Brunswick",
      "Newfoundland and Labrador",
      "Nova Scotia",
      "Ontario",
      "Prince Edward Island",
      "Quebec",
      "Saskatchewan",
    ],
  },

  // Australia
  AU: {
    code: "AU",
    name: "Australia",
    stateLabel: "State",
    postalCodeLabel: "Postcode",
    postalCodePattern: /^\d{4}$/,
    postalCodeRequired: true,
    states: [
      "New South Wales",
      "Victoria",
      "Queensland",
      "Western Australia",
      "South Australia",
      "Tasmania",
      "Australian Capital Territory",
      "Northern Territory",
    ],
  },

  // India
  IN: {
    code: "IN",
    name: "India",
    stateLabel: "State",
    postalCodeLabel: "PIN Code",
    postalCodePattern: /^\d{6}$/,
    postalCodeRequired: true,
    states: [
      "Andhra Pradesh",
      "Arunachal Pradesh",
      "Assam",
      "Bihar",
      "Chhattisgarh",
      "Goa",
      "Gujarat",
      "Haryana",
      "Himachal Pradesh",
      "Jharkhand",
      "Karnataka",
      "Kerala",
      "Madhya Pradesh",
      "Maharashtra",
      "Manipur",
      "Meghalaya",
      "Mizoram",
      "Nagaland",
      "Odisha",
      "Punjab",
      "Rajasthan",
      "Sikkim",
      "Tamil Nadu",
      "Telangana",
      "Tripura",
      "Uttar Pradesh",
      "Uttarakhand",
      "West Bengal",
    ],
  },

  // Zambia
  ZM: {
    code: "ZM",
    name: "Zambia",
    stateLabel: "Province",
    postalCodeLabel: "Postal Code",
    postalCodePattern: /^\d{5}$/,
    postalCodeRequired: false,
    states: [
      "Central",
      "Copperbelt",
      "Eastern",
      "Luapula",
      "Lusaka",
      "Muchinga",
      "Northern",
      "North-Western",
      "Southern",
      "Western",
    ],
  },

  // South Africa
  ZA: {
    code: "ZA",
    name: "South Africa",
    stateLabel: "Province",
    postalCodeLabel: "Postal Code",
    postalCodePattern: /^\d{4}$/,
    postalCodeRequired: true,
    states: [
      "Eastern Cape",
      "Free State",
      "Gauteng",
      "KwaZulu-Natal",
      "Limpopo",
      "Mpumalanga",
      "Northern Cape",
      "North West",
      "Western Cape",
    ],
  },

  // Kenya
  KE: {
    code: "KE",
    name: "Kenya",
    stateLabel: "County",
    postalCodeLabel: "Postal Code",
    postalCodePattern: /^\d{5}$/,
    postalCodeRequired: false,
    states: [
      "Nairobi",
      "Mombasa",
      "Kisumu",
      "Nakuru",
      "Eldoret",
      "Thika",
      "Malindi",
      "Kitale",
      "Garissa",
      "Kakamega",
    ],
  },

  // Nigeria
  NG: {
    code: "NG",
    name: "Nigeria",
    stateLabel: "State",
    postalCodeLabel: "Postal Code",
    postalCodePattern: /^\d{6}$/,
    postalCodeRequired: false,
    states: [
      "Lagos",
      "Kano",
      "Kaduna",
      "Ibadan",
      "Port Harcourt",
      "Benin City",
      "Maiduguri",
      "Zaria",
      "Aba",
      "Jos",
      "Ilorin",
      "Oyo",
      "Enugu",
      "Abeokuta",
      "Abuja",
      "Sokoto",
      "Onitsha",
      "Warri",
      "Ebute Ikorodu",
    ],
  },

  // Germany
  DE: {
    code: "DE",
    name: "Germany",
    stateLabel: "State",
    postalCodeLabel: "Postal Code",
    postalCodePattern: /^\d{5}$/,
    postalCodeRequired: true,
    states: [
      "Baden-Württemberg",
      "Bavaria",
      "Berlin",
      "Brandenburg",
      "Bremen",
      "Hamburg",
      "Hesse",
      "Lower Saxony",
      "Mecklenburg-Vorpommern",
      "North Rhine-Westphalia",
      "Rhineland-Palatinate",
      "Saarland",
      "Saxony",
      "Saxony-Anhalt",
      "Schleswig-Holstein",
      "Thuringia",
    ],
  },

  // France
  FR: {
    code: "FR",
    name: "France",
    stateLabel: "Region",
    postalCodeLabel: "Postal Code",
    postalCodePattern: /^\d{5}$/,
    postalCodeRequired: true,
    states: [
      "Île-de-France",
      "Auvergne-Rhône-Alpes",
      "Nouvelle-Aquitaine",
      "Occitanie",
      "Hauts-de-France",
      "Provence-Alpes-Côte d'Azur",
      "Grand Est",
      "Pays de la Loire",
      "Brittany",
      "Normandy",
      "Bourgogne-Franche-Comté",
      "Centre-Val de Loire",
      "Corsica",
    ],
  },
};

/**
 * Get country-specific metadata for address field labels and validation
 * @param code ISO 3166-1 alpha-2 country code (e.g., "US", "GB", "ZM")
 * @returns CountryMetadata object with labels and validation patterns
 */
export function getCountryMetadata(code: string): CountryMetadata {
  const metadata = COUNTRY_METADATA[code.toUpperCase()];

  if (metadata) {
    return metadata;
  }

  // Fallback for countries not in the metadata list
  return {
    code: code.toUpperCase(),
    name: code,
    stateLabel: "State/Province",
    postalCodeLabel: "Postal Code",
    postalCodeRequired: false,
  };
}

/**
 * Validate postal code for a given country
 * @param postalCode The postal code to validate
 * @param countryCode ISO 3166-1 alpha-2 country code
 * @returns true if valid or validation not required, false otherwise
 */
export function validatePostalCode(
  postalCode: string | undefined,
  countryCode: string
): boolean {
  if (!postalCode) {
    const metadata = getCountryMetadata(countryCode);
    return !metadata.postalCodeRequired;
  }

  const metadata = getCountryMetadata(countryCode);

  if (!metadata.postalCodePattern) {
    return true; // No pattern defined, accept any value
  }

  return metadata.postalCodePattern.test(postalCode);
}
